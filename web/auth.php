<?php
/**
 * =========================================================
 * UFRP AUTH HELPER (PERSISTENT LOGIN ENGINE)
 * =========================================================
 *
 * This file provides:
 * - Auto-login from cookie
 * - Token creation and validation
 * - Logout cleanup
 *
 * Storage:
 * - /home/saveena/ufrp-onprem/data/users.json
 *
 * Cookie:
 * - Name: UFRP_REMEMBER
 * - Lifetime: 365 days
 */

// ---------------------------------------------------------
// CONFIG
// ---------------------------------------------------------
$UFRP_USER_STORE = "/home/saveena/ufrp-onprem/data/users.json";
$UFRP_COOKIE_NAME = "UFRP_REMEMBER";
$UFRP_COOKIE_DAYS = 365;

// ---------------------------------------------------------
// READ / WRITE USER STORE
// ---------------------------------------------------------
function ufrp_read_users() {
  global $UFRP_USER_STORE;

  if (!is_file($UFRP_USER_STORE)) return [];

  $raw = @file_get_contents($UFRP_USER_STORE);
  if (!$raw) return [];

  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function ufrp_write_users($data) {
  global $UFRP_USER_STORE;

  $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
  if ($json === false) return false;

  return @file_put_contents($UFRP_USER_STORE, $json, LOCK_EX) !== false;
}

// ---------------------------------------------------------
// CREATE REMEMBER TOKEN
// ---------------------------------------------------------
function ufrp_create_remember_token($email) {
  global $UFRP_COOKIE_NAME, $UFRP_COOKIE_DAYS;

  $users = ufrp_read_users();
  if (!isset($users[$email])) return false;

  $rawToken = bin2hex(random_bytes(32));
  $tokenHash = hash("sha256", $rawToken);
  $expiresAt = gmdate("c", time() + ($UFRP_COOKIE_DAYS * 86400));

  if (!isset($users[$email]["tokens"]) || !is_array($users[$email]["tokens"])) {
    $users[$email]["tokens"] = [];
  }

  $users[$email]["tokens"][] = [
    "tokenHash" => $tokenHash,
    "createdAt" => gmdate("c"),
    "expiresAt" => $expiresAt
  ];

  if (!ufrp_write_users($users)) {
    return false;
  }

  setcookie(
    $UFRP_COOKIE_NAME,
    $rawToken,
    [
      "expires"  => time() + ($UFRP_COOKIE_DAYS * 86400),
      "path"     => "/",
      "secure"   => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
      "httponly" => true,
      "samesite" => "Lax"
    ]
  );

  return true;
}

// ---------------------------------------------------------
// AUTO LOGIN FROM COOKIE
// ---------------------------------------------------------
function ufrp_try_auto_login() {
  global $UFRP_COOKIE_NAME;

  if (!empty($_SESSION["UFRP_USER"])) {
    return true;
  }

  if (empty($_COOKIE[$UFRP_COOKIE_NAME])) {
    return false;
  }

  $rawToken = (string)$_COOKIE[$UFRP_COOKIE_NAME];
  $tokenHash = hash("sha256", $rawToken);

  $users = ufrp_read_users();

  foreach ($users as $email => $user) {
    if (empty($user["tokens"]) || !is_array($user["tokens"])) continue;

    foreach ($user["tokens"] as $t) {
      $storedHash = isset($t["tokenHash"]) ? (string)$t["tokenHash"] : "";
      $expiresAt  = isset($t["expiresAt"]) ? (string)$t["expiresAt"] : "";

      if (!$storedHash) continue;
      if (!hash_equals($storedHash, $tokenHash)) continue;
      if (!$expiresAt || strtotime($expiresAt) < time()) continue;

      $_SESSION["UFRP_USER"] = [
        "email" => (string)$email,
        "fullName" => "",
        "ts" => gmdate("c"),
        "auto" => true
      ];

      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------
// LOGOUT
// ---------------------------------------------------------
function ufrp_logout() {
  global $UFRP_COOKIE_NAME;

  $_SESSION = [];

  if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(
      session_name(),
      "",
      [
        "expires"  => time() - 42000,
        "path"     => $params["path"],
        "domain"   => $params["domain"],
        "secure"   => $params["secure"],
        "httponly" => $params["httponly"],
        "samesite" => "Lax"
      ]
    );
  }

  setcookie(
    $UFRP_COOKIE_NAME,
    "",
    [
      "expires"  => time() - 3600,
      "path"     => "/",
      "secure"   => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
      "httponly" => true,
      "samesite" => "Lax"
    ]
  );

  session_destroy();
}