<?php
/**
 * =========================================================
 * UFRP LOCAL API - SUBMIT LOCAL BRIDGE
 * =========================================================
 *
 * Purpose:
 * - Browser calls this PHP endpoint
 * - PHP checks logged-in session
 * - PHP forwards submission payload to local Node internal API
 * - Returns JSON submission queue response
 *
 * IMPORTANT:
 * - Browser should call /api/submit-local.php
 * - Browser should NOT call Node directly
 */

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

error_log("UFRP submit-local.php HIT at " . gmdate("c"));

/* ---------------------------------------------------------
 * REQUIRE POST
 * --------------------------------------------------------- */
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode([
        "ok" => false,
        "error" => "METHOD_NOT_ALLOWED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------------------------------------------------------
 * READ BROWSER JSON BODY
 * --------------------------------------------------------- */
$rawBody = file_get_contents("php://input");
if (!is_string($rawBody) || trim($rawBody) === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "EMPTY_BODY"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$parsed = json_decode($rawBody, true);
if (!is_array($parsed)) {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "INVALID_JSON"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------------------------------------------------------
 * BUILD NODE PAYLOAD
 * --------------------------------------------------------- */
$formKey = trim((string)($parsed["formKey"] ?? ""));
$submissionUid = trim((string)($parsed["submissionUid"] ?? ""));
$answers = isset($parsed["answers"]) && is_array($parsed["answers"]) ? $parsed["answers"] : [];
$localFiles = isset($parsed["localFiles"]) && is_array($parsed["localFiles"]) ? $parsed["localFiles"] : [];

if ($formKey === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "FORMKEY_REQUIRED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($submissionUid === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "SUBMISSION_UID_REQUIRED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$nodePayload = json_encode([
    "formKey"       => $formKey,
    "submissionUid" => $submissionUid,
    "email"         => $email,
    "fullName"      => $fullName,
    "answers"       => $answers,
    "localFiles"    => $localFiles
], JSON_UNESCAPED_UNICODE);

/* ---------------------------------------------------------
 * CALL LOCAL NODE INTERNAL API
 * --------------------------------------------------------- */
$nodeUrl = "http://127.0.0.1:3000/internal/submit-local";

$ch = curl_init($nodeUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Content-Type: application/json; charset=utf-8"
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $nodePayload);
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
$nodeRes = json_decode($responseBody, true);

if (!is_array($nodeRes)) {
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

echo json_encode($nodeRes, JSON_UNESCAPED_UNICODE);