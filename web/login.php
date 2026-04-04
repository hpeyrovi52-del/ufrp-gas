<?php
/**
 * =========================================================
 * UFRP LOCAL LOGIN - STEP 1 (EMAIL GATE VIA GOOGLE REGISTRY)
 * =========================================================
 *
 * Purpose:
 * - Replace browser-side Google OAuth
 * - Keep Google Sheets / GAS as the source of truth for who is allowed
 * - First login step only:
 *     1) user enters email
 *     2) Saveena server checks that email against GAS
 *     3) if allowed, store pending login email in PHP session
 *     4) redirect to setup-password.php (next step we will create)
 *
 * IMPORTANT:
 * - This file does NOT hard-code app users
 * - This file does NOT create final UFRP_USER login session yet
 * - This file only verifies that the email is valid for UFRP access
 */

// ---------------------------------------------------------
// SESSION COOKIE HARDENING
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// IF ALREADY FULLY LOGGED IN -> GO TO APP
// ---------------------------------------------------------
if (!empty($_SESSION["UFRP_USER"]["email"])) {
  header("Location: /");
  exit;
}

// ---------------------------------------------------------
// CONFIG
// IMPORTANT: use your real GAS web app URL here
// ---------------------------------------------------------
$GAS_URL = "https://script.google.com/macros/s/AKfycbxPC8fP8o8UecxXcbXBuL9gjwc7ww6sBggkWIDWzUkCPxWV46UO8n2pKeNbWMvV0SCR/exec";

// ---------------------------------------------------------
// UI STATE
// ---------------------------------------------------------
$error = "";
$email = "";

// ---------------------------------------------------------
// HELPER: call GAS action directly from PHP
// ---------------------------------------------------------
function ufrp_gas_call($gasUrl, $action, $args = [], $sessionUser = null) {
  $payload = json_encode([
    "action"      => (string)$action,
    "args"        => is_array($args) ? $args : [],
    "sessionUser" => $sessionUser
  ], JSON_UNESCAPED_UNICODE);

  $ch = curl_init($gasUrl);

  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json; charset=utf-8"]);
  curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
  curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 40);
  curl_setopt($ch, CURLOPT_TIMEOUT, 120);
  curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
  curl_setopt($ch, CURLOPT_MAXREDIRS, 10);
  curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
  curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);

  $responseBody = curl_exec($ch);
  $curlErr      = curl_error($ch);
  $httpCode     = curl_getinfo($ch, CURLINFO_HTTP_CODE);

  curl_close($ch);

  if ($responseBody === false) {
    return [
      "ok" => false,
      "error" => "cURL error: " . $curlErr,
      "httpCode" => $httpCode
    ];
  }

  $parsed = json_decode($responseBody, true);

  if (!is_array($parsed)) {
    return [
      "ok" => false,
      "error" => "GAS did not return valid JSON.",
      "httpCode" => $httpCode,
      "raw" => substr((string)$responseBody, 0, 300)
    ];
  }

  return $parsed;
}

