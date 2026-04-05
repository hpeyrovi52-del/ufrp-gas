/**
 * 60_Submit.gs — FULL REPLACEMENT (Auto-promote FILE_UPLOAD from _PENDING)
 *
 * Adds: FILE_UPLOAD values are written as HYPERLINK formulas using the question title.
 * Multi-file: <question title> ۱ / <question title> ۲ ... each on its own line in the same cell.
 *
 * Requires existing project functions:
 *  - app_getCurrentUserEmail_()
 *  - registryReadAll_()
 *  - access_buildMenuForEmail_(email, reg)
 *  - _menuContainsFormKey_(menu, formKey)
 */

// ✅ helper to escape " inside formulas
function _escapeForFormula_(s){
  return String(s ?? "").replace(/"/g, '""');
}

// ✅ if input is fileId, convert to Drive open URL; if already URL, keep it
function _valueToDriveUrl_(raw){
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const id = _extractDriveFileId_(s);
  if (!id) return "";
  return "https://drive.google.com/open?id=" + encodeURIComponent(id);
}

// ✅ produce HYPERLINK("url","label") (as a formula string)
function _makeHyperlinkFormula_(url, label){
  url = String(url || "").trim();
  label = String(label || "").trim();
  if (!url) return "";

  // IMPORTANT:
  // Never allow fallback to "File" (this is what causes File 1 / File 2)
  // If label is empty for any reason, use a safe Persian default.
  if (!label) label = "فایل";

  return '=HYPERLINK("' + _escapeForFormula_(url) + '","' + _escapeForFormula_(label) + '")';
}

// ✅ turn raw FILE_UPLOAD value into a single-cell formula containing 1..N links on separate lines
function _fileUploadCellValue_(rawValue, baseLabel){
  if (rawValue == null) return "";
  let parts = [];
  if (Array.isArray(rawValue)) {
    parts = rawValue.map(x => String(x ?? "").trim()).filter(Boolean);
  } else {
    const s = String(rawValue ?? "").trim();
    if (!s) return "";
    // Support "|" and line breaks
    parts = s.split(/\s*\|\s*|\r?\n+/)
             .map(x => String(x ?? "").trim())
             .filter(Boolean);
  }
  if (!parts.length) return "";

  // Use question title as base label
  const base = String(baseLabel || "").trim() || "فاکتور";

  const formulas = [];
  for (let i = 0; i < parts.length; i++){
    const url = _valueToDriveUrl_(parts[i]);
    if (!url) continue;

    const label = (parts.length === 1)
      ? base
      : (base + " " + toFaDigits_(i + 1));

    formulas.push(
      _makeHyperlinkFormula_(url, label).replace(/^=/, "")
    );
  }

  if (!formulas.length) return parts.join(" | ");

  if (formulas.length === 1){
    return "=" + formulas[0];
  }

  return "=" + formulas.join("&CHAR(10)&");
}

// ✅ convert 1..9.. to Persian digits (keeps everything else)
function toFaDigits_(n){
  const fa = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
  return String(n).replace(/\d/g, d => fa[Number(d)]);
}

function app_submitFormForCurrentUser(formKey, payload) {
  formKey = String(formKey || "").trim();
  if (!formKey) return { ok: false, error: "formKey is required." };

  payload = payload || {};
  const answers = Array.isArray(payload.answers) ? payload.answers : [];

  Logger.log("UPLOAD ANSWERS DEBUG: " + JSON.stringify(answers));

  if (!answers.length) {
    return { ok: false, error: "No answers received." };
  }

  const email = app_getCurrentUserEmail_();
  if (!email) {
    return {
      ok: false,
      error: "Could not detect your Google account email. Please make sure you are signed into Google in this browser."
    };
  }

  // --- Access check ---
  const reg = registryReadAll_();
  const menu = access_buildMenuForEmail_(email, reg);

  if (!_menuContainsFormKey_(menu, formKey)) {
    return { ok: false, error: "Access denied for this form.", email, formKey };
  }

  // --- Resolve destination from Forms tab ---
  const formRow = (reg.forms || []).find(
    f => String(f.formKey || "").trim() === formKey
  );

  if (!formRow) {
    return { ok: false, error: "Form not found in registry (Forms tab).", email, formKey };
  }

  // --- Collect SyncUrls rows for this formKey from Master Registry ---
  // These rows will later be returned to the frontend so the standalone
  // sync web app can be called without reading the registry itself.
  const syncUrls = (reg.syncUrls || []).filter(
    r => String(r.formKey || "").trim() === formKey
  );

  const destSpreadsheetId = _pickFirstNonEmpty_(formRow, [
    "spreadsheetId",
    "responsesSpreadsheetId",
    "destinationSpreadsheetId",
    "destSpreadsheetId",
    "sheetId"
  ]);

  const destSheetName = _pickFirstNonEmpty_(formRow, [
    "destination",
    "responsesSheetName",
    "destinationSheetName",
    "destSheetName",
    "sheetName",
    "tabName"
  ]);

  const uploadRootFolderId = _pickFirstNonEmpty_(formRow, [
    "uploadFolderId",
    "uploadFolderID",
    "uploadRootFolderId"
  ]);

  // Kept temporarily for backward compatibility while old path still exists.
  // It can be removed later when the standalone sync web app fully replaces it.
  const postSubmitWebhookUrl = _pickFirstNonEmpty_(formRow, [
    "postSubmitWebhookUrl"
  ]);

  const syncUrlsStatus = String(formRow.SyncUrlsStatus || "").trim();

  if (!destSpreadsheetId) {
    return {
      ok: false,
      error: "Destination spreadsheetId is missing in registry (Forms tab) for this formKey.",
      formKey
    };
  }

  if (!destSheetName) {
    return {
      ok: false,
      error: "Destination sheet/tab name is missing in registry (Forms tab) for this formKey.",
      formKey
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);

  try {
    const t0 = Date.now();

    // 1) Promote uploaded files first and collect final raw links
    let promoted = [];
    let promoteErrors = [];
    let finalLinksByTitle = {};

    if (uploadRootFolderId) {
      const out = _promoteFileUploads_(uploadRootFolderId, formKey, answers);
      promoted = out.promoted || [];
      promoteErrors = out.errors || [];
      finalLinksByTitle = out.finalLinksByTitle || {};
    }

    Logger.log("TIMING promote ms=" + (Date.now() - t0));

    // 2) Normalize answers so FILE_UPLOAD values become final raw URLs
    // joined by line breaks. We intentionally do NOT write rich text to source.
    const normalizedAnswers = answers.map(a => {
      const copy = Object.assign({}, a);
      const type = String(copy && copy.type || "").trim();
      const title = String(copy && copy.title || "").trim();

      if (type === "FILE_UPLOAD" && title && finalLinksByTitle[title] && finalLinksByTitle[title].length) {
        copy.value = finalLinksByTitle[title].join("\n");
      }

      return copy;
    });

    // 3) Open destination responses sheet
    const ss = SpreadsheetApp.openById(destSpreadsheetId);
    const sh = ss.getSheetByName(destSheetName);

    Logger.log("TIMING sheet-open ms=" + (Date.now() - t0));

    if (!sh) {
      return { ok: false, error: `Destination sheet not found: "${destSheetName}"`, formKey };
    }

    let header = _ensureHeaderRow_(sh);
    if (!header.length) {
      header = ["Timestamp", "UserEmail", "FormKey", "SubmissionId"];
      _setHeaderRow_(sh, header);
    }

    const titleToCol = {};
    header.forEach((h, i) => {
      const key = String(h || "").trim();
      if (key) titleToCol[key] = i;
    });

    const BASE_HEADERS = ["Timestamp", "UserEmail", "FormKey", "SubmissionId"];
    BASE_HEADERS.forEach(h => {
      if (titleToCol[h] == null) {
        header.push(h);
        titleToCol[h] = header.length - 1;
      }
    });

    for (const a of normalizedAnswers) {
      const title = String((a && a.title) || "").trim();
      if (!title) continue;

      if (titleToCol[title] == null) {
        header.push(title);
        titleToCol[title] = header.length - 1;
      }
    }

    _setHeaderRow_(sh, header);

    const submissionId = _nextSubmissionId_(sh, titleToCol["SubmissionId"] + 1);

    const row = new Array(header.length).fill("");
    row[titleToCol["Timestamp"]] = new Date();
    row[titleToCol["UserEmail"]] = email;
    row[titleToCol["FormKey"]] = formKey;
    row[titleToCol["SubmissionId"]] = submissionId;

    const fileCells = []; // [{ colIndex0, links[], baseLabel }]

    for (const a of normalizedAnswers) {
      const title = String((a && a.title) || "").trim();
      if (!title) continue;

      const col = titleToCol[title];
      if (col == null) continue;

      const type = String(a && a.type || "").trim();
      let v = (a && a.value != null) ? a.value : "";

      if (type === "FILE_UPLOAD") {
        const raw = String(v || "").trim();
        row[col] = raw;

        const links = raw
          .split(/\r?\n/)
          .map(s => String(s).trim())
          .filter(Boolean);

        if (links.length) {
          fileCells.push({
            colIndex0: col,
            links: links,
            baseLabel: title
          });
        }

        continue;
      }

      if (Array.isArray(v)) v = v.join(" | ");
      if (typeof v === "object") v = JSON.stringify(v);

      row[col] = String(v);
    }

    // 4) Dedupe recent identical payload
    const dupRowIndex = _findRecentDuplicateRow_(
      sh,
      header,
      titleToCol,
      email,
      formKey,
      row,
      normalizedAnswers,
      10,
      80
    );

    let targetRowIndex;
    if (dupRowIndex) {
      sh.getRange(dupRowIndex, 1, 1, row.length).setValues([row]);
      targetRowIndex = dupRowIndex;
    } else {
      sh.appendRow(row);
      targetRowIndex = sh.getLastRow();
    }

    Logger.log("TIMING sheet-write ms=" + (Date.now() - t0));

    // 5) Write plain raw URLs into source sheet.
    // Sync tabs / external formatter will later use these raw URLs.
    for (const fc of fileCells) {
      const r = sh.getRange(targetRowIndex, fc.colIndex0 + 1);
      const links = Array.isArray(fc.links) ? fc.links : [];
      const rawText = links.join("\n");
      r.setValue(rawText);
      r.setWrap(true);
    }

    // Old in-sheet webhook path is intentionally kept disabled here.
    // The frontend will later call the new standalone sync web app.
    return {
      ok: true,
      formKey,
      destSpreadsheetId,
      destSheetName,
      appendedAt: new Date().toISOString(),
      submissionId,
      promotedFiles: promoted,
      promoteErrors,
      postSubmitWebhookUrl,
      syncUrlsStatus,
      syncUrls,
      timingMs: {
        total: Date.now() - t0
      }
    };

  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * SubmissionId helper
 *
 * Keeps a simple incremental numeric ID in the destination sheet.
 * This is separate from __SubmissionUID.
 */
function _nextSubmissionId_(sheet, submissionIdCol) {
  submissionIdCol = Number(submissionIdCol || 0);
  if (!submissionIdCol || submissionIdCol < 1) return 1;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;

  const rng = sheet.getRange(2, submissionIdCol, lastRow - 1, 1).getValues();

  let maxId = 0;
  for (let i = 0; i < rng.length; i++) {
    const v = rng[i][0];
    if (v == null || v === "") continue;

    const n = Number(String(v).replace(/[^\d.-]/g, ""));
    if (!isFinite(n)) continue;

    if (n > maxId) maxId = n;
  }

  return maxId + 1;
}

/**
 * Promote FILE_UPLOAD answers
 * Moves files from _PENDING to final folder and returns final links
 */
function _promoteFileUploads_(uploadRootFolderId, formKey, answers) {

  const promoted = [];
  const errors = [];
  const finalLinksByTitle = {};

  const submissionMeta = (answers || []).find(a =>
  String(a?.title || "").trim() === "__SubmissionUID"
);
const submissionUid = String(submissionMeta?.value || "").trim();


  for (const a of (answers || [])) {

    const type = String(a?.type || "").trim();
    if (type !== "FILE_UPLOAD") continue;

    const title = String(a?.title || "").trim();
    const raw = String(a?.value || "").trim();
    if (!raw) continue;

    try {

      const fileIds = _extractDriveFileIds_(raw);
      if (!fileIds.length) {
        errors.push({ title, raw, error: "Could not extract any fileIds from value." });
        continue;
      }

      const finalFolder = _resolveFinalQuestionFolder_(uploadRootFolderId, title);
      if (!finalFolder) {
        errors.push({ title, fileIds, error: "Could not resolve final folder." });
        continue;
      }

      const pending = _getPendingFolderIfExists_(finalFolder);

      const links = [];

      for (const fileId of fileIds) {

        try {

          const file = DriveApp.getFileById(fileId);
const desc = String(file.getDescription() || "");
const alreadyThere = /PROMOTED/i.test(desc);
          if (!alreadyThere) {
            // Always ensure file ends up ONLY in final folder
try {
  finalFolder.addFile(file);
} catch (_) {}

if (pending) {
  try { pending.removeFile(file); } catch (_) {}
}
          }

          const viewLink = "https://drive.google.com/file/d/" + fileId + "/view";
          links.push(viewLink);

          try {
            const desc = String(file.getDescription() || "");
            if (!/PROMOTED/i.test(desc)) {
              file.setDescription(
  "PROMOTED | Form: " + formKey +
  (title ? (" | Field: " + title) : "") +
  (submissionUid ? (" | SubmissionUID: " + submissionUid) : "")
);
            }
          } catch (_) {}

          promoted.push({
            title,
            fileId,
            movedToFolderId: finalFolder.getId(),
            viewLink
          });

        } catch (eFile) {

          errors.push({ title, fileId, error: String(eFile) });

        }

      }

      if (links.length) {
        finalLinksByTitle[title] = links;
      }

    } catch (e) {

      errors.push({ title, raw, error: String(e) });

    }

  }

  return {
    promoted,
    errors,
    finalLinksByTitle
  };

}

function _resolveFinalQuestionFolder_(rootFolderId, fieldTitle) {
  const root = DriveApp.getFolderById(rootFolderId);
  const folderName = _buildFormsFileResponsesFolderName_(fieldTitle);
  const targetNorm = _normFolderKey_(folderName);
  const it = root.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (_normFolderKey_(f.getName()) === targetNorm) return f;
  }
  return root.createFolder(folderName);
}

function _getPendingFolderIfExists_(finalFolder) {
  const it = finalFolder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    if (String(f.getName() || "").trim() === FILEUPLOAD_PENDING_SUBFOLDER_NAME) return f;
  }
  return null;
}

function _fileIsInFolder_(file, folderId) {
  const it = file.getParents();
  while (it.hasNext()) {
    const p = it.next();
    if (p.getId() === folderId) return true;
  }
  return false;
}

function _extractDriveFileIds_(s) {
  s = String(s || "").trim();
  if (!s) return [];
  // Split by newlines OR pipes OR commas (client currently uses newline, but be safe)
  const parts = s.split(/\r?\n|\s*\|\s*|\s*,\s*/g).map(x => x.trim()).filter(Boolean);
  const out = [];
  const push = (id) => {
    if (id && out.indexOf(id) === -1) out.push(id);
  };
  for (const p of parts) {
    // raw fileId
    if (/^[a-zA-Z0-9_-]{10,}$/.test(p) && p.indexOf("/") === -1) {
      push(p);
      continue;
    }
    // /d/<id>/
    const m1 = p.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m1 && m1[1]) { push(m1[1]); continue; }
    // id=<id>
    const m2 = p.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (m2 && m2[1]) { push(m2[1]); continue; }
  }
  return out;
}

// ---------- helpers ----------
function _pickFirstNonEmpty_(obj, keys) {
  obj = obj || {};
  for (const k of keys) {
    const v = obj[k];
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function _ensureHeaderRow_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const range = sheet.getRange(1, 1, 1, lastCol);
  const vals = range.getValues()[0] || [];
  const header = vals.map(v => String(v || "").trim());
  const hasAny = header.some(h => h);
  if (!hasAny) return [];
  let end = header.length;
  while (end > 0 && !header[end - 1]) end--;
  return header.slice(0, end);
}

function _setHeaderRow_(sheet, headerArr) {
  headerArr = headerArr || [];
  if (!headerArr.length) return;
  const neededCols = headerArr.length;
  const currentCols = sheet.getMaxColumns();
  if (neededCols > currentCols) {
    sheet.insertColumnsAfter(currentCols, neededCols - currentCols);
  }
  sheet.getRange(1, 1, 1, neededCols).setValues([headerArr]);
  try { sheet.setFrozenRows(1); } catch (e) {}
}

function _buildFormsFileResponsesFolderName_(fieldTitle) {
  const q = _cleanQuestionTitle_(fieldTitle);
  return q + " (File responses)";
}

function _cleanQuestionTitle_(s) {
  return String(s ?? "")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/\s+/g, " ")
    .trim();
}

function _normFolderKey_(s) {
  return String(s ?? "")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Find a recently-appended duplicate row.
 * Priority:
 * 1) exact same __SubmissionUID (strongest match)
 * 2) fallback = same user + formKey + same non-file fields within time window
 *
 * Returns sheet row index (1-based) or 0 if not found.
 */
