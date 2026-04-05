/** =========================================================
 * Client.js — FULL REPLACEMENT
 * =========================================================
 *
 * Purpose:
 * - Main frontend controller for the UFRP PWA
 * - Loads menu, forms, options, uploads, offline queue, and sync flow
 *
 * IMPORTANT AUTH CHANGE:
 * - Google browser auth has been removed
 * - Logged-in user email is now injected by PHP into:
 *     window.__UFRP_USER_EMAIL__
 *
 * IMPORTANT:
 * - Existing GAS contract is preserved
 * - Existing proxy.php contract is preserved
 * - Existing offline / upload / sync logic is preserved
 */

(function () {
"use strict";

/* =========================================================
 * BOOT FLAGS
 * ========================================================= */
window.CLIENT_LOADED = true;
window.__UFRP_FORCE_OFFLINE__ = false;

/* =========================================================
 * BASIC DOM / STRING HELPERS
 * ========================================================= */
function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function isDateLikeTitle(title){
  const t = String(title || "");
  return /تاریخ|date/i.test(t);
}

/* =========================================================
 * GAS CALL LAYER
 * =========================================================
 * All app API calls continue to go through /api/proxy.php
 * This keeps the frontend contract unchanged.
 */
window.gsCall = function (fnName, ...args) {
  return fetch("/api/proxy.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: String(fnName || ""),
      args: args || []
    })
  })
  .then(res => res.text())
  .then(text => {
    try {
      const data = JSON.parse(text);
      window.__UFRP_FORCE_OFFLINE__ = false;
      updateOnlineIndicator();
      return data;
    } catch (e) {
      window.__UFRP_FORCE_OFFLINE__ = true;
      updateOnlineIndicator();
      throw new Error("Proxy did not return JSON. First 200 chars: " + text.slice(0, 200));
    }
  })
  .catch(err => {
    window.__UFRP_FORCE_OFFLINE__ = true;
    updateOnlineIndicator();
    throw err;
  });
};

/* =========================================================
 * OPTIONS HEADER HELPERS
 * Supports headers marked with *
 * ========================================================= */
function normalizeHeaderFull(s){
  return String(s ?? "")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headerAllowsAdd(rawHeader){
  const h = normalizeHeaderFull(rawHeader);
  return /[*٭✱✳✴]/.test(h);
}

function headerWithoutStar(rawHeader){
  return normalizeHeaderFull(rawHeader).replace(/[*٭✱✳✴]/g, "").trim();
}

function findOptionsHeaderInfoForTitle(optionsFieldMap, title){
  const wanted = normalizeHeaderFull(title);
  const keys = Object.keys(optionsFieldMap || {});

  for (const k of keys){
    const cleaned = headerWithoutStar(k);
    if (cleaned === wanted){
      return { header: k, allowAdd: headerAllowsAdd(k) };
    }
  }
  return { header: null, allowAdd: false };
}

/* =========================================================
 * PERSIAN DIGITS / AMOUNT INPUT HELPERS
 * ========================================================= */
const FA_DIGITS = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];

function toFaDigits(str){
  return String(str ?? "").replace(/\d/g, d => FA_DIGITS[Number(d)]);
}

function stripToDigits(str){
  const s = String(str ?? "")
    .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

  return s.replace(/[^\d]/g, "");
}

function formatThousandsEn(digits){
  if (!digits) return "";
  digits = String(digits).replace(/^0+(?=\d)/, "0");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatAmountFa(raw){
  const digits = stripToDigits(raw);
  const withSep = formatThousandsEn(digits);
  return toFaDigits(withSep);
}

function isAmountTitle(title){
  return /مبلغ/.test(String(title || ""));
}

function attachAmountInputBehavior(inputEl){
  if (!inputEl) return;

  inputEl.inputMode = "numeric";
  inputEl.autocomplete = "off";
  inputEl.spellcheck = false;
  inputEl.dataset.rawDigits = "";

  const applyFormat = () => {
    const digits = stripToDigits(inputEl.value);
    inputEl.dataset.rawDigits = digits;
    inputEl.value = formatAmountFa(digits);
  };

  inputEl.addEventListener("input", applyFormat);

  inputEl.addEventListener("paste", (e) => {
    e.preventDefault();
    const txt = (e.clipboardData || window.clipboardData).getData("text");
    const digits = stripToDigits(txt);
    inputEl.dataset.rawDigits = digits;
    inputEl.value = formatAmountFa(digits);
  });

  applyFormat();
}

/* =========================================================
 * QUESTION GROUPING / ICON HELPERS
 * ========================================================= */
function normFa(s){
  return String(s ?? "")
    .replace(/\u200c/g,"")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase();
}

function categorizeQuestion(it){
  const type = String(it?.type || "").trim();
  const t = normFa(String(it?.title || ""));

  if (type === "DATE" || type === "DATETIME" || type === "TIME" || /تاریخ|date/.test(t)) return "تاریخ‌ها";
  if (/(حساب\s*(کدام|چه)\s*(شخص|کسی)|حساب.*(شخص|کسی))/.test(t)) return "اشخاص";
  if (/(درصد\s*سهم)/.test(t)) return "اشخاص";
  if (/(سند|رسید|فاکتور)/.test(t)) return "جزئیات و مبلغ";
  if (/(مرکز|نوع\s*تراکنش|مرکز هزینه|سرفصل|دسته|دسته‌بندی|دسته بندی|طبقه|پروژه|فعالیت|واحد|محل|بخش)/.test(t)) return "دسته‌بندی";
  if (/(منشع\s*پول\s*پرداختی|منش[اأع]\s*پول\s*پرداختی|منبع\s*پول\s*پرداختی)/.test(t)) return "جزئیات و مبلغ";
  if (/(مبلغ|ریال|تومان|هزینه|شماره|کد|جمع)/.test(t)) return "جزئیات و مبلغ";
  if (/(شرح|توضیح|توضیحات|جزئیات)/.test(t) || type === "PARAGRAPH_TEXT") return "جزئیات و مبلغ";
  if (/(درخواست‌کننده|درخواست کننده|شخص|اشخاص|کارفرما|پیمانکار|مجری|تامین|تأمین|پرداخت‌کننده|پرداخت کننده)/.test(t)) return "اشخاص";

  return "سایر";
}

function iconSvg(path) {
  return `<span class="qIcon" aria-hidden="true"><svg viewBox="0 0 24 24">${path}</svg></span>`;
}

function iconSvgForCategory(cat){
  if (cat === "تاریخ‌ها"){
    return iconSvg(`<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 11h18"></path>`);
  }

  if (cat === "اشخاص"){
    return iconSvg(`<path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="8" r="4"></circle>`);
  }

  if (cat === "دسته‌بندی"){
    return iconSvg(`<path d="M3 10.5V6a2 2 0 0 1 2-2h5"></path><path d="M21 13.5V18a2 2 0 0 1-2 2h-5"></path><path d="M7 10h10"></path><path d="M7 14h10"></path><path d="M7 18h10"></path>`);
  }

  if (cat === "جزئیات و مبلغ"){
    return iconSvg(`<rect x="3" y="6" width="18" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.5"></circle>`);
  }

  return iconSvg(`<path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path>`);
}

function iconSvgForQuestion(it, cat){
  const type = String(it?.type || "").trim();
  const title = String(it?.title || "");
  const t = normFa(title);

  if (type === "DATE" || type === "DATETIME" || type === "TIME" || /تاریخ|date/.test(t)){
    return iconSvg(`<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 11h18"></path>`);
  }

  if (/(درصد|٪|%|سهم)/.test(t)){
    return iconSvg(`<path d="M19 5L5 19"></path><circle cx="7" cy="7" r="2"></circle><circle cx="17" cy="17" r="2"></circle>`);
  }

  if (/(شرح|توضیح|توضیحات|description|جزئیات)/.test(t) || type === "PARAGRAPH_TEXT"){
    return iconSvg(`<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h8"></path>`);
  }

  if (/(سند|رسید|فاکتور|invoice|receipt)/.test(t)){
    return iconSvg(`<path d="M7 2h10v20l-2-1-2 1-2-1-2 1-2-1-2 1z"></path><path d="M9 7h6"></path><path d="M9 11h6"></path><path d="M9 15h6"></path>`);
  }

  if (/(واحد\s*ارز|ارز|currency|fx|نرخ\s*ارز|exchange)/.test(t)){
    return iconSvg(`<ellipse cx="12" cy="6" rx="7" ry="3"></ellipse><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"></path><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>`);
  }

  if (/(مبلغ|ریال|تومان|amount|جمع)/.test(t)){
    return iconSvg(`<rect x="3" y="6" width="18" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.5"></circle>`);
  }

  if (cat === "اشخاص" || /(شخص|کارفرما|پیمانکار|مجری|درخواست‌کننده|پرداخت‌کننده)/.test(t)){
    return iconSvg(`<path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="8" r="4"></circle>`);
  }

  return iconSvgForCategory(cat);
}

function makeSectionChip(title){
  const wrap = document.createElement("div");
  wrap.className = "formSectionChip";
  wrap.innerHTML = `
    <div class="section">
      <div class="line"></div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="line"></div>
    </div>
  `;
  return wrap;
}

const __UFRP_AUTO_EQUAL_SHARE_TITLES__ = new Set([
  "درصد سهم خانم شمس",
  "درصد سهم آقای ثابتی",
  "درصد سهم آقای منصوری"
].map(normFa));

let __UFRP_AUTO_EQUAL_SHARE_SYNCING__ = false;

function isAutoEqualShareTitle_(title){
  return __UFRP_AUTO_EQUAL_SHARE_TITLES__.has(normFa(String(title || "")));
}

function bindAutoEqualShareGroup_(root){
  const rows = Array.from((root || document).querySelectorAll('.field[data-auto-equal-share="1"]'));
  if (rows.length < 2) return;

  function resetShareRowIfEqual_(row){
    const fieldId = String(row?.dataset?.autoEqualFieldId || "").trim();
    if (!fieldId) return;

    const radios = Array.from(row.querySelectorAll(`input[name="${fieldId}__radio"]`));
    const checkedRadio = radios.find((r) => r.checked);
    const pickedVal = String(checkedRadio?.value || "").trim();

    if (pickedVal !== "مساوی") return;

    radios.forEach((r) => { r.checked = false; });

    const hiddenVal = row.querySelector(`#${fieldId}__value`);
    if (hiddenVal) hiddenVal.value = "";

    const otherInput = row.querySelector(`#${fieldId}__other`);
    if (otherInput) {
      otherInput.style.display = "none";
      otherInput.value = "";
    }
  }

  rows.forEach((row) => {
    if (row.dataset.autoEqualShareBound === "1") return;
    row.dataset.autoEqualShareBound = "1";

    const fieldId = String(row.dataset.autoEqualFieldId || "").trim();
    if (!fieldId) return;

    const radios = Array.from(row.querySelectorAll(`input[name="${fieldId}__radio"]`));
    if (!radios.length) return;

    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (__UFRP_AUTO_EQUAL_SHARE_SYNCING__) return;
        if (!radio.checked) return;

        const pickedVal = String(radio.value || "").trim();

        __UFRP_AUTO_EQUAL_SHARE_SYNCING__ = true;
        try {
          if (pickedVal === "مساوی") {
            rows.forEach((otherRow) => {
              const otherFieldId = String(otherRow.dataset.autoEqualFieldId || "").trim();
              if (!otherFieldId) return;

              const otherRadios = Array.from(
                otherRow.querySelectorAll(`input[name="${otherFieldId}__radio"]`)
              );
              const equalRadio = otherRadios.find(
                r => String(r.value || "").trim() === "مساوی"
              );

              if (equalRadio && !equalRadio.checked) {
                equalRadio.checked = true;
                equalRadio.dispatchEvent(new Event("change", { bubbles: true }));
              }
            });
            return;
          }

          if (pickedVal === "سایر") {
            rows.forEach((otherRow) => {
              if (otherRow === row) return;
              resetShareRowIfEqual_(otherRow);
            });
          }
        } finally {
          __UFRP_AUTO_EQUAL_SHARE_SYNCING__ = false;
        }
      });
    });
  });
}

/* =========================================================
 * GLOBAL APP STATE
 * ========================================================= */
const APP = {
  email: "",
  fullName: "",
  menu: [],
  currentFormKey: null,
  currentBundle: null,
  currentSchema: null,
  uploads: {}
};

window.APP = APP;

/* Debug helpers */
function _resetUploadTracking_(){ resetUploadTracking(); }
function _getUploadEntries_(){ return getUploadEntries(); }
async function _waitForAllUploads_(){ return waitForAllUploads(); }
function _getOrCreateDraftSubmissionUid_(){ return getOrCreateDraftSubmissionUid(); }
function _clearDraftSubmissionUid_(){ return clearDraftSubmissionUid(); }

/* =========================================================
 * OUTBOX CHIP / PANEL
 * ========================================================= */
(function setupOutboxChip(){

async function fetchServerQueueItems(){
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      try { ctl.abort(); } catch (_) {}
    }, 8000);

    const res = await fetch("/api/queue-item.php", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: ctl.signal
    });

    clearTimeout(t);

    if (!res || !res.ok) throw new Error("SERVER_QUEUE_ITEMS_HTTP_" + (res ? res.status : 0));

    const j = await res.json();
    return {
      ok: true,
      items: Array.isArray(j?.items) ? j.items : []
    };
  } catch (e) {
    console.warn("Server queue items failed:", e);
    return {
      ok: false,
      items: []
    };
  }
}

async function fetchServerQueueSummary(){
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      try { ctl.abort(); } catch (_) {}
    }, 8000);

    const res = await fetch("/api/queue-summary.php", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: ctl.signal
    });

    clearTimeout(t);

    if (!res || !res.ok) throw new Error("SERVER_QUEUE_SUMMARY_HTTP_" + (res ? res.status : 0));

    const j = await res.json();
    return {
      ok: true,
      total: Number(j?.total || 0),
      queued: Number(j?.queued || 0),
      processing: Number(j?.processing || 0),
      failed: Number(j?.failed || 0),
      sent: Number(j?.sent || 0)
    };
  } catch (e) {
    console.warn("Server queue summary failed:", e);
    return {
      ok: false,
      total: 0,
      queued: 0,
      processing: 0,
      failed: 0,
      sent: 0
    };
  }
}

function isRetryableServerOutboxError_(errMsg){
  return /eai_again|getaddrinfo|dns|offline|network|timeout|timed out|failed to fetch|502|503|504|سهمیه پهنای باند|مجاز فراتر|uploadType=resumable/i.test(
    String(errMsg || "").trim()
  );
}

function isRetryableLocalOutboxError_(errMsg){
  return /failed to fetch|network|offline|timeout|timed out|502|503|504|upload_to_server_failed|local_api_unreachable|connection|disconnect|aborted|internet|آفلاین|ارسال بعداً انجام می‌شود|پس از برقراری ارتباط|سرور میانی|ارتباط با سرور|قطع میباشد/i.test(
    String(errMsg || "").trim()
  );
}

function outboxStagePercent_(stageKey){
  return (
    stageKey === "local_initial_queue" ? 10 :
    stageKey === "local_to_server_uploading" ? 25 :
    stageKey === "server_to_google_queue" ? 40 :
    stageKey === "server_to_google_uploading" ? 70 :
    stageKey === "google_finalizing" ? 90 :
    stageKey === "done" ? 100 : 0
  );
}

const __RECENT_OUTBOX_TTL_MS__ = 2 * 60 * 1000;

function outboxStorageKey_(base){
  const email =
    String(window.__UFRP_USER_EMAIL__ || APP?.email || "")
      .trim()
      .toLowerCase() || "anon";
  return `${String(base || "").trim()}:${email}`;
}

