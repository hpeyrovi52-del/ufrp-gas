/**
 * 56_FileUpload.gs — FULL REPLACEMENT (PENDING-enabled)
 *
 * Creates Drive resumable upload sessions and stores files under:
 *   <uploadFolderId root> / "<question> (File responses)" / "_PENDING"
 *
 * Rules:
 * 1) Root folder comes from Master Registry (Forms tab) header: uploadFolderId
 * 2) Final folder name is EXACT Google Forms convention:
 *      "<question> (File responses)"
 * 3) We normalize folder names to prevent duplicate folder creation.
 * 4) Upload goes into a "_PENDING" subfolder inside that question folder.
 * 5) On successful submit (60_Submit.gs), referenced files are MOVED from _PENDING to the final folder.
 * 6) If anything fails, fallback to root folder (still allows upload to  happen).
 */

const FILEUPLOAD_PENDING_SUBFOLDER_NAME = "_PENDING";

function app_createResumableUploadSessionForCurrentUser(formKey, fieldTitle, fileName, mimeType, submissionUid) {
  formKey = String(formKey || "").trim();
  fieldTitle = String(fieldTitle || "").trim();
  fileName = String(fileName || "").trim();
  mimeType = String(mimeType || "application/octet-stream").trim();
  submissionUid = String(submissionUid || "").trim();

  if (!formKey) return { ok: false, error: "formKey is required." };
  if (!fileName) return { ok: false, error: "fileName is required." };

  const email = app_getCurrentUserEmail_();
  if (!email) return { ok: false, error: "Could not detect your Google account email." };

  const reg = registryReadAll_();
  const menu = access_buildMenuForEmail_(email, reg);
  if (!_menuContainsFormKey_(menu, formKey)) {
    return { ok: false, error: "Access denied for this form.", email, formKey };
  }

  // ---- Read upload root folder from registry (Forms tab): uploadFolderId ----
  const formRow = (reg.forms || []).find(f => String(f.formKey || "").trim() === formKey);
  if (!formRow) return { ok: false, error: "Form not found in registry (Forms tab).", formKey };

  const uploadRootFolderId = _pickFirstNonEmpty_(formRow, [
    "uploadFolderId", // ✅ your confirmed header
    "uploadFolderID",
    "uploadRootFolderId"
  ]);

  if (!uploadRootFolderId) {
    return { ok: false, error: 'uploadFolderId is missing in registry (Forms tab) for this formKey.', formKey };
  }

  // ---- Resolve folders: final question folder + _PENDING subfolder ----
  const resolved = _resolvePendingUploadFolder_(uploadRootFolderId, fieldTitle);
  const folderId = resolved.folderId;            // pending folder id
  const finalFolderId = resolved.finalFolderId;  // final folder id
  const usedFallbackToRoot = resolved.usedFallbackToRoot;

  // ---- Prefix filename to avoid collisions ----
  const safeOriginal = _sanitizeFileName_(fileName);
  const prefix = _timestampPrefix_() + "__SID-" + _shortSid_() + "__";
  const finalName = prefix + safeOriginal;

  const meta = {
  name: finalName,
  parents: [folderId],
  mimeType: mimeType,
  description:
    "PENDING | Form: " + formKey +
    (fieldTitle ? (" | Field: " + fieldTitle) : "") +
    (submissionUid ? (" | SubmissionUID: " + submissionUid) : "")
};

  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
  const token = ScriptApp.getOAuthToken();

  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json; charset=utf-8",
    payload: JSON.stringify(meta),
    headers: {
      Authorization: "Bearer " + token,
      "X-Upload-Content-Type": mimeType
    },
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const headers = resp.getAllHeaders();
  if (code < 200 || code >= 300) {
    return {
      ok: false,
      error: "Failed to create upload session. HTTP " + code + " :: " + resp.getContentText()
    };
  }

  const uploadUrl = headers.Location || headers.location;
  if (!uploadUrl) {
    return { ok: false, error: "Drive did not return an upload session URL (Location header missing)." };
  }

  return {
    ok: true,
    uploadUrl: uploadUrl,
    folderId: folderId,
    finalFolderId: finalFolderId,
    usedFallbackToRoot: usedFallbackToRoot,
    finalName: finalName
  };
}

/**
 * Resolve:
 * root/<question> (File responses)/_PENDING
 *
 * Returns:
 *  - folderId: pending folder id (upload destination)
 *  - finalFolderId: final question folder id (promotion destination)
 */