function _findRecentDuplicateRow_(sh, header, titleToCol, email, formKey, newRow, answers, minutesWindow, scanRows) {
  minutesWindow = Number(minutesWindow || 10);
  scanRows = Number(scanRows || 80);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  const startRow = Math.max(2, lastRow - scanRows + 1);
  const numRows = lastRow - startRow + 1;
  if (numRows < 1) return 0;

  const values = sh.getRange(startRow, 1, numRows, header.length).getValues();
  const now = new Date();

  // FILE_UPLOAD titles in this submission (ignored in fallback compare)
  const fileTitles = {};
  for (const a of (answers || [])) {
    if (String(a?.type || "").trim() === "FILE_UPLOAD") {
      const t = String(a?.title || "").trim();
      if (t) fileTitles[t] = true;
    }
  }

  const tsCol = titleToCol["Timestamp"];
  const emailCol = titleToCol["UserEmail"];
  const formCol = titleToCol["FormKey"];
  const submissionUidCol = titleToCol["__SubmissionUID"];

  // Current submission UID from incoming answers/new row
  let currentSubmissionUid = "";
  if (submissionUidCol != null) {
    currentSubmissionUid = String(newRow[submissionUidCol] || "").trim();
  }
  if (!currentSubmissionUid) {
    const metaAns = (answers || []).find(a => String(a?.title || "").trim() === "__SubmissionUID");
    currentSubmissionUid = String(metaAns?.value || "").trim();
  }

  // 1) Strongest match: same __SubmissionUID
  if (submissionUidCol != null && currentSubmissionUid) {
    for (let i = values.length - 1; i >= 0; i--) {
      const r = values[i];
      const rowUid = String(r[submissionUidCol] || "").trim();
      if (rowUid && rowUid === currentSubmissionUid) {
        return startRow + i;
      }
    }
  }

  // 2) Fallback compare for older rows / older schema
  for (let i = values.length - 1; i >= 0; i--) {
    const r = values[i];

    if (emailCol != null && String(r[emailCol] || "").trim() !== String(email || "").trim()) continue;
    if (formCol != null && String(r[formCol] || "").trim() !== String(formKey || "").trim()) continue;

    const ts = (tsCol != null) ? r[tsCol] : null;
    if (!(ts instanceof Date)) continue;

    const diffMin = (now.getTime() - ts.getTime()) / 60000;
    if (diffMin < 0 || diffMin > minutesWindow) continue;

    let same = true;

    for (let c = 0; c < header.length; c++) {
      const colName = String(header[c] || "").trim();
      if (!colName) continue;

      // Ignore volatile / system columns
      if (colName === "Timestamp") continue;
      if (colName === "SubmissionId") continue;

      // Ignore file-upload columns in fallback mode
      if (fileTitles[colName]) continue;

      const a = String(r[c] ?? "");
      const b = String(newRow[c] ?? "");

      if (a !== b) {
        same = false;
        break;
      }
    }

    if (same) {
      return startRow + i;
    }
  }

  return 0;
}


