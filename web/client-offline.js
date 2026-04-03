(function () {
  "use strict";

  const DB_NAME = "UFRP_OFFLINE_DB";
  const DB_VER  = 3;

  const STORE = "submissions"; // submission records (metadata + state machine)
  const BLOBS = "blobs";       // file blobs (persisted for true offline + crash resume)
  const CACHE = "cache";       // menu / bundle / schema / options cache

  let syncHandler = null;
  let isFlushing = false;

  function safeClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const db = req.result;

        // submissions store
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("createdAt", "createdAt", { unique: false });
        } else {
          const tx = req.transaction;
          const os = tx.objectStore(STORE);
          if (!os.indexNames.contains("createdAt")) {
            os.createIndex("createdAt", "createdAt", { unique: false });
          }
        }

        // blobs store
        if (!db.objectStoreNames.contains(BLOBS)) {
          const bs = db.createObjectStore(BLOBS, { keyPath: "id" });
          bs.createIndex("submissionId", "submissionId", { unique: false });
          bs.createIndex("createdAt", "createdAt", { unique: false });
        } else {
          const tx = req.transaction;
          const bs = tx.objectStore(BLOBS);
          if (!bs.indexNames.contains("submissionId")) {
            bs.createIndex("submissionId", "submissionId", { unique: false });
          }
          if (!bs.indexNames.contains("createdAt")) {
            bs.createIndex("createdAt", "createdAt", { unique: false });
          }
        }

        // cache store
        if (!db.objectStoreNames.contains(CACHE)) {
          const cs = db.createObjectStore(CACHE, { keyPath: "key" });
          cs.createIndex("type", "type", { unique: false });
          cs.createIndex("updatedAt", "updatedAt", { unique: false });
        } else {
          const tx = req.transaction;
          const cs = tx.objectStore(CACHE);
          if (!cs.indexNames.contains("type")) {
            cs.createIndex("type", "type", { unique: false });
          }
          if (!cs.indexNames.contains("updatedAt")) {
            cs.createIndex("updatedAt", "updatedAt", { unique: false });
          }
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("TX_FAILED"));
      tx.objectStore(STORE).put(item);
    });
  }

  async function idbGetAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? req.result : [];
        rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(String(id || ""));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("TX_FAILED"));
      tx.objectStore(STORE).delete(String(id || ""));
    });
  }

  async function idbCachePut(entry) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("TX_FAILED"));
      tx.objectStore(CACHE).put(entry);
    });
  }

  async function idbCacheGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE, "readonly");
      const req = tx.objectStore(CACHE).get(String(key || ""));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbCacheDelete(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("TX_FAILED"));
      tx.objectStore(CACHE).delete(String(key || ""));
    });
  }

  // -------------------------
  // BLOB STORE
  // -------------------------

  async function idbBlobPut(blobItem) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("TX_FAILED"));
      tx.objectStore(BLOBS).put(blobItem);
    });
  }

  async function idbBlobGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS, "readonly");
      const req = tx.objectStore(BLOBS).get(String(id || ""));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbBlobDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("TX_FAILED"));
      tx.objectStore(BLOBS).delete(String(id || ""));
    });
  }

  async function idbBlobDeleteBySubmissionId(submissionId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS, "readwrite");
      const store = tx.objectStore(BLOBS);
      const idx = store.index("submissionId");
      const req = idx.openCursor(IDBKeyRange.only(String(submissionId || "")));

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("TX_FAILED"));
    });
  }

  async function countBlobsBySubmissionId(submissionId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS, "readonly");
      const store = tx.objectStore(BLOBS);
      const idx = store.index("submissionId");
      const req = idx.count(IDBKeyRange.only(String(submissionId || "")));
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function countQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function flushQueueInternal() {
    if (isFlushing) {
      console.log("Flush skipped (already running).");
      return { ok: true, processed: 0, remaining: await countQueue() };
    }

    if (typeof syncHandler !== "function") {
      console.warn("Flush skipped: no syncHandler registered.");
      return { ok: false, error: "NO_SYNC_HANDLER", processed: 0, remaining: await countQueue() };
    }

    if (!navigator.onLine) {
      console.log("Flush skipped: offline.");
      return { ok: false, error: "OFFLINE", processed: 0, remaining: await countQueue() };
    }

    isFlushing = true;
    let processed = 0;
    let failed = 0;

    try {
      const items = await idbGetAll();
      console.log("Flush called. Queue size:", items.length);

      for (const item of items) {
        try {
          item.status = "processing";
          item.updatedAt = new Date().toISOString();
          item.attemptCount = Number(item.attemptCount || 0) + 1;
          await idbPut(item);
          if (window.OUTBOX && window.OUTBOX.refresh) window.OUTBOX.refresh();

          const ok = await syncHandler(item);
          if (ok === false) throw new Error("syncHandler returned false");

          item.status = "done";
          item.updatedAt = new Date().toISOString();
          item.lastError = "";
          await idbPut(item);

          await idbDelete(item.id);
          if (window.OUTBOX && window.OUTBOX.refresh) window.OUTBOX.refresh();

          processed++;
        } catch (err) {
          failed++;

          const errMsg = String(err && err.message ? err.message : err || "");

          const stillExists = await idbGet(item.id);
          if (!stillExists) {
            if (window.OUTBOX && window.OUTBOX.refresh) window.OUTBOX.refresh();
            continue;
          }

          const retryable =
            /timeout|timed out|failed to fetch|network|502|503|offline|upload_to_server_failed|local_api_unreachable|آفلاین|ارسال بعداً انجام می‌شود|پس از برقراری ارتباط|قطع میباشد|ارتباط با سرور|سرور میانی/i.test(errMsg);

          item.updatedAt = new Date().toISOString();
          item.lastError = errMsg;

          if (retryable) {
            item.status = "queued";
            await idbPut(item);

            console.warn("Transient error, will retry automatically.", { id: item?.id, errMsg });

            setTimeout(() => {
              try { scheduleAutoFlush(); } catch (_) {}
            }, 4000);
          } else {
            item.status = "failed";
            await idbPut(item);

            console.error("Flush item failed.", { id: item?.id, errMsg });
          }

          if (window.OUTBOX && window.OUTBOX.refresh) window.OUTBOX.refresh();

          break; // keep FIFO order stable
        }
      }
    } finally {
      isFlushing = false;
    }

    const remaining = await countQueue();

    if (remaining > 0 && navigator.onLine) {
      setTimeout(() => {
        try { scheduleAutoFlush(); } catch (_) {}
      }, 300);
    }

    return { ok: failed === 0, processed, failed, remaining };
  }

  function scheduleAutoFlush() {
    if (!navigator.onLine) return;

    try {
      if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
        window.OUTBOX.refresh();
      }
    } catch (_) {}

    setTimeout(() => {
      try {
        if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
          window.OUTBOX.refresh();
        }
      } catch (_) {}

      flushQueueInternal()
        .catch(e => console.error("Auto-flush error:", e))
        .finally(() => {
          try {
            if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
              window.OUTBOX.refresh();
            }
          } catch (_) {}
        });
    }, 300);
  }

  console.log("OFFLINE ENGINE LOADED (idb v1)");

  window.__OFFLINE__ = {
    version: "1.2-idb-error-delete-fix",
    isReady: true,

    enqueueSubmission: async function (payload) {
      const id = (window.crypto && crypto.randomUUID)
        ? ("idb-" + crypto.randomUUID())
        : ("idb-" + Date.now() + "-" + Math.random().toString(16).slice(2));

      const nowIso = new Date().toISOString();

      const item = {
        id,
        kind: "submission",
        status: "queued",
        createdAt: nowIso,
        updatedAt: nowIso,
        attemptCount: 0,
        lastError: "",
        payload: safeClone(payload ?? null)
      };

      await idbPut(item);

      const len = await countQueue();
      console.log("Submission stored in IndexedDB:", id);
      console.log("Current queue length:", len);

      return id;
    },

    // ---- BLOB API ----
    putBlob: async function ({ id, submissionId, fieldId, name, type, size, blob }) {
      if (!id) throw new Error("putBlob: id required");
      if (!submissionId) throw new Error("putBlob: submissionId required");
      if (!fieldId) throw new Error("putBlob: fieldId required");
      if (!blob) throw new Error("putBlob: blob required");

      await idbBlobPut({
        id: String(id),
        submissionId: String(submissionId),
        fieldId: String(fieldId),
        name: String(name || ""),
        type: String(type || "application/octet-stream"),
        size: Number(size || 0),
        blob: blob,
        createdAt: new Date().toISOString()
      });

      return true;
    },

    getBlob: async function (id) {
      return await idbBlobGet(String(id || ""));
    },

    deleteBlob: async function (id) {
      return await idbBlobDelete(String(id || ""));
    },

    deleteBlobsBySubmissionId: async function (submissionId) {
      return await idbBlobDeleteBySubmissionId(String(submissionId || ""));
    },

    countBlobsBySubmissionId: async function (submissionId) {
      return await countBlobsBySubmissionId(String(submissionId || ""));
    },

    getQueue: async function () {
      return await idbGetAll();
    },

    getQueueItem: async function (id) {
      if (!id) return null;
      return await idbGet(String(id));
    },

    removeQueueItem: async function (id) {
      if (!id) return false;
      await idbDelete(String(id));
      return true;
    },

    clearQueue: async function () {
      const db = await openDB();

      return await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE, BLOBS], "readwrite");
        tx.objectStore(STORE).clear();
        tx.objectStore(BLOBS).clear();

        tx.oncomplete = () => {
          try { db.close(); } catch (_) {}
          resolve(true);
        };
        tx.onerror = () => {
          try { db.close(); } catch (_) {}
          reject(tx.error || new Error("CLEAR_QUEUE_FAILED"));
        };
      });
    },

    hardResetOfflineState: async function () {
      const db = await openDB();
      const storeNames = Array.from(db.objectStoreNames || []);

      return await new Promise((resolve, reject) => {
        if (!storeNames.length) {
          try { db.close(); } catch (_) {}
          resolve(true);
          return;
        }

        const tx = db.transaction(storeNames, "readwrite");
        storeNames.forEach((name) => {
          try { tx.objectStore(name).clear(); } catch (_) {}
        });

        tx.oncomplete = () => {
          try { db.close(); } catch (_) {}
          resolve(true);
        };
        tx.onerror = () => {
          try { db.close(); } catch (_) {}
          reject(tx.error || new Error("HARD_RESET_OFFLINE_STATE_FAILED"));
        };
      });
    },

    getQueueSummary: async function () {
      try {
        await openDB();
      } catch (e) {
        console.warn("DB not ready for summary", e);
        return { total: 0, queued: 0, processing: 0, failed: 0 };
      }

      try {
        const items = await idbGetAll();

        const queued = items.filter(x => x && x.status === "queued").length;
        const processing = items.filter(x => x && x.status === "processing").length;
        const failed = items.filter(x => x && x.status === "failed").length;

        return {
          total: items.length,
          queued,
          processing,
          failed
        };
      } catch (err) {
        console.warn("Outbox summary failed:", err);
        return { total: 0, queued: 0, processing: 0, failed: 0 };
      }
    },

    flushQueue: async function () {
      return await flushQueueInternal();
    },

    cachePut: async function (key, type, data) {
      if (!key) throw new Error("cachePut: key required");
      await idbCachePut({
        key: String(key),
        type: String(type || "generic"),
        data: safeClone(data ?? null),
        updatedAt: new Date().toISOString()
      });
      return true;
    },

    cacheGet: async function (key) {
      return await idbCacheGet(String(key || ""));
    },

    cacheDelete: async function (key) {
      return await idbCacheDelete(String(key || ""));
    },

    setSyncHandler: function (fn) {
      syncHandler = fn;
      console.log("setSyncHandler registered (idb v1)");

      try {
        if (navigator.onLine) {
          setTimeout(() => {
            try { scheduleAutoFlush(); } catch (_) {}
          }, 350);
        }
      } catch (_) {}
    }
  };

  window.addEventListener("online", () => {
    console.log("Connection restored. Triggering auto-flush...");

    try {
      if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
        window.OUTBOX.refresh();
      }
    } catch (_) {}

    scheduleAutoFlush();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleAutoFlush();
  });

})();