function getActiveOutboxRegistry_(){
  try {
    const raw = localStorage.getItem(outboxStorageKey_("__UFRP_ACTIVE_OUTBOX__"));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function setActiveOutboxRegistry_(items){
  try {
    localStorage.setItem(
      outboxStorageKey_("__UFRP_ACTIVE_OUTBOX__"),
      JSON.stringify(Array.isArray(items) ? items : [])
    );
  } catch (_) {}
}

function upsertActiveOutboxItem_(payload){
  const submissionUid =
    String(payload?.submissionUid || "").trim() ||
    String((((payload?.answers || []).find(a => String(a?.title || "").trim() === "__SubmissionUID") || {}).value) || "").trim();

  if (!submissionUid) return;

  const items = getActiveOutboxRegistry_().filter(x => String(x?.submissionUid || "").trim() !== submissionUid);

  items.push({
    submissionUid,
    formKey: String(payload?.formKey || "").trim(),
    formNameFa: String(payload?.formNameFa || "").trim(),
    answers: Array.isArray(payload?.answers) ? payload.answers : [],
    uiStageKey: String(payload?.uiStageKey || "local_to_server_uploading").trim(),
    uiPercent: Number(payload?.uiPercent || outboxStagePercent_("local_to_server_uploading")),
    uiDeleteAllowed: !!payload?.uiDeleteAllowed,
    uiErrorText: String(payload?.uiErrorText || "").trim(),
    uiStatusOverride: String(payload?.uiStatusOverride || "").trim(),
    rawOutboxError: String(payload?.rawOutboxError || "").trim(),
    status: String(payload?.status || "processing").trim(),
    hasReachedServerStage: !!payload?.hasReachedServerStage,
    missingAfterServerPolls: Number(payload?.missingAfterServerPolls || 0),
    createdAtMs: Number(payload?.createdAtMs || Date.now()),
    updatedAtMs: Date.now()
  });

  setActiveOutboxRegistry_(items);
}

function removeActiveOutboxItem_(submissionUid){
  const uid = String(submissionUid || "").trim();
  if (!uid) return;
  const items = getActiveOutboxRegistry_().filter(x => String(x?.submissionUid || "").trim() !== uid);
  setActiveOutboxRegistry_(items);
}

function normalizeActiveOutboxRegistryItems_(){
  return getActiveOutboxRegistry_().map((x) => ({
    id: "active-" + String(x?.submissionUid || "").trim(),
    submissionUid: String(x?.submissionUid || "").trim(),
    status: String(x?.status || "processing").trim() || "processing",
    sourceLayer: "active",
    uiStageKey: String(x?.uiStageKey || "local_to_server_uploading").trim(),
    uiPercent: Number(x?.uiPercent || outboxStagePercent_("local_to_server_uploading")),
    uiDeleteAllowed: !!x?.uiDeleteAllowed,
    uiErrorText: String(x?.uiErrorText || "").trim(),
    uiStatusOverride: String(x?.uiStatusOverride || "").trim(),
    rawOutboxError: String(x?.rawOutboxError || "").trim(),
    hasReachedServerStage: !!x?.hasReachedServerStage,
    missingAfterServerPolls: Number(x?.missingAfterServerPolls || 0),
    createdAt: new Date(Number(x?.createdAtMs || Date.now())).toISOString(),
    updatedAt: new Date(Number(x?.updatedAtMs || Date.now())).toISOString(),
    retryCount: 0,
    payload: {
      formKey: String(x?.formKey || "").trim(),
      formNameFa: String(x?.formNameFa || "").trim(),
      submissionUid: String(x?.submissionUid || "").trim(),
      answers: Array.isArray(x?.answers) ? x.answers : []
    }
  }));
}

function getRecentOutboxBridge_(){
  try {
    const raw = sessionStorage.getItem("__UFRP_RECENT_OUTBOX__");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function setRecentOutboxBridge_(items){
  try {
    sessionStorage.setItem("__UFRP_RECENT_OUTBOX__", JSON.stringify(Array.isArray(items) ? items : []));
  } catch (_) {}
}

function pruneRecentOutboxBridge_(){
  const now = Date.now();
  const items = getRecentOutboxBridge_().filter(x => {
    const t = Number(x?.createdAtMs || 0);
    return t > 0 && (now - t) < __RECENT_OUTBOX_TTL_MS__;
  });
  setRecentOutboxBridge_(items);
  return items;
}

function addRecentOutboxBridge_(payload){
  const submissionUid =
    String(payload?.submissionUid || "").trim() ||
    String((((payload?.answers || []).find(a => String(a?.title || "").trim() === "__SubmissionUID") || {}).value) || "").trim();

  if (!submissionUid) return;

  let formNameFa = String(payload?.formNameFa || "").trim();

  if (!formNameFa) {
    try {
      const fk = String(payload?.formKey || "").trim();
      const allForms = typeof flattenMenuForms === "function" ? flattenMenuForms(APP.menu) : [];
      const found = allForms.find(f => String(f?.formKey || "").trim() === fk);
      formNameFa = String(found?.formNameFa || found?.titleFa || found?.title || "").trim();
    } catch (_) {}
  }

  const items = pruneRecentOutboxBridge_().filter(x => String(x?.submissionUid || "").trim() !== submissionUid);

  items.push({
    submissionUid,
    formKey: String(payload?.formKey || "").trim(),
    formNameFa: formNameFa,
    answers: Array.isArray(payload?.answers) ? payload.answers : [],
    createdAtMs: Date.now()
  });

  setRecentOutboxBridge_(items);
}

function removeRecentOutboxBridgeByUid_(submissionUid){
  const uid = String(submissionUid || "").trim();
  if (!uid) return;
  const items = pruneRecentOutboxBridge_().filter(x => String(x?.submissionUid || "").trim() !== uid);
  setRecentOutboxBridge_(items);
}

function normalizeRecentOutboxBridgeItems_(){
  return pruneRecentOutboxBridge_().map((x) => ({
    id: "recent-" + String(x?.submissionUid || "").trim(),
    submissionUid: String(x?.submissionUid || "").trim(),
    status: "processing",
    sourceLayer: "recent",
    uiStageKey: "local_to_server_uploading",
    uiPercent: outboxStagePercent_("local_to_server_uploading"),
    uiDeleteAllowed: false,
    uiErrorText: "",
    rawOutboxError: "",
    createdAt: new Date(Number(x?.createdAtMs || Date.now())).toISOString(),
    updatedAt: new Date(Number(x?.createdAtMs || Date.now())).toISOString(),
    retryCount: 0,
    payload: {
      formKey: String(x?.formKey || "").trim(),
      formNameFa: String(x?.formNameFa || "").trim(),
      submissionUid: String(x?.submissionUid || "").trim(),
      answers: Array.isArray(x?.answers) ? x.answers : []
    }
  }));
}

function outboxStageText_(stageKey){
  return (
    stageKey === "local_initial_queue" ? "در صف بارگذاری اولیه" :
    stageKey === "local_to_server_uploading" ? "در حال بارگذاری به سرور میانی" :
    stageKey === "server_to_google_queue" ? "در صف بارگذاری سرور میانی به گوگل" :
    stageKey === "server_to_google_uploading" ? "در حال بارگذاری از سرور میانی به گوگل" :
    stageKey === "google_finalizing" ? "گوگل در حال ثبت نهایی" :
    stageKey === "done" ? "فرایند تکمیل شد" :
    stageKey === "failed_non_retryable" ? "خطای غیر قابل رفع، مورد مجدد باید از طرف کاربر بارگذاری شود" :
    ""
  );
}

function resolveOutboxDisplayTitle_(x){
  const fk = String(x?.payload?.formKey || "").trim();
  let displayTitle =
    String(x?.payload?.formNameFa || "").trim() ||
    fk;

  try {
    if (!String(x?.payload?.formNameFa || "").trim()) {
      const allForms = typeof flattenMenuForms === "function" ? flattenMenuForms(APP.menu) : [];
      const found = allForms.find(f => String(f?.formKey || "").trim() === fk);
      const formNameFa = String(found?.formNameFa || found?.titleFa || found?.title || "").trim();
      if (formNameFa) displayTitle = formNameFa;
    }
  } catch (_) {}

  try {
    const answers = Array.isArray(x?.payload?.answers) ? x.payload.answers : [];
    const descAns = answers.find(a => {
      const t = String(a?.title || "").trim();
      return t === "شرح هزینه" || t === "شرح تراکنش" || t === "شرح";
    });

    const descVal = String(descAns?.value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[<>]/g, "")
      .trim();

    if (descVal) displayTitle += " - " + descVal.slice(0, 60);
  } catch (_) {}

  return displayTitle || "فرم بدون نام";
}

function outboxStageRank_(stageKey){
  return (
    stageKey === "local_initial_queue" ? 10 :
    stageKey === "local_to_server_uploading" ? 20 :
    stageKey === "server_to_google_queue" ? 40 :
    stageKey === "server_to_google_uploading" ? 70 :
    stageKey === "google_finalizing" ? 90 :
    stageKey === "done" ? 100 :
    stageKey === "failed_non_retryable" ? 1000 : 0
  );
}

function preferRicherOutboxAnswers_(a, b){
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];

  const score = (arr) => {
    const nonMeta = arr.filter(x => String(x?.title || "").trim() !== "__SubmissionUID").length;
    const hasDesc = arr.some(x => {
      const t = String(x?.title || "").trim();
      return t === "شرح" || t === "شرح هزینه" || t === "شرح تراکنش";
    }) ? 100 : 0;
    return hasDesc + nonMeta;
  };

  return score(bb) > score(aa) ? bb : aa;
}

function outboxItemKey_(it){
  return String(
    ((it?.payload?.answers || []).find(a => String(a?.title || "").trim() === "__SubmissionUID") || {}).value ||
    it?.payload?.submissionUid ||
    it?.submissionUid ||
    it?.id ||
    ""
  ).trim() || String(it?.id || "").trim();
}

function mergeWithCurrentOutboxSnapshot_(items){
  const next = Array.isArray(items) ? items : [];
  const current = Array.isArray(__OUTBOX_CURRENT_ITEMS__) ? __OUTBOX_CURRENT_ITEMS__ : [];
  if (!current.length || !next.length) return next;

  const curMap = new Map();
  for (const it of current) {
    const k = outboxItemKey_(it);
    if (k) curMap.set(k, it);
  }

  return next.map((it) => {
    const k = outboxItemKey_(it);
    const cur = k ? curMap.get(k) : null;
    if (!cur) return it;

    const curAnswers = Array.isArray(cur?.payload?.answers) ? cur.payload.answers : [];
    const nextAnswers = Array.isArray(it?.payload?.answers) ? it.payload.answers : [];

    return {
      ...it,
      payload: {
        ...(it?.payload || {}),
        formNameFa: String(it?.payload?.formNameFa || cur?.payload?.formNameFa || "").trim(),
        answers: preferRicherOutboxAnswers_(curAnswers, nextAnswers)
      }
    };
  });
}

function stabilizeOutboxItems_(items){
  const arr = Array.isArray(items) ? items : [];
  const prev = Array.isArray(__OUTBOX_LAST_RENDERED_ITEMS__) ? __OUTBOX_LAST_RENDERED_ITEMS__ : [];
  if (!prev.length) return arr;

  const getKey = (it) =>
    String(
      ((it?.payload?.answers || []).find(a => String(a?.title || "").trim() === "__SubmissionUID") || {}).value ||
      it?.payload?.submissionUid ||
      it?.submissionUid ||
      it?.id ||
      ""
    ).trim() || String(it?.id || "").trim();

  const prevMap = new Map();
  for (const it of prev) {
    const key = getKey(it);
    if (key) prevMap.set(key, it);
  }

  return arr.map((it) => {
    const key = getKey(it);
    if (!key) return it;

    const old = prevMap.get(key);
    if (!old) return it;

    const oldRank = outboxStageRank_(String(old?.uiStageKey || "").trim());
    const newRank = outboxStageRank_(String(it?.uiStageKey || "").trim());

    if (newRank >= oldRank) return it;

    const oldAnswers = Array.isArray(old?.payload?.answers) ? old.payload.answers : [];
    const newAnswers = Array.isArray(it?.payload?.answers) ? it.payload.answers : [];

    return {
      ...it,
      uiStageKey: String(old?.uiStageKey || it?.uiStageKey || "").trim(),
      uiPercent: Number(old?.uiPercent || it?.uiPercent || 0),
      status: String(old?.status || it?.status || "").trim() || it.status,
      payload: {
        ...(it?.payload || {}),
        formNameFa: String(old?.payload?.formNameFa || it?.payload?.formNameFa || "").trim(),
        answers: preferRicherOutboxAnswers_(oldAnswers, newAnswers)
      }
    };
  });
}

function buildOutboxChipLinesFromItems_(items){
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return [];

  const counts = new Map();

  for (const it of arr) {
    const stageKey = String(it?.uiStageKey || "").trim();
    if (!stageKey || stageKey === "done") continue;
    counts.set(stageKey, Number(counts.get(stageKey) || 0) + 1);
  }

  const orderedStageKeys = [
    "failed_non_retryable",
    "local_initial_queue",
    "local_to_server_uploading",
    "server_to_google_queue",
    "server_to_google_uploading",
    "google_finalizing"
  ];

  const lines = [];
  for (const k of orderedStageKeys) {
    const n = Number(counts.get(k) || 0);
    if (n <= 0) continue;
    const st = outboxStageText_(k);
    if (!st) continue;
    lines.push(`${toFaDigits(String(n))} فرم ${st}`);
  }

  return lines;
}

function buildGeneralOutboxChipText_(items){
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return "";

  let failed = 0;
  let active = 0;

  for (const it of arr) {
    const k = String(it?.uiStageKey || "").trim();
    if (!k || k === "done") continue;
    if (k === "failed_non_retryable") {
      failed++;
      continue;
    }
    active++;
  }

  const lines = [];

  if (active > 0) {
    lines.push(`${toFaDigits(String(active))} فرم در حال پردازش میباشد`);
  }

  if (failed > 0) {
    lines.push(`${toFaDigits(String(failed))} ارسال ناموفق`);
  }

  return lines.join("<br>");
}

function normalizeLocalOutboxItems_(items){
  return (Array.isArray(items) ? items : []).map((x) => {
    const rawStatus = String(x?.status || "queued").trim();
    const rawErr = String(x?.lastError || "").trim();
    const retryableLocalWait = isRetryableLocalOutboxError_(rawErr);

    let compatStatus = rawStatus || "queued";
    let stageKey = "local_initial_queue";
    let uiDeleteAllowed = false;
    let uiErrorText = "";
    let uiStatusOverride = "";

    if (rawStatus === "processing") {
      compatStatus = "processing";
      stageKey = "local_to_server_uploading";
    } else if (rawStatus === "done") {
      compatStatus = "done";
      stageKey = "done";
    } else if (rawStatus === "failed" && retryableLocalWait) {
      compatStatus = "queued";
      stageKey = "local_to_server_uploading";
      uiStatusOverride = "ارتباط با سرور میانی قطع میباشد";
    } else if (rawStatus === "failed") {
      compatStatus = "failed";
      stageKey = "failed_non_retryable";
      uiDeleteAllowed = true;
      uiErrorText = "خطای غیر قابل رفع، مورد مجدد باید از طرف کاربر بارگذاری شود";
    } else {
      compatStatus = "queued";
      stageKey = "local_initial_queue";
    }

    return {
      ...x,
      status: compatStatus,
      sourceLayer: "local",
      uiStageKey: stageKey,
      uiPercent: outboxStagePercent_(stageKey),
      uiDeleteAllowed: uiDeleteAllowed,
      uiErrorText: uiErrorText,
      uiStatusOverride: uiStatusOverride,
      rawOutboxError: rawErr,
      lastError: uiDeleteAllowed ? uiErrorText : ""
    };
  });
}

function normalizeServerOutboxItems_(items){
  return (Array.isArray(items) ? items : []).map((x) => {
    const bucket = String(x?.bucket || "").trim();
    const rawStatus = String(x?.status || "").trim();
    const rawErr = String(x?.lastError || "").trim();
    const retryableServerWait = isRetryableServerOutboxError_(rawErr);

    let compatStatus = "queued";
    let stageKey = "server_to_google_queue";

    if (bucket === "sent") {
      compatStatus = "done";
      stageKey = "done";
    } else if (bucket === "processing" && (rawStatus === "submitting_gas" || rawStatus === "submitted_gas")) {
      compatStatus = "processing";
      stageKey = "google_finalizing";
    } else if (bucket === "processing") {
      compatStatus = "processing";
      stageKey = "server_to_google_uploading";
    } else if (bucket === "failed" && !retryableServerWait) {
      compatStatus = "failed";
      stageKey = "failed_non_retryable";
    } else {
      compatStatus = "queued";
      stageKey = "server_to_google_queue";
    }

    const answers = Array.isArray(x?.answers) && x.answers.length
      ? x.answers
      : [
          {
            title: "__SubmissionUID",
            type: "TEXT",
            value: String(x?.submissionUid || x?.id || "").trim()
          }
        ];

    let formNameFa = "";
    try {
      const fk = String(x?.formKey || "").trim();
      const allForms = typeof flattenMenuForms === "function" ? flattenMenuForms(APP.menu) : [];
      const found = allForms.find(f => String(f?.formKey || "").trim() === fk);
      formNameFa = String(found?.formNameFa || found?.titleFa || found?.title || "").trim();
    } catch (_) {}

    return {
      id: String(x?.id || ""),
      submissionUid: String(x?.submissionUid || x?.id || "").trim(),
      status: compatStatus,
      lastError:
        stageKey === "failed_non_retryable"
          ? "خطای غیر قابل رفع، مورد مجدد باید از طرف کاربر بارگذاری شود"
          : "",
      rawOutboxError: rawErr,
      createdAt: String(x?.createdAt || "").trim(),
      updatedAt: String(x?.updatedAt || "").trim(),
      retryCount: Number(x?.retryCount || 0),
      sourceLayer: "server",
      uiStageKey: stageKey,
      uiPercent: outboxStagePercent_(stageKey),
      uiDeleteAllowed: stageKey === "failed_non_retryable",
      uiErrorText:
        stageKey === "failed_non_retryable"
          ? "خطای غیر قابل رفع، مورد مجدد باید از طرف کاربر بارگذاری شود"
          : "",
      serverBucket: bucket,
      serverRawStatus: rawStatus,
      payload: {
        formKey: String(x?.formKey || "").trim(),
        formNameFa: formNameFa,
        submissionUid: String(x?.submissionUid || x?.id || "").trim(),
        answers: answers
      }
    };
  });
}

function outboxItemsFromRegistry_(){
  const items = normalizeActiveOutboxRegistryItems_();
  __OUTBOX_CURRENT_ITEMS__ = items.slice();
  return items;
}

function mergeOutboxItemOverlay_(base, overlay){
  const b = base || {};
  const o = overlay || {};

  const bAnswers = Array.isArray(b?.payload?.answers) ? b.payload.answers : [];
  const oAnswers = Array.isArray(o?.payload?.answers) ? o.payload.answers : [];

  const bRank = outboxStageRank_(String(b?.uiStageKey || "").trim());
  const oRank = outboxStageRank_(String(o?.uiStageKey || "").trim());
  const useOverlayStage = oRank >= bRank;

  return {
    ...b,
    ...o,
    uiStageKey: useOverlayStage
      ? String(o?.uiStageKey || b?.uiStageKey || "").trim()
      : String(b?.uiStageKey || o?.uiStageKey || "").trim(),
    uiPercent: useOverlayStage
      ? Number(o?.uiPercent || b?.uiPercent || 0)
      : Number(b?.uiPercent || o?.uiPercent || 0),
    status: useOverlayStage
      ? String(o?.status || b?.status || "processing").trim()
      : String(b?.status || o?.status || "processing").trim(),
    uiDeleteAllowed: !!(o?.uiDeleteAllowed || b?.uiDeleteAllowed),
    uiErrorText: String(o?.uiErrorText || b?.uiErrorText || "").trim(),
    payload: {
      ...(b?.payload || {}),
      ...(o?.payload || {}),
      formKey: String(o?.payload?.formKey || b?.payload?.formKey || "").trim(),
      formNameFa: String(b?.payload?.formNameFa || o?.payload?.formNameFa || "").trim(),
      submissionUid: String(
        o?.payload?.submissionUid ||
        b?.payload?.submissionUid ||
        outboxItemKey_(b) ||
        outboxItemKey_(o) ||
        ""
      ).trim(),
      answers: preferRicherOutboxAnswers_(bAnswers, oAnswers)
    }
  };
}

function registryEntryFromOutboxItem_(it){
  const key = outboxItemKey_(it);
  if (!key) return null;

  return {
    submissionUid: key,
    formKey: String(it?.payload?.formKey || "").trim(),
    formNameFa: String(it?.payload?.formNameFa || "").trim(),
    answers: Array.isArray(it?.payload?.answers) ? it.payload.answers : [],
    uiStageKey: String(it?.uiStageKey || "local_to_server_uploading").trim(),
    uiPercent: Number(it?.uiPercent || outboxStagePercent_("local_to_server_uploading")),
    uiDeleteAllowed: !!it?.uiDeleteAllowed,
    uiErrorText: String(it?.uiErrorText || "").trim(),
    uiStatusOverride: String(it?.uiStatusOverride || "").trim(),
    rawOutboxError: String(it?.rawOutboxError || it?.lastError || "").trim(),
    status: String(it?.status || "processing").trim() || "processing",
    hasReachedServerStage: !!it?.hasReachedServerStage,
    missingAfterServerPolls: Number(it?.missingAfterServerPolls || 0),
    createdAtMs: Date.parse(String(it?.createdAt || "")) || Date.now(),
    updatedAtMs: Date.now()
  };
}

async function syncActiveOutboxRegistry_(){
  const activeItems = normalizeActiveOutboxRegistryItems_();
  const deviceToServerDown = (!navigator.onLine) || !!window.__UFRP_FORCE_OFFLINE__;

  let localItems = [];
  let serverItems = [];
  let serverSummary = { ok: false, total: 0, queued: 0, processing: 0, failed: 0, sent: 0 };
  let serverFetchFailed = false;

  try {
    if (window.__OFFLINE__ && typeof window.__OFFLINE__.getQueue === "function") {
      const items = await window.__OFFLINE__.getQueue();
      localItems = normalizeLocalOutboxItems_(items);
    }
  } catch (e) {
    console.warn("Local outbox items failed:", e);
  }

  if (!activeItems.length && localItems.length) {
    const keep = localItems
      .map(registryEntryFromOutboxItem_)
      .filter(Boolean);

    setActiveOutboxRegistry_(keep);
    __OUTBOX_CURRENT_ITEMS__ = localItems.slice();
    return localItems.slice();
  }

  if (!activeItems.length) {
    setActiveOutboxRegistry_([]);
    __OUTBOX_CURRENT_ITEMS__ = [];
    return [];
  }

  try {
    const [serverItemsRes, serverSummaryRes] = await Promise.all([
      fetchServerQueueItems(),
      fetchServerQueueSummary()
    ]);

    if (!serverItemsRes || !serverItemsRes.ok || !serverSummaryRes || !serverSummaryRes.ok) {
      serverFetchFailed = true;
    } else {
      serverItems = normalizeServerOutboxItems_(serverItemsRes.items);
      serverSummary = serverSummaryRes;
    }
  } catch (e) {
    serverFetchFailed = true;
    console.warn("Server outbox sync failed:", e);
  }

  const activeMap = new Map();
  const localMap  = new Map();
  const serverMap = new Map();

  for (const it of activeItems) {
    const k = outboxItemKey_(it);
    if (k) activeMap.set(k, it);
  }

  for (const it of localItems) {
    const k = outboxItemKey_(it);
    if (k) localMap.set(k, it);
  }

  for (const it of serverItems) {
    const k = outboxItemKey_(it);
    if (k) serverMap.set(k, it);
  }

  const allKeys = new Set([
    ...Array.from(activeMap.keys()),
    ...Array.from(localMap.keys()),
    ...Array.from(serverMap.keys())
  ]);

  const visible = [];

  for (const key of Array.from(allKeys)) {
    const prevActive = activeMap.get(key) || null;
    const localNow   = localMap.get(key) || null;
    const serverNow  = serverMap.get(key) || null;

    let merged = prevActive || localNow || serverNow || null;
    if (!merged) continue;

    if (localNow) {
      merged = mergeOutboxItemOverlay_(merged, localNow);
    }
    if (serverNow) {
      merged = mergeOutboxItemOverlay_(merged, serverNow);
    }

    const bucket = String(merged?.serverBucket || "").trim();
    const stageKey = String(merged?.uiStageKey || "").trim();
    const stageRank = outboxStageRank_(stageKey);

    if (bucket === "sent" || stageKey === "done") {
      removeActiveOutboxItem_(key);
      continue;
    }

    const item = { ...merged };
    item.hasReachedServerStage =
      !!(prevActive?.hasReachedServerStage) ||
      stageRank >= outboxStageRank_("server_to_google_queue");

    if (
      !item.hasReachedServerStage &&
      !localNow &&
      !serverNow
    ) {
      removeActiveOutboxItem_(key);
      continue;
    }

    if (
      item.hasReachedServerStage &&
      !localNow &&
      !serverNow &&
      !serverFetchFailed
    ) {
      item.missingAfterServerPolls = Number(prevActive?.missingAfterServerPolls || 0) + 1;

      if (item.missingAfterServerPolls >= 2) {
        removeActiveOutboxItem_(key);
        continue;
      }

      visible.push(item);
      continue;
    } else {
      item.missingAfterServerPolls = 0;
    }

    const rawErr = String(item?.rawOutboxError || item?.lastError || "").trim();
    const prevOverride = String(prevActive?.uiStatusOverride || "").trim();

    if (stageRank < outboxStageRank_("server_to_google_queue")) {
      item.uiStatusOverride = deviceToServerDown ? "ارتباط با سرور میانی قطع میباشد" : "";
    } else {
      if (isRetryableServerOutboxError_(rawErr)) {
        item.uiStatusOverride = "ارتباط سرور میانی با اینترنت قطع میباشد";
      } else if (serverNow) {
        item.uiStatusOverride = "";
      } else {
        item.uiStatusOverride = prevOverride;
      }
    }

    visible.push(item);
  }

  const keep = visible
    .map(registryEntryFromOutboxItem_)
    .filter(Boolean);

  setActiveOutboxRegistry_(keep);
  __OUTBOX_CURRENT_ITEMS__ = visible.slice();

  return visible.slice();
}

async function outboxGetItems(){
  return outboxItemsFromRegistry_();
}

async function outboxGetSummary(){
  const arr = outboxItemsFromRegistry_();

  const queued = arr.filter(x => String(x?.status || "").trim() === "queued").length;
  const processing = arr.filter(x => String(x?.status || "").trim() === "processing").length;
  const failed = arr.filter(x => String(x?.status || "").trim() === "failed").length;

  return {
    total: arr.length,
    queued,
    processing,
    failed,
    sent: 0,
    localTotal: 0,
    localQueued: 0,
    localProcessing: 0,
    localFailed: 0,
    serverTotal: 0,
    serverQueued: 0,
    serverProcessing: 0,
    serverFailed: 0,
    serverSent: 0,
    recentTotal: 0
  };
}

function outboxAdd(formKey){
  try { updateOutboxChip(); } catch(_) {}
  return null;
}

function outboxSetStatus(id, status, lastError){
  try { updateOutboxChip(); } catch(_) {}
}

let __OUTBOX_PANEL_RENDER_TOKEN__ = 0;
let __OUTBOX_LAST_RENDERED_ITEMS__ = [];
let __OUTBOX_CURRENT_ITEMS__ = [];

async function outboxRemove(id){
  const rawId = String(id || "").trim();

  try {
    if (window.__OFFLINE__ && typeof window.__OFFLINE__.removeQueueItem === "function" && rawId) {
      await window.__OFFLINE__.removeQueueItem(rawId);
    }
  } catch (e) {
    console.warn("Outbox remove failed:", e);
  }

  try {
    let submissionUid = "";

    const current = Array.isArray(__OUTBOX_CURRENT_ITEMS__) ? __OUTBOX_CURRENT_ITEMS__ : [];
    const found = current.find(x => String(x?.id || "").trim() === rawId);
    if (found) {
      submissionUid = outboxItemKey_(found);
    }

    if (!submissionUid && rawId.startsWith("active-")) {
      submissionUid = rawId.slice("active-".length).trim();
    }
    if (!submissionUid && rawId.startsWith("recent-")) {
      submissionUid = rawId.slice("recent-".length).trim();
    }

    if (submissionUid) {
      removeActiveOutboxItem_(submissionUid);

      __OUTBOX_CURRENT_ITEMS__ = current.filter(x => outboxItemKey_(x) !== submissionUid);
      __OUTBOX_LAST_RENDERED_ITEMS__ = (Array.isArray(__OUTBOX_LAST_RENDERED_ITEMS__) ? __OUTBOX_LAST_RENDERED_ITEMS__ : [])
        .filter(x => outboxItemKey_(x) !== submissionUid);
    }
  } catch (e) {
    console.warn("Active outbox remove cleanup failed:", e);
  }

  try { updateOutboxChip(); } catch(_) {}
}

function renderOutboxPanelBody_(items){
  const body = document.getElementById("outboxPanelBody");
  if (!body) return;

  if (!Array.isArray(items) || !items.length) {
    body.innerHTML = `<div style="color:rgba(17,24,39,0.68);">صف ارسال خالی است.</div>`;
    __OUTBOX_LAST_RENDERED_ITEMS__ = [];
    return;
  }

  const orderedItems = items.slice().sort((a, b) => {
    return outboxStageRank_(String(a?.uiStageKey || "").trim()) -
           outboxStageRank_(String(b?.uiStageKey || "").trim());
  });

  __OUTBOX_LAST_RENDERED_ITEMS__ = orderedItems.slice();

  const rows = orderedItems.slice(0, 20).map((x, i) => {
    const st =
      String(x?.uiStatusOverride || "").trim() ||
      outboxStageText_(String(x?.uiStageKey || "").trim()) ||
      String(x?.status || "queued");

    const displayTitle = resolveOutboxDisplayTitle_(x);
    const err = String(x?.uiErrorText || x?.lastError || "").trim();
    const allowDelete = !!x?.uiDeleteAllowed;

    return `
      <div style="padding:10px 0;border-bottom:1px solid rgba(17,24,39,0.08);">
        <div style="font-weight:700;color:rgba(17,24,39,0.92);">
          ${toFaDigits(i + 1)} - ${escapeHtml(displayTitle)}
        </div>

        <div style="font-size:13px;color:rgba(17,24,39,0.68);margin-top:4px;">
          وضعیت: ${escapeHtml(st)}
        </div>

        ${err ? `<div style="font-size:12px;color:#991b1b;margin-top:6px;">${escapeHtml(err)}</div>` : ``}

        ${allowDelete ? `
          <div style="display:flex;gap:8px;justify-content:flex-start;margin-top:10px;">
            <button
              type="button"
              class="outboxDeleteBtn"
              data-id="${escapeHtml(String(x?.id || ""))}"
              style="
                border:1px solid rgba(153,27,27,0.18);
                background:#fff5f5;
                color:#991b1b;
                border-radius:10px;
                padding:6px 10px;
                font-size:12px;
                cursor:pointer;
              "
            >
              حذف
            </button>
          </div>
        ` : ``}
      </div>
    `;
  }).join("");

  body.innerHTML = rows;

  const deleteBtns = Array.from(body.querySelectorAll(".outboxDeleteBtn"));
  deleteBtns.forEach((btn) => {
    btn.onclick = async () => {
      const id = String(btn.getAttribute("data-id") || "").trim();
      if (!id) return;

      try {
        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.textContent = "در حال حذف...";

        await outboxRemove(id);

        await showOutboxDetails();

        if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
          await window.OUTBOX.refresh();
        }
      } catch (e) {
        console.error(e);
      }
    };
  });
}

async function showOutboxDetails(){
  const panel = document.getElementById("outboxPanel");
  if (!panel) return;

  const renderToken = ++__OUTBOX_PANEL_RENDER_TOKEN__;
  const wasAlreadyOpen = !panel.classList.contains("hidden");

  if (!wasAlreadyOpen) {
    panel.classList.remove("hidden");
    window.__OUTBOX_PANEL_OPEN__ = true;
    scheduleOutboxLiveRefresh_();
  }

  const immediate = outboxItemsFromRegistry_();
  renderOutboxPanelBody_(immediate);

  const synced = await syncActiveOutboxRegistry_().catch(() => immediate);

  if (renderToken !== __OUTBOX_PANEL_RENDER_TOKEN__) return;
  if (panel.classList.contains("hidden")) return;

  const latestLocal = outboxItemsFromRegistry_();

  if ((!Array.isArray(synced) || !synced.length) && latestLocal.length > 0) {
    renderOutboxPanelBody_(latestLocal);
    return;
  }

  if (!Array.isArray(synced) || !synced.length) {
    panel.classList.add("hidden");
    window.__OUTBOX_PANEL_OPEN__ = false;
    stopOutboxLiveRefresh_();
    return;
  }

  renderOutboxPanelBody_(synced);
}

function renderOutboxChipFromItems_(chip, txt, items){
  const arr = Array.isArray(items) ? items : [];

  if (!arr.length) {
    chip.style.display = "none";
    chip.classList.remove("pending", "error");
    return;
  }

  chip.style.display = "inline-flex";
  chip.classList.remove("pending", "error");

  txt.innerHTML =
    buildGeneralOutboxChipText_(arr) ||
    `${toFaDigits(String(arr.length || 1))} فرم در حال پردازش میباشد`;

  chip.classList.add(txt.innerHTML.includes("ارسال ناموفق") ? "error" : "pending");
}

async function updateOutboxChip(){
  const chip = document.getElementById("outboxChip");
  const txt  = document.getElementById("outboxText");
  if (!chip || !txt) return;

  const immediate = outboxItemsFromRegistry_();

  if (immediate.length) {
    renderOutboxChipFromItems_(chip, txt, immediate);
  }

  const synced = await syncActiveOutboxRegistry_().catch(() => immediate);
  const latestLocal = outboxItemsFromRegistry_();
  const finalItems =
    (Array.isArray(synced) && synced.length) ? synced :
    (latestLocal.length ? latestLocal : []);

  if (!finalItems.length) {
    setActiveOutboxRegistry_([]);
    __OUTBOX_CURRENT_ITEMS__ = [];
    __OUTBOX_LAST_RENDERED_ITEMS__ = [];
    chip.style.display = "none";
    chip.classList.remove("pending", "error");

    const panel = document.getElementById("outboxPanel");
    if (panel) panel.classList.add("hidden");
    window.__OUTBOX_PANEL_OPEN__ = false;
    stopOutboxLiveRefresh_();
    return;
  }

  renderOutboxChipFromItems_(chip, txt, finalItems);

  if (window.__OUTBOX_PANEL_OPEN__) {
    renderOutboxPanelBody_(finalItems);
  }
}
document.addEventListener("click", (e) => {
  const chipEl = e.target.closest("#outboxChip");
  if (!chipEl) return;
  e.stopPropagation();
  showOutboxDetails().catch(() => {});
});

let __outboxDebugTimer = null;
let __OUTBOX_LIVE_REFRESH_TIMER__ = null;

function scheduleOutboxLiveRefresh_(){
  try {
    if (__OUTBOX_LIVE_REFRESH_TIMER__) return;

    __OUTBOX_LIVE_REFRESH_TIMER__ = setInterval(async () => {
      try {
        await updateOutboxChip();
      } catch (_) {}
    }, 2000);
  } catch (_) {}
}

function stopOutboxLiveRefresh_(){
  try {
    if (__OUTBOX_LIVE_REFRESH_TIMER__) {
      clearInterval(__OUTBOX_LIVE_REFRESH_TIMER__);
      __OUTBOX_LIVE_REFRESH_TIMER__ = null;
    }
  } catch (_) {}
}

let __OUTBOX_RESET_TAP_COUNT__ = 0;
let __OUTBOX_RESET_TAP_TIMER__ = null;
let __OUTBOX_RESET_BUSY__ = false;

function resetOutboxSecretTapState_(){
  __OUTBOX_RESET_TAP_COUNT__ = 0;
  if (__OUTBOX_RESET_TAP_TIMER__) {
    clearTimeout(__OUTBOX_RESET_TAP_TIMER__);
    __OUTBOX_RESET_TAP_TIMER__ = null;
  }
}

function armOutboxSecretTapReset_(){
  if (__OUTBOX_RESET_TAP_TIMER__) {
    clearTimeout(__OUTBOX_RESET_TAP_TIMER__);
  }

  __OUTBOX_RESET_TAP_TIMER__ = setTimeout(() => {
    resetOutboxSecretTapState_();
  }, 2200);
}

async function handleOutboxSecretTap_(e){
  const chip = document.getElementById("outboxChip");
  const panel = document.getElementById("outboxPanel");
  const panelHeader = panel ? panel.querySelector(".outboxPanelHeader") : null;
  const target = e.target instanceof Element ? e.target : null;

  const onChip = !!(chip && target && chip.contains(target));
  const onPanelHeader = !!(panelHeader && target && panelHeader.contains(target));

  if (!onChip && !onPanelHeader) return;
  if (__OUTBOX_RESET_BUSY__) return;

  __OUTBOX_RESET_TAP_COUNT__ += 1;
  armOutboxSecretTapReset_();

  if (__OUTBOX_RESET_TAP_COUNT__ < 5) return;

  __OUTBOX_RESET_BUSY__ = true;
  resetOutboxSecretTapState_();

  try {
    e.preventDefault();
    e.stopPropagation();
  } catch (_) {}

  try {
    await clearAllOutboxNow_();
  } catch (err) {
    console.error(err);
  } finally {
    __OUTBOX_RESET_BUSY__ = false;
  }
}

document.addEventListener("click", handleOutboxSecretTap_, true);

document.addEventListener("click", (e) => {
  const panel = document.getElementById("outboxPanel");
  const closeBtn = document.getElementById("outboxPanelClose");
  const chip = document.getElementById("outboxChip");
  if (!panel || !closeBtn) return;

  if (e.target === closeBtn) {
    panel.classList.add("hidden");
    window.__OUTBOX_PANEL_OPEN__ = false;
    stopOutboxLiveRefresh_();
    return;
  }

  if (!panel.classList.contains("hidden")) {
    const clickedInsidePanel = panel.contains(e.target);
    const clickedChip = chip && chip.contains(e.target);

    if (!clickedInsidePanel && !clickedChip) {
      panel.classList.add("hidden");
      window.__OUTBOX_PANEL_OPEN__ = false;
      stopOutboxLiveRefresh_();
    }
  }
});

window.__UFRP_OUTBOX_SEED_ACTIVE__ = function (payload) {
  try {
    upsertActiveOutboxItem_(payload || {});
    __OUTBOX_CURRENT_ITEMS__ = normalizeActiveOutboxRegistryItems_();

    Promise.resolve()
      .then(() => updateOutboxChip())
      .catch(() => {});

    if (window.__OUTBOX_PANEL_OPEN__) {
      Promise.resolve()
        .then(() => showOutboxDetails())
        .catch(() => {});
    }

    return true;
  } catch (e) {
    console.warn("Outbox seed failed:", e);
    return false;
  }
};

async function clearAllOutboxNow_(){
  try {
    if (window.__OFFLINE__ && typeof window.__OFFLINE__.hardResetOfflineState === "function") {
      await window.__OFFLINE__.hardResetOfflineState();
    } else if (window.__OFFLINE__ && typeof window.__OFFLINE__.clearQueue === "function") {
      await window.__OFFLINE__.clearQueue();
    }
  } catch (e) {
    console.warn("offline hard reset failed:", e);
  }

  try {
    Object.keys(localStorage).forEach((k) => {
      if (String(k || "").startsWith("__UFRP_ACTIVE_OUTBOX__:")) {
        localStorage.removeItem(k);
      }
    });
  } catch (_) {}

  try { setActiveOutboxRegistry_([]); } catch (_) {}
  try { setRecentOutboxBridge_([]); } catch (_) {}
  try { sessionStorage.removeItem("__UFRP_RECENT_OUTBOX__"); } catch (_) {}

  try {
    __OUTBOX_CURRENT_ITEMS__ = [];
    __OUTBOX_LAST_RENDERED_ITEMS__ = [];
  } catch (_) {}

  try {
    const chip = document.getElementById("outboxChip");
    if (chip) {
      chip.style.display = "none";
      chip.classList.remove("pending", "error");
    }
  } catch (_) {}

  try {
    const panel = document.getElementById("outboxPanel");
    if (panel) panel.classList.add("hidden");
    window.__OUTBOX_PANEL_OPEN__ = false;
    stopOutboxLiveRefresh_();
  } catch (_) {}

  try { showToast_("صف ارسال پاک شد"); } catch (_) {}

  setTimeout(() => {
    try { location.reload(); } catch (_) {}
  }, 450);
}

window.__UFRP_CLEAR_ALL_OUTBOX__ = clearAllOutboxNow_;

window.OUTBOX = {
  add: outboxAdd,
  setStatus: outboxSetStatus,
  remove: outboxRemove,
  summary: outboxGetSummary,
  items: outboxGetItems,
  refresh: updateOutboxChip,
  clearAll: clearAllOutboxNow_
};

setTimeout(updateOutboxChip, 0);

})();