function app_deleteSubmissionRowBySubmissionUidForCurrentUser(formKey, submissionUid) {
  formKey = String(formKey || "").trim();
  submissionUid = String(submissionUid || "").trim();

  if (!formKey) return { ok: false, error: "formKey is required." };
  if (!submissionUid) return { ok: false, error: "submissionUid is required." };

  const email = app_getCurrentUserEmail_();
  if (!email) {
    return {
      ok: false,
      error: "Could not detect your Google account email."
    };
  }

  const reg = registryReadAll_();
  const menu = access_buildMenuForEmail_(email, reg);

  if (!_menuContainsFormKey_(menu, formKey)) {
    return { ok: false, error: "Access denied for this form.", email, formKey };
  }

  const formRow = (reg.forms || []).find(f => String(f.formKey || "").trim() === formKey);
  if (!formRow) {
    return { ok: false, error: "Form not found in registry (Forms tab).", formKey };
  }

  const destSpreadsheetId = _pickFirstNonEmpty_(formRow, [
    "spreadsheetId",
    "responsesSpreadsheetId",
    "destinationSpreadsheetId",
    "destSpreadsheetId",
    "sheetId"
  ]);

  const destSheetName = _pickFirstNonEmpty_(formRow, [
    "destination",
    "responsesSheetName",
    "destinationSheetName",
    "destSheetName",
    "sheetName",
    "tabName"
  ]);

  if (!destSpreadsheetId) {
    return { ok: false, error: "Destination spreadsheetId is missing in registry.", formKey };
  }

  if (!destSheetName) {
    return { ok: false, error: "Destination sheet/tab name is missing in registry.", formKey };
  }

  try {
    const ss = SpreadsheetApp.openById(destSpreadsheetId);
    const sh = ss.getSheetByName(destSheetName);
    if (!sh) {
      return { ok: false, error: "Destination sheet not found: " + destSheetName };
    }

    const header = _ensureHeaderRow_(sh);
    if (!header.length) {
      return { ok: false, error: "Header row not found." };
    }

    const titleToCol = {};
    header.forEach((h, i) => {
      const key = String(h || "").trim();
      if (key) titleToCol[key] = i;
    });

    const uidCol = titleToCol["__SubmissionUID"];
    const formCol = titleToCol["FormKey"];

    if (uidCol == null) {
      return { ok: false, error: "__SubmissionUID column not found." };
    }

    if (formCol == null) {
      return { ok: false, error: "FormKey column not found." };
    }

    const lastRow = sh.getLastRow();
    if (lastRow < 2) {
      return { ok: true, deleted: 0, rowIndex: 0 };
    }

    const values = sh.getRange(2, 1, lastRow - 1, header.length).getValues();

    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];
      const rowUid = String(row[uidCol] || "").trim();
      const rowFormKey = String(row[formCol] || "").trim();

      if (rowUid === submissionUid && rowFormKey === formKey) {
        const rowIndex = i + 2; // because data starts at row 2
        sh.deleteRow(rowIndex);
        return {
          ok: true,
          deleted: 1,
          rowIndex: rowIndex,
          formKey: formKey,
          submissionUid: submissionUid
        };
      }
    }

    return {
      ok: true,
      deleted: 0,
      rowIndex: 0,
      formKey: formKey,
      submissionUid: submissionUid
    };

  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
