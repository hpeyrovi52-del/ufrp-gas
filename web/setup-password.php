<?php
/**
 * =========================================================
 * UFRP LOCAL LOGIN - STEP 2 (SET OR VERIFY PASSWORD)
 * =========================================================
 *
 * Purpose:
 * - Continue after login.php has validated the email against GAS
 * - If this email has no local password yet:
 *     -> let the user create one
 * - If this email already has a local password:
 *     -> ask the user to enter it
 * - On successful password verification/set:
 *     -> create the real UFRP_USER session
 *
 * Storage:
 * - Password hashes are stored locally on Saveena server in:
 *     /home/saveena/ufrp-onprem/data/users.json
 *
 * Security:
 * - Passwords are NEVER stored in plain text
 * - PHP password_hash() / password_verify() are used
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
require_once __DIR__ . '/auth.php';

// ---------------------------------------------------------
// IF ALREADY FULLY LOGGED IN -> GO TO APP
// ---------------------------------------------------------
if (!empty($_SESSION["UFRP_USER"]["email"])) {
  header("Location: /");
  exit;
}

// ---------------------------------------------------------
// REQUIRE PENDING LOGIN EMAIL FROM STEP 1
// ---------------------------------------------------------
$pending = $_SESSION["UFRP_LOGIN_PENDING"] ?? null;

if (
  !is_array($pending) ||
  empty($pending["email"])
) {
  header("Location: /login.php");
  exit;
}

$email = strtolower(trim((string)($pending["email"] ?? "")));
$fullName = trim((string)($pending["fullName"] ?? ""));

// ---------------------------------------------------------
// LOCAL USER STORE PATH
// ---------------------------------------------------------
$USER_STORE = "/home/saveena/ufrp-onprem/data/users.json";

// ---------------------------------------------------------
// HELPERS: read / write local password store
// ---------------------------------------------------------
function ufrp_read_user_store($path) {
  if (!is_file($path)) {
    return [];
  }

  $raw = @file_get_contents($path);
  if ($raw === false || trim($raw) === "") {
    return [];
  }

  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function ufrp_write_user_store($path, $data) {
  $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
  if ($json === false) {
    return false;
  }
  return @file_put_contents($path, $json, LOCK_EX) !== false;
}

// ---------------------------------------------------------
// LOAD USER STORE
// ---------------------------------------------------------
$users = ufrp_read_user_store($USER_STORE);

// Does this email already have a local password?
$hasPassword = (
  isset($users[$email]) &&
  is_array($users[$email]) &&
  !empty($users[$email]["passwordHash"])
);

// ---------------------------------------------------------
// UI STATE
// ---------------------------------------------------------
$error = "";
$mode = $hasPassword ? "login" : "setup";

// ---------------------------------------------------------
// HANDLE FORM SUBMIT
// ---------------------------------------------------------
if ($_SERVER["REQUEST_METHOD"] === "POST") {

  if ($mode === "setup") {
    $password = (string)($_POST["password"] ?? "");
    $confirm  = (string)($_POST["confirm_password"] ?? "");

    if ($password === "") {
      $error = "رمز عبور الزامی است.";
    } elseif (strlen($password) < 6) {
      $error = "رمز عبور باید حداقل ۶ کاراکتر باشد.";
    } elseif ($password !== $confirm) {
      $error = "رمز عبور و تکرار آن یکسان نیست.";
    } else {
      // -----------------------------------------------
      // CREATE PASSWORD HASH AND SAVE LOCALLY
      // -----------------------------------------------
      $users[$email] = [
        "passwordHash" => password_hash($password, PASSWORD_DEFAULT),
        "createdAt"    => gmdate("c"),
        "updatedAt"    => gmdate("c")
      ];

      if (!ufrp_write_user_store($USER_STORE, $users)) {
        $error = "خطا در ذخیره رمز عبور.";
      } else {
        // ---------------------------------------------
        // CREATE FINAL LOGGED-IN SESSION
        // ---------------------------------------------
        $_SESSION["UFRP_USER"] = [
          "email"    => $email,
          "fullName" => $fullName,
          "ts"       => gmdate("c")
        ];

        ufrp_create_remember_token($email);

        unset($_SESSION["UFRP_LOGIN_PENDING"]);

        header("Location: /");
        exit;
      }
    }

  } else {
    $password = (string)($_POST["password"] ?? "");

    if ($password === "") {
      $error = "رمز عبور الزامی است.";
    } else {
      $row = $users[$email] ?? null;
      $hash = is_array($row) ? (string)($row["passwordHash"] ?? "") : "";

      if (!$hash || !password_verify($password, $hash)) {
        $error = "رمز عبور نادرست است.";
      } else {
        // Optional: refresh updated timestamp
        $users[$email]["updatedAt"] = gmdate("c");
        ufrp_write_user_store($USER_STORE, $users);

        // ---------------------------------------------
        // CREATE FINAL LOGGED-IN SESSION
        // ---------------------------------------------
        $_SESSION["UFRP_USER"] = [
          "email"    => $email,
          "fullName" => $fullName,
          "ts"       => gmdate("c")
        ];

        ufrp_create_remember_token($email);

        unset($_SESSION["UFRP_LOGIN_PENDING"]);

        header("Location: /");
        exit;
      }
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
      line-height:1.7;
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

    .emailBox{
      margin-bottom: 14px;
      border: 1px solid rgba(17,24,39,0.10);
      background: rgba(17,24,39,0.05);
      color: rgba(17,24,39,0.85);
      border-radius: 14px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 800;
      text-align:center;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>سامانه ثبت تراکنش های مالی</h1>

    <p class="sub">
      <?php if ($mode === "setup"): ?>
        برای این ایمیل هنوز رمز عبور محلی تعریف نشده است. لطفاً رمز عبور خود را تنظیم کنید.
      <?php else: ?>
        رمز عبور خود را برای ورود وارد کنید.
      <?php endif; ?>
    </p>

    <div class="emailBox">
      <?php echo htmlspecialchars($email, ENT_QUOTES, 'UTF-8'); ?>
    </div>

    <?php if ($error): ?>
      <div class="err"><?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?></div>
    <?php endif; ?>

    <form method="post" action="/setup-password.php">

      <div class="field">
        <label class="label" for="password">رمز عبور</label>
        <input class="control" id="password" name="password" type="password" required>
      </div>

      <?php if ($mode === "setup"): ?>
        <div class="field">
          <label class="label" for="confirm_password">تکرار رمز عبور</label>
          <input class="control" id="confirm_password" name="confirm_password" type="password" required>
        </div>
      <?php endif; ?>

      <button class="btn" type="submit">
        <?php echo $mode === "setup" ? "ثبت رمز عبور و ورود" : "ورود"; ?>
      </button>

    </form>
  </div>
</body>
</html>