function _resolvePendingUploadFolder_(rootFolderId, fieldTitle) {
  let usedFallbackToRoot = false;

  try {
    const root = DriveApp.getFolderById(rootFolderId);

    // Final folder: "<question> (File responses)"
    const finalFolderName = _buildFormsFileResponsesFolderName_(fieldTitle);
    const finalTargetNorm = _normFolderKey_(finalFolderName);

    let finalFolder = null;
    const it = root.getFolders();
    while (it.hasNext()) {
      const f = it.next();
      if (_normFolderKey_(f.getName()) === finalTargetNorm) {
        finalFolder = f;
        break;
      }
    }
    if (!finalFolder) {
      finalFolder = root.createFolder(finalFolderName);
    }

    // Pending subfolder: "_PENDING" under final folder
    let pendingFolder = null;
    const pit = finalFolder.getFolders();
    while (pit.hasNext()) {
      const f = pit.next();
      if (String(f.getName() || "").trim() === FILEUPLOAD_PENDING_SUBFOLDER_NAME) {
        pendingFolder = f;
        break;
      }
    }
    if (!pendingFolder) {
      pendingFolder = finalFolder.createFolder(FILEUPLOAD_PENDING_SUBFOLDER_NAME);
    }

    return {
      folderId: pendingFolder.getId(),
      finalFolderId: finalFolder.getId(),
      usedFallbackToRoot: false
    };

  } catch (e) {
    // Fallback to root if anything fails
    usedFallbackToRoot = true;
    return {
      folderId: rootFolderId,
      finalFolderId: rootFolderId,
      usedFallbackToRoot: usedFallbackToRoot,
      error: String(e)
    };
  }
}

function _buildFormsFileResponsesFolderName_(fieldTitle) {
  const q = _cleanQuestionTitle_(fieldTitle);
  return q + " (File responses)";
}

/** Clean question title but KEEP user-visible text; remove invisible marks and normalize letters/spaces. */
function _cleanQuestionTitle_(s) {
  return String(s ?? "")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, "")   // invisible RTL marks / ZWNJ
    .replace(/[ي]/g, "ی")                         // Arabic yeh -> Persian ی
    .replace(/[ك]/g, "ک")                         // Arabic kaf -> Persian ک
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize folder keys for comparisons (stronger than cleanQuestion). */
function _normFolderKey_(s) {
  return String(s ?? "")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function _timestampPrefix_() {
  const tz = Session.getScriptTimeZone() || "Etc/UTC";
  const now = new Date();
  const ymd = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  const hms = Utilities.formatDate(now, tz, "HHmmss");
  return ymd + "_" + hms;
}

function _shortSid_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 8);
}

function _sanitizeFileName_(name) {
  let n = String(name || "file")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) n = "file";
  if (n.length > 140) n = n.slice(-140);
  return n;
}

