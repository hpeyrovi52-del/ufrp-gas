/**
 * =========================================================
 * UFRP ON-PREM INTERNAL API SERVER
 * =========================================================
 *
 * PHASE 1 COMPLETE + SUBMISSION STEP 1
 *
 * Implemented:
 * - GET  /health
 * - GET  /internal/health-local
 * - GET  /internal/health-upstream
 * - POST /internal/cache/menu
 * - POST /internal/cache/form-bundle
 * - POST /internal/cache/form-options
 * - POST /internal/submit-local
 * - GET  /internal/queue-summary
 * - GET  /internal/queue-items
 * - GET  /queue-count
 * - POST /submit   (legacy intake kept unchanged)
 *
 * IMPORTANT:
 * - Browser should NOT call Node directly
 * - Browser should call PHP bridge endpoints under /api/*.php
 * - This file keeps all current working read-side behavior unchanged
 * - This file only ADDS the first submission-side internal endpoints
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

/* ---------------------------------------------------------
 * CONFIG
 * --------------------------------------------------------- */
const PORT = 3000;
const HOST = "0.0.0.0";

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxPC8fP8o8UecxXcbXBuL9gjwc7ww6sBggkWIDWzUkCPxWV46UO8n2pKeNbWMvV0SCR/exec";

/* ---------------------------------------------------------
 * STORAGE ROOTS
 * --------------------------------------------------------- */
const DATA_ROOT = "/data";

const UPLOAD_DIR = path.join(DATA_ROOT, "uploads");
const QUEUE_DIR = path.join(DATA_ROOT, "queue");
const PROCESSING_DIR = path.join(DATA_ROOT, "processing");
const SENT_DIR = path.join(DATA_ROOT, "sent");
const FAILED_DIR = path.join(DATA_ROOT, "failed");
const LOG_DIR = path.join(DATA_ROOT, "logs");

const CACHE_ROOT = path.join(DATA_ROOT, "cache");
const CACHE_MENU_DIR = path.join(CACHE_ROOT, "menu");
const CACHE_BUNDLE_DIR = path.join(CACHE_ROOT, "bundles");
const CACHE_OPTIONS_DIR = path.join(CACHE_ROOT, "options");

[
  UPLOAD_DIR,
  QUEUE_DIR,
  PROCESSING_DIR,
  SENT_DIR,
  FAILED_DIR,
  LOG_DIR,
  CACHE_ROOT,
  CACHE_MENU_DIR,
  CACHE_BUNDLE_DIR,
  CACHE_OPTIONS_DIR
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/* ---------------------------------------------------------
 * HELPERS
 * --------------------------------------------------------- */
function nowIso() {
  return new Date().toISOString();
}

function safeNowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(obj));
}

