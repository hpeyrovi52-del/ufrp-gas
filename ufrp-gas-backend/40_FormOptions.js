/**
 * 40_FormOptions.gs
 * Reads options for a given formKey using the form row in the registry (Forms tab).
 *
 * Expected columns in Forms tab include:
 * - formKey
 * - optionsSsId
 * - optionsTabName
 */

function formOptions_getForFormKey_(formKey, reg) {
  formKey = String(formKey || "").trim();
  if (!formKey) return { ok: false, error: "formKey is required.", rows: [] };

  const forms = reg && Array.isArray(reg.forms) ? reg.forms : [];
  const form = forms.find(f => String(f.formKey || "").trim() === formKey);

  if (!form) {
    return { ok: false, error: "Form not found in registry forms.", rows: [] };
  }

  const optionsSsId = String(form.optionsSsId || "").trim();
  const optionsTabName = String(form.optionsTabName || "").trim();

  // If a form has no options sheet, return empty.
  if (!optionsSsId || !optionsTabName) {
    return { ok: true, source: null, rows: [] };
  }

  const oss = SpreadsheetApp.openById(optionsSsId);
  const sh = oss.getSheetByName(optionsTabName);
  if (!sh) {
    return {
      ok: false,
      error: `Options tab not found: ${optionsTabName}`,
      source: { optionsSsId, optionsTabName },
      rows: []
    };
  }

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) {
    return { ok: true, source: { optionsSsId, optionsTabName }, rows: [] };
  }

  const headers = values[0].map(h => String(h || "").trim());
  const rows = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const isEmpty = row.every(v => String(v || "").trim() === "");
    if (isEmpty) continue;

    const obj = {};
    headers.forEach((h, c) => {
      if (!h) return;
      obj[h] = row[c];
    });
    rows.push(obj);
  }

  return { ok: true, source: { optionsSsId, optionsTabName }, rows };
}

/**
 * Public API: returns dropdown options rows for a formKey (access-controlled)
 * Uses:
 * - registryReadAll_()
 * - access_buildMenuForEmail_()
 * - _menuContainsFormKey_()
 * - app_getCurrentUserEmail_()
 * - formOptions_getForFormKey_()
 */
function app_getFormOptionsForCurrentUser(formKey) {
  try {
    formKey = String(formKey || "").trim();
    if (!formKey) return { ok: false, error: "formKey is required.", rows: [] };

    const email = app_getCurrentUserEmail_();
    if (!email) {
      return {
        ok: false,
        error:
          "Could not detect your Google account email. " +
          "Deploy web app as 'Execute as: User accessing the web app'.",
        rows: []
      };
    }

    const reg = registryReadAll_();
    const menu = access_buildMenuForEmail_(email, reg);

    if (!_menuContainsFormKey_(menu, formKey)) {
      return { ok: false, error: "Access denied for this form.", email, formKey, rows: [] };
    }

    // Use the helper you already have
    const res = formOptions_getForFormKey_(formKey, reg);
    if (!res || !res.ok) {
      return { ok: false, error: res?.error || "Failed to load options.", source: res?.source || null, rows: [] };
    }

    return {
      ok: true,
      email,
      formKey,
      source: res.source || null,
      rows: Array.isArray(res.rows) ? res.rows : []
    };
  } catch (err) {
    return {
      ok: false,
      error: "SERVER_EXCEPTION: " + (err && err.stack ? err.stack : String(err)),
      rows: []
    };
  }
}