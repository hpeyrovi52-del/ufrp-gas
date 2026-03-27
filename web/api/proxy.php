<?php
// /public_html/ufrp/api/proxy.php
// Production forwarder + session layer
// - Adds HttpOnly session cookie support
// - Keeps existing GAS forwarding behavior unchanged for normal actions

// -------------------------------
// Session cookie hardening
// -------------------------------
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');

session_set_cookie_params([
  'lifetime' => 0,                 // session cookie
  'path'     => '/',
  'domain'   => $_SERVER['HTTP_HOST'], // current host only
  'secure'   => $https,            // true on HTTPS
  'httponly' => true,              // JS can't read it
  'samesite' => 'Lax',             // good default for same-site apps
]);

session_start();

// -------------------------------
// CORS (cookies require non-* origin + credentials)
// Since your PWA and /api are same domain, this will work.
// -------------------------------
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
$host   = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
$allowedOrigin = '';

if ($origin) {
  $originHost = parse_url($origin, PHP_URL_HOST);
  if ($originHost && $originHost === $host) {
    $allowedOrigin = $origin;
  }
}

header("Content-Type: application/json; charset=utf-8");

if ($allowedOrigin) {
  header("Access-Control-Allow-Origin: $allowedOrigin");
  header("Access-Control-Allow-Credentials: true");
}

header("Vary: Origin");
header("Access-Control-Allow-Headers: Content-Type");
header("Access-Control-Allow-Methods: POST, OPTIONS");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
  http_response_code(200);
  echo json_encode(["ok" => true, "preflight" => true], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
  http_response_code(405);
  echo json_encode([
    "ok" => false,
    "error" => "Method not allowed. Use POST."
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

// ✅ Your GAS Web App URL
$GAS_URL = "https://script.google.com/macros/s/AKfycbxPC8fP8o8UecxXcbXBuL9gjwc7ww6sBggkWIDWzUkCPxWV46UO8n2pKeNbWMvV0SCR/exec";

$raw  = file_get_contents("php://input");
$body = json_decode($raw, true);

if (!$body || !is_array($body)) {
  http_response_code(400);
  echo json_encode([
    "ok" => false,
    "error" => "Invalid JSON body"
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$action = isset($body["action"]) ? (string)$body["action"] : "";
$args   = (isset($body["args"]) && is_array($body["args"])) ? $body["args"] : [];

// -------------------------------
// Session actions
// -------------------------------
if ($action === "session_set") {
  $u = (isset($args[0]) && is_array($args[0])) ? $args[0] : [];
  $email    = isset($u["email"]) ? trim((string)$u["email"]) : "";
  $fullName = isset($u["fullName"]) ? trim((string)$u["fullName"]) : "";

  if ($email === "") {
    http_response_code(400);
    echo json_encode([
      "ok" => false,
      "error" => "email is required"
    ], JSON_UNESCAPED_UNICODE);
    exit;
  }

  $_SESSION["UFRP_USER"] = [
    "email"    => strtolower($email),
    "fullName" => $fullName,
    "ts"       => gmdate("c"),
  ];

  http_response_code(200);
  echo json_encode([
    "ok" => true,
    "saved" => $_SESSION["UFRP_USER"],
    "session_id" => session_id(),
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($action === "session_get") {
  $u = isset($_SESSION["UFRP_USER"]) ? $_SESSION["UFRP_USER"] : null;

  http_response_code(200);
  echo json_encode([
    "ok" => true,
    "user" => $u,
    "session_id" => session_id(),
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($action === "session_clear") {
  $_SESSION = [];

  if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(
      session_name(),
      '',
      [
        'expires'  => time() - 42000,
        'path'     => $params["path"],
        'domain'   => $params["domain"],
        'secure'   => $params["secure"],
        'httponly' => $params["httponly"],
        'samesite' => 'Lax',
      ]
    );
  }

  session_destroy();

  http_response_code(200);
  echo json_encode([
    "ok" => true,
    "cleared" => true
  ], JSON_UNESCAPED_UNICODE);
  exit;
}


// -------------------------------
// Generic webhook forwarder
// Allows client to call a separate Apps Script webhook URL
// without changing the normal action/args GAS flow.
// Expected body:
// {
//   "url": "https://...",
//   "method": "POST",
//   "body": { ... }
// }
// -------------------------------
if (isset($body["url"]) && is_string($body["url"]) && trim($body["url"]) !== "") {
  $targetUrl = trim((string)$body["url"]);
  $targetMethod = isset($body["method"]) ? strtoupper(trim((string)$body["method"])) : "POST";
  $targetBody = isset($body["body"]) ? $body["body"] : [];

  if (!preg_match('#^https://script\.google\.com/#i', $targetUrl)) {
    http_response_code(400);
    echo json_encode([
      "ok" => false,
      "error" => "Webhook target URL not allowed"
    ], JSON_UNESCAPED_UNICODE);
    exit;
  }

  $forwardPayload = json_encode($targetBody, JSON_UNESCAPED_UNICODE);

$cmd =
  'curl -L -s -X ' . escapeshellarg($targetMethod) .
  ' -H ' . escapeshellarg('Content-Type: application/json; charset=utf-8') .
  ' --data ' . escapeshellarg($forwardPayload) .
  ' ' . escapeshellarg($targetUrl) .
  ' > /dev/null 2>&1 &';

@shell_exec($cmd);

http_response_code(200);
echo json_encode([
  "ok" => true,
  "queued" => true
], JSON_UNESCAPED_UNICODE);
exit;
}




// -------------------------------
// Normal behavior: forward to GAS
// -------------------------------
$sessionUser = isset($_SESSION["UFRP_USER"]) ? $_SESSION["UFRP_USER"] : null;

$payload = json_encode([
  "action"      => $action,
  "args"        => $args,
  "sessionUser" => $sessionUser
], JSON_UNESCAPED_UNICODE);

$ch = curl_init($GAS_URL);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json; charset=utf-8"]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);

// More tolerant timeout settings for GAS + Drive session creation
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 40);
curl_setopt($ch, CURLOPT_TIMEOUT, 120);

// Follow Google redirect (302 -> googleusercontent)
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 10);

// Small hardening
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);

$responseBody = curl_exec($ch);
$curlErr      = curl_error($ch);
$httpCode     = curl_getinfo($ch, CURLINFO_HTTP_CODE);

curl_close($ch);

if ($responseBody === false) {
  http_response_code(502);
  echo json_encode([
    "ok" => false,
    "error" => "Proxy cURL error: " . $curlErr
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$parsed = json_decode($responseBody, true);

if ($parsed === null && json_last_error() !== JSON_ERROR_NONE) {
  http_response_code(502);
  echo json_encode([
    "ok" => false,
    "error" => "GAS did not return JSON",
    "debug" => [
      "http_code" => $httpCode,
      "raw_first_250" => substr($responseBody ?? "", 0, 250)
    ]
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

http_response_code(200);
echo json_encode($parsed, JSON_UNESCAPED_UNICODE);