// Small helper reused across files
function _pickFirstNonEmpty_(obj, keys) {
  obj = obj || {};
  for (const k of keys) {
    const v = obj[k];
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function ping_upload() {
  return { ok: true, msg: "ping ok", at: new Date().toISOString() };
}

/**
 * (Optional) Receives one resumable chunk from client and PUTs it to Drive.
 * Kept for compatibility; your client currently uses direct fetch(uploadUrl).
 */
function app_putResumableChunkForCurrentUser(uploadUrl, base64Data, start, endExclusive, total) {
  uploadUrl = String(uploadUrl || "").trim();
  if (!uploadUrl) return { ok: false, error: "uploadUrl missing." };

  start = Number(start);
  endExclusive = Number(endExclusive);
  total = Number(total);

  const bytes = Utilities.base64Decode(String(base64Data || ""));
  const token = ScriptApp.getOAuthToken();

  const resp = UrlFetchApp.fetch(uploadUrl, {
    method: "put",
    payload: bytes,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Range": "bytes " + start + "-" + (endExclusive - 1) + "/" + total
    },
    muteHttpExceptions: true
  });

  const status = resp.getResponseCode();
  const text = resp.getContentText();

  if (status === 308) return { ok: true, done: false, status };
  if (status === 200 || status === 201) {
    let json = {};
    try { json = JSON.parse(text || "{}"); } catch (e) {}
    return { ok: true, done: true, status, json };
  }
  return { ok: false, error: "Chunk upload failed HTTP " + status + " :: " + text, status };
}

function app_deletePendingUploadedFileForCurrentUser(formKey, fieldTitle, fileUrlOrId) {
  formKey = String(formKey || "").trim();
  fieldTitle = String(fieldTitle || "").trim();
  fileUrlOrId = String(fileUrlOrId || "").trim();

  if (!formKey) return { ok: false, error: "formKey is required." };
  if (!fieldTitle) return { ok: false, error: "fieldTitle is required." };
  if (!fileUrlOrId) return { ok: false, error: "fileUrlOrId is required." };

  const email = app_getCurrentUserEmail_();
  if (!email) return { ok: false, error: "Could not detect your Google account email." };

  const reg = registryReadAll_();
  const menu = access_buildMenuForEmail_(email, reg);
  if (!_menuContainsFormKey_(menu, formKey)) {
    return { ok: false, error: "Access denied for this form.", email, formKey };
  }

  const formRow = (reg.forms || []).find(f => String(f.formKey || "").trim() === formKey);
  if (!formRow) return { ok: false, error: "Form not found in registry (Forms tab).", formKey };

  const uploadRootFolderId = _pickFirstNonEmpty_(formRow, [
    "uploadFolderId",
    "uploadFolderID",
    "uploadRootFolderId"
  ]);
  if (!uploadRootFolderId) {
    return { ok: false, error: "uploadFolderId is missing in registry (Forms tab) for this formKey.", formKey };
  }

  const fileIds = _extractDriveFileIds_(fileUrlOrId);
  const fileId = fileIds[0] || "";
  if (!fileId) return { ok: false, error: "Could not extract fileId." };

  try {
    const finalFolder = _resolveFinalQuestionFolder_(uploadRootFolderId, fieldTitle);
    if (!finalFolder) return { ok: false, error: "Could not resolve final folder." };

    const pending = _getPendingFolderIfExists_(finalFolder);
    if (!pending) return { ok: false, error: "Pending folder not found." };

    const file = DriveApp.getFileById(fileId);

    if (!_fileIsInFolder_(file, pending.getId())) {
      return { ok: false, error: "File is not in pending folder.", fileId };
    }

    file.setTrashed(true);

    return {
      ok: true,
      fileId,
      deleted: true
    };

  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function app_listAllPendingUploadedFilesForCurrentUser() {
  const email = app_getCurrentUserEmail_();
  if (!email) return { ok: false, error: "Could not detect your Google account email." };

  const reg = registryReadAll_();
  const menu = access_buildMenuForEmail_(email, reg);

  const allowedFormKeys = {};

  // menu structure = centers -> forms
  (menu || []).forEach(center => {
    const forms = Array.isArray(center?.forms) ? center.forms : [];
    forms.forEach(f => {
      const k = String(f?.formKey || "").trim();
      if (k) allowedFormKeys[k] = true;
    });
  });

  const out = [];

  for (const formRow of (reg.forms || [])) {
    const formKey = String(formRow?.formKey || "").trim();
    if (!formKey || !allowedFormKeys[formKey]) continue;

    const rootId = _pickFirstNonEmpty_(formRow, [
      "uploadFolderId",
      "uploadFolderID",
      "uploadRootFolderId"
    ]);
    if (!rootId) continue;

    try {
      const root = DriveApp.getFolderById(rootId);
      const questionFolders = root.getFolders();

      while (questionFolders.hasNext()) {
        const qf = questionFolders.next();
        const pending = _getPendingFolderIfExists_(qf);
        if (!pending) continue;

        const files = pending.getFiles();
        while (files.hasNext()) {
          const file = files.next();
          const desc = String(file.getDescription() || "");
          const uidMatch = desc.match(/SubmissionUID:\s*([^|]+)/i);
          const pendingUid = uidMatch ? String(uidMatch[1] || "").trim() : "";

          out.push({
            formKey: formKey,
            fieldFolderName: String(qf.getName() || ""),
            pendingFolderId: pending.getId(),
            fileId: file.getId(),
            fileName: file.getName(),
            createdAt: file.getDateCreated() ? file.getDateCreated().toISOString() : "",
            description: desc,
            pendingUid: pendingUid
          });
        }
      }
    } catch (e) {
      // ignore per-form errors
    }
  }

  return {
    ok: true,
    items: out
  };
}

function app_deletePendingUploadedFilesBulkForCurrentUser(items) {
  items = Array.isArray(items) ? items : [];
  const results = [];

  for (const it of items) {
    const formKey = String(it?.formKey || "").trim();
    const fieldTitle = String(it?.fieldFolderName || "").trim()
      .replace(/\s*\(File responses\)\s*$/i, "");
    const fileUrlOrId = String(it?.fileId || "").trim();

    try {
      const res = app_deletePendingUploadedFileForCurrentUser(
        formKey,
        fieldTitle,
        fileUrlOrId
      );
      results.push({
        formKey,
        fileId: fileUrlOrId,
        ok: !!res?.ok,
        error: res?.error || ""
      });
    } catch (e) {
      results.push({
        formKey,
        fileId: fileUrlOrId,
        ok: false,
        error: String(e)
      });
    }
  }

  return {
    ok: true,
    count: results.length,
    results
  };
}

