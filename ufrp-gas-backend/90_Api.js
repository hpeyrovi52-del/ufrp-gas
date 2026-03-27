/** ============================
 * 90_Api.gs — FULL REPLACEMENT
 * =============================
 * Purpose:
 * - Provide a clean API router for Hostwinds proxy.php
 * - Provide diagnostics: ping + whoami
 * - Keep responses always JSON
 */

function api_ping_(e) {
  return {
    ok: true,
    ts: new Date().toISOString()
  };
}

function api_whoami_(e) {
  // These can differ depending on deployment settings and domain
  const activeUser = safeEmail_(Session.getActiveUser());
  const effectiveUser = safeEmail_(Session.getEffectiveUser());

  return {
    ok: true,
    ts: new Date().toISOString(),
    activeUser: activeUser || null,
    effectiveUser: effectiveUser || null
  };
}

function safeEmail_(userObj) {
  try {
    if (!userObj) return "";
    const em = userObj.getEmail && userObj.getEmail();
    return String(em || "").trim();
  } catch (e) {
    return "";
  }
}

// ==============================
// API router (called by proxy.php)
// Expected JSON body:
//   { action: "api_whoami", args: [...] }
// We will call function by exact action name if allowlisted
// ==============================

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : {};

    // Extract sessionUser if provided by proxy
    const sessionUser = body && body.sessionUser ? body.sessionUser : null;

    // Make it globally accessible for this execution
    if (sessionUser && sessionUser.email) {
      globalThis.__SESSION_USER__ = {
        email: String(sessionUser.email || "").trim(),
        fullName: String(sessionUser.fullName || "").trim()
      };
    } else {
      globalThis.__SESSION_USER__ = null;
    }

    const action = String(body.action || "").trim();
    const args = Array.isArray(body.args) ? body.args : [];

    // ✅ Allowlist (ONLY what client/proxy is allowed to call)
    const ALLOWED = {
      // diagnostics
      "ping": true,
      "api_ping_": true,
      "api_whoami_": true,
      "api_ping": true,
      "api_whoami": true,

      // app
      "app_getMenuForCurrentUser": true,
      "app_getCurrentUserProfile": true,
      "app_getFormBundleForCurrentUser": true,
      "app_getFormSchemaForCurrentUser": true,
      "app_getFormOptionsForCurrentUser": true,
      "app_submitFormForCurrentUser": true,
      "app_getMenuForEmail": true,

      // uploads (resumable)
      "app_createResumableUploadSessionForCurrentUser": true,
      "app_putResumableChunkForCurrentUser": true,
      "app_deletePendingUploadedFileForCurrentUser": true,
      "app_listAllPendingUploadedFilesForCurrentUser": true,
      "app_deletePendingUploadedFilesBulkForCurrentUser": true,
      "app_deleteSubmissionRowBySubmissionUidForCurrentUser": true,
      "app_deleteUploadedFilesBySubmissionUidForCurrentUser": true,
      "app_listUploadedFilesBySubmissionUidForCurrentUser": true
    };

    if (!action || !ALLOWED[action]) {
      return ContentService
        .createTextOutput(JSON.stringify({
          ok: false,
          error: "Unknown action",
          action: action
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ✅ Dispatch to global function by name
    const fn = globalThis[action];

    if (typeof fn !== "function") {
      return ContentService
        .createTextOutput(JSON.stringify({
          ok: false,
          error: "Action not implemented as function",
          action: action
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const result = fn.apply(null, args);

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        error: String(err && err.message ? err.message : err)
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Aliases so the proxy action names match real functions
function ping() {
  return api_whoami_(); // or api_ping_() if you only want timestamp
}

function api_whoami() {
  return api_whoami_();
}

function api_ping() {
  return api_ping_();
}