/**
 * =========================================================
 * UFRP ON-PREM QUEUE WORKER
 * =========================================================
 *
 * Option B architecture:
 * - Browser hands off queued submission to on-prem server
 * - Worker performs final GAS submit
 * - Worker performs sync webhook follow-up
 * - Browser no longer depends on final GAS response fields
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

/* ---------------------------------------------------------
 * CONFIG
 * --------------------------------------------------------- */
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxPC8fP8o8UecxXcbXBuL9gjwc7ww6sBggkWIDWzUkCPxWV46UO8n2pKeNbWMvV0SCR/exec";

const NEW_SYNC_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwWUAoAFSKfZnN6qqQ92ahDqQzkNvShkFr2j5SlHEMZqNMFhGjUAggM3ua2xMW8kLC-/exec";

const QUEUE_DIR = "/data/queue";
const PROCESSING_DIR = "/data/processing";
const SENT_DIR = "/data/sent";
const FAILED_DIR = "/data/failed";
const LOG_DIR = "/data/logs";

const INTERVAL_MS = 15000;
let isTickRunning = false;

/* ---------------------------------------------------------
 * ENSURE FOLDERS EXIST
 * --------------------------------------------------------- */
for (const dir of [QUEUE_DIR, PROCESSING_DIR, SENT_DIR, FAILED_DIR, LOG_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/* ---------------------------------------------------------
 * HELPERS
 * --------------------------------------------------------- */
function nowIso() {
  return new Date().toISOString();
}

function log(line) {
  const file = path.join(LOG_DIR, "worker.log");
  fs.appendFileSync(file, `[${nowIso()}] ${line}\n`);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function moveFileAcrossMounts(src, dst) {
  fs.copyFileSync(src, dst);
  fs.unlinkSync(src);
}

/* ---------------------------------------------------------
 * GENERIC JSON HTTP CALL
 * --------------------------------------------------------- */
function jsonHttpRequest(targetUrl, method = "POST", bodyObj = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
    const transport = urlObj.protocol === "https:" ? https : http;

    const body = bodyObj == null ? "" : JSON.stringify(bodyObj);
    const req = transport.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          ...headers
        },
        timeout: 120000
      },
      (res) => {
        let raw = "";

        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          jsonHttpRequest(res.headers.location, "GET", null, {})
            .then(resolve)
            .catch(reject);
          return;
        }

        res.on("data", (chunk) => {
          raw += chunk.toString();
        });

        res.on("end", () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (err) {
            return reject(new Error(`INVALID_JSON_RESPONSE: ${raw.slice(0, 300)}`));
          }

          resolve({
            statusCode: res.statusCode || 0,
            body: parsed
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("HTTP_TIMEOUT"));
    });

    req.on("error", reject);

    if (body) req.write(body);
    req.end();
  });
}

/* ---------------------------------------------------------
 * GAS CALL
 * --------------------------------------------------------- */
async function gasCall(action, args = [], sessionUser = null) {
  const payload = {
    action: String(action || ""),
    args: Array.isArray(args) ? args : [],
    sessionUser
  };

  const res = await jsonHttpRequest(GAS_URL, "POST", payload);

  if (!res || !res.body || typeof res.body !== "object") {
    throw new Error("GAS_EMPTY_RESPONSE");
  }

  return res.body;
}

/* ---------------------------------------------------------
 * QUEUE CLAIM
 * --------------------------------------------------------- */
function takeNextFromQueue(fileName) {
  const src = path.join(QUEUE_DIR, fileName);
  const dst = path.join(PROCESSING_DIR, fileName);

  try {
    moveFileAcrossMounts(src, dst);
    log(`CLAIMED ${fileName} queue -> processing`);
    return true;
  } catch (err) {
    log(`CLAIM_ERROR ${fileName} ${err.message}`);
    return false;
  }
}

/* ---------------------------------------------------------
 * GOOGLE DRIVE UPLOAD FROM STAGED SERVER FILES
 * --------------------------------------------------------- */
function safeEmailKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
}

function safePathKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getStagedFilePath(record, fieldId, blobId, originalName) {
  const emailDir = safeEmailKey(record?.email || "");
  const submissionDir = safePathKey(record?.submissionUid || record?.id || "");
  const safeName = safePathKey(originalName || "file");
  const hash = require("crypto").createHash("sha1").update(String(blobId || "")).digest("hex").slice(0, 16);
  return path.join("/data/uploads", emailDir, submissionDir, `${fieldId}__${hash}__${safeName}`);
}

async function putResumableBufferToDrive(uploadUrl, buffer, sessionUser) {
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const total = buffer.length;
  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const chunkBuf = buffer.subarray(offset, end);
    const b64 = chunkBuf.toString("base64");

    let lastErr = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await gasCall(
          "app_putResumableChunkForCurrentUser",
          [uploadUrl, b64, offset, end, total],
          sessionUser
        );

        if (!res || !res.ok) throw new Error(res?.error || "CHUNK_UPLOAD_FAILED");

        if (res.done) return res.json || {};
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 400 * attempt));
      }
    }

    if (lastErr) throw lastErr;
    offset = end;
  }

  return {};
}

