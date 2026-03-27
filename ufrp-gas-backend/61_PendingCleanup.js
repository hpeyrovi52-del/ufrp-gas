/**
 * 61_PendingCleanup.gs
 *
 * Deletes files that were uploaded but never submitted, sitting in:
 *   <uploadRoot> / "<question> (File responses)" / "_PENDING"
 *
 * Default retention: 2 days (change if you want)
 */



/** Run daily via trigger */
function cleanupPendingUploadsDaily() {
  cleanupPendingUploads_(2); // keep 2 days
}

/**
 * Deletes pending files older than N days.
 * Uses Drive "trash" (setTrashed) so recovery is possible if needed.
 */
function cleanupPendingUploads_(olderThanDays) {
  olderThanDays = Number(olderThanDays);
  if (!olderThanDays || olderThanDays < 0) olderThanDays = 2;

  const reg = registryReadAll_();
  const forms = reg.forms || [];
  const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

  let deletedCount = 0;
  let checkedCount = 0;

  for (const formRow of forms) {
    const rootId = String(formRow?.uploadFolderId || "").trim();
    if (!rootId) continue;

    try {
      const root = DriveApp.getFolderById(rootId);
      const qFolders = root.getFolders();

      while (qFolders.hasNext()) {
        const qf = qFolders.next();

        // find _PENDING inside each question folder
        const pending = _findSubFolderByExactName_(qf, FILEUPLOAD_PENDING_SUBFOLDER_NAME);
        if (!pending) continue;

        const files = pending.getFiles();
        while (files.hasNext()) {
          const file = files.next();
          checkedCount++;

          const created = file.getDateCreated();
          const t = created ? created.getTime() : 0;

          if (t && t < cutoff) {
            try {
              file.setTrashed(true);
              deletedCount++;
            } catch (e) {}
          }
        }
      }
    } catch (e) {
      // ignore per-root failures
    }
  }

  return { ok: true, checkedCount, deletedCount, olderThanDays, at: new Date().toISOString() };
}

function _findSubFolderByExactName_(folder, name) {
  const it = folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (String(f.getName() || "").trim() === String(name || "").trim()) return f;
  }
  return null;
}

/**
 * One-time setup: creates a daily trigger at ~03:00 AM script timezone.
 * Run this once manually from Apps Script editor.
 */
function setupPendingCleanupTrigger() {
  // Remove existing triggers for this function (avoid duplicates)
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction && t.getHandlerFunction() === "cleanupPendingUploadsDaily") {
      ScriptApp.deleteTrigger(t);
    }
  }

  ScriptApp.newTrigger("cleanupPendingUploadsDaily")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  return { ok: true, msg: "Daily cleanup trigger created (03:00).", at: new Date().toISOString() };
}

function __forceAuthForTriggers() {
  ScriptApp.getProjectTriggers();
  return "ok";
}


function app_listUploadedFilesBySubmissionUidForCurrentUser(formKey, submissionUid) {
  formKey = String(formKey || "").trim();
  submissionUid = String(submissionUid || "").trim();

  if (!formKey) return { ok: false, error: "formKey is required." };
  if (!submissionUid) return { ok: false, error: "submissionUid is required." };

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

  const out = [];

  try {
    const root = DriveApp.getFolderById(uploadRootFolderId);
    const qFolders = root.getFolders();

    while (qFolders.hasNext()) {
      const qf = qFolders.next();

      // Check files directly in final folder
      const finalFiles = qf.getFiles();
      while (finalFiles.hasNext()) {
        const file = finalFiles.next();
        const desc = String(file.getDescription() || "");
        if (desc.indexOf("SubmissionUID: " + submissionUid) >= 0) {
          out.push({
            fileId: file.getId(),
            fileName: file.getName(),
            folderName: String(qf.getName() || ""),
            location: "final",
            description: desc
          });
        }
      }

      // Check files in _PENDING subfolder
      const pending = _findSubFolderByExactName_(qf, FILEUPLOAD_PENDING_SUBFOLDER_NAME);
      if (pending) {
        const pendingFiles = pending.getFiles();
        while (pendingFiles.hasNext()) {
          const file = pendingFiles.next();
          const desc = String(file.getDescription() || "");
          if (desc.indexOf("SubmissionUID: " + submissionUid) >= 0) {
            out.push({
              fileId: file.getId(),
              fileName: file.getName(),
              folderName: String(qf.getName() || ""),
              location: "pending",
              description: desc
            });
          }
        }
      }
    }

    return {
      ok: true,
      formKey,
      submissionUid,
      items: out
    };

  } catch (e) {
    return { ok: false, error: String(e) };
  }
}


function app_deleteUploadedFilesBySubmissionUidForCurrentUser(formKey, submissionUid) {

  const list = app_listUploadedFilesBySubmissionUidForCurrentUser(formKey, submissionUid);

  if (!list || !list.ok) {
    return list;
  }

  const results = [];

  for (const it of (list.items || [])) {
    try {

      const file = DriveApp.getFileById(it.fileId);

      file.setTrashed(true);

      results.push({
        fileId: it.fileId,
        ok: true
      });

    } catch (e) {

      results.push({
        fileId: it.fileId,
        ok: false,
        error: String(e)
      });

    }
  }

  return {
    ok: true,
    formKey,
    submissionUid,
    deleted: results.length,
    results
  };
}