<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

function ufrp_file_mtime($path) {
  $t = @filemtime($path);
  return $t ? (int)$t : 0;
}

$root = dirname(__DIR__);

$parts = [
  ufrp_file_mtime($root . '/index.php'),
  ufrp_file_mtime($root . '/client.js'),
  ufrp_file_mtime($root . '/client-offline.js'),
  ufrp_file_mtime($root . '/sw.js'),
  ufrp_file_mtime($root . '/manifest.webmanifest')
];

$buildId = sha1(implode('|', $parts));

$cfg = [
  'enabled' => true,
  'message' => 'نسخه جدید برنامه آماده است. برنامه اکنون بروزرسانی می‌شود.',
  'delayMs' => 1400
];

$cfgPath = $root . '/update-control.json';
if (is_file($cfgPath)) {
  $raw = @file_get_contents($cfgPath);
  $decoded = json_decode((string)$raw, true);
  if (is_array($decoded)) {
    $cfg = array_merge($cfg, $decoded);
  }
}

echo json_encode([
  'ok' => true,
  'buildId' => $buildId,
  'enabled' => !empty($cfg['enabled']),
  'message' => (string)($cfg['message'] ?? ''),
  'delayMs' => max(0, (int)($cfg['delayMs'] ?? 1400)),
  'generatedAt' => gmdate('c')
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