/* =========================================================
 * UPLOAD TRACKING HELPERS
 * ========================================================= */
function resetUploadTracking(){
  APP.uploads = {};
}

function _setUploadState(fieldId, state, promise){
  APP.uploads[fieldId] = { state, promise: promise || null };
}

function getUploadEntries(){
  return Object.entries(APP.uploads || {});
}

async function waitForAllUploads(){
  const pending = _getUploadEntries_()
    .map(([_, v]) => v)
    .filter(v => v && (v.state === "uploading" || v.state === "starting") && v.promise);

  if (!pending.length) return;

  console.log("Uploads still running — continuing with background submission.");
  return;
}

function captureFileUploadSnapshot_(schema, submissionUid){
  const live = [];
  const persisted = [];

  for (let i = 0; i < (schema || []).length; i++){
    const it = schema[i] || {};
    const type = String(it.type || "").trim();
    if (type !== "FILE_UPLOAD") continue;

    const fieldId = `f_${i}`;
    const title = String(it.title || "").trim();
    const fileInput = document.getElementById(fieldId);

    const items = Array.isArray(fileInput?.__items) ? fileInput.__items : [];

    live.push({
      fieldId,
      title,
      items,
      queuePromise: (fileInput && fileInput.__queue && typeof fileInput.__queue.then === "function")
        ? fileInput.__queue
        : Promise.resolve()
    });

    persisted.push({
      fieldId,
      title,
      items: items.map((item) => ({
        key: String(item?.key || "").trim(),
        blobId: String(item?.blobId || "").trim(),
        name: String((item?.file && item.file.name) || item?.name || "").trim(),
        type: String((item?.file && item.file.type) || item?.type || "application/octet-stream").trim(),
        size: Number((item?.file && item.file.size) || item?.size || 0),
        uploadedLocal: !!item?.uploadedLocal,
        uploaded: !!item?.uploaded,
        viewLink: String(item?.viewLink || "").trim()
      }))
    });
  }

  window.__UFRP_FILE_JOB_REGISTRY__ = window.__UFRP_FILE_JOB_REGISTRY__ || {};
  window.__UFRP_FILE_JOB_REGISTRY__[String(submissionUid || "")] = live;
  return persisted;
}

function getCapturedFileUploadSnapshot_(submissionUid){
  const reg = window.__UFRP_FILE_JOB_REGISTRY__ || {};
  return Array.isArray(reg[String(submissionUid || "")])
    ? reg[String(submissionUid || "")]
    : [];
}

async function uploadCapturedFileSnapshot_(formKey, snap){
  const items = Array.isArray(snap?.items) ? snap.items : [];
  const title = String(snap?.title || "").trim();

  for (let i = 0; i < items.length; i++){
    const item = items[i];
    if (!item || item.uploaded) continue;

    let file = item.file || null;

    if (!file && item.blobId && window.__OFFLINE__ && typeof window.__OFFLINE__.getBlob === "function") {
      try {
        const blobRec = await window.__OFFLINE__.getBlob(item.blobId);
        if (blobRec && blobRec.blob) {
          file = blobRec.blob;
          item.file = file;
        }
      } catch (e) {
        console.warn("Blob restore failed:", e);
      }
    }

    if (!file) throw new Error("Captured file object missing.");

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const makeSession = async () => {
      const s = await gsCall(
        "app_createResumableUploadSessionForCurrentUser",
        formKey,
        title,
        file.name || item.name || "file",
        file.type || "application/octet-stream",
        _getOrCreateDraftSubmissionUid_()
      );
      if (!s || !s.ok) throw new Error(s?.error || "Upload session failed");
      return s;
    };

    let fileRes = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const session = await makeSession();
        fileRes = await resumableUploadToDrive_(session.uploadUrl, file, null);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`Captured upload retry ${attempt}/4 failed for ${(file && file.name) || "file"}:`, e);
        await sleep(700 * attempt);
      }
    }

    if (lastErr) throw lastErr;

    const fileId = (fileRes && fileRes.id) ? String(fileRes.id) : "";
    const viewLink = fileId ? ("https://drive.google.com/file/d/" + fileId + "/view") : "";

    if (!viewLink) throw new Error("Upload finished but no fileId returned");

    item.uploaded = true;
    item.viewLink = viewLink;
  }

  return true;
}

/* =========================================================
 * STATUS / ONLINE INDICATOR
 * ========================================================= */
function setStatus(msg, showDots){
  const line = qs("#statusLine");
  const txt  = qs("#statusText");
  const dots = qs("#statusDots");
  if (!line || !txt || !dots) return;

  if (!msg){
    line.style.display = "none";
    return;
  }

  txt.textContent = msg;
  line.style.display = "flex";
  dots.style.display = (showDots === false) ? "none" : "inline-flex";
}

function updateOnlineIndicator(){
  const online = navigator.onLine && !window.__UFRP_FORCE_OFFLINE__;
  const chip = qs("#titleChip");
  const dot = qs("#netDot");

  if (chip) chip.classList.toggle("offline", !online);
  if (dot)  dot.classList.toggle("offline", !online);
}

/* =========================================================
 * MENU HELPERS
 * ========================================================= */
function flattenMenuForms(menu){
  const out = [];
  (menu || []).forEach(center =>
    (center.forms || []).forEach(f => out.push({ ...f, __center: center }))
  );
  return out;
}

function updateRefreshChipVisibility_(isMenuView){
  const refreshBtn = qs("#refreshAppBtn");
  if (!refreshBtn) return;

  refreshBtn.style.display = isMenuView ? "inline-flex" : "none";
}

let __UFRP_REQUIRED_UPDATE_RUNNING__ = false;
const __UFRP_ACK_BUILD_KEY__ = "__UFRP_LAST_ACK_BUILD__";
const __UFRP_EXPECTED_BUILD_KEY__ = "__UFRP_EXPECT_BUILD_AFTER_REFRESH__";

function finalizeRequiredAppUpdateState_(){
  try {
    const currentBuild = String(window.__UFRP_APP_BUILD_ID__ || "").trim();
    if (!currentBuild) return;

    const expectedBuild = String(localStorage.getItem(__UFRP_EXPECTED_BUILD_KEY__) || "").trim();
    const ackBuild = String(localStorage.getItem(__UFRP_ACK_BUILD_KEY__) || "").trim();

    if (expectedBuild && expectedBuild === currentBuild) {
      localStorage.setItem(__UFRP_ACK_BUILD_KEY__, currentBuild);
      localStorage.removeItem(__UFRP_EXPECTED_BUILD_KEY__);
      console.log("Required update acknowledged ✅", currentBuild);
      return;
    }

    if (!ackBuild) {
      localStorage.setItem(__UFRP_ACK_BUILD_KEY__, currentBuild);
      console.log("Initial build acknowledgment saved ✅", currentBuild);
    }
  } catch (e) {
    console.warn("finalizeRequiredAppUpdateState_ failed:", e);
  }
}

async function checkForRequiredAppUpdateOnMenuLoad_(){
  if (__UFRP_REQUIRED_UPDATE_RUNNING__) return false;
  if (!navigator.onLine) return false;

  try {
    const res = await fetch("/api/app-version.php", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    }).then(r => r.json());

    const enabled = !!res?.enabled;
    const currentBuild = String(window.__UFRP_APP_BUILD_ID__ || "").trim();
    const serverBuild = String(res?.buildId || "").trim();
    const ackBuild = String(localStorage.getItem(__UFRP_ACK_BUILD_KEY__) || "").trim();

    if (!enabled) return false;
    if (!currentBuild || !serverBuild) return false;
    if (ackBuild === serverBuild) return false;

    __UFRP_REQUIRED_UPDATE_RUNNING__ = true;

    try {
      localStorage.setItem(__UFRP_EXPECTED_BUILD_KEY__, serverBuild);
    } catch (_) {}

    const msg =
      String(res?.message || "").trim() ||
      "نسخه جدید برنامه شناسایی شد. برنامه در حال بروزرسانی خودکار است";
    const delayMs = Math.max(0, Number(res?.delayMs || 1800));

    try { setStatus(msg, true); } catch (_) {}

    setTimeout(() => {
      try { refreshAppNow_(); } catch (_) {}
    }, delayMs);

    return true;
  } catch (e) {
    console.warn("Required app update check failed:", e);
    return false;
  }
}

function showMenuView(){
  const mv = qs("#menuView");
  const fv = qs("#formView");
  const back = qs("#backBtn");
  const fsh = qs("#formStaticHeader");

  if (mv) mv.style.display = "block";
  if (fv) fv.style.display = "none";
  if (back) back.style.display = "none";
  if (fsh) fsh.style.display = "none";

  updateRefreshChipVisibility_(true);

  const ft = qs("#formTitle");
  const fs = qs("#formSubtitle");

  if (ft) ft.textContent = "—";
  if (fs) fs.textContent = "—";
}