function writeLog(line) {
  const logFile = path.join(LOG_DIR, "server.log");
  fs.appendFileSync(logFile, `[${nowIso()}] ${line}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();

      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function countJsonFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

function safeEmailKey(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, "_");
}

function safeFormKey(formKey) {
  return String(formKey || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function safeReadJsonFile(filePath) {
  try {
    return readJsonFile(filePath);
  } catch (err) {
    writeLog(`READ_JSON_ERROR ${filePath} ${err.message}`);
    return null;
  }
}

/* ---------------------------------------------------------
 * UPSTREAM STATUS
 * --------------------------------------------------------- */
const UPSTREAM_STATUS_FILE = path.join(CACHE_ROOT, "upstream-status.json");

function getUpstreamStatus() {
  try {
    if (fs.existsSync(UPSTREAM_STATUS_FILE)) {
      const parsed = readJsonFile(UPSTREAM_STATUS_FILE);
      return {
        ok: true,
        googleReachable: !!parsed.googleReachable,
        lastCheckedAt: parsed.lastCheckedAt || null,
        lastSuccessAt: parsed.lastSuccessAt || null
      };
    }
  } catch (err) {
    writeLog(`UPSTREAM_STATUS_READ_ERROR ${err.message}`);
  }

  return {
    ok: true,
    googleReachable: false,
    lastCheckedAt: null,
    lastSuccessAt: null
  };
}

function updateUpstreamStatus(googleReachable) {
  const prev = getUpstreamStatus();

  const next = {
    googleReachable: !!googleReachable,
    lastCheckedAt: nowIso(),
    lastSuccessAt: googleReachable ? nowIso() : (prev.lastSuccessAt || null)
  };

  try {
    writeJsonFile(UPSTREAM_STATUS_FILE, next);
  } catch (err) {
    writeLog(`UPSTREAM_STATUS_WRITE_ERROR ${err.message}`);
  }
}

/* ---------------------------------------------------------
 * MENU CACHE HELPERS
 * --------------------------------------------------------- */
function getMenuCacheFilePath(email) {
  return path.join(CACHE_MENU_DIR, `${safeEmailKey(email)}.json`);
}

function readCachedMenu(email) {
  const filePath = getMenuCacheFilePath(email);
  if (!fs.existsSync(filePath)) return null;

  const parsed = readJsonFile(filePath);

  return {
    ok: true,
    source: "cache",
    cachedAt: parsed.cachedAt || null,
    email: parsed.email || String(email || "").trim().toLowerCase(),
    fullName: parsed.fullName || "",
    menu: Array.isArray(parsed.menu) ? parsed.menu : []
  };
}

function writeCachedMenu(email, payload) {
  const filePath = getMenuCacheFilePath(email);

  const record = {
    cachedAt: nowIso(),
    email: String(payload.email || email || "").trim().toLowerCase(),
    fullName: String(payload.fullName || "").trim(),
    menu: Array.isArray(payload.menu) ? payload.menu : []
  };

  writeJsonFile(filePath, record);

  return {
    ok: true,
    source: "fresh",
    cachedAt: record.cachedAt,
    email: record.email,
    fullName: record.fullName,
    menu: record.menu
  };
}

/* ---------------------------------------------------------
 * FORM BUNDLE CACHE HELPERS
 * --------------------------------------------------------- */
function getBundleCacheFilePath(formKey) {
  return path.join(CACHE_BUNDLE_DIR, `${safeFormKey(formKey)}.json`);
}

function readCachedBundle(formKey) {
  const filePath = getBundleCacheFilePath(formKey);
  if (!fs.existsSync(filePath)) return null;

  const parsed = readJsonFile(filePath);

  return {
    ok: true,
    source: "cache",
    cachedAt: parsed.cachedAt || null,
    formKey: parsed.formKey || String(formKey || "").trim(),
    schema: parsed.schema || null,
    form: parsed.form || null,
    syncUrls: Array.isArray(parsed.syncUrls) ? parsed.syncUrls : []
  };
}

function writeCachedBundle(formKey, payload) {
  const filePath = getBundleCacheFilePath(formKey);

  const record = {
    cachedAt: nowIso(),
    formKey: String(payload.formKey || formKey || "").trim(),
    schema: payload.schema || null,
    form: payload.form || null,
    syncUrls: Array.isArray(payload.syncUrls) ? payload.syncUrls : []
  };

  writeJsonFile(filePath, record);

  return {
    ok: true,
    source: "fresh",
    cachedAt: record.cachedAt,
    formKey: record.formKey,
    schema: record.schema,
    form: record.form,
    syncUrls: record.syncUrls
  };
}

/* ---------------------------------------------------------
 * FORM OPTIONS CACHE HELPERS
 * --------------------------------------------------------- */
function getOptionsCacheFilePath(formKey) {
  return path.join(CACHE_OPTIONS_DIR, `${safeFormKey(formKey)}.json`);
}

function readCachedOptions(formKey) {
  const filePath = getOptionsCacheFilePath(formKey);
  if (!fs.existsSync(filePath)) return null;

  const parsed = readJsonFile(filePath);

  return {
    ok: true,
    source: "cache",
    cachedAt: parsed.cachedAt || null,
    formKey: parsed.formKey || String(formKey || "").trim(),
    rows: Array.isArray(parsed.rows) ? parsed.rows : []
  };
}

function writeCachedOptions(formKey, payload) {
  const filePath = getOptionsCacheFilePath(formKey);

  const record = {
    cachedAt: nowIso(),
    formKey: String(payload.formKey || formKey || "").trim(),
    rows: Array.isArray(payload.rows) ? payload.rows : []
  };

  writeJsonFile(filePath, record);

  return {
    ok: true,
    source: "fresh",
    cachedAt: record.cachedAt,
    formKey: record.formKey,
    rows: record.rows
  };
}

/* ---------------------------------------------------------
 * GAS CALL
 * --------------------------------------------------------- */
function gasCall(action, args = [], sessionUser = null) {
  const payload = JSON.stringify({
    action: String(action || ""),
    args: Array.isArray(args) ? args : [],
    sessionUser
  });

  return new Promise((resolve, reject) => {
    const urlObj = new URL(GAS_URL);
    const transport = urlObj.protocol === "https:" ? https : http;

    const req = transport.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(payload)
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
          const redirectUrl = new URL(res.headers.location);
          const redirectTransport =
            redirectUrl.protocol === "https:" ? https : http;

          const redirectReq = redirectTransport.request(
            {
              protocol: redirectUrl.protocol,
              hostname: redirectUrl.hostname,
              port:
                redirectUrl.port ||
                (redirectUrl.protocol === "https:" ? 443 : 80),
              path: redirectUrl.pathname + redirectUrl.search,
              method: "GET",
              timeout: 120000
            },
            (redirectRes) => {
              let redirectRaw = "";

              redirectRes.on("data", (chunk) => {
                redirectRaw += chunk.toString();
              });

              redirectRes.on("end", () => {
                try {
                  const parsed = JSON.parse(redirectRaw);
                  resolve(parsed);
                } catch (err) {
                  reject(
                    new Error(
                      `GAS_INVALID_JSON: ${redirectRaw.slice(0, 300)}`
                    )
                  );
                }
              });
            }
          );

          redirectReq.on("timeout", () => {
            redirectReq.destroy(new Error("GAS_TIMEOUT"));
          });

          redirectReq.on("error", reject);
          redirectReq.end();
          return;
        }

        res.on("data", (chunk) => {
          raw += chunk.toString();
        });

        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            resolve(parsed);
          } catch (err) {
            reject(new Error(`GAS_INVALID_JSON: ${raw.slice(0, 300)}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("GAS_TIMEOUT"));
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/* ---------------------------------------------------------
 * FRESH FETCH HELPERS
 * --------------------------------------------------------- */
async function fetchFreshMenu(email, fullName) {
  const res = await gasCall("app_getMenuForEmail", [email], null);

  if (!res || !res.ok) {
    throw new Error(res?.error || "MENU_FETCH_FAILED");
  }

  return {
    email: String(res.email || email || "").trim().toLowerCase(),
    fullName: String(res.fullName || fullName || "").trim(),
    menu: Array.isArray(res.menu) ? res.menu : []
  };
}

async function fetchFreshBundle(formKey, email) {
  const sessionUser = email ? { email } : null;
  const res = await gasCall(
    "app_getFormSchemaForCurrentUser",
    [formKey],
    sessionUser
  );

  if (!res || !res.ok) {
    throw new Error(res?.error || "FORM_BUNDLE_FETCH_FAILED");
  }

  return {
    formKey: String(res.formKey || formKey || "").trim(),
    schema: res.schema || null,
    form: res.form || null,
    syncUrls: Array.isArray(res.syncUrls) ? res.syncUrls : []
  };
}

async function fetchFreshOptions(formKey, email) {
  const sessionUser = email ? { email } : null;
  const res = await gasCall(
    "app_getFormOptionsForCurrentUser",
    [formKey],
    sessionUser
  );

  if (!res || !res.ok) {
    throw new Error(res?.error || "FORM_OPTIONS_FETCH_FAILED");
  }

  return {
    formKey: String(res.formKey || formKey || "").trim(),
    rows: Array.isArray(res.rows) ? res.rows : []
  };
}

/* ---------------------------------------------------------
 * SUBMISSION / QUEUE HELPERS
 * --------------------------------------------------------- */
function getSubmissionFilePath(id, bucketDir = QUEUE_DIR) {
  return path.join(bucketDir, `${String(id || "").trim()}.json`);
}

function normalizeSubmissionRecord(input, ip) {
  const id =
    String(input.id || input.submissionId || input.submissionUid || "").trim() ||
    safeNowId();

  const createdAt = String(input.createdAt || "").trim() || nowIso();
  const updatedAt = nowIso();

  return {
    id,
    submissionUid: String(input.submissionUid || id).trim(),
    formKey: String(input.formKey || "").trim(),
    email: String(input.email || "").trim().toLowerCase(),
    fullName: String(input.fullName || "").trim(),
    answers: Array.isArray(input.answers) ? input.answers : [],
    localFiles: Array.isArray(input.localFiles) ? input.localFiles : [],
    status: String(input.status || "queued").trim(),
    retryCount: Number(input.retryCount || 0),
    lastError: String(input.lastError || "").trim(),
    createdAt,
    updatedAt,
    receivedFromIp: String(ip || ""),
    source: "onprem-browser-handoff"
  };
}

function readQueueItemsFromDir(dirPath, bucketName) {
  if (!fs.existsSync(dirPath)) return [];

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  const out = [];

  for (const file of files) {
    const parsed = safeReadJsonFile(path.join(dirPath, file));
    if (!parsed || typeof parsed !== "object") continue;
    parsed.__bucket = String(bucketName || "").trim();
    out.push(parsed);
  }

  return out;
}

function getAllQueueItems(emailFilter = "") {
  const emailNeedle = String(emailFilter || "").trim().toLowerCase();

  const items = [
    ...readQueueItemsFromDir(QUEUE_DIR, "queue"),
    ...readQueueItemsFromDir(PROCESSING_DIR, "processing"),
    ...readQueueItemsFromDir(FAILED_DIR, "failed"),
    ...readQueueItemsFromDir(SENT_DIR, "sent")
  ];

  const filtered = emailNeedle
    ? items.filter(x => String(x?.email || "").trim().toLowerCase() === emailNeedle)
    : items;

  return filtered.sort((a, b) => {
    const aa = String(a.createdAt || "");
    const bb = String(b.createdAt || "");
    return aa.localeCompare(bb);
  });
}

function getQueueSummaryObject(emailFilter = "") {
  const items = getAllQueueItems(emailFilter);

  const queued = items.filter(x => String(x?.__bucket || "") === "queue").length;
  const processing = items.filter(x => String(x?.__bucket || "") === "processing").length;
  const failed = items.filter(x => String(x?.__bucket || "") === "failed").length;
  const sent = items.filter(x => String(x?.__bucket || "") === "sent").length;

  return {
    ok: true,
    total: queued + processing + failed + sent,
    queued,
    processing,
    failed,
    sent
  };
}

/* ---------------------------------------------------------
 * MAIN SERVER
 * --------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  const ip =
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "unknown";

  try {
    /* ---------------------------------------------
     * HEALTH
     * --------------------------------------------- */
    if (method === "GET" && url === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "ufrp-internal-api",
        time: nowIso()
      });
    }

    if (method === "GET" && url === "/internal/health-local") {
      return sendJson(res, 200, {
        ok: true,
        serverReachable: true,
        time: nowIso()
      });
    }

    if (method === "GET" && url === "/internal/health-upstream") {
      return sendJson(res, 200, getUpstreamStatus());
    }

    /* ---------------------------------------------
     * CACHE: MENU
     * --------------------------------------------- */
    if (method === "POST" && url === "/internal/cache/menu") {
      const body = await readBody(req);

      let parsed;
      try {
        parsed = body && body.trim() ? JSON.parse(body) : {};
      } catch {
        return sendJson(res, 400, { ok: false, error: "INVALID_JSON" });
      }

      const email = String(parsed.email || "").trim().toLowerCase();
      const fullName = String(parsed.fullName || "").trim();

      if (!email) {
        return sendJson(res, 400, { ok: false, error: "EMAIL_REQUIRED" });
      }

      try {
        const fresh = await fetchFreshMenu(email, fullName);
        const saved = writeCachedMenu(email, fresh);
        updateUpstreamStatus(true);
        return sendJson(res, 200, saved);
      } catch (err) {
        writeLog(`MENU_FRESH_FETCH_FAILED ${email} ${err.message}`);
        updateUpstreamStatus(false);

        const cached = readCachedMenu(email);
        if (cached) return sendJson(res, 200, cached);

        return sendJson(res, 502, {
          ok: false,
          error: "UPSTREAM_FETCH_FAILED",
          details: err.message
        });
      }
    }

    /* ---------------------------------------------
     * CACHE: FORM BUNDLE
     * --------------------------------------------- */
    if (method === "POST" && url === "/internal/cache/form-bundle") {
      const body = await readBody(req);

      let parsed;
      try {
        parsed = body && body.trim() ? JSON.parse(body) : {};
      } catch {
        return sendJson(res, 400, { ok: false, error: "INVALID_JSON" });
      }

      const formKey = String(parsed.formKey || "").trim();
      const email = String(parsed.email || "").trim().toLowerCase();

      if (!formKey) {
        return sendJson(res, 400, { ok: false, error: "FORMKEY_REQUIRED" });
      }

      try {
        const fresh = await fetchFreshBundle(formKey, email);
        const saved = writeCachedBundle(formKey, fresh);
        updateUpstreamStatus(true);
        return sendJson(res, 200, saved);
      } catch (err) {
        writeLog(`BUNDLE_FRESH_FETCH_FAILED ${formKey} ${err.message}`);
        updateUpstreamStatus(false);

        const cached = readCachedBundle(formKey);
        if (cached) return sendJson(res, 200, cached);

        return sendJson(res, 502, {
          ok: false,
          error: "UPSTREAM_FETCH_FAILED",
          details: err.message
        });
      }
    }

    /* ---------------------------------------------
     * CACHE: FORM OPTIONS
     * --------------------------------------------- */
    if (method === "POST" && url === "/internal/cache/form-options") {
      const body = await readBody(req);

      let parsed;
      try {
        parsed = body && body.trim() ? JSON.parse(body) : {};
      } catch {
        return sendJson(res, 400, { ok: false, error: "INVALID_JSON" });
      }

      const formKey = String(parsed.formKey || "").trim();
      const email = String(parsed.email || "").trim().toLowerCase();

      if (!formKey) {
        return sendJson(res, 400, { ok: false, error: "FORMKEY_REQUIRED" });
      }

      try {
        const fresh = await fetchFreshOptions(formKey, email);
        const saved = writeCachedOptions(formKey, fresh);
        updateUpstreamStatus(true);
        return sendJson(res, 200, saved);
      } catch (err) {
        writeLog(`OPTIONS_FRESH_FETCH_FAILED ${formKey} ${err.message}`);
        updateUpstreamStatus(false);

        const cached = readCachedOptions(formKey);
        if (cached) return sendJson(res, 200, cached);

        return sendJson(res, 502, {
          ok: false,
          error: "UPSTREAM_FETCH_FAILED",
          details: err.message
        });
      }
    }

    /* ---------------------------------------------
     * SUBMISSION: LOCAL INTAKE
     * --------------------------------------------- */
    if (method === "POST" && url === "/internal/submit-local") {
      const body = await readBody(req);

      if (!body.trim()) {
        writeLog(`${ip} SUBMIT_LOCAL_EMPTY_BODY`);
        return sendJson(res, 400, { ok: false, error: "EMPTY_BODY" });
      }

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        writeLog(`${ip} SUBMIT_LOCAL_INVALID_JSON ${err.message}`);
        return sendJson(res, 400, { ok: false, error: "INVALID_JSON" });
      }

      const formKey = String(parsed.formKey || "").trim();
      const submissionUid = String(parsed.submissionUid || "").trim();
      const email = String(parsed.email || "").trim().toLowerCase();
      const fullName = String(parsed.fullName || "").trim();

      if (!formKey) {
        return sendJson(res, 400, { ok: false, error: "FORMKEY_REQUIRED" });
      }

      if (!submissionUid) {
        return sendJson(res, 400, { ok: false, error: "SUBMISSION_UID_REQUIRED" });
      }

      const record = normalizeSubmissionRecord(
        {
          id: submissionUid,
          submissionUid,
          formKey,
          email,
          fullName,
          answers: Array.isArray(parsed.answers) ? parsed.answers : [],
          localFiles: Array.isArray(parsed.localFiles) ? parsed.localFiles : [],
          status: "queued",
          retryCount: 0,
          lastError: ""
        },
        ip
      );

      const filePath = getSubmissionFilePath(record.id, QUEUE_DIR);

      writeJsonFile(filePath, record);
      writeLog(`${ip} SUBMIT_LOCAL_QUEUED ${record.id} formKey=${record.formKey}`);

      return sendJson(res, 200, {
        ok: true,
        queued: true,
        id: record.id,
        submissionUid: record.submissionUid,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      });
    }

    /* ---------------------------------------------
     * QUEUE: SUMMARY
     * --------------------------------------------- */
    if (method === "GET" && url.startsWith("/internal/queue-summary")) {
      const urlObj = new URL(url, "http://localhost");
      const email = String(urlObj.searchParams.get("email") || "").trim().toLowerCase();
      return sendJson(res, 200, getQueueSummaryObject(email));
    }

    /* ---------------------------------------------
     * QUEUE: ITEMS
     * --------------------------------------------- */
    if (method === "GET" && url.startsWith("/internal/queue-items")) {
      const urlObj = new URL(url, "http://localhost");
      const email = String(urlObj.searchParams.get("email") || "").trim().toLowerCase();

      const items = getAllQueueItems(email).map((x) => ({
        id: String(x.id || ""),
        submissionUid: String(x.submissionUid || x.id || ""),
        formKey: String(x.formKey || ""),
        email: String(x.email || ""),
        fullName: String(x.fullName || ""),
        status: String(x.status || "queued"),
        bucket: String(x.__bucket || ""),
        createdAt: String(x.createdAt || ""),
        updatedAt: String(x.updatedAt || ""),
        retryCount: Number(x.retryCount || 0),
        lastError: String(x.lastError || "")
      }));

      return sendJson(res, 200, {
        ok: true,
        items
      });
    }

    /* ---------------------------------------------
     * EXISTING LEGACY ENDPOINTS (UNCHANGED)
     * --------------------------------------------- */
    if (method === "GET" && url === "/queue-count") {
      return sendJson(res, 200, {
        ok: true,
        count: countJsonFiles(QUEUE_DIR)
      });
    }

    if (method === "POST" && url === "/submit") {
      const body = await readBody(req);

      if (!body.trim()) {
        writeLog(`${ip} EMPTY_BODY`);
        return sendJson(res, 400, { ok: false, error: "EMPTY_BODY" });
      }

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        writeLog(`${ip} INVALID_JSON ${err.message}`);
        return sendJson(res, 400, { ok: false, error: "INVALID_JSON" });
      }

      const id = parsed.submissionId || safeNowId();
      const filePath = path.join(QUEUE_DIR, `${id}.json`);

      const record = {
        id,
        status: "queued",
        receivedAt: nowIso(),
        updatedAt: nowIso(),
        ip,
        payload: parsed
      };

      writeJsonFile(filePath, record);
      writeLog(`${ip} QUEUED ${id}`);

      return sendJson(res, 200, {
        ok: true,
        queued: true,
        id,
        status: "queued"
      });
    }

    /* ---------------------------------------------
     * NOT FOUND
     * --------------------------------------------- */
    writeLog(`${ip} NOT_FOUND ${method} ${url}`);
    return sendJson(res, 404, {
      ok: false,
      error: "NOT_FOUND"
    });
  } catch (err) {
    writeLog(`${ip} SERVER_ERROR ${err.message}`);
    return sendJson(res, 500, {
      ok: false,
      error: "SERVER_ERROR",
      details: err.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ufrp-internal-api listening on ${HOST}:${PORT}`);
  writeLog(`SERVER_STARTED ${HOST}:${PORT}`);
});