async function uploadLocalFilesToGoogleAndInjectAnswers(record) {
  const formKey = String(record?.formKey || "").trim();
  const email = String(record?.email || "").trim().toLowerCase();
  const submissionUid = String(record?.submissionUid || record?.id || "").trim();

  if (!formKey) throw new Error("FORMKEY_REQUIRED");
  if (!email) throw new Error("EMAIL_REQUIRED");
  if (!submissionUid) throw new Error("SUBMISSION_UID_REQUIRED");

  const sessionUser = { email };
  const localFiles = Array.isArray(record?.localFiles) ? record.localFiles : [];
  record.answers = Array.isArray(record?.answers) ? record.answers : [];

  for (const group of localFiles) {
    const title = String(group?.title || "").trim();
    const fieldId = String(group?.fieldId || "").trim();
    const items = Array.isArray(group?.items) ? group.items : [];
    const links = [];

    for (const item of items) {
      if (!item) continue;

      if (item.uploadedGoogle && item.viewLink) {
        links.push(String(item.viewLink).trim());
        continue;
      }

      const blobId = String(item?.blobId || "").trim();
      const originalName = String(item?.name || "file").trim();
      const mimeType = String(item?.type || "application/octet-stream").trim();
      const stagedPath = getStagedFilePath(record, fieldId, blobId, originalName);

      if (!fs.existsSync(stagedPath)) {
        throw new Error(`STAGED_FILE_MISSING: ${stagedPath}`);
      }

      const fileBuf = fs.readFileSync(stagedPath);

      const session = await gasCall(
        "app_createResumableUploadSessionForCurrentUser",
        [formKey, title, originalName, mimeType, submissionUid],
        sessionUser
      );

      if (!session || !session.ok || !session.uploadUrl) {
        throw new Error(session?.error || "UPLOAD_SESSION_FAILED");
      }

      const fileRes = await putResumableBufferToDrive(session.uploadUrl, fileBuf, sessionUser);
      const fileId = (fileRes && fileRes.id) ? String(fileRes.id) : "";
      const viewLink = fileId ? ("https://drive.google.com/file/d/" + fileId + "/view") : "";

      if (!viewLink) throw new Error("UPLOAD_FINISHED_BUT_NO_FILEID");

      item.uploadedGoogle = true;
      item.viewLink = viewLink;
      links.push(viewLink);
    }

    const ans = record.answers.find(a =>
      String(a?.type || "").trim() === "FILE_UPLOAD" &&
      String(a?.title || "").trim() === title
    );

    if (ans) {
      ans.value = links.join("\n");
    }
  }

  return true;
}

function cleanupStagedFiles(record) {
  const localFiles = Array.isArray(record?.localFiles) ? record.localFiles : [];

  for (const group of localFiles) {
    const fieldId = String(group?.fieldId || "").trim();
    const items = Array.isArray(group?.items) ? group.items : [];

    for (const item of items) {
      if (!item) continue;

      const stagedPath = getStagedFilePath(
        record,
        fieldId,
        String(item?.blobId || "").trim(),
        String(item?.name || "file").trim()
      );

      try {
        if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
      } catch (_) {}

      try {
        if (fs.existsSync(stagedPath + ".json")) fs.unlinkSync(stagedPath + ".json");
      } catch (_) {}
    }
  }

  try {
    const submissionDir = path.join(
      "/data/uploads",
      safeEmailKey(record?.email || ""),
      safePathKey(record?.submissionUid || record?.id || "")
    );
    if (fs.existsSync(submissionDir)) {
      fs.rmSync(submissionDir, { recursive: true, force: true });
      log(`CLEANED_DIR ${submissionDir}`);
    }
  } catch (e) {
    log(`CLEAN_DIR_FAILED ${e.message}`);
  }
}

/* ---------------------------------------------------------
 * FINAL SUBMIT TO GAS
 * --------------------------------------------------------- */
async function submitQueuedRecordToGas(record) {
  const formKey = String(record?.formKey || "").trim();
  const email = String(record?.email || "").trim().toLowerCase();
  const answers = Array.isArray(record?.answers) ? record.answers : [];

  if (!formKey) throw new Error("FORMKEY_REQUIRED");
  if (!email) throw new Error("EMAIL_REQUIRED");

  const sessionUser = { email };

  const res = await gasCall(
    "app_submitFormForCurrentUser",
    [formKey, { answers }],
    sessionUser
  );

  if (!res || !res.ok) {
    throw new Error(res?.error || "FINAL_SUBMIT_FAILED");
  }

  return res;
}

/* ---------------------------------------------------------
 * SYNC WEBHOOK
 * --------------------------------------------------------- */
