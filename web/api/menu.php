<?php
/**
 * =========================================================
 * UFRP LOCAL API - MENU BRIDGE
 * =========================================================
 *
 * PHASE 1 - STEP 5
 *
 * Purpose:
 * - Browser calls this PHP endpoint
 * - PHP checks logged-in session
 * - PHP forwards request to local Node internal API
 * - Returns JSON menu response
 *
 * IMPORTANT:
 * - Browser should call /api/menu.php
 * - Browser should NOT call Node directly
 */

/* ---------------------------------------------------------
 * RESPONSE TYPE
 * --------------------------------------------------------- */
header("Content-Type: application/json; charset=utf-8");

/* ---------------------------------------------------------
 * SESSION COOKIE HARDENING
 * --------------------------------------------------------- */
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

/* ---------------------------------------------------------
 * REQUIRE LOGGED-IN USER
 * --------------------------------------------------------- */
$user = $_SESSION["UFRP_USER"] ?? null;
$email = strtolower(trim((string)($user["email"] ?? "")));
$fullName = trim((string)($user["fullName"] ?? ""));

if ($email === "") {
    http_response_code(401);
    echo json_encode([
        "ok" => false,
        "error" => "NOT_AUTHENTICATED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

session_write_close();

/* ---------------------------------------------------------
 * CALL LOCAL NODE INTERNAL API
 * --------------------------------------------------------- */
$nodeUrl = "http://127.0.0.1:3000/internal/cache/menu";

$payload = json_encode([
    "email"    => $email,
    "fullName" => $fullName
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

/* ---------------------------------------------------------
 * HANDLE NODE CONNECTION FAILURE
 * --------------------------------------------------------- */
if ($responseBody === false) {
    http_response_code(502);
    echo json_encode([
        "ok" => false,
        "error" => "LOCAL_API_UNREACHABLE",
        "details" => $curlErr
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------------------------------------------------------
 * PASS THROUGH NODE JSON
 * --------------------------------------------------------- */
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