// ---------------------------------------------------------
// HANDLE EMAIL SUBMIT
// ---------------------------------------------------------
if ($_SERVER["REQUEST_METHOD"] === "POST") {
  $email = strtolower(trim((string)($_POST["email"] ?? "")));

  if ($email === "") {
    $error = "ایمیل الزامی است.";
  } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $error = "فرمت ایمیل معتبر نیست.";
  } else {

    // -----------------------------------------------------
    // CHECK ACCESS USING EXISTING GAS LOGIC
    // This reuses your existing registry + access rules:
    // - Users tab
    // - Access tab
    // - app_getMenuForEmail
    // -----------------------------------------------------
    $res = ufrp_gas_call($GAS_URL, "app_getMenuForEmail", [$email]);

    $menu = [];
    $ok = false;

    if (is_array($res) && !empty($res["ok"])) {
      $menu = (isset($res["menu"]) && is_array($res["menu"])) ? $res["menu"] : [];
      $ok = count($menu) > 0;
    }

    if (!$ok) {
      $error = "این ایمیل در سامانه مجاز نیست یا دسترسی فعالی ندارد.";
    } else {
      // ---------------------------------------------------
      // STORE PENDING EMAIL FOR STEP 2 (PASSWORD SETUP/LOGIN)
      // ---------------------------------------------------
      $_SESSION["UFRP_LOGIN_PENDING"] = [
        "email"    => strtolower($email),
        "fullName" => trim((string)($res["fullName"] ?? "")),
        "ts"       => gmdate("c")
      ];

      header("Location: /setup-password.php");
      exit;
    }
  }
}
?>
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>ورود به سامانه</title>

  <?php
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'ufrpir.peyrovigroup.com';
    $base = $scheme . '://' . $host;
    $shareTitle = 'سامانه ثبت تراکنش های مالی';
    $shareDesc  = 'ورود به نسخه PWA سامانه ثبت تراکنش های مالی UFRP-IR';
    $shareImage = $base . '/icon-512.png?v=' . (@filemtime(__DIR__ . '/icon-512.png') ?: time());
    $shareUrl   = $base . '/';
  ?>

  <meta name="description" content="<?php echo htmlspecialchars($shareDesc, ENT_QUOTES, 'UTF-8'); ?>">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="UFRP-IR">
  <meta property="og:title" content="<?php echo htmlspecialchars($shareTitle, ENT_QUOTES, 'UTF-8'); ?>">
  <meta property="og:description" content="<?php echo htmlspecialchars($shareDesc, ENT_QUOTES, 'UTF-8'); ?>">
  <meta property="og:url" content="<?php echo htmlspecialchars($shareUrl, ENT_QUOTES, 'UTF-8'); ?>">
  <meta property="og:image" content="<?php echo htmlspecialchars($shareImage, ENT_QUOTES, 'UTF-8'); ?>">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="<?php echo htmlspecialchars($shareTitle, ENT_QUOTES, 'UTF-8'); ?>">
  <meta name="twitter:description" content="<?php echo htmlspecialchars($shareDesc, ENT_QUOTES, 'UTF-8'); ?>">
  <meta name="twitter:image" content="<?php echo htmlspecialchars($shareImage, ENT_QUOTES, 'UTF-8'); ?>">

  <style>
    :root{
      --card: rgba(255,255,255,0.72);
      --card-border: rgba(0,0,0,0.06);
      --text: #111827;
      --muted: rgba(17,24,39,0.55);
      --blue: #1e5bd7;
      --shadow: 0 16px 50px rgba(0,0,0,0.10);
      --radius: 22px;
    }

    html,body{
      height:100%;
      margin:0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans Arabic", "Vazirmatn", sans-serif;
      background: transparent;
      color: var(--text);
    }

    body{
      display:flex;
      align-items:center;
      justify-content:center;
      padding:20px;
      box-sizing:border-box;
    }

    .card{
      width:min(460px, 96vw);
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 18px;
      box-sizing:border-box;
    }

    h1{
      margin: 6px 0 4px;
      font-size: 22px;
      font-weight: 900;
      text-align:center;
    }

    .sub{
      margin:0 0 16px;
      font-size: 14px;
      text-align:center;
      color: var(--muted);
      line-height:1.6;
    }

    .field{
      margin-bottom: 12px;
    }

    .label{
      display:block;
      font-weight: 900;
      font-size: 13.5px;
      margin-bottom: 6px;
    }

    .control{
      width:100%;
      box-sizing:border-box;
      border: 1px solid rgba(17,24,39,0.12);
      background: rgba(255,255,255,0.65);
      border-radius: 14px;
      padding: 12px 14px;
      font-size: 14px;
      outline: none;
    }

    .control:focus{
      border-color: rgba(30,91,215,0.35);
      box-shadow: 0 0 0 4px rgba(30,91,215,0.10);
    }

    .btn{
      width:100%;
      border: 1px solid rgba(30,91,215,0.20);
      background: rgba(30,91,215,0.10);
      color: rgba(30,91,215,0.98);
      border-radius: 14px;
      padding: 12px 14px;
      font-size: 14px;
      cursor:pointer;
      font-weight: 900;
    }

    .err{
      margin-bottom: 12px;
      border: 1px solid rgba(239,68,68,0.14);
      background: rgba(239,68,68,0.10);
      color: rgba(239,68,68,0.95);
      border-radius: 14px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 800;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>سامانه ثبت تراکنش های مالی</h1>

    <p class="sub">
      برای ادامه، ایمیل خود را وارد کنید تا دسترسی شما بررسی شود.
    </p>

    <?php if ($error): ?>
      <div class="err"><?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?></div>
    <?php endif; ?>

    <form method="post" action="/login.php">
      <div class="field">
        <label class="label" for="email">ایمیل</label>
        <input
          class="control"
          id="email"
          name="email"
          type="email"
          required
          value="<?php echo htmlspecialchars($email, ENT_QUOTES, 'UTF-8'); ?>"
        >
      </div>

      <button class="btn" type="submit">ادامه</button>
    </form>
  </div>
</body>
</html>