function showFormView(){
  const mv = qs("#menuView");
  const fv = qs("#formView");
  const back = qs("#backBtn");
  const fsh = qs("#formStaticHeader");

  if (mv) mv.style.display = "none";
  if (fv) fv.style.display = "block";
  if (back) back.style.display = "inline-flex";
  if (fsh) fsh.style.display = "block";

  updateRefreshChipVisibility_(false);
}

function renderMenu(menu){
  const container = qs("#menuContainer");
  if (!container) return;

  container.innerHTML = "";

  (menu || []).forEach(center => {
    const centerName = center.TransactionCenterNameFa || center.TransactionCenterKey || "";
    const section = document.createElement("div");

    section.innerHTML = `
      <div class="section">
        <div class="line"></div>
        <div class="title">${escapeHtml(centerName)}</div>
        <div class="line"></div>
      </div>
      <div class="cardsGrid"></div>
    `;

    const grid = section.querySelector(".cardsGrid");
    const forms = Array.isArray(center.forms) ? center.forms : [];

    forms.forEach(f => {
      const card = document.createElement("div");
      card.className = "formCard";
      card.innerHTML = `<div class="formCardTitle">${escapeHtml(f.formNameFa || f.formKey || "")}</div>`;
      card.addEventListener("click", () => showForm(f.formKey));
      grid.appendChild(card);
    });

    container.appendChild(section);
  });
}

async function persistMenuCache_(menuRes){
  try {
    if (!(menuRes && menuRes.ok)) return false;

    const payload = {
      savedAt: new Date().toISOString(),
      data: menuRes
    };

    try {
      localStorage.setItem("__UFRP_MENU_CACHE__", JSON.stringify(payload));
      console.log("Menu cached (localStorage) ✅");
    } catch (e) {
      console.warn("Menu localStorage cache failed:", e);
    }

    try {
      if (window.__OFFLINE__ && typeof window.__OFFLINE__.cachePut === "function") {
        await window.__OFFLINE__.cachePut("menu:main", "menu", payload);
        console.log("Menu cached (IndexedDB) ✅");
      }
    } catch (e) {
      console.warn("Menu IndexedDB cache failed:", e);
    }

    return true;
  } catch (e) {
    console.warn("persistMenuCache_ failed:", e);
    return false;
  }
}

async function tryReadCachedMenu_(restoreSessionToo){
  let data = null;

  try {
    const raw = localStorage.getItem("__UFRP_MENU_CACHE__");
    const cached = raw ? JSON.parse(raw) : null;
    data = cached && cached.data ? cached.data : null;
  } catch (e) {
    console.warn("Menu localStorage read failed:", e);
  }

  if (!(data && data.ok)) {
    try {
      if (window.__OFFLINE__ && typeof window.__OFFLINE__.cacheGet === "function") {
        const idbCached = await window.__OFFLINE__.cacheGet("menu:main");
        const idbData = idbCached && idbCached.data ? idbCached.data : null;

        if (idbData && idbData.data && idbData.data.ok) {
          data = idbData.data;
        } else if (idbData && idbData.ok) {
          data = idbData;
        }
      }
    } catch (e) {
      console.warn("Menu IndexedDB read failed:", e);
    }
  }

  if (data && data.ok && restoreSessionToo) {
    try {
      if (navigator.onLine && data.email) {
        await gsCall("session_set", {
          email: data.email,
          fullName: data.fullName || ""
        });
        console.log("Session restored from cached menu ✅", data.email);
      }
    } catch (e) {
      console.warn("Session restore from cached menu failed:", e);
    }
  }

  return (data && data.ok) ? data : null;
}

let __UFRP_PREFETCH_HIDE_TIMER__ = null;
let __UFRP_PREFETCH_MENU_PHASE__ = false;
let __UFRP_PREFETCH_MENU_TIMER__ = null;
let __UFRP_PREFETCH_PENDING_PROGRESS__ = null;

function setPrefetchChipState_(text, mode){
  const chip = document.getElementById("prefetchChip");
  const txt = document.getElementById("prefetchText");
  if (!chip || !txt) return;

  if (__UFRP_PREFETCH_HIDE_TIMER__) {
    clearTimeout(__UFRP_PREFETCH_HIDE_TIMER__);
    __UFRP_PREFETCH_HIDE_TIMER__ = null;
  }

  chip.classList.remove("done", "error");
  if (mode === "done") chip.classList.add("done");
  if (mode === "error") chip.classList.add("error");

  txt.textContent = String(text || "").trim();
  chip.style.display = text ? "inline-flex" : "none";
}

function hidePrefetchChip_(){
  const chip = document.getElementById("prefetchChip");
  if (!chip) return;
  chip.style.display = "none";
  chip.classList.remove("done", "error");
}

function scheduleHidePrefetchChip_(ms){
  if (__UFRP_PREFETCH_HIDE_TIMER__) {
    clearTimeout(__UFRP_PREFETCH_HIDE_TIMER__);
  }
  __UFRP_PREFETCH_HIDE_TIMER__ = setTimeout(() => {
    hidePrefetchChip_();
    __UFRP_PREFETCH_HIDE_TIMER__ = null;
  }, Math.max(0, Number(ms || 0)));
}

function readPrefetchManifest_(){
  try {
    const raw = localStorage.getItem("__UFRP_PREFETCH_MANIFEST__");
    const manifest = raw ? JSON.parse(raw) : null;
    return manifest && typeof manifest === "object" ? manifest : null;
  } catch (_) {
    return null;
  }
}

