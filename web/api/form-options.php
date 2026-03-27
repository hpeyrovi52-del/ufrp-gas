<?php
/**
 * =========================================================
 * UFRP LOCAL API - FORM OPTIONS BRIDGE
 * =========================================================
 */

header("Content-Type: application/json; charset=utf-8");

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'domain'   => $_SERVER['HTTP_HOST'],
    'secure'   => $https,
    'httponly' => true,
    'samesite' => 'Lax',
]);

session_start();

$user = $_SESSION["UFRP_USER"] ?? null;
$email = strtolower(trim((string)($user["email"] ?? "")));

if ($email === "") {
    http_response_code(401);
    echo json_encode([
        "ok" => false,
        "error" => "NOT_AUTHENTICATED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

session_write_close();

$formKey = trim((string)($_GET["formKey"] ?? $_POST["formKey"] ?? ""));

if ($formKey === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "FORMKEY_REQUIRED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$nodeUrl = "http://127.0.0.1:3000/internal/cache/form-options";

$payload = json_encode([
    "formKey" => $formKey,
    "email"   => $email
], JSON_UNESCAPED_UNICODE);

$ch = curl_init($nodeUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Content-Type: application/json; charset=utf-8"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
curl_setopt($ch, CURLOPT_TIMEOUT, 120);

$responseBody = curl_exec($ch);
$curlErr = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($responseBody === false) {
    http_response_code(502);
    echo json_encode([
        "ok" => false,
        "error" => "LOCAL_API_UNREACHABLE",
        "details" => $curlErr
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$parsed = json_decode($responseBody, true);

if (!is_array($parsed)) {
    http_response_code(502);
    echo json_encode([
        "ok" => false,
        "error" => "LOCAL_API_INVALID_JSON",
        "httpCode" => $httpCode,
        "raw" => substr((string)$responseBody, 0, 300)
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($httpCode >= 400) {
    http_response_code($httpCode);
} else {
    http_response_code(200);
}

echo json_encode($parsed, JSON_UNESCAPED_UNICODE);