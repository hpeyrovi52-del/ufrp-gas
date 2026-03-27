<?php
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

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode([
        "ok" => false,
        "error" => "METHOD_NOT_ALLOWED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$submissionUid = trim((string)($_POST["submissionUid"] ?? ""));
$fieldId       = trim((string)($_POST["fieldId"] ?? ""));
$title         = trim((string)($_POST["title"] ?? ""));
$blobId        = trim((string)($_POST["blobId"] ?? ""));

if ($submissionUid === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "SUBMISSION_UID_REQUIRED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($fieldId === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "FIELD_ID_REQUIRED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($blobId === "") {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "BLOB_ID_REQUIRED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!isset($_FILES["file"])) {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "FILE_REQUIRED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$file = $_FILES["file"];
if (!is_array($file) || (int)($file["error"] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode([
        "ok" => false,
        "error" => "UPLOAD_FAILED",
        "code" => (int)($file["error"] ?? -1)
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$baseDir = "/home/saveena/ufrp-onprem/data/uploads";
$userDir = preg_replace('/[^a-z0-9@._-]/i', '_', $email);
$subDir  = preg_replace('/[^a-zA-Z0-9._-]/', '_', $submissionUid);
$destDir = $baseDir . "/" . $userDir . "/" . $subDir;

if (!is_dir($destDir) && !mkdir($destDir, 0775, true)) {
    http_response_code(500);
    echo json_encode([
        "ok" => false,
        "error" => "UPLOAD_DIR_CREATE_FAILED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$origName = (string)($file["name"] ?? "file");
$safeName = preg_replace('/[^a-zA-Z0-9._-]/', '_', $origName);
$storedName = $fieldId . "__" . substr(sha1($blobId), 0, 16) . "__" . $safeName;

$destPath = $destDir . "/" . $storedName;

if (!move_uploaded_file($file["tmp_name"], $destPath)) {
    http_response_code(500);
    echo json_encode([
        "ok" => false,
        "error" => "MOVE_FAILED"
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$meta = [
    "ok" => true,
    "submissionUid" => $submissionUid,
    "fieldId" => $fieldId,
    "title" => $title,
    "blobId" => $blobId,
    "email" => $email,
    "originalName" => $origName,
    "storedName" => $storedName,
    "storedPath" => $destPath,
    "mimeType" => (string)($file["type"] ?? "application/octet-stream"),
    "size" => (int)($file["size"] ?? 0),
    "uploadedAt" => gmdate("c")
];

file_put_contents($destPath . ".json", json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

http_response_code(200);
echo json_encode($meta, JSON_UNESCAPED_UNICODE);