function formatPrefetchManifestUpdatedAtFa_(isoStr){
  try {
    const d = new Date(String(isoStr || "").trim());
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";

    const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${toFaNumber(j.jd)} ${J_MONTHS[j.jm - 1]} ${toFaNumber(j.jy)}`;
  } catch (_) {
    return "";
  }
}

function showCachedManifestChip_(){
  const manifest = readPrefetchManifest_();
  const faDate = formatPrefetchManifestUpdatedAtFa_(manifest?.updatedAt || "");
  const msg = faDate
    ? `استفاده از نسخه کش‌شده — آخرین بروزرسانی: ${faDate}`
    : "استفاده از نسخه کش‌شده";

  setPrefetchChipState_(msg, "");
}

function showMenuReadyChip_(){
  if (__UFRP_PREFETCH_MENU_TIMER__) {
    clearTimeout(__UFRP_PREFETCH_MENU_TIMER__);
    __UFRP_PREFETCH_MENU_TIMER__ = null;
  }

  __UFRP_PREFETCH_MENU_PHASE__ = true;
  __UFRP_PREFETCH_PENDING_PROGRESS__ = null;
  setPrefetchChipState_("منو بروزرسانی و آماده شد", "pending");

  __UFRP_PREFETCH_MENU_TIMER__ = setTimeout(() => {
    __UFRP_PREFETCH_MENU_PHASE__ = false;
    __UFRP_PREFETCH_MENU_TIMER__ = null;

    if (__UFRP_PREFETCH_PENDING_PROGRESS__) {
      const p = __UFRP_PREFETCH_PENDING_PROGRESS__;
      __UFRP_PREFETCH_PENDING_PROGRESS__ = null;
      setPrefetchChipState_(
        `در حال آماده‌سازی فرم‌ها — ${toFaDigits(String(p.done || 0))} از ${toFaDigits(String(p.total || 0))}`,
        "pending"
      );
      return;
    }

    if (window.__UFRP_PREFETCH_RESTORED_FROM_MANIFEST__) {
      showCachedManifestChip_();
      return;
    }

    hidePrefetchChip_();
  }, 900);
}

function showPrefetchProgress_(done, total){
  if (__UFRP_PREFETCH_MENU_PHASE__) {
    __UFRP_PREFETCH_PENDING_PROGRESS__ = {
      done: Number(done || 0),
      total: Number(total || 0)
    };
    return;
  }

  setPrefetchChipState_(
    `در حال آماده‌سازی فرم‌ها — ${toFaDigits(String(done || 0))} از ${toFaDigits(String(total || 0))}`,
    "pending"
  );
}

function finishPrefetchProgress_(ok, fail, total){
  const done = Number(ok || 0) + Number(fail || 0);

  if (__UFRP_PREFETCH_MENU_TIMER__) {
    clearTimeout(__UFRP_PREFETCH_MENU_TIMER__);
    __UFRP_PREFETCH_MENU_TIMER__ = null;
  }
  __UFRP_PREFETCH_MENU_PHASE__ = false;
  __UFRP_PREFETCH_PENDING_PROGRESS__ = null;

  if (done <= 0 || total <= 0) {
    hidePrefetchChip_();
    return;
  }

  if (fail <= 0 && ok >= total) {
    setPrefetchChipState_("همه فرم‌ها آماده شد", "done");
    scheduleHidePrefetchChip_(2200);
    return;
  }

  if (ok > 0) {
    setPrefetchChipState_(
      `${toFaDigits(String(ok))} از ${toFaDigits(String(total))} فرم آماده شد`,
      "error"
    );
    scheduleHidePrefetchChip_(3200);
    return;
  }

  setPrefetchChipState_("آماده‌سازی فرم‌ها کامل نشد", "error");
  scheduleHidePrefetchChip_(3200);
}

/* =========================================================
 * OPTIONS MAP
 * ========================================================= */
function buildOptionsFieldMap(optionsRows){
  const rows = Array.isArray(optionsRows) ? optionsRows : [];
  const fieldMap = {};

  rows.forEach(r => {
    Object.keys(r || {}).forEach(key => {
      if (!key) return;
      if (String(key).trim().startsWith("@")) return;

      const val = String(r[key] ?? "").trim();
      if (!val) return;

      if (!fieldMap[key]) fieldMap[key] = new Set();
      fieldMap[key].add(val);
    });
  });

  const out = {};
  Object.keys(fieldMap).forEach(k => {
    out[k] = Array.from(fieldMap[k]).sort((a,b)=>String(a).localeCompare(String(b), "fa"));
  });

  return out;
}

/* =========================================================
 * SEARCHABLE DROPDOWN
 * ========================================================= */
function createSearchDropdown(mountEl, cfg){
  const wrap = document.createElement("div");
  wrap.className = "sdWrap";

  const input = document.createElement("input");
  input.className = "control sdInput";
  input.type = "text";
  input.autocomplete = "off";

  const allowAdd = !!cfg.allowAdd;
  input.placeholder = allowAdd
    ? (cfg.placeholder || "جستجو یا انتخاب...")
    : "انتخاب...";

  const caret = document.createElement("div");
  caret.className = "sdCaret";
  caret.textContent = "▾";

  const menu = document.createElement("div");
  menu.className = "sdMenu";

  const list = document.createElement("div");
  list.className = "sdList";
  menu.appendChild(list);

  wrap.appendChild(input);
  wrap.appendChild(caret);
  wrap.appendChild(menu);
  mountEl.appendChild(wrap);

  let options = Array.isArray(cfg.options) ? cfg.options.slice() : [];
  options.sort((a,b)=>String(a).localeCompare(String(b), "fa"));

  let isOpen = false;
  let actionNodes = [];
  let activeIndex = -1;
  let selectedValue = "";
  let searchQuery = "";
  let typingEnabled = false;
  let openedAtMs = 0;

  function normalize(s){ return String(s ?? "").trim(); }

  function setTypingEnabled(enabled){
    if (!allowAdd) {
      typingEnabled = false;
      input.readOnly = true;
      input.inputMode = "none";
      input.style.cursor = "pointer";
      return;
    }

    typingEnabled = !!enabled;
    input.readOnly = !typingEnabled;
    input.inputMode = typingEnabled ? "search" : "none";
    input.style.cursor = typingEnabled ? "text" : "pointer";
  }

  setTypingEnabled(false);
  function normLower(s){ return normalize(s).toLowerCase(); }

  function optionExists(val){
    const v = normLower(val);
    return options.some(o => normLower(o) === v);
  }

  function addOption(val){
    const v = normalize(val);
    if (!v) return false;
    if (optionExists(v)) return false;
    options.push(v);
    options.sort((a,b)=>String(a).localeCompare(String(b), "fa"));
    return true;
  }

  function setActive(i){
    if (!actionNodes.length){ activeIndex = -1; return; }
    activeIndex = Math.max(0, Math.min(i, actionNodes.length - 1));
    actionNodes.forEach((n, idx) => n.classList.toggle("active", idx === activeIndex));
    const node = actionNodes[activeIndex];
    if (node && typeof node.scrollIntoView === "function"){
      node.scrollIntoView({ block: "nearest" });
    }
  }

  function close(){
    menu.classList.remove("show");
    isOpen = false;
    activeIndex = -1;
    actionNodes = [];
    input.value = selectedValue || "";
    searchQuery = "";
    setTypingEnabled(false);
  }

  function pickValue(v){
    selectedValue = String(v ?? "");
    input.value = selectedValue;
    close();

    try {
      if (typeof cfg.onPick === "function") {
        cfg.onPick(selectedValue);
      }
    } catch (_) {}
  }

  function ensureAddRow(){
    const old = menu.querySelector(".sdAddRow");
    if (old) old.remove();
    if (!allowAdd) return;

    const addRow = document.createElement("div");
    addRow.className = "sdAddRow";

    const link = document.createElement("div");
    link.className = "sdAddLink";
    link.textContent = "➕ افزودن مورد جدید...";

    const toEditMode = (prefill) => {
      addRow.innerHTML = "";

      const addInput = document.createElement("input");
      addInput.className = "sdAddInput";
      addInput.type = "text";
      addInput.placeholder = "عنوان مورد جدید...";
      addInput.value = prefill || "";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "sdAddBtn";
      addBtn.textContent = "+";

      const commit = () => {
        const v = normalize(addInput.value);
        if (!v) { addInput.focus(); return; }
        const added = addOption(v);
        pickValue(v);
        if (added && typeof cfg.onAdd === "function") cfg.onAdd(v);
      };

      addBtn.addEventListener("mousedown", (e) => {
        e.preventDefault(); e.stopPropagation();
        commit();
      });

      addInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter"){
          e.preventDefault(); commit();
        } else if (e.key === "Escape"){
          e.preventDefault();
          addRow.innerHTML = "";
          addRow.appendChild(link);
        }
      });

      addRow.appendChild(addInput);
      addRow.appendChild(addBtn);
      setTimeout(() => addInput.focus(), 0);
    };

    link.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      toEditMode(searchQuery || "");
    });

    addRow.appendChild(link);
    menu.appendChild(addRow);
  }

  function render(){
    const q = normalize(searchQuery);
    const qLower = q.toLowerCase();
    list.innerHTML = "";
    actionNodes = [];
    activeIndex = -1;

    const filtered = options
      .filter(v => !qLower || String(v).toLowerCase().includes(qLower))
      .slice(0, 600);

    filtered.forEach(v => {
      const item = document.createElement("div");
      item.className = "sdItem";
      const isSelected = normLower(v) === normLower(selectedValue);
      if (isSelected) item.classList.add("selected");

      item.innerHTML = `<span>${escapeHtml(v)}</span><span class="sdMark">✓</span>`;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pickValue(v);
      });

      list.appendChild(item);
      actionNodes.push(item);
    });

    if (!actionNodes.length){
      const empty = document.createElement("div");
      empty.className = "sdEmpty";
      empty.textContent = "موردی برای نمایش وجود ندارد.";
      list.appendChild(empty);
    }

    ensureAddRow();

    let idx = actionNodes.findIndex(n => n.classList.contains("selected"));
    if (idx < 0) idx = 0;
    setActive(idx);
  }

  function open(clearSearch){
    if (clearSearch){
      searchQuery = "";
      input.value = "";
    }
    if (!isOpen){
      menu.classList.add("show");
      isOpen = true;
    }
    openedAtMs = Date.now();
    setTypingEnabled(false);
    render();
  }

  input.addEventListener("focus", () => open(true));

  input.addEventListener("click", () => {
    if (!allowAdd) return;
    if (!isOpen) return;
    if ((Date.now() - openedAtMs) < 250) return;
    if (typingEnabled) return;

    setTypingEnabled(true);
    searchQuery = "";
    input.value = "";

    setTimeout(() => {
      try { input.focus(); } catch (_) {}
    }, 0);
  });

  input.addEventListener("input", () => {
    searchQuery = input.value;
    if (!isOpen) open(false);
    else render();
  });

  input.addEventListener("keydown", (e) => {
    const key = e.key;

    if (key === "ArrowDown"){
      e.preventDefault();
      if (!isOpen) open(false);
      else if (actionNodes.length) setActive((activeIndex < 0 ? 0 : activeIndex + 1));
      return;
    }

    if (key === "ArrowUp"){
      e.preventDefault();
      if (!isOpen) open(false);
      else if (actionNodes.length) setActive((activeIndex < 0 ? 0 : activeIndex - 1));
      return;
    }

    if (key === "Enter"){
      if (!isOpen){
        open(false);
        e.preventDefault();
        return;
      }

      if (actionNodes.length && activeIndex >= 0){
        e.preventDefault();
        actionNodes[activeIndex].dispatchEvent(new MouseEvent("mousedown", { bubbles:true, cancelable:true }));
      }
      return;
    }

    if (key === "Escape"){
      if (isOpen){
        e.preventDefault();
        close();
      }
      return;
    }
  });

  caret.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (isOpen) close();
    else { input.focus(); open(true); }
  });

  document.addEventListener("mousedown", (e) => {
    if (!wrap.contains(e.target)) close();
  });

  const api = {
    getValue: () => normalize(selectedValue),
    setValue: (v) => { selectedValue = String(v ?? ""); input.value = selectedValue; },
    clear: () => { selectedValue=""; searchQuery=""; input.value=""; },
    setOptions: (arr) => {
      options = Array.isArray(arr) ? arr.slice() : [];
      options.sort((a,b)=>String(a).localeCompare(String(b), "fa"));
      render();
    }
  };

  wrap.__sdApi = api;
  return api;
}

/* =========================================================
 * RESUMABLE UPLOAD HELPER
 * ========================================================= */
async function resumableUploadToDrive_(uploadUrl, file, onProgress) {
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const total = file.size;

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  async function readAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error);
      fr.onload = () => {
        const s = String(fr.result || "");
        const idx = s.indexOf("base64,");
        resolve(idx >= 0 ? s.slice(idx + 7) : s);
      };
      fr.readAsDataURL(blob);
    });
  }

  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    if (typeof onProgress === "function") onProgress(Math.floor((offset / total) * 100));

    const chunk = file.slice(offset, end);
    const b64 = await readAsBase64(chunk);

    let lastErr = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await gsCall("app_putResumableChunkForCurrentUser", uploadUrl, b64, offset, end, total);
        if (!res || !res.ok) throw new Error(res?.error || "Chunk upload failed");

        if (res.done) {
          if (typeof onProgress === "function") onProgress(100);
          return res.json || {};
        }

        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await sleep(400 * attempt);
      }
    }

    if (lastErr) throw lastErr;
    offset = end;
  }

  if (typeof onProgress === "function") onProgress(100);
  return {};
}

/* =========================================================
 * JALALI PICKER
 * ========================================================= */
const faDigits = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
function toFaNumber(str){ return String(str).replace(/\d/g, d => faDigits[Number(d)]); }
const J_MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
const DOW = ["ش","ی","د","س","چ","پ","ج"];
function div(a,b){ return ~~(a/b); }
function mod(a,b){ return a - ~~(a/b)*b; }

function jalCal(jy){
  const breaks = [-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178];
  let bl = breaks.length, gy = jy + 621, leapJ = -14, jp = breaks[0], jm, jump, leap, n, i;
  if (jy < jp || jy >= breaks[bl-1]) throw new Error("Invalid Jalali year " + jy);

  for (i=1; i<bl; i++){
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump,33)*8 + div(mod(jump,33),4);
    jp = jm;
  }

  n = jy - jp;
  leapJ = leapJ + div(n,33)*8 + div(mod(n,33)+3,4);
  if (mod(jump,33) === 4 && jump - n === 4) leapJ++;

  const leapG = div(gy,4) - div((div(gy,100)+1)*3,4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump+4,33)*33;
  leap = mod(mod(n+1,33)-1,4);
  if (leap === -1) leap = 4;

  return { leap: leap, gy: gy, march: march };
}

function isLeapJalaaliYear(jy){ return jalCal(jy).leap === 0; }

function jalaaliMonthLength(jy, jm){
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaaliYear(jy) ? 30 : 29;
}

function toGregorian(jy, jm, jd){
  const r = jalCal(jy);
  let gy = r.gy, march = r.march;

  let jDayNo = (jm <= 7) ? ((jm-1)*31) : (((jm-7)*30)+186);
  jDayNo += (jd-1);

  let gDayNo = jDayNo + march - 1;
  gy += 400 * div(gDayNo, 146097);
  gDayNo = mod(gDayNo, 146097);

  if (gDayNo > 36524){
    gy += 100 * div(--gDayNo, 36524);
    gDayNo = mod(gDayNo, 36524);
    if (gDayNo >= 365) gDayNo++;
  }

  gy += 4 * div(gDayNo, 1461);
  gDayNo = mod(gDayNo, 1461);

  if (gDayNo > 365){
    gy += div(gDayNo-1, 365);
    gDayNo = mod(gDayNo-1, 365);
  }

  let gd = gDayNo + 1;
  const sal_a = [0,31, ((gy%4===0 && gy%100!==0) || (gy%400===0)) ? 29 : 28,31,30,31,30,31,31,30,31,30,31];

  let gm;
  for (gm=1; gm<=12; gm++){
    const v = sal_a[gm];
    if (gd <= v) break;
    gd -= v;
  }

  return { gy, gm, gd };
}

function toJalaali(gy, gm, gd){
  gy = +gy; gm = +gm; gd = +gd;

  let gDayNo = 365*(gy-1600) + div(gy-1600+3,4) - div(gy-1600+99,100) + div(gy-1600+399,400);
  const gMonthDays = [0,31,28,31,30,31,30,31,31,30,31,30,31];

  for (let i=1; i<gm; ++i) gDayNo += gMonthDays[i];
  if (gm>2 && ((gy%4===0 && gy%100!==0) || (gy%400===0))) gDayNo++;
  gDayNo += gd-1;

  let jDayNo = gDayNo - 79;
  const jNp = div(jDayNo, 12053);
  jDayNo = mod(jDayNo, 12053);

  let jy = 979 + 33*jNp + 4*div(jDayNo,1461);
  jDayNo = mod(jDayNo,1461);

  if (jDayNo >= 366){
    jy += div(jDayNo-1,365);
    jDayNo = mod(jDayNo-1,365);
  }

  let jm, jd;
  if (jDayNo < 186){
    jm = 1 + div(jDayNo,31);
    jd = 1 + mod(jDayNo,31);
  } else {
    jm = 7 + div(jDayNo-186,30);
    jd = 1 + mod(jDayNo-186,30);
  }

  return { jy, jm, jd };
}

function jalaliToWeekdayIndex(jy, jm, jd){
  const g = toGregorian(jy, jm, jd);
  const d = new Date(Date.UTC(g.gy, g.gm-1, g.gd, 12, 0, 0));
  const js = d.getUTCDay();
  return (js + 1) % 7;
}

function getTodayJalali(){
  const now = new Date();
  return toJalaali(now.getFullYear(), now.getMonth()+1, now.getDate());
}

let pickerTargetInput = null;
let todayJ = null;
let viewJy = null;
let viewJm = null;

function bindPickerDom(){
  const pickerModal   = qs("#pickerModal");
  const gridEl        = qs("#grid");
  const monthTitleEl  = qs("#monthTitle");
  const prevBtn       = qs("#prevBtn");
  const nextBtn       = qs("#nextBtn");
  const yearSelect    = qs("#yearSelect");
  const monthSelect   = qs("#monthSelect");
  const pickerBadge   = qs("#pickerBadge");

  if (!pickerModal || !gridEl || !monthTitleEl || !yearSelect || !monthSelect) return;

  todayJ = getTodayJalali();
  viewJy = todayJ.jy;
  viewJm = todayJ.jm;

  function renderPicker(){
    monthTitleEl.textContent = `${J_MONTHS[viewJm-1]} ${toFaNumber(viewJy)}`;
    yearSelect.value = String(viewJy);
    monthSelect.value = String(viewJm);

    gridEl.innerHTML = "";

    for (const d of DOW){
      const el = document.createElement("div");
      el.className = "dow";
      el.textContent = d;
      gridEl.appendChild(el);
    }

    const firstIdx = jalaliToWeekdayIndex(viewJy, viewJm, 1);
    const daysInMonth = jalaaliMonthLength(viewJy, viewJm);

    for (let i=0; i<firstIdx; i++){
      const b = document.createElement("div");
      b.className = "day empty";
      gridEl.appendChild(b);
    }

    for (let d=1; d<=daysInMonth; d++){
      const el = document.createElement("div");
      el.className = "day";
      el.textContent = toFaNumber(d);

      if (viewJy === todayJ.jy && viewJm === todayJ.jm && d === todayJ.jd){
        el.classList.add("todayOutline","todayDot");
      }

      el.addEventListener("click", () => {
        const val = `${toFaNumber(d)} ${J_MONTHS[viewJm-1]} ${toFaNumber(viewJy)}`;
        if (pickerTargetInput) pickerTargetInput.value = val;
        closePicker();
      });

      gridEl.appendChild(el);
    }
  }

  function shiftMonth(delta){
    let jy = viewJy, jm = viewJm + delta;
    while (jm < 1){ jm += 12; jy -= 1; }
    while (jm > 12){ jm -= 12; jy += 1; }
    viewJy = jy; viewJm = jm;
    renderPicker();
  }

  function openPicker(inputEl, label){
    pickerTargetInput = inputEl;
    if (pickerBadge) pickerBadge.textContent = String(label || "انتخاب تاریخ");
    viewJy = todayJ.jy;
    viewJm = todayJ.jm;
    pickerModal.classList.add("show");
    pickerModal.setAttribute("aria-hidden","false");
    renderPicker();
  }

  function closePicker(){
    pickerModal.classList.remove("show");
    pickerModal.setAttribute("aria-hidden","true");
    pickerTargetInput = null;
  }

  window.closePicker = closePicker;
  window.__openPicker = openPicker;

  window.goPickerToday = function(){
    try {
      if (!todayJ) todayJ = getTodayJalali();
      viewJy = todayJ.jy;
      viewJm = todayJ.jm;
      renderPicker();
    } catch (e) {
      console.error("goPickerToday failed:", e);
    }
  };

  yearSelect.innerHTML = "";
  const start = todayJ.jy - 7;
  const end = todayJ.jy + 7;
  for (let y = start; y <= end; y++){
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = toFaNumber(y);
    yearSelect.appendChild(opt);
  }

  monthSelect.innerHTML = "";
  for (let m=1; m<=12; m++){
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = J_MONTHS[m-1];
    monthSelect.appendChild(opt);
  }

  if (prevBtn) prevBtn.addEventListener("click", () => shiftMonth(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => shiftMonth(+1));

  yearSelect.addEventListener("change", () => { viewJy = Number(yearSelect.value); renderPicker(); });
  monthSelect.addEventListener("change", () => { viewJm = Number(monthSelect.value); renderPicker(); });

  pickerModal.addEventListener("mousedown", (e) => {
    if (e.target === pickerModal) closePicker();
  });
}

/* =========================================================
 * DYNAMIC FORM RENDERER
 * ========================================================= */
function renderSchemaError(msg){
  const host = qs("#formShellBody");
  if (!host) return;

  host.innerHTML = `
    <div class="field" style="margin-top:12px;">
      <div class="labelRow">
        <div class="label">Schema error</div>
        <span class="badgeReq">ضروری</span>
      </div>
      <div style="font-size:13px; color: rgba(17,24,39,0.75); line-height:1.7;">
        ${escapeHtml(msg)}
      </div>
    </div>
  `;
}

function renderDynamicForm(schema, optionsRows){
  const host = qs("#formShellBody");
  if (!host) return;

  const items = Array.isArray(schema) ? schema : [];
  const optionsFieldMap = buildOptionsFieldMap(optionsRows);
  APP.currentOptionsFieldMap = optionsFieldMap;

  if (!items.length){
    host.innerHTML = `<div class="field" style="margin-top:12px;">No schema items.</div>`;
    return;
  }

  host.innerHTML = `
    <div class="gridForm" id="dynForm"></div>
    <div class="actions">
      <button class="btn btnPrimary" type="button" id="btnDynSubmit">ثبت</button>
      <button class="btn" type="button" id="btnDynClear">پاک کردن فرم</button>
    </div>
  `;

  const formHost = qs("#dynForm");
  if (!formHost) return;

  const isDateItem = (it) => {
    const type = String(it?.type || "").trim();
    const title = String(it?.title || "").trim();
    return (
      type === "DATE" || type === "DATETIME" || type === "TIME" ||
      (type === "TEXT" && isDateLikeTitle(title))
    );
  };

  const withMeta = items.map((it, idx) => ({ it: it || {}, idx, cat: categorizeQuestion(it || {}) }));
  const catOrder = ["تاریخ‌ها","اشخاص","دسته‌بندی","جزئیات و مبلغ","سایر"];

  withMeta.sort((a,b) => {
    const ai = catOrder.indexOf(a.cat);
    const bi = catOrder.indexOf(b.cat);
    const aRank = ai < 0 ? 999 : ai;
    const bRank = bi < 0 ? 999 : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.idx - b.idx;
  });

  let lastCat = null;

  for (let k = 0; k < withMeta.length; k++){
    const { it, idx, cat } = withMeta[k];

    if (cat !== lastCat){
      formHost.appendChild(makeSectionChip(cat));
      lastCat = cat;
    }

    const title = String(it.title || "").trim();
    const type = String(it.type || "").trim();
    const required = !!it.required;
    const fieldId = `f_${idx}`;
    const dateLike = isDateItem(it);

    const isLong =
      type === "PARAGRAPH_TEXT" ||
      String(it?.layout || "").toLowerCase() === "full" ||
      String(it?.span || "").toLowerCase() === "full";

    const spanClass = (!dateLike && isLong) ? "twoColSpan" : "";
    const row = document.createElement("div");
    row.className = `field ${spanClass}`.trim();

    const iconHtml = iconSvgForQuestion(it, cat);

    row.innerHTML = `
      <div class="labelRow">
        <div class="label">${iconHtml}<span>${escapeHtml(title)}</span></div>
        ${required ? `<span class="badgeReq">ضروری</span>` : `<span class="badgeOpt">اختیاری</span>`}
      </div>
      <div id="${fieldId}__control"></div>
    `;

    const ctlHost = row.querySelector(`#${fieldId}__control`);
    if (!ctlHost) continue;

    if (type === "LIST" || it.fromOptions === true){
      const info = findOptionsHeaderInfoForTitle(optionsFieldMap, title);
      const header = info.header;
      const choices = header ? (optionsFieldMap[header] || []) : [];

      ctlHost.innerHTML = `<div id="${fieldId}"></div>`;
      const mount = row.querySelector(`#${fieldId}`);

      createSearchDropdown(mount, {
        options: choices,
        placeholder: "جستجو یا انتخاب...",
        allowAdd: info.allowAdd,
        onPick: () => {
          setTimeout(() => focusNextQuestionField_(fieldId), 60);
        }
      });
    }

    else if (type === "MULTIPLE_CHOICE"){
      const choices = Array.isArray(it.choices) ? it.choices : [];
      const hasOther = !!it.hasOther;

      if (hasOther){
        const OTHER_LABEL = "سایر";
        const uiChoices = choices.slice();
        if (!uiChoices.some(x => String(x).trim() === OTHER_LABEL)) uiChoices.push(OTHER_LABEL);

        if (isAutoEqualShareTitle_(title)) {
          row.dataset.autoEqualShare = "1";
          row.dataset.autoEqualFieldId = fieldId;
        }

        ctlHost.innerHTML = `
          <div id="${fieldId}" class="mcWrap" style="display:flex; flex-direction:column; gap:10px;">
            <div class="mcRow" style="display:flex; flex-wrap:wrap; gap:10px;">
              ${uiChoices.map((c, i) => {
                const id = `${fieldId}__opt_${i}`;
                return `
                  <label for="${id}" style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; user-select:none; font-weight:900;">
                    <input type="radio" name="${fieldId}__radio" id="${id}" value="${escapeHtml(c)}" style="accent-color:#1e5bd7;">
                    <span>${escapeHtml(c)}</span>
                  </label>
                `;
              }).join("")}
            </div>
            <input id="${fieldId}__other" class="control" type="text" placeholder="سایر (بنویسید...)" style="display:none;" />
            <input id="${fieldId}__value" type="hidden" value="">
          </div>
        `;

        const wrap = row.querySelector(`#${fieldId}`);
        const otherInput = row.querySelector(`#${fieldId}__other`);
        const hiddenVal = row.querySelector(`#${fieldId}__value`);
        const radios = wrap ? Array.from(wrap.querySelectorAll(`input[type="radio"][name="${fieldId}__radio"]`)) : [];
        const isAutoEqualShareField = isAutoEqualShareTitle_(title);

        const normalizeShareDigits_ = (v) => stripToDigits(String(v || "").trim());

        const setFinalValue = (v) => {
          if (!hiddenVal) return;
          hiddenVal.value = isAutoEqualShareField
            ? normalizeShareDigits_(v)
            : String(v || "").trim();
        };

        const syncShareOtherInput_ = () => {
          if (!otherInput || !isAutoEqualShareField) return;
          const digits = normalizeShareDigits_(otherInput.value);
          otherInput.value = toFaDigits(digits);
          return digits;
        };

        if (otherInput && isAutoEqualShareField) {
          otherInput.inputMode = "numeric";
          otherInput.autocomplete = "off";
          otherInput.spellcheck = false;

          otherInput.addEventListener("paste", (e) => {
            e.preventDefault();
            const txt = (e.clipboardData || window.clipboardData).getData("text");
            otherInput.value = toFaDigits(normalizeShareDigits_(txt));
            const picked = radios.find(r => r.checked);
            const pickedVal = picked ? String(picked.value || "").trim() : "";
            if (pickedVal === OTHER_LABEL) {
              setFinalValue(otherInput.value);
            }
          });
        }

        const updateFromState = () => {
          const picked = radios.find(r => r.checked);
          const pickedVal = picked ? String(picked.value || "").trim() : "";

          if (pickedVal === OTHER_LABEL){
            if (otherInput){
              otherInput.style.display = "block";
              const digits = syncShareOtherInput_();
              setFinalValue(isAutoEqualShareField ? digits : otherInput.value);
            } else {
              setFinalValue("");
            }
          } else {
            if (otherInput){
              otherInput.style.display = "none";
              otherInput.value = "";
            }
            setFinalValue(pickedVal);
          }
        };

        radios.forEach(r => r.addEventListener("change", () => {
          updateFromState();
          if (otherInput && radios.some(x => x.checked && String(x.value).trim() === OTHER_LABEL)){
            otherInput.focus();
          }
        }));

        if (otherInput){
          otherInput.addEventListener("input", () => {
            const picked = radios.find(r => r.checked);
            const pickedVal = picked ? String(picked.value || "").trim() : "";
            if (pickedVal === OTHER_LABEL){
              const digits = syncShareOtherInput_();
              setFinalValue(isAutoEqualShareField ? digits : otherInput.value);
            }
          });
        }

        updateFromState();
      } else {
        ctlHost.innerHTML = `<div id="${fieldId}"></div>`;
        const mount = row.querySelector(`#${fieldId}`);
        createSearchDropdown(mount, {
          options: choices,
          placeholder: "انتخاب...",
          onPick: () => {
            setTimeout(() => focusNextQuestionField_(fieldId), 60);
          }
        });
      }
    }

    else if (type === "PARAGRAPH_TEXT"){
      ctlHost.innerHTML = `<textarea id="${fieldId}" class="control" ${required ? "required" : ""} rows="4"></textarea>`;
    }

    else if (dateLike){
      ctlHost.innerHTML = `
        <input id="${fieldId}" class="control" ${required ? "required" : ""} type="text"
          placeholder="انتخاب تاریخ..." readonly>
      `;
    }

    else if (type === "FILE_UPLOAD") {
      ctlHost.innerHTML = `
        <div class="fuWrap">
          <div class="fuRight">
            <button type="button" class="fuBtn" id="${fieldId}__btn">انتخاب فایل</button>
            <div class="fuName" id="${fieldId}__name">فایلی انتخاب نشده</div>
          </div>
        </div>
        <div id="${fieldId}__chips" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;"></div>
        <input id="${fieldId}" class="fuNativeInput" ${required ? "required" : ""} type="file" multiple>
        <input id="${fieldId}__drive" type="hidden">
      `;

      const fileInput = row.querySelector(`#${fieldId}`);
      const pickBtn   = row.querySelector(`#${fieldId}__btn`);
      const nameEl    = row.querySelector(`#${fieldId}__name`);
      const chipsEl   = row.querySelector(`#${fieldId}__chips`);
      const hidden    = row.querySelector(`#${fieldId}__drive`);

      if (pickBtn && fileInput) {
        pickBtn.addEventListener("click", () => {
          try { fileInput.value = ""; } catch(_) {}
          fileInput.click();
        });
      }

      if (!fileInput || !hidden) {
        console.warn("[FILE_UPLOAD] Missing elements for", fieldId);
      } else {
        fileInput.__items = fileInput.__items || [];
        fileInput.__queue = fileInput.__queue || Promise.resolve();

        const fileKey = (f) => [f.name, f.size, f.lastModified].join("|");

        const renderNames = () => {
          const items = fileInput.__items || [];

          if (!items.length) {
            if (nameEl) nameEl.textContent = "فایلی انتخاب نشده";
            if (chipsEl) chipsEl.innerHTML = "";
            return;
          }

          if (nameEl) nameEl.textContent = `${toFaDigits(String(items.length))} فایل انتخاب شده`;
          if (!chipsEl) return;

          chipsEl.innerHTML = "";

          items.forEach((it, idx) => {
            const chip = document.createElement("div");
            chip.style.display = "inline-flex";
            chip.style.alignItems = "center";
            chip.style.gap = "6px";
            chip.style.padding = "6px 10px";
            chip.style.borderRadius = "999px";
            chip.style.border = "1px solid rgba(17,24,39,0.10)";
            chip.style.background = "rgba(255,255,255,0.65)";
            chip.style.fontSize = "12.5px";
            chip.style.fontWeight = "700";
            chip.style.color = "rgba(17,24,39,0.82)";
            chip.style.maxWidth = "100%";

            const label = document.createElement("span");
            label.textContent = it?.file?.name || `فایل ${toFaDigits(String(idx + 1))}`;
            label.style.overflow = "hidden";
            label.style.textOverflow = "ellipsis";
            label.style.whiteSpace = "nowrap";

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.textContent = "×";
            removeBtn.style.border = "0";
            removeBtn.style.background = "transparent";
            removeBtn.style.cursor = "pointer";
            removeBtn.style.fontSize = "16px";
            removeBtn.style.lineHeight = "1";
            removeBtn.style.padding = "0";
            removeBtn.style.color = "rgba(239,68,68,0.95)";

            removeBtn.addEventListener("click", async () => {
              const removedViewLink = it.viewLink || "";
              it.cancelled = true;
              const removedBlobId = it.blobId || "";
              const wasUploaded = !!it.uploaded;

              fileInput.__items = (fileInput.__items || []).filter(x => x !== it);
              syncHidden();
              renderNames();

              try {
                if (removedBlobId && window.__OFFLINE__ && typeof window.__OFFLINE__.deleteBlob === "function") {
                  await window.__OFFLINE__.deleteBlob(removedBlobId);
                }
              } catch (e) {
                console.warn("Blob delete failed:", e);
              }

              if (wasUploaded && removedViewLink) {
                try {
                  const delRes = await gsCall(
                    "app_deletePendingUploadedFileForCurrentUser",
                    APP.currentFormKey,
                    title,
                    removedViewLink
                  );
                  console.log("Pending delete result:", delRes);
                } catch (e) {
                  console.warn("Pending uploaded file delete failed:", e);
                }
              }
            });

            chip.appendChild(label);
            chip.appendChild(removeBtn);
            chipsEl.appendChild(chip);
          });
        };

        const syncHidden = () => {
          const links = (fileInput.__items || [])
            .map(it => String(it.viewLink || "").trim())
            .filter(Boolean);
          hidden.value = links.join("\n");
        };

        async function uploadOne(item, idx1, total) {
          const file = item.file;

          const makeSession = async () => {
            const s = await gsCall(
              "app_createResumableUploadSessionForCurrentUser",
              APP.currentFormKey,
              title,
              file.name,
              file.type || "application/octet-stream",
              _getOrCreateDraftSubmissionUid_()
            );
            if (!s || !s.ok) throw new Error(s?.error || "Upload session failed");
            return s;
          };

          let session = await makeSession();
          let fileRes;

          try {
            fileRes = await resumableUploadToDrive_(session.uploadUrl, file, null);
          } catch (e1) {
            console.warn("Upload failed, restarting once...", e1);
            session = await makeSession();
            fileRes = await resumableUploadToDrive_(session.uploadUrl, file, null);
          }

          const fileId = (fileRes && fileRes.id) ? String(fileRes.id) : "";
          const viewLink = fileId ? ("https://drive.google.com/file/d/" + fileId + "/view") : "";
          if (!viewLink) throw new Error("Upload finished but no fileId returned");

          if (item.cancelled) {
            try {
              await gsCall(
                "app_deletePendingUploadedFileForCurrentUser",
                APP.currentFormKey,
                title,
                viewLink
              );
            } catch (e) {
              console.warn("Pending uploaded file delete after cancel failed:", e);
            }
            return;
          }

          item.uploaded = true;
          item.viewLink = viewLink;
          syncHidden();
        }

        fileInput.addEventListener("change", async () => {
          const newlyPicked = Array.from(fileInput.files || []);
          if (!newlyPicked.length) return;

          const draftSubmissionUid = _getOrCreateDraftSubmissionUid_();
          const existing = new Set((fileInput.__items || []).map(it => it.key));

          for (const f of newlyPicked) {
            const k = fileKey(f);
            if (existing.has(k)) continue;

            existing.add(k);
            const blobId = `${draftSubmissionUid}|${fieldId}|${k}`;

            try {
              if (window.__OFFLINE__ && typeof window.__OFFLINE__.putBlob === "function") {
                await window.__OFFLINE__.putBlob({
                  id: blobId,
                  submissionId: draftSubmissionUid,
                  fieldId: fieldId,
                  name: f.name,
                  type: f.type || "application/octet-stream",
                  size: f.size || 0,
                  blob: f
                });
              }
            } catch (e) {
              console.warn("Blob persist failed:", e);
            }

            fileInput.__items.push({
              key: k,
              blobId: blobId,
              file: f,
              uploaded: false,
              viewLink: ""
            });
          }

          renderNames();

          const queuePromise = fileInput.__queue.then(async () => {
            try {
              _setUploadState(fieldId, "starting", null);

              const items = fileInput.__items || [];
              const total = items.length;

              for (let i = 0; i < items.length; i++) {
                if (items[i].uploaded) continue;

                _setUploadState(fieldId, "uploading", null);
                await uploadOne(items[i], i + 1, total);
              }

              _setUploadState(fieldId, "done", null);
            } catch (e) {
              console.error(e);
              _setUploadState(fieldId, "paused", null);
              throw e;
            }
          });

          fileInput.__queue = queuePromise;
          _setUploadState(fieldId, "uploading", queuePromise);

          queuePromise.catch(err => {
            console.warn("Upload paused — waiting for connection:", err);
            _setUploadState(fieldId, "paused", null);
          });

          try { fileInput.value = ""; } catch(_) {}
        });
      }
    }

    else {
      const isAmount = isAmountTitle(title);

      if (isAmount) {
        ctlHost.innerHTML = `
          <div style="position:relative;">
            <input
              id="${fieldId}"
              class="control"
              ${required ? "required" : ""}
              type="text"
              inputmode="numeric"
              autocomplete="off"
              spellcheck="false"
              style="padding-left:72px;"
            >
            <span
              aria-hidden="true"
              style="
                position:absolute;
                left:14px;
                top:50%;
                transform:translateY(-50%);
                color: rgba(17,24,39,0.38);
                font-size:14px;
                font-weight:800;
                pointer-events:none;
                user-select:none;
                white-space:nowrap;
              "
            >ریال</span>
          </div>
        `;

        const inp = row.querySelector(`#${fieldId}`);
        attachAmountInputBehavior(inp);
      } else {
        ctlHost.innerHTML = `
          <input id="${fieldId}" class="control" ${required ? "required" : ""} type="text">
        `;
      }
    }

    formHost.appendChild(row);

    if (dateLike){
      const input = row.querySelector(`#${fieldId}`);
      if (input){
        input.addEventListener("click", () => {
          if (typeof window.__openPicker === "function") window.__openPicker(input, title);
        });
      }
    }
  }

  bindAutoEqualShareGroup_(formHost);

  const submitBtn = qs("#btnDynSubmit");
  const clearBtn  = qs("#btnDynClear");

  if (submitBtn){
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof window.submitForm === "function") window.submitForm();
    });
  }

  if (clearBtn){
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      clearForm();
    });
  }
}