async function runSyncWebhookIfNeeded(record, submitRes) {
  const submissionUid = String(record?.submissionUid || "").trim();
  const syncUrls = Array.isArray(submitRes?.syncUrls) ? submitRes.syncUrls : [];
  const spreadsheetId = String(submitRes?.destSpreadsheetId || "").trim();
  const responsesSheetName = String(submitRes?.destSheetName || "").trim();
  const syncUrlsStatus = String(submitRes?.syncUrlsStatus || "").trim();

  if (
    syncUrlsStatus !== "Enabled" ||
    !syncUrls.length ||
    !spreadsheetId ||
    !responsesSheetName ||
    !submissionUid
  ) {
    log(`SYNC_WEBHOOK_SKIPPED id=${record.id || "unknown"} submissionUid=${submissionUid || "none"}`);
    return { ok: true, skipped: true };
  }

  const destUrlCols = String(syncUrls[0]?.DestUrlCols || "").trim();

  const targets = syncUrls.map((r) => ({
    SyncTab: String(r.SyncTab || "").trim(),
    SyncHeaderRow: Number(r.SyncHeaderRow || 0),
    SyncUrlCols: String(r.SyncUrlCols || "").trim(),
    SyncUidCol: String(r.SyncUidCol || "").trim(),
    DestUidCol: String(r.DestUidCol || "").trim()
  }));

  const payload = {
    spreadsheetId,
    responsesSheetName,
    submissionUid,
    destUrlCols,
    targets
  };

  const res = await jsonHttpRequest(NEW_SYNC_WEBAPP_URL, "POST", payload);

  if (!res || res.statusCode >= 400) {
    throw new Error(`SYNC_WEBHOOK_HTTP_${res?.statusCode || 0}`);
  }

  if (res.body && res.body.ok === false) {
    throw new Error(res.body.error || "SYNC_WEBHOOK_FAILED");
  }

  log(`SYNC_WEBHOOK_OK id=${record.id || "unknown"} submissionUid=${submissionUid}`);

  return { ok: true, skipped: false, response: res.body };
}

/* ---------------------------------------------------------
 * PROCESS ONE FILE
 * --------------------------------------------------------- */
async function processOne(fileName) {
  const src = path.join(PROCESSING_DIR, fileName);
  const sentDst = path.join(SENT_DIR, fileName);
  const failedDst = path.join(FAILED_DIR, fileName);
  const queueDst = path.join(QUEUE_DIR, fileName);

  try {
    const record = readJsonFile(src);

    record.status = "uploading_gdrive";
    record.updatedAt = nowIso();
    record.retryCount = Number(record.retryCount || 0) + 1;
    writeJsonFile(src, record);

    log(
      `READY ${fileName} id=${record.id || "unknown"} formKey=${record.formKey || ""} submissionUid=${record.submissionUid || ""}`
    );

    await uploadLocalFilesToGoogleAndInjectAnswers(record);
    writeJsonFile(src, record);

    record.status = "submitting_gas";
    record.updatedAt = nowIso();
    writeJsonFile(src, record);

    const submitRes = await submitQueuedRecordToGas(record);

    record.status = "submitted_gas";
    record.updatedAt = nowIso();
    record.finalSubmitResponse = submitRes;
    writeJsonFile(src, record);

    await runSyncWebhookIfNeeded(record, submitRes);
    cleanupStagedFiles(record);

    record.status = "sent";
    record.updatedAt = nowIso();
    record.lastError = "";
    writeJsonFile(src, record);

    moveFileAcrossMounts(src, sentDst);
    log(`MOVED ${fileName} processing -> sent`);
  } catch (err) {
    try {
      const record = readJsonFile(src);
      const errMsg = String(err?.message || err || "");
      const retryable = /timeout|timed out|failed to fetch|network|502|503|504|eai_again|getaddrinfo|dns|offline|سهمیه پهنای باند|مجاز فراتر|uploadType=resumable/i.test(errMsg);

      record.updatedAt = nowIso();
      record.lastError = errMsg;

      if (retryable) {
        record.status = "queued_retry";
        writeJsonFile(src, record);
        moveFileAcrossMounts(src, queueDst);
        log(`REQUEUED ${fileName} -> queue ${record.lastError}`);
      } else {
        record.status = "failed";
        writeJsonFile(src, record);
        moveFileAcrossMounts(src, failedDst);
        log(`FAILED ${fileName} -> failed ${record.lastError}`);
      }
    } catch (innerErr) {
      log(`ERROR ${fileName} ${err.message} / FAIL_MOVE_ERROR ${innerErr.message}`);
    }
  }
}

/* ---------------------------------------------------------
 * ONE WORKER CYCLE
 * --------------------------------------------------------- */
async function tick() {
  if (isTickRunning) {
    log("TICK_SKIPPED_ALREADY_RUNNING");
    return;
  }

  isTickRunning = true;

  try {
    const queuedFiles = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith(".json"));
    for (const file of queuedFiles) {
      takeNextFromQueue(file);
    }

    const processingFiles = fs.readdirSync(PROCESSING_DIR).filter((f) => f.endsWith(".json"));
    for (const file of processingFiles) {
      await processOne(file);
    }
  } catch (err) {
    log(`TICK_ERROR ${err.message}`);
  } finally {
    isTickRunning = false;
  }
}

log("WORKER_STARTED");
setInterval(tick, INTERVAL_MS);
tick();