/* =========================================================
 * FORM OPEN / LOAD
 * ========================================================= */
let __formLoadToken = 0;

async function showForm(formKey){
  const myToken = ++__formLoadToken;

  if (APP.currentFormKey && APP.currentFormKey !== String(formKey || "").trim()) {
    clearForm();
  }

  APP.currentFormKey = String(formKey || "").trim();

  try {
    window.__UFRP_PREFETCH_PRIORITY_KEY__ = APP.currentFormKey;
  } catch (_) {}

  APP.currentBundle = null;
  APP.currentSchema = null;

  _resetUploadTracking_();

  const draftUid = _getOrCreateDraftSubmissionUid_();
  console.log("DRAFT UID:", draftUid);

  showFormView();

  const host = qs("#formShellBody");
  if (host){
    host.innerHTML = `
      <div class="field" style="margin-top:12px;">
        <div class="labelRow">
          <div class="label">در حال بارگذاری فرم…</div>
          <span class="badgeOpt">لطفاً صبر کنید</span>
        </div>
        <div style="font-size:13px; color: rgba(17,24,39,0.70); line-height:1.7;">
          اطلاعات فرم در حال دریافت است.
        </div>
      </div>
    `;
  }

  setStatus("در حال بارگذاری فرم", true);

  const titleEl = qs("#formTitle");
  const subEl   = qs("#formSubtitle");

  let titleFa = "";
  try {
    const allForms = typeof flattenMenuForms === "function" ? flattenMenuForms(APP.menu) : [];
    const found = allForms.find(f =>
      String(f.formKey || "").trim() === String(APP.currentFormKey || "").trim()
    );
    titleFa = String(found?.formNameFa || found?.titleFa || found?.title || "").trim();
  } catch (_) {}

  if (titleEl) titleEl.textContent = titleFa || APP.currentFormKey;
  if (subEl)   subEl.textContent   = "";

  let bundle;
  const cacheKey = "__UFRP_BUNDLE_CACHE__:" + APP.currentFormKey;
  const idbBundleKey = "bundle:" + APP.currentFormKey;
  const idbOptionsKey = "options:" + APP.currentFormKey;

  const sessionBundleFreshKey = "__UFRP_SESSION_BUNDLE_REFRESHED__:" + APP.currentFormKey;
  const sessionBundleFresh = sessionStorage.getItem(sessionBundleFreshKey) === "1";

  if (sessionBundleFresh && window.__OFFLINE__ && typeof window.__OFFLINE__.cacheGet === "function") {
    try {
      const idbCached = await window.__OFFLINE__.cacheGet(idbBundleKey);
      const idbData = idbCached && idbCached.data ? idbCached.data : null;
      if (idbData && idbData.ok) {
        console.log("Using session-fresh cached bundle ✅", APP.currentFormKey);
        bundle = idbData;
      }
    } catch (e) {
      console.warn("Session-fresh bundle read failed:", e);
    }
  }

  if (!bundle) try {
    bundle = await fetch("/api/form-bundle.php?formKey=" + encodeURIComponent(APP.currentFormKey), { credentials: "include" }).then(r => r.json());

    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        savedAt: new Date().toISOString(),
        data: bundle
      }));

      try {
        if (window.__OFFLINE__ && typeof window.__OFFLINE__.cachePut === "function") {
          await window.__OFFLINE__.cachePut(idbBundleKey, "bundle", bundle);
        }
      } catch (idbErr) {
        console.warn("Bundle IDB cache failed:", idbErr);
      }

      sessionStorage.setItem("__UFRP_SESSION_BUNDLE_REFRESHED__:" + APP.currentFormKey, "1");
      console.log("Bundle cached ✅", APP.currentFormKey);
    } catch (cacheErr) {
      console.warn("Bundle cache failed:", cacheErr);
    }

  } catch (e) {
    console.warn("Bundle fetch failed. Trying cache...", e);

    try {
      const raw = localStorage.getItem(cacheKey);
      const cached = raw ? JSON.parse(raw) : null;
      const data = cached && cached.data ? cached.data : null;

      if (data && data.ok) {
        console.warn("Using cached bundle (offline/localStorage) ✅", APP.currentFormKey, cached?.savedAt || "");
        bundle = data;
      } else if (window.__OFFLINE__ && typeof window.__OFFLINE__.cacheGet === "function") {
        const idbCached = await window.__OFFLINE__.cacheGet(idbBundleKey);
        const idbData = idbCached && idbCached.data ? idbCached.data : null;

        if (idbData && idbData.ok) {
          console.warn("Using cached bundle (offline/IndexedDB) ✅", APP.currentFormKey, idbCached?.updatedAt || "");
          bundle = idbData;
        } else {
          bundle = null;
        }
      } else {
        bundle = null;
      }
    } catch (err) {
      console.error(err);
      bundle = null;
    }
  }

  if (myToken !== __formLoadToken) return;

  if (!bundle || !bundle.ok){
    if (titleEl) titleEl.textContent = "خطا";
    if (subEl)   subEl.textContent = bundle?.error || "خطا در دریافت اطلاعات فرم";

    if (host){
      host.innerHTML = `
        <div class="field" style="margin-top:12px;">
          <div class="labelRow">
            <div class="label">خطا</div>
            <span class="badgeReq">مشکل</span>
          </div>
          <div style="font-size:13px; color: rgba(17,24,39,0.75); line-height:1.7;">
            ${escapeHtml(bundle?.error || "خطا در دریافت اطلاعات فرم")}
          </div>
        </div>
      `;
    }

    setStatus("", false);
    return;
  }

  APP.currentBundle = bundle;

  const centerName = bundle.center?.TransactionCenterNameFa || bundle.center?.TransactionCenterKey || "";
  const formName =
    bundle.form?.formNameFa ||
    bundle.form?.titleFa ||
    bundle.form?.title ||
    titleFa ||
    APP.currentFormKey;

  if (titleEl) titleEl.textContent = formName;
  if (subEl)   subEl.textContent = centerName;

  if (host){
    host.innerHTML = `
      <div class="field" style="margin-top:12px;">
        <div class="labelRow">
          <div class="label">در حال بارگذاری سوالات…</div>
          <span class="badgeOpt">لطفاً صبر کنید</span>
        </div>
        <div style="font-size:13px; color: rgba(17,24,39,0.70); line-height:1.7;">
          ساختار فرم در حال دریافت است.
        </div>
      </div>
    `;
  }

  if (myToken !== __formLoadToken) return;

  let schema =
    (bundle && (
      bundle.schema ||
      bundle.formSchema ||
      bundle.currentSchema ||
      (bundle.form && (bundle.form.schema || bundle.form.formSchema || bundle.form.currentSchema))
    )) || null;

  if (schema && !Array.isArray(schema)) {
    schema = schema.schema || schema.questions || schema.items || null;
  }

  if (!schema) {
    if (!navigator.onLine) {
      console.error("Schema missing in bundle (offline):", bundle);
      renderSchemaError("Schema not found in cached bundle");
      setStatus("", false);
      return;
    }

    let schemaRes;
    try {
      schemaRes = await fetch("/api/form-bundle.php?formKey=" + encodeURIComponent(APP.currentFormKey), { credentials: "include" }).then(r => r.json());
    } catch (e) {
      console.error(e);
      schemaRes = null;
    }

    if (myToken !== __formLoadToken) return;

    if (!schemaRes || !schemaRes.ok) {
      renderSchemaError(schemaRes?.error || "خطا در دریافت اسکیمای فرم");
      setStatus("", false);
      return;
    }

    schema = schemaRes.schema || [];
  }

  APP.currentSchema = schema;
  APP.currentBundle = bundle;
  try { bundle.schema = schema; } catch (_) {}

  try {
    const cacheKey2 = "__UFRP_BUNDLE_CACHE__:" + APP.currentFormKey;
    const raw = localStorage.getItem(cacheKey2);
    const cached = raw ? JSON.parse(raw) : null;
    const data = cached && cached.data ? cached.data : null;

    if (data && typeof data === "object") {
      data.schema = schema;
      localStorage.setItem(cacheKey2, JSON.stringify({
        savedAt: new Date().toISOString(),
        data: data
      }));
      console.log("Bundle schema saved ✅", APP.currentFormKey);
    } else {
      localStorage.setItem(cacheKey2, JSON.stringify({
        savedAt: new Date().toISOString(),
        data: Object.assign({}, bundle, { schema })
      }));
      console.log("Bundle+schema cached ✅", APP.currentFormKey);
    }
  } catch (e) {
    console.warn("Saving schema to bundle cache failed:", e);
  }

  let optRes = { ok: true, rows: [] };
  const sessionOptionsFreshKey = "__UFRP_SESSION_OPTIONS_REFRESHED__:" + APP.currentFormKey;
  const sessionOptionsFresh = sessionStorage.getItem(sessionOptionsFreshKey) === "1";

  if (sessionOptionsFresh && window.__OFFLINE__ && typeof window.__OFFLINE__.cacheGet === "function") {
    try {
      const idbCached = await window.__OFFLINE__.cacheGet(idbOptionsKey);
      const idbData = idbCached && idbCached.data ? idbCached.data : null;

      if (idbData && Array.isArray(idbData.rows)) {
        optRes = idbData;
        APP.currentOptionsBundle = optRes;
        console.log("Using session-fresh cached options ✅", APP.currentFormKey, "rows:", idbData.rows.length);
      }
    } catch (e) {
      console.warn("Session-fresh options read failed:", e);
    }
  }

  if (!(sessionOptionsFresh && Array.isArray(optRes.rows))) try {
    optRes = await fetch("/api/form-options.php?formKey=" + encodeURIComponent(APP.currentFormKey), { credentials: "include" }).then(r => r.json());
    APP.currentOptionsBundle = optRes;

    try {
      if (window.__OFFLINE__ && typeof window.__OFFLINE__.cachePut === "function") {
        await window.__OFFLINE__.cachePut(idbOptionsKey, "options", optRes || { ok: true, rows: [] });
      }
    } catch (idbErr) {
      console.warn("Options IDB cache failed:", idbErr);
    }

  } catch (e) {
    console.warn("Options fetch failed:", e);

    try {
      if (window.__OFFLINE__ && typeof window.__OFFLINE__.cacheGet === "function") {
        const idbCached = await window.__OFFLINE__.cacheGet(idbOptionsKey);
        const idbData = idbCached && idbCached.data ? idbCached.data : null;

        if (idbData && Array.isArray(idbData.rows)) {
          optRes = idbData;
          console.warn("Using cached options (IndexedDB) ✅", APP.currentFormKey, idbCached?.updatedAt || "");
        } else {
          optRes = { ok: true, rows: [] };
        }
      } else {
        optRes = { ok: true, rows: [] };
      }
    } catch (idbErr) {
      console.warn("Options cache read failed:", idbErr);
      optRes = { ok: true, rows: [] };
    }
  }

  APP.currentOptionsBundle = optRes;
  sessionStorage.setItem("__UFRP_SESSION_OPTIONS_REFRESHED__:" + APP.currentFormKey, "1");

  renderDynamicForm(APP.currentSchema, (optRes && optRes.rows) ? optRes.rows : []);
  setStatus("", false);

  try{
    const scrollArea = qs("#scrollArea");
    if (scrollArea) scrollArea.scrollTo({ top: 0, behavior: "smooth" });
  }catch(_){}
}

/* =========================================================
 * BACK / CLEAR
 * ========================================================= */
function backToMenu(){
  clearForm();

  APP.currentFormKey = null;
  APP.currentBundle = null;
  APP.currentSchema = null;
  resetUploadTracking();

  clearDraftSubmissionUid();
  showMenuView();
  setStatus("", false);

  try{
    const scrollArea = qs("#scrollArea");
    if (scrollArea) scrollArea.scrollTo({ top: 0, behavior: "smooth" });
  }catch(_){}
}

function clearForm(){
  const root = qs("#dynForm") || qs("#formShellBody") || qs("#formView") || document;
  if (!root) return;

  const skipPendingCleanup = !!window.__UFRP_SKIP_PENDING_CLEANUP_ON_CLEAR__;
  const pendingCleanupItems = [];

  root.querySelectorAll("input.fuNativeInput").forEach(el => {
    const items = Array.isArray(el.__items) ? el.__items : [];
    items.forEach(it => {
      if (!it) return;
      if (!skipPendingCleanup) it.cancelled = true;
      pendingCleanupItems.push({
        item: it,
        fieldId: String(el.id || "")
      });
    });
  });

  if (!skipPendingCleanup) {
    (async () => {
      for (const rec of pendingCleanupItems) {
        const it = rec.item;
        const fieldId = String(rec.fieldId || "");
        const fieldIndex = Number(String(fieldId).replace(/^f_/, ""));
        const schemaItem = Array.isArray(APP.currentSchema) ? APP.currentSchema[fieldIndex] : null;
        const fieldTitle = String(schemaItem?.title || "").trim();

        try {
          if (it?.blobId && window.__OFFLINE__ && typeof window.__OFFLINE__.deleteBlob === "function") {
            await window.__OFFLINE__.deleteBlob(it.blobId);
          }
        } catch (e) {
          console.warn("Blob delete on clear failed:", e);
        }

        try {
          if (it?.uploaded && it?.viewLink) {
            const delRes = await gsCall(
              "app_deletePendingUploadedFileForCurrentUser",
              APP.currentFormKey,
              fieldTitle,
              it.viewLink
            );
            console.log("Pending delete on clear result:", {
              formKey: APP.currentFormKey,
              fieldTitle,
              viewLink: it.viewLink,
              delRes
            });
          }
        } catch (e) {
          console.warn("Pending uploaded file delete on clear failed:", e);
        }
      }
    })();
  }

  _resetUploadTracking_();
  _clearDraftSubmissionUid_();

  root.querySelectorAll("input").forEach(el => {
    const t = (el.type || "").toLowerCase();

    if (t === "checkbox" || t === "radio") el.checked = false;
    else el.value = "";

    if (el.dataset && el.dataset.rawDigits != null) el.dataset.rawDigits = "";

    if (el.classList && el.classList.contains("fuNativeInput")) {
      try { el.value = ""; } catch(_) {}
      el.__uploadPromise = null;
      el.__items = [];
      el.__queue = Promise.resolve();
      el.__suppressStatus = true;
    }
  });

  root.querySelectorAll("textarea").forEach(el => el.value = "");
  root.querySelectorAll("select").forEach(el => { el.selectedIndex = 0; });

  root.querySelectorAll(".sdWrap").forEach(wrap => {
    if (wrap && wrap.__sdApi && typeof wrap.__sdApi.clear === "function") {
      wrap.__sdApi.clear();
    } else {
      const inp = wrap.querySelector(".sdInput");
      if (inp) inp.value = "";
    }

    const menu = wrap.querySelector(".sdMenu");
    if (menu) menu.classList.remove("show");
  });

  root.querySelectorAll(".fuWrap").forEach(wrap => {
    const nameEl = wrap.querySelector(".fuName");
    if (nameEl) nameEl.textContent = "فایلی انتخاب نشده";
  });

  root.querySelectorAll("div[id$='__chips']").forEach(el => { el.innerHTML = ""; });
  root.querySelectorAll("input[id$='__drive']").forEach(el => { el.value = ""; });

  root.querySelectorAll("div[id$='__status']").forEach(el => {
    el.textContent = "";
    el.style.color = "rgba(17,24,39,0.65)";
  });

  root.querySelectorAll("input[id$='__value']").forEach(el => { el.value = ""; });

  setTimeout(() => {
    const scrollArea = qs("#scrollArea");

    if (scrollArea && typeof scrollArea.scrollTo === "function") {
      scrollArea.scrollTo({ top: 0, behavior: "smooth" });
    } else if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, 50);
}

/* =========================================================
 * VALIDATION / COLLECT
 * ========================================================= */
function validateRequiredFields_(schema){
  const missing = [];

  for (let i = 0; i < schema.length; i++){
    const it = schema[i] || {};
    if (!it.required) continue;

    const fieldId = `f_${i}`;
    const type = String(it.type || "").trim();
    const title = String(it.title || "").trim();

    if (type === "FILE_UPLOAD"){
      const fileInput = document.getElementById(fieldId);
      const selectedCount = Array.isArray(fileInput?.__items) ? fileInput.__items.length : 0;
      if (selectedCount <= 0) {
        missing.push({ index: i, fieldId, title, type });
      }
      continue;
    }

    if (type === "MULTIPLE_CHOICE"){
      const hiddenVal = document.getElementById(fieldId + "__value");
      if (hiddenVal){
        const v = String(hiddenVal.value || "").trim();
        if (!v) {
          missing.push({ index: i, fieldId, title, type });
        }
        continue;
      }
    }

    const ddHolder = document.getElementById(fieldId);
    if (ddHolder && ddHolder.querySelector && ddHolder.querySelector(".sdWrap")){
      const wrap = ddHolder.querySelector(".sdWrap");
      const v = wrap?.__sdApi?.getValue ? wrap.__sdApi.getValue() : "";
      if (!String(v || "").trim()) {
        missing.push({ index: i, fieldId, title, type: "DROPDOWN" });
      }
      continue;
    }

    const el = document.getElementById(fieldId);
    if (!el) continue;

    const v = String(el.value || "").trim();
    if (!v) {
      missing.push({ index: i, fieldId, title, type });
    }
  }

  return missing;
}

function collectAnswers_(schema){
  const out = [];

  for (let i = 0; i < schema.length; i++){
    const it = schema[i] || {};
    const fieldId = `f_${i}`;
    const type = String(it.type || "").trim();
    const title = String(it.title || "").trim();
    const itemId = it.itemId;

    let value = "";

    if (type === "FILE_UPLOAD"){
      const hidden = document.getElementById(fieldId + "__drive");
      value = String(hidden?.value || "").trim();
      out.push({ itemId, title, type, value });
      continue;
    }

    if (type === "MULTIPLE_CHOICE"){
      const hiddenVal = document.getElementById(fieldId + "__value");
      if (hiddenVal){
        value = String(hiddenVal.value || "").trim();
        out.push({ itemId, title, type, value });
        continue;
      }
    }

    const ddHolder = document.getElementById(fieldId);
    if (ddHolder && ddHolder.querySelector && ddHolder.querySelector(".sdWrap")){
      const wrap = ddHolder.querySelector(".sdWrap");
      value = wrap?.__sdApi?.getValue ? wrap.__sdApi.getValue() : "";
      out.push({ itemId, title, type, value });
      continue;
    }

    const el = document.getElementById(fieldId);
    if (el){
      if (el.dataset && el.dataset.rawDigits != null && String(el.dataset.rawDigits).trim() !== "") {
        value = String(el.dataset.rawDigits);
      } else {
        value = String(el.value || "").trim();
      }
    }

    out.push({ itemId, title, type, value });
  }

  return out;
}

function showToast_(msg){
  const t = document.getElementById("toast");
  if (!t) return;

  t.textContent = msg || "✅ انجام شد";
  t.classList.remove("validation");
  t.style.background = "";
  t.style.color = "";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1500);
}

function showValidationToast_(msg){
  const t = document.getElementById("toast");
  if (!t) return;

  t.textContent = msg || "فیلد الزامی تکمیل نشده است";
  t.style.background = "";
  t.style.color = "";
  t.classList.add("validation", "show");

  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => {
      t.classList.remove("validation");
    }, 160);
  }, 3600);
}


let __UFRP_TEXT_FIELD_VISIBILITY_TICK__ = 0;

function isKeyboardAwareTextControl_(el){
  return !!(
    el &&
    el.matches &&
    (
      el.matches('textarea') ||
      el.matches('input[type="text"]:not(.sdInput):not([readonly])')
    )
  );
}

function ensureFocusedTextControlVisible_(){
  const active = document.activeElement;
  const scrollArea = document.getElementById("scrollArea");
  if (!scrollArea || !isKeyboardAwareTextControl_(active)) return;

  const fieldEl = active.closest(".field");
  if (!fieldEl) return;

  try {
    const scrollRect = scrollArea.getBoundingClientRect();
    const fieldRect = fieldEl.getBoundingClientRect();
    const inputRect = active.getBoundingClientRect();

    const viewportHeight = Number(window.visualViewport?.height || window.innerHeight || 0);
    const visibleBottom = Math.min(scrollRect.bottom, viewportHeight || scrollRect.bottom) - 12;
    const visibleTop = scrollRect.top + 12;

    let targetTop = scrollArea.scrollTop;

    // First: make sure the actual input box is above the keyboard
    if (inputRect.bottom > visibleBottom) {
      targetTop += (inputRect.bottom - visibleBottom);
    }

    // Then: make sure the field title/card is not cut off at the top
    const projectedFieldTop = fieldRect.top - (targetTop - scrollArea.scrollTop);
    if (projectedFieldTop < visibleTop) {
      targetTop += (projectedFieldTop - visibleTop);
    }

    const maxScrollTop = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight);
    targetTop = Math.max(0, Math.min(maxScrollTop, targetTop));

    scrollArea.scrollTop = targetTop;
  } catch (_) {}
}

function scheduleFocusedTextControlVisibility_(){
  const myTick = ++__UFRP_TEXT_FIELD_VISIBILITY_TICK__;
  const run = () => {
    if (myTick !== __UFRP_TEXT_FIELD_VISIBILITY_TICK__) return;
    ensureFocusedTextControlVisible_();
  };

  [0, 90, 180, 320, 520, 820, 1200].forEach(ms => setTimeout(run, ms));
}

function bindKeyboardAwareFocusedFieldVisibility_(){
  if (window.__UFRP_TEXT_FIELD_VISIBILITY_BOUND__) return;
  window.__UFRP_TEXT_FIELD_VISIBILITY_BOUND__ = true;

  const scheduleIfNeeded = (target) => {
    if (isKeyboardAwareTextControl_(target || document.activeElement)) {
      scheduleFocusedTextControlVisibility_();
    }
  };

  document.addEventListener("focusin", (e) => {
    scheduleIfNeeded(e.target);
  }, true);

  document.addEventListener("input", (e) => {
    scheduleIfNeeded(e.target);
  }, true);

  document.addEventListener("click", (e) => {
    scheduleIfNeeded(e.target);
  }, true);

  const onViewportChange = () => {
    scheduleIfNeeded(document.activeElement);
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onViewportChange);
    window.visualViewport.addEventListener("scroll", onViewportChange);
  }

  window.addEventListener("resize", onViewportChange);
}

function focusNextQuestionField_(currentFieldId){
  const root = document.getElementById("dynForm");
  const scrollArea = document.getElementById("scrollArea");
  if (!root || !currentFieldId) return;

  const fieldRows = Array.from(root.querySelectorAll(".field"));
  const currentField =
    document.getElementById(currentFieldId)?.closest(".field") ||
    document.getElementById(currentFieldId + "__control")?.closest(".field") ||
    null;

  if (!currentField) return;

  const idx = fieldRows.indexOf(currentField);
  if (idx < 0) return;

  const getFocusableForField = (fieldEl) => {
    if (!fieldEl) return null;

    return (
      fieldEl.querySelector(".sdInput") ||
      fieldEl.querySelector('input[type="text"]') ||
      fieldEl.querySelector("textarea") ||
      fieldEl.querySelector('input[type="radio"]') ||
      fieldEl.querySelector(".fuBtn") ||
      fieldEl.querySelector("button") ||
      null
    );
  };

  const isDropdownField_ = (fieldEl) => {
    return !!(fieldEl && fieldEl.querySelector && fieldEl.querySelector(".sdWrap"));
  };

  const isTextEntryField_ = (fieldEl) => {
    return !!(
      fieldEl &&
      fieldEl.querySelector &&
      (
        fieldEl.querySelector('input[type="text"]:not(.sdInput):not([readonly])') ||
        fieldEl.querySelector("textarea")
      )
    );
  };

  const scrollDropdownFieldIntoViewWithinApp_ = (fieldEl) => {
    if (!fieldEl || !scrollArea) return;

    try {
      const rowRect = fieldEl.getBoundingClientRect();
      const scrollRect = scrollArea.getBoundingClientRect();
      const fixedHeader = document.getElementById("fixedHeaderArea");
      const baseHeaderOffset = Math.max(18, Math.min(42, Number(fixedHeader?.offsetHeight || 0) * 0.2));

      const viewportHeight = Number(window.visualViewport?.height || window.innerHeight || 0);
      const keyboardInset = Math.max(0, Number(window.innerHeight || 0) - viewportHeight);
      const effectiveBottom = Math.min(scrollRect.bottom, viewportHeight || scrollRect.bottom) - Math.max(18, keyboardInset + 10);

      const visibleTop = scrollRect.top + baseHeaderOffset + 12;
      const visibleHeight = Math.max(120, effectiveBottom - visibleTop);

      const menuEl = fieldEl.querySelector(".sdMenu");
      let menuMaxHeight = 0;

      try {
        if (menuEl) {
          const cs = window.getComputedStyle(menuEl);
          const px = parseFloat(cs.maxHeight || "0");
          if (Number.isFinite(px) && px > 0) menuMaxHeight = px;
        }
      } catch (_) {}

      if (!menuMaxHeight) {
        menuMaxHeight = Math.max(140, Math.min(280, visibleHeight * 0.42));
      }

      const preferredTopGap = Math.max(24, Math.min(84, visibleHeight * 0.12));
      const preferredTopEdge = visibleTop + preferredTopGap;

      const desiredMenuRoom = Math.max(
        120,
        Math.min(menuMaxHeight, visibleHeight * 0.58)
      );

      let targetTop =
        scrollArea.scrollTop +
        (rowRect.top - preferredTopEdge);

      const maxScrollableTop = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight);
      targetTop = Math.max(0, Math.min(maxScrollableTop, targetTop));

      const projectedRowTop = rowRect.top - (targetTop - scrollArea.scrollTop);
      const projectedRowBottom = rowRect.bottom - (targetTop - scrollArea.scrollTop);
      const desiredBottomEdge = effectiveBottom - desiredMenuRoom;

      if (projectedRowTop < preferredTopEdge) {
        targetTop += projectedRowTop - preferredTopEdge;
      } else if (projectedRowBottom > desiredBottomEdge) {
        targetTop += projectedRowBottom - desiredBottomEdge;
      }

      targetTop = Math.max(0, Math.min(maxScrollableTop, targetTop));

      scrollArea.scrollTo({
        top: targetTop,
        behavior: "smooth"
      });
    } catch (_) {}
  };

  for (let i = idx + 1; i < fieldRows.length; i++) {
    const nextField = fieldRows[i];
    const target = getFocusableForField(nextField);
    if (!target) continue;

    const dropdownField = isDropdownField_(nextField);
    const textEntryField = isTextEntryField_(nextField);

    if (dropdownField) {
      scrollDropdownFieldIntoViewWithinApp_(nextField);
    }

    setTimeout(() => {
      try {
        if (typeof target.focus === "function") {
          try {
            target.focus({ preventScroll: true });
          } catch (_) {
            target.focus();
          }
        }
      } catch (_) {}

      if (dropdownField) {
        setTimeout(() => scrollDropdownFieldIntoViewWithinApp_(nextField), 120);
        setTimeout(() => scrollDropdownFieldIntoViewWithinApp_(nextField), 420);
      } else if (textEntryField) {
        scheduleFocusedTextControlVisibility_();
      }
    }, dropdownField ? 260 : 80);

    break;
  }
}


function focusMissingField_(miss){
  const fieldId = String(miss?.fieldId || "").trim();
  if (!fieldId) return;

  const row =
    document.getElementById(fieldId)?.closest(".field") ||
    document.getElementById(fieldId + "__control")?.closest(".field") ||
    document.getElementById(fieldId + "__btn")?.closest(".field") ||
    document.getElementById(fieldId + "__value")?.closest(".field");

  try {
    const scrollArea = document.getElementById("scrollArea");
    if (row && scrollArea) {
      const rowRect = row.getBoundingClientRect();
      const scrollRect = scrollArea.getBoundingClientRect();
      const fixedHeader = document.getElementById("fixedHeaderArea");
      const headerOffset = Math.max(18, Math.min(42, Number(fixedHeader?.offsetHeight || 0) * 0.2));

      const targetTop =
        scrollArea.scrollTop +
        (rowRect.top - scrollRect.top) -
        headerOffset;

      scrollArea.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
      });
    } else if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } catch (_) {}

  setTimeout(() => {
    try {
      const type = String(miss?.type || "").trim();

      if (type === "FILE_UPLOAD") {
        const btn = document.getElementById(fieldId + "__btn");
        if (btn && typeof btn.focus === "function") {
          try { btn.focus({ preventScroll: true }); } catch (_) { btn.focus(); }
        }
        return;
      }

      if (type === "MULTIPLE_CHOICE") {
        const other = document.getElementById(fieldId + "__other");
        const firstRadio = document.querySelector(`input[name="${fieldId}__radio"]`);
        if (firstRadio && typeof firstRadio.focus === "function") {
          try { firstRadio.focus({ preventScroll: true }); } catch (_) { firstRadio.focus(); }
          return;
        }
        if (other && typeof other.focus === "function") {
          try { other.focus({ preventScroll: true }); } catch (_) { other.focus(); }
          return;
        }
      }

      if (type === "DROPDOWN") {
        const host = document.getElementById(fieldId);
        const input = host ? host.querySelector(".sdInput") : null;
        if (input && typeof input.focus === "function") {
          try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
          return;
        }
      }

      const el = document.getElementById(fieldId);
      if (el && typeof el.focus === "function") {
        try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
        return;
      }
    } catch (_) {}
  }, 280);
}

let __APP_REFRESH_MODAL_OPEN__ = false;
let __PULL_REFRESH_ARMED__ = false;
let __PULL_REFRESH_START_Y__ = 0;
let __PULL_REFRESH_LAST_DELTA__ = 0;
let __PULL_REFRESH_TRACKING__ = false;

function canStartPullRefreshFromTarget_(target){
  const el = target instanceof Element ? target : null;
  if (!el) return true;

  if (
    el.closest(".outboxPanel") ||
    el.closest(".modalBackdrop.show") ||
    el.closest("input") ||
    el.closest("textarea") ||
    el.closest("select") ||
    el.closest(".sdMenu") ||
    el.closest(".sdWrap") ||
    el.closest(".fuWrap") ||
    el.closest("button")
  ) {
    return false;
  }

  return true;
}

function showAppRefreshModal_(){
  const modal = document.getElementById("appRefreshModal");
  if (!modal) return;

  __APP_REFRESH_MODAL_OPEN__ = true;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function hideAppRefreshModal_(){
  const modal = document.getElementById("appRefreshModal");
  if (!modal) return;

  __APP_REFRESH_MODAL_OPEN__ = false;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function refreshAppNow_(){
  try { localStorage.setItem("__UFRP_FORCE_CACHE_REFRESH__", "1"); } catch (_) {}
  try { hideAppRefreshModal_(); } catch (_) {}
  try { setStatus("در حال بروزرسانی...", true); } catch (_) {}

  setTimeout(() => {
    try {
      window.location.reload();
    } catch (_) {
      location.reload();
    }
  }, 150);
}

function setPullRefreshHintState_(state){
  const hint = document.getElementById("pullRefreshHint");
  if (!hint) return;

  hint.classList.remove("show", "ready");

  if (state === "show") {
    hint.classList.add("show");
  } else if (state === "ready") {
    hint.classList.add("show", "ready");
  }
}

function resetPullRefreshState_(){
  __PULL_REFRESH_ARMED__ = false;
  __PULL_REFRESH_START_Y__ = 0;
  __PULL_REFRESH_LAST_DELTA__ = 0;
  __PULL_REFRESH_TRACKING__ = false;

  setPullRefreshHintState_("");
}

function bindAppRefreshUI_(){
  const refreshBtn = document.getElementById("refreshAppBtn");
  const modal = document.getElementById("appRefreshModal");
  const confirmBtn = document.getElementById("appRefreshConfirmBtn");
  const cancelBtn = document.getElementById("appRefreshCancelBtn");
  const scrollArea = document.getElementById("scrollArea");
  const hint = document.getElementById("pullRefreshHint");

  if (refreshBtn && !refreshBtn.__boundRefreshClick) {
    refreshBtn.__boundRefreshClick = true;
    refreshBtn.addEventListener("click", () => {
      showAppRefreshModal_();
    });
  }

  if (confirmBtn && !confirmBtn.__boundRefreshConfirm) {
    confirmBtn.__boundRefreshConfirm = true;
    confirmBtn.addEventListener("click", () => {
      refreshAppNow_();
    });
  }

  if (cancelBtn && !cancelBtn.__boundRefreshCancel) {
    cancelBtn.__boundRefreshCancel = true;
    cancelBtn.addEventListener("click", () => {
      hideAppRefreshModal_();
    });
  }

  if (modal && !modal.__boundRefreshBackdrop) {
    modal.__boundRefreshBackdrop = true;
    modal.addEventListener("mousedown", (e) => {
      if (e.target === modal) hideAppRefreshModal_();
    });
    modal.addEventListener("touchstart", (e) => {
      if (e.target === modal) hideAppRefreshModal_();
    }, { passive: true });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && __APP_REFRESH_MODAL_OPEN__) {
      hideAppRefreshModal_();
    }
  });

  if (!scrollArea || scrollArea.__boundPullRefresh) return;
  scrollArea.__boundPullRefresh = true;

  scrollArea.addEventListener("touchstart", (e) => {
    if (__APP_REFRESH_MODAL_OPEN__) return;
    if (!canStartPullRefreshFromTarget_(e.target)) return;
    if ((scrollArea.scrollTop || 0) > 0) return;

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    __PULL_REFRESH_TRACKING__ = true;
    __PULL_REFRESH_START_Y__ = touch.clientY;
    __PULL_REFRESH_LAST_DELTA__ = 0;
    __PULL_REFRESH_ARMED__ = false;
  }, { passive: true });

  scrollArea.addEventListener("touchmove", (e) => {
    if (!__PULL_REFRESH_TRACKING__) return;
    if ((scrollArea.scrollTop || 0) > 0) {
      resetPullRefreshState_();
      return;
    }

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    const delta = Math.max(0, touch.clientY - __PULL_REFRESH_START_Y__);
    __PULL_REFRESH_LAST_DELTA__ = delta;

    if (delta >= 90) {
      __PULL_REFRESH_ARMED__ = true;
      setPullRefreshHintState_("ready");
    } else if (delta >= 35) {
      __PULL_REFRESH_ARMED__ = false;
      setPullRefreshHintState_("show");
    } else {
      setPullRefreshHintState_("");
    }
  }, { passive: true });

  const finishPull = () => {
    if (!__PULL_REFRESH_TRACKING__) return;

    const shouldOpen = __PULL_REFRESH_ARMED__ && __PULL_REFRESH_LAST_DELTA__ >= 90;
    resetPullRefreshState_();

    if (shouldOpen) {
      showAppRefreshModal_();
    }
  };

  scrollArea.addEventListener("touchend", finishPull, { passive: true });
  scrollArea.addEventListener("touchcancel", finishPull, { passive: true });
}

/* =========================================================
 * DRAFT SUBMISSION UID
 * ========================================================= */
function getOrCreateDraftSubmissionUid(){
  const key = "UFRP_DRAFT_SUBMISSION_UID";
  try{
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;

    const uid = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : ("draft_" + Date.now() + "_" + Math.random().toString(16).slice(2));

    sessionStorage.setItem(key, uid);
    return uid;
  }catch(e){
    return ("draft_" + Date.now() + "_" + Math.random().toString(16).slice(2));
  }
}

function clearDraftSubmissionUid(){
  try{ sessionStorage.removeItem("UFRP_DRAFT_SUBMISSION_UID"); }catch(e){}
}

/* =========================================================
 * SUBMIT FLOW
 * ========================================================= */
window.submitForm = async function submitForm(){

  function _getOrCreateSubmissionUid_(){
    const key = "__UFRP_PENDING_SUBMISSION_UID__";
    try{
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;

      const uid = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ("uid_" + Date.now() + "_" + Math.random().toString(16).slice(2));

      sessionStorage.setItem(key, uid);
      return uid;
    }catch(e){
      return ("uid_" + Date.now() + "_" + Math.random().toString(16).slice(2));
    }
  }

  function _clearPendingUid_(){
    try{ sessionStorage.removeItem("__UFRP_PENDING_SUBMISSION_UID__"); }catch(e){}
  }

  if (window.__SUBMIT_IN_FLIGHT__) {
    console.warn("Submit already in flight; ignoring.");
    return;
  }
  window.__SUBMIT_IN_FLIGHT__ = true;

  const submitBtn = document.querySelector("#btnDynSubmit");
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (!APP.currentFormKey || !Array.isArray(APP.currentSchema)) {
      alert("No form is loaded.");
      return;
    }

    const submissionUid = _getOrCreateSubmissionUid_();
    console.log("SUBMIT UID:", submissionUid);
    captureFileUploadSnapshot_(APP.currentSchema, submissionUid);

    try{
      setStatus("در حال تکمیل فایل‌ها...", true);
      await _waitForAllUploads_();
    }catch(e){
      setStatus("", false);
      alert("Upload error: " + (e && e.message ? e.message : e));
      return;
    } finally {
      setStatus("", false);
    }

    const missing = validateRequiredFields_(APP.currentSchema);
    if (missing.length){
      const firstMissing = missing[0];
      showValidationToast_(`فیلد الزامی «${String(firstMissing?.title || "").trim()}» باید تکمیل شود`);
      focusMissingField_(firstMissing);
      return;
    }

    const answers = collectAnswers_(APP.currentSchema);
    answers.push({
      itemId: "__meta__",
      title: "__SubmissionUID",
      type: "TEXT",
      value: submissionUid
    });

    if (!(window.__OFFLINE__ && typeof window.__OFFLINE__.enqueueSubmission === "function")) {
      alert("Offline engine not available.");
      return;
    }

    const queuedId = await window.__OFFLINE__.enqueueSubmission({
      formKey: APP.currentFormKey,
      submissionUid: submissionUid,
      answers: answers,
      fileUploadSnapshot: captureFileUploadSnapshot_(APP.currentSchema, submissionUid)
    });

    try {
      const seededFormNameFa = String(
        APP.currentBundle?.form?.formNameFa ||
        APP.currentBundle?.form?.titleFa ||
        (document.getElementById("formTitle") && document.getElementById("formTitle").textContent) ||
        ""
      ).trim();

      if (window.__UFRP_OUTBOX_SEED_ACTIVE__) {
        window.__UFRP_OUTBOX_SEED_ACTIVE__({
          formKey: APP.currentFormKey,
          formNameFa: seededFormNameFa,
          submissionUid: submissionUid,
          answers: answers,
          uiStageKey: "local_to_server_uploading",
          uiPercent: 25,
          status: "processing"
        });
      }
    } catch (_) {}

    console.log("Queued submission ID:", queuedId);

    window.__UFRP_SKIP_PENDING_CLEANUP_ON_CLEAR__ = true;
    clearForm();
    window.__UFRP_SKIP_PENDING_CLEANUP_ON_CLEAR__ = false;
    _clearPendingUid_();

    try {
      if (window.OUTBOX && window.OUTBOX.refresh) {
        Promise.resolve()
          .then(() => window.OUTBOX.refresh())
          .catch(() => {});
      }
    } catch (_) {}

    if (navigator.onLine) {
      showToast_("✅ ثبت در پس‌زمینه شروع شد");
      try {
        window.__OFFLINE__.flushQueue().catch((e) => {
          console.warn("Immediate flush failed, will retry automatically:", e);
        });
      } catch (e) {
        console.warn("Immediate flush failed, will retry automatically:", e);
      }
    } else {
      showToast_("✅ ذخیره شد (آفلاین)");
    }

  } catch (e){
    console.error(e);
    setStatus("", false);
    alert("Submit error: " + (e && e.message ? e.message : e));
  } finally {
    window.__SUBMIT_IN_FLIGHT__ = false;
    if (submitBtn) submitBtn.disabled = false;
  }
};

/* =========================================================
 * APP INIT
 * ========================================================= */
async function appInit(){

  let forceRefresh = false;
  try {
    forceRefresh = localStorage.getItem("__UFRP_FORCE_CACHE_REFRESH__") === "1";
    localStorage.removeItem("__UFRP_FORCE_CACHE_REFRESH__");
  } catch (_) {}

  window.__UFRP_PREFETCH_RESTORED_FROM_MANIFEST__ = false;

  finalizeRequiredAppUpdateState_();

  try {
    sessionStorage.removeItem("__UFRP_SESSION_MENU_REFRESHED__");

    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith("__UFRP_SESSION_BUNDLE_REFRESHED__")) {
        sessionStorage.removeItem(k);
      }
      if (k.startsWith("__UFRP_SESSION_OPTIONS_REFRESHED__")) {
        sessionStorage.removeItem(k);
      }
    });

    if (forceRefresh) {
      try { localStorage.removeItem("__UFRP_PREFETCH_MANIFEST__"); } catch (_) {}
      console.log("Explicit refresh requested — persistent prefetch manifest cleared ✅");
    } else {
      const raw = localStorage.getItem("__UFRP_PREFETCH_MANIFEST__");
      const manifest = raw ? JSON.parse(raw) : null;

      const manifestEmail = String(manifest?.userEmail || "").trim().toLowerCase();
      const currentUserEmail = String(window.__UFRP_USER_EMAIL__ || "").trim().toLowerCase();

      const formKeys = Array.isArray(manifest?.formKeys)
        ? Array.from(new Set(
            manifest.formKeys
              .map(k => String(k || "").trim())
              .filter(Boolean)
          ))
        : [];

      if (
        manifest &&
        manifest.complete === true &&
        manifestEmail &&
        manifestEmail === currentUserEmail
      ) {
        formKeys.forEach(k => {
          sessionStorage.setItem("__UFRP_SESSION_BUNDLE_REFRESHED__:" + k, "1");
          sessionStorage.setItem("__UFRP_SESSION_OPTIONS_REFRESHED__:" + k, "1");
        });

        window.__UFRP_PREFETCH_RESTORED_FROM_MANIFEST__ = true;
        console.log("Prefetch manifest restored ✅", formKeys.length);
      }
    }
  } catch (_) {}

  updateOnlineIndicator();

  async function verifyOnlineIndicator_(){
    try {
      const res = await fetch("/api/health-local.php", {
        method: "GET",
        cache: "no-store"
      });
      if (!res || !res.ok) throw new Error();
      window.__UFRP_FORCE_OFFLINE__ = false;
    } catch (_) {
      window.__UFRP_FORCE_OFFLINE__ = true;
    }

    updateOnlineIndicator();

    try {
      if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
        window.OUTBOX.refresh();
      }
    } catch (_) {}
  }

  window.addEventListener("online", () => {
    window.__UFRP_RECONNECTED_AT__ = Date.now();
    verifyOnlineIndicator_();
  });

  window.addEventListener("offline", () => {
    window.__UFRP_FORCE_OFFLINE__ = true;
    updateOnlineIndicator();

    try {
      if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
        window.OUTBOX.refresh();
      }
    } catch (_) {}
  });

  setInterval(() => {
    verifyOnlineIndicator_();
  }, 50000);

  /* =======================================================
   * OFFLINE SYNC HANDLER
   * ======================================================= */
  if (window.__OFFLINE__ && typeof window.__OFFLINE__.setSyncHandler === "function") {
    window.__OFFLINE__.setSyncHandler(async (item) => {
      const p = item && item.payload ? item.payload : null;

      if (!p || !p.formKey || !p.answers) {
        console.warn("Invalid queued payload. Dropping item:", item?.id);
        return true;
      }

      if (!navigator.onLine) {
        throw new Error("آفلاین هستید. ارسال بعداً انجام می‌شود.");
      }

      let sess = null;
      try {
        sess = await gsCall("session_get");
      } catch (_) {}

      if (!sess || !sess.ok || !sess.user || !sess.user.email) {
        try {
          const raw = localStorage.getItem("__UFRP_MENU_CACHE__");
          const cached = raw ? JSON.parse(raw) : null;
          const data = cached && cached.data ? cached.data : null;

          if (data && data.ok && data.email) {
            await gsCall("session_set", {
              email: data.email,
              fullName: data.fullName || ""
            });
            sess = await gsCall("session_get");
          }
        } catch (e) {
          console.warn("Session restore from menu cache failed:", e);
        }
      }

      if ((!sess || !sess.ok || !sess.user || !sess.user.email) && window.APP) {
        try {
          const appEmail =
            String(window.APP?.email || window.APP?.user?.email || "").trim();
          const appFullName =
            String(window.APP?.fullName || window.APP?.user?.fullName || window.APP?.user?.name || "").trim();

          if (appEmail) {
            await gsCall("session_set", {
              email: appEmail,
              fullName: appFullName
            });
            sess = await gsCall("session_get");
          }
        } catch (e) {
          console.warn("Session restore from APP state failed:", e);
        }
      }

      if (!sess || !sess.ok || !sess.user || !sess.user.email) {
        throw new Error("جلسه کاربری معتبر نیست. لطفاً دوباره وارد شوید.");
      }

      const submissionMeta = (p.answers || []).find(a => String(a?.title || "").trim() === "__SubmissionUID");
      const submissionUid = String(submissionMeta?.value || "").trim();
      let localFiles = [];

      if (submissionUid) {
        let snaps = getCapturedFileUploadSnapshot_(submissionUid);

        const hasFileAnswers = (p.answers || []).some(a =>
          String(a?.type || "").trim() === "FILE_UPLOAD"
        );

        if ((!Array.isArray(snaps) || snaps.length === 0) && Array.isArray(p.fileUploadSnapshot)) {
          snaps = p.fileUploadSnapshot;
        }

        if (hasFileAnswers && (!Array.isArray(snaps) || snaps.length === 0)) {
          throw new Error("فایل‌های این ارسال پس از بارگذاری مجدد صفحه دیگر در دسترس نیستند. لطفاً این فرم را دوباره ارسال کنید.");
        }

        const promises = snaps
          .map(s => s && s.queuePromise)
          .filter(pr => pr && typeof pr.then === "function");

        try {
          if (promises.length) {
            await Promise.all(promises);
          }
        } catch (e) {
          console.warn("Captured upload promise failed; retrying upload in background.", e);
        }

        for (const snap of snaps) {
          const items = Array.isArray(snap?.items) ? snap.items : [];

          for (const item of items) {
            if (!item || item.uploadedLocal) continue;

            let file = item.file || null;

            const isRealBinaryFile =
              !!file &&
              (
                (typeof Blob !== "undefined" && file instanceof Blob) ||
                (typeof File !== "undefined" && file instanceof File)
              );

            if (!isRealBinaryFile) {
              file = null;
            }

            if (!file && item.blobId && window.__OFFLINE__ && typeof window.__OFFLINE__.getBlob === "function") {
              try {
                const blobRec = await window.__OFFLINE__.getBlob(item.blobId);
                if (blobRec && blobRec.blob) {
                  file = blobRec.blob;
                  item.file = file;
                }
              } catch (e) {
                console.warn("Blob restore failed:", e);
              }
            }

            if (!file) throw new Error("Local file missing");

            const formData = new FormData();
            formData.append("file", file);
            formData.append("submissionUid", submissionUid);
            formData.append("fieldId", snap.fieldId);
            formData.append("title", snap.title);
            formData.append("blobId", item.blobId);

            const res = await fetch("/api/upload-local.php", {
              method: "POST",
              body: formData,
              credentials: "same-origin"
            });

            if (!res || !res.ok) {
              throw new Error("UPLOAD_TO_SERVER_FAILED");
            }

            const j = await res.json();

            if (!j || !j.ok) {
              throw new Error(j?.error || "UPLOAD_TO_SERVER_FAILED");
            }

            item.uploadedLocal = true;
          }
        }

        localFiles = [];

        for (const snap of snaps) {
          const items = Array.isArray(snap?.items) ? snap.items : [];

          const expectedCount = items.length;
          const readyCount = items.filter(it => it && it.uploadedLocal).length;

          if (expectedCount > 0 && readyCount < expectedCount) {
            throw new Error("فایل‌ها هنوز کامل نشده‌اند. پس از برقراری ارتباط دوباره تلاش می‌شود.");
          }

          localFiles.push({
            fieldId: String(snap?.fieldId || "").trim(),
            title: String(snap?.title || "").trim(),
            items: items.map(it => ({
              blobId: String(it?.blobId || "").trim(),
              name: String((it?.file && it.file.name) || it?.name || "").trim(),
              type: String((it?.file && it.file.type) || it?.type || "application/octet-stream").trim(),
              size: Number((it?.file && it.file.size) || it?.size || 0),
              uploadedLocal: !!it?.uploadedLocal
            }))
          });

          const ans = (p.answers || []).find(a =>
            String(a?.type || "").trim() === "FILE_UPLOAD" &&
            String(a?.title || "").trim() === String(snap?.title || "").trim()
          );

          // Keep any existing Drive links from the browser upload path.
          // If this value is already populated, the on-prem worker can skip
          // a duplicate Google re-upload and reuse the original pending file.
          if (ans && typeof ans.value !== "string") {
            ans.value = String(ans.value || "");
          }
        }
      }

      try {
        if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
          await window.OUTBOX.refresh();
        }
      } catch (_) {}

      const res = await fetch("/api/submit-local.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          formKey: p.formKey,
          submissionUid: submissionUid,
          email: String((sess && sess.user && sess.user.email) || APP.email || "").trim().toLowerCase(),
          fullName: String((sess && sess.user && (sess.user.fullName || sess.user.name)) || APP.fullName || "").trim(),
          answers: p.answers,
          localFiles: localFiles
        })
      }).then(r => r.json());

      console.log("FINAL SUBMIT RESPONSE (ON-PREM):", res);

      if (!res || !res.ok) {
        throw new Error(res?.error || "خطا در ارسال اطلاعات به سرور");
      }

      try {
        const syncUrls = Array.isArray(res?.syncUrls) ? res.syncUrls : [];
        const spreadsheetId = String(res?.destSpreadsheetId || "").trim();
        const responsesSheetName = String(res?.destSheetName || "").trim();
        const syncUrlsStatus = String(res?.syncUrlsStatus || "").trim();

        if (
          syncUrlsStatus === "Enabled" &&
          syncUrls.length &&
          spreadsheetId &&
          responsesSheetName &&
          submissionUid
        ) {
          const NEW_SYNC_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwWUAoAFSKfZnN6qqQ92ahDqQzkNvShkFr2j5SlHEMZqNMFhGjUAggM3ua2xMW8kLC-/exec";
          const destUrlCols = String(syncUrls[0]?.DestUrlCols || "").trim();

          const targets = syncUrls.map(r => ({
            SyncTab: String(r.SyncTab || "").trim(),
            SyncHeaderRow: Number(r.SyncHeaderRow || 0),
            SyncUrlCols: String(r.SyncUrlCols || "").trim(),
            SyncUidCol: String(r.SyncUidCol || "").trim(),
            DestUidCol: String(r.DestUidCol || "").trim()
          }));

          fetch("/api/proxy.php", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              url: NEW_SYNC_WEBAPP_URL,
              method: "POST",
              body: {
                spreadsheetId: spreadsheetId,
                responsesSheetName: responsesSheetName,
                submissionUid: submissionUid,
                destUrlCols: destUrlCols,
                targets: targets
              }
            })
          }).catch(err => {
            console.warn("New sync webhook failed:", err);
          });
        }
      } catch (e) {
        console.warn("New sync webhook setup failed:", e);
      }

      if (submissionUid) {
        try {
          delete window.__UFRP_FILE_JOB_REGISTRY__[submissionUid];
        } catch (_) {}
      }

      try {
        if (window.OUTBOX && typeof window.OUTBOX.refresh === "function") {
          await window.OUTBOX.refresh();
        }
      } catch (_) {}

      return true;
    });
  }

  /* =======================================================
   * MENU LOAD
   * IMPORTANT AUTH NOTE:
   * - Main browser auth is now PHP-based
   * - This frontend still syncs proxy.php session as needed
   * - One key transition line now uses:
   *     window.__UFRP_USER_EMAIL__
   * ======================================================= */
  setStatus("در حال بارگذاری", true);

  let res;

  try {
    if (!navigator.onLine) {
      const cachedMenu = await tryReadCachedMenu_(false);
      if (cachedMenu && cachedMenu.ok) {
        console.warn("Using cached menu before network fetch (offline) ✅");
        res = cachedMenu;
      } else {
        throw new Error("__OFFLINE__");
      }
    }

    const sess = (!res && navigator.onLine) ? await gsCall("session_get") : null;

    if (sess && sess.ok && sess.user && sess.user.email) {
      res = await fetch("/api/menu.php", {
        method: "GET",
        credentials: "include",
        cache: "no-store"
      }).then(r => r.json());

      try {
        await persistMenuCache_(res);
      } catch (cacheErr) {
        console.warn("Menu cache failed:", cacheErr);
      }

    } else {
      try {
        const raw = localStorage.getItem("__UFRP_MENU_CACHE__");
        const cached = raw ? JSON.parse(raw) : null;
        const data = cached && cached.data ? cached.data : null;

        if (navigator.onLine) {
          if (data && data.ok && data.email) {
            try {
              await gsCall("session_set", { email: data.email, fullName: data.fullName || "" });
              console.log("Session restored from cached menu ✅", data.email);
            } catch (e) {
              console.warn("Session restore failed ⚠️", e?.message || e);
            }

            /* =================================================
             * AUTH TRANSITION LINE
             * OLD:
             *   res = await gsCall("app_getMenuForEmail", data.email);
             * NEW:
             *   res = await gsCall("app_getMenuForEmail", window.__UFRP_USER_EMAIL__);
             * ================================================= */
            res = await fetch("/api/menu.php", {
              method: "GET",
              credentials: "include",
              cache: "no-store"
            }).then(r => r.json());

            try {
              await persistMenuCache_(res);
              console.log("Menu cached ✅");
            } catch (cacheErr) {
              console.warn("Menu cache failed:", cacheErr);
            }

          } else {
            setStatus("در حال انتقال به صفحه ورود...", true);
            window.location.href = "/login.php";
            return;
          }

        } else {
          if (data && data.ok) {
            console.warn("Using cached menu (offline) ✅", cached?.savedAt || "");
            setStatus("", false);
            res = data;
          } else {
            setStatus("Redirecting to local login...", true);
            window.location.href = "/login.php";
            return;
          }
        }

      } catch (err) {
        console.error(err);
        setStatus("Redirecting to local login...", true);
        window.location.href = "/login.php";
        return;
      }
    }

  } catch (e) {
    console.warn("Menu fetch failed. Trying cache...", e);

    try {
      const data = await tryReadCachedMenu_(false);

      if (data && data.ok) {
        console.warn("Using cached menu (offline/fallback) ✅");
        res = data;
      } else {
        setStatus("خطا در دریافت منو (کش موجود نیست)", false);
        return;
      }
    } catch (err) {
      console.error(err);
      setStatus("خطا در دریافت منو (خواندن کش ناموفق بود)", false);
      return;
    }
  }

  if (!res || !res.ok) {
    setStatus(res?.error || "خطا در دریافت منو", false);
    return;
  }

  APP.email    = (res.email || "").trim();
  APP.fullName = (res.fullName || "").trim();
  APP.menu     = res.menu || [];

  try {
    const prof = await gsCall("app_getCurrentUserProfile");
    if (prof && prof.ok && (prof.fullName || "").trim()) {
      APP.fullName = (prof.fullName || "").trim();
    }
  } catch (_) {}

  const nameEl = qs("#userFullName");
  if (nameEl) {
    console.log("[UFRP] write #userFullName", {
      APP_fullName: APP.fullName,
      APP_email: APP.email,
      willWrite: (APP.fullName || APP.email || "")
    });

    nameEl.textContent = (APP.fullName || APP.email || "");
    console.log("[UFRP] after write #userFullName:", nameEl.textContent);
  }

  const requiredUpdateScheduled = await checkForRequiredAppUpdateOnMenuLoad_();
  if (requiredUpdateScheduled) {
    return;
  }

  renderMenu(APP.menu);

  if (window.__UFRP_PREFETCH_RESTORED_FROM_MANIFEST__) {
    showCachedManifestChip_();
  } else {
    showMenuReadyChip_();
  }

  setStatus("", false);

  /* =======================================================
   * PREFETCH REGISTRY
   * ======================================================= */
  try {
    const allForms = flattenMenuForms(APP.menu);
    const keys = Array.from(new Set(
      (allForms || [])
        .map(f => String(f.formKey || "").trim())
        .filter(Boolean)
    ));

    window.__UFRP_ALL_FORM_KEYS__ = keys;
    console.log("UFRP formKeys collected ✅ count =", keys.length, keys);
  } catch (e) {
    console.warn("UFRP formKeys collect failed:", e);
    window.__UFRP_ALL_FORM_KEYS__ = [];
  }

  (function startBackgroundPrefetchBundles() {
    try {
      const keys = Array.isArray(window.__UFRP_ALL_FORM_KEYS__) ? window.__UFRP_ALL_FORM_KEYS__ : [];
      if (!keys.length) return;

      if (!navigator.onLine) {
        console.log("Prefetch skipped (offline) ✅");
        return;
      }

      if (window.__UFRP_PREFETCH_RESTORED_FROM_MANIFEST__) {
        console.log("Prefetch skipped (persistent cache manifest restored) ✅");
        return;
      }

      if (window.__UFRP_PREFETCH_RUNNING__) return;
      window.__UFRP_PREFETCH_RUNNING__ = true;

      console.log("Prefetch starting ✅ forms =", keys.length);
      showPrefetchProgress_(0, keys.length);

      setTimeout(async () => {
        let ok = 0, fail = 0;
        let doneCount = 0;

        try {
          const sess = await gsCall("session_get");
          if (!sess || !sess.ok || !sess.user || !sess.user.email) {
            console.warn("Prefetch skipped (no session) ✅");
            return;
          }

          for (const k of keys) {
            if (!navigator.onLine) {
              console.warn("Prefetch stopped (went offline) ⚠️");
              break;
            }

            const alreadyBundleFresh = sessionStorage.getItem("__UFRP_SESSION_BUNDLE_REFRESHED__:" + k) === "1";
            const alreadyOptionsFresh = sessionStorage.getItem("__UFRP_SESSION_OPTIONS_REFRESHED__:" + k) === "1";

            if (alreadyBundleFresh && alreadyOptionsFresh) {
              doneCount++;
              showPrefetchProgress_(doneCount, keys.length);
              console.log("Prefetch skipped (already refreshed this session) ✅", k);
              continue;
            }

            const cacheKey = "__UFRP_BUNDLE_CACHE__:" + k;

            if (!navigator.onLine && localStorage.getItem(cacheKey)) {
              doneCount++;
              showPrefetchProgress_(doneCount, keys.length);
              continue;
            }

            try {
              const bundleRes = await fetch("/api/form-bundle.php?formKey=" + encodeURIComponent(k), {
                method: "GET",
                credentials: "include",
                cache: "no-store"
              }).then(r => r.json());

              if (bundleRes && bundleRes.ok) {
                localStorage.setItem(
                  cacheKey,
                  JSON.stringify({
                    savedAt: new Date().toISOString(),
                    data: bundleRes
                  })
                );

                try {
                  if (window.__OFFLINE__ && typeof window.__OFFLINE__.cachePut === "function") {
                    await window.__OFFLINE__.cachePut("bundle:" + k, "bundle", bundleRes);
                  }
                } catch (idbErr) {
                  console.warn("Prefetch IDB cache failed ❌", k, idbErr);
                }

                try {
                  const optRes = await fetch("/api/form-options.php?formKey=" + encodeURIComponent(k), {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store"
                  }).then(r => r.json());

                  if (optRes && optRes.ok && window.__OFFLINE__ && typeof window.__OFFLINE__.cachePut === "function") {
                    await window.__OFFLINE__.cachePut("options:" + k, "options", optRes);
                    sessionStorage.setItem("__UFRP_SESSION_OPTIONS_REFRESHED__:" + k, "1");
                    console.log("Prefetch options cached ✅", k, "rows:", Array.isArray(optRes.rows) ? optRes.rows.length : 0);
                  } else {
                    console.warn("Prefetch options skipped ⚠️", k, optRes?.error || "no ok");
                  }
                } catch (optErr) {
                  console.warn("Prefetch options failed ❌", k, optErr?.message || optErr);
                }

                ok++;
                sessionStorage.setItem("__UFRP_SESSION_BUNDLE_REFRESHED__:" + k, "1");
                console.log("Prefetch cached ✅", k);
              } else {
                fail++;
                console.warn("Prefetch failed ❌", k, bundleRes?.error || "no ok");
              }

            } catch (e) {
              fail++;
              console.warn("Prefetch error ❌", k, e?.message || e);
            }

            doneCount++;
            showPrefetchProgress_(doneCount, keys.length);
            await new Promise(r => setTimeout(r, 150));
          }

        } catch (e) {
          console.warn("Prefetch bootstrap failed:", e?.message || e);
        } finally {
          try {
            if (fail === 0 && doneCount === keys.length) {
              localStorage.setItem("__UFRP_PREFETCH_MANIFEST__", JSON.stringify({
                complete: true,
                userEmail: String(APP.email || window.__UFRP_USER_EMAIL__ || "").trim().toLowerCase(),
                formKeys: keys.map(k => String(k || "").trim()).filter(Boolean),
                updatedAt: new Date().toISOString()
              }));
              console.log("Prefetch manifest saved ✅", keys.length);
            } else {
              localStorage.removeItem("__UFRP_PREFETCH_MANIFEST__");
            }
          } catch (manifestErr) {
            console.warn("Prefetch manifest write failed:", manifestErr);
          }

          finishPrefetchProgress_(ok, fail, keys.length);
          console.log("Prefetch finished ✅ ok =", ok, "fail =", fail);
          window.__UFRP_PREFETCH_RUNNING__ = false;
        }
      }, 0);

    } catch (e) {
      console.warn("Prefetch outer failed:", e?.message || e);
      window.__UFRP_PREFETCH_RUNNING__ = false;
    }
  })();

  const forcedKey = (window.__INITIAL_FORM_KEY__ || "").trim();
  if (forcedKey) {
    showForm(forcedKey)
      .then(() => { try { setStatus("", false); } catch (_) {} })
      .catch((e) => console.error("showForm(forcedKey) failed:", e));
    return;
  }

  flattenMenuForms(APP.menu);
  showMenuView();

  (async () => {
    try {
      const res = await gsCall("app_listAllPendingUploadedFilesForCurrentUser");
      if (!res || !res.ok || !Array.isArray(res.items)) return;

      const activeUids = new Set();

      try {
        const currentDraftUid = _getOrCreateDraftSubmissionUid_();
        if (currentDraftUid) activeUids.add(String(currentDraftUid).trim());
      } catch (_) {}

      try {
        if (window.__OFFLINE__ && typeof window.__OFFLINE__.getQueue === "function") {
          const qItems = await window.__OFFLINE__.getQueue();
          (qItems || []).forEach(q => {
            const uid =
              String(q?.payload?.submissionUid || "").trim() ||
              String(
                ((q?.payload?.answers || []).find(a => String(a?.title || "").trim() === "__SubmissionUID") || {}).value || ""
              ).trim();

            if (uid) activeUids.add(uid);
          });
        }
      } catch (e) {
        console.warn("Startup cleanup could not read local queue:", e);
      }

      const staleItems = (res.items || []).filter(it => {
        const uid = String(it?.pendingUid || "").trim();
        if (!uid) return false;
        return !activeUids.has(uid);
      });

      for (const it of staleItems) {
        try {
          await gsCall(
            "app_deletePendingUploadedFileForCurrentUser",
            it.formKey,
            String(it.fieldFolderName || "").replace(/\s*\(File responses\)\s*$/i, ""),
            "https://drive.google.com/file/d/" + it.fileId + "/view"
          );
        } catch (e) {
          console.warn("Startup pending cleanup failed:", it.fileId, e);
        }
      }

      if (staleItems.length) {
        console.log("Safe startup cleanup removed pending files:", staleItems.length);
      }
    } catch (e) {
      console.warn("Startup cleanup error:", e);
    }
  })();

  setStatus("", false);
}

/* =========================================================
 * PUBLIC EXPORTS
 * ========================================================= */
window.appInit = appInit;
window.showForm = showForm;
window.backToMenu = backToMenu;
window.clearForm = clearForm;

/* =========================================================
 * SAFE BOOT
 * ========================================================= */
function safeBoot() {
  try {
    bindPickerDom();
    bindAppRefreshUI_();
    bindKeyboardAwareFocusedFieldVisibility_();
  } catch (e) {
    console.error("Client boot error:", e);
    try { setStatus("خطای داخلی در کلاینت", false); } catch (_) {}
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", safeBoot);
} else {
  safeBoot();
}

})();