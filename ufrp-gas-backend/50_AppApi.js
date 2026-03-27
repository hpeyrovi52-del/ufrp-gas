/**
 * 50_AppApi.gs
 * Public APIs called from Client.js
 * Depends on:
 *  - registryReadAll_() in 20_RegistryRead.gs
 *  - access_buildMenuForEmail_() in 30_AccessControl.gs
 *  - formOptions_getForFormKey_() in 40_FormOptions.gs
 *
 * IMPORTANT:
 * - In Hostwinds app mode, actual app identity must come ONLY from proxy.php sessionUser.
 * - For GAS auth popup page only, we allow reading Google identity from Session.getActiveUser()
 *   so the popup can detect who logged in and send that email back to Hostwinds.
 */

/** Internal helper: normalize email for matching */
function _normEmail_(s) {
  return String(s || "").trim().toLowerCase();
}

/** Internal helper: find user's full name from registry Users tab */
function _getFullNameForEmail_(reg, email) {
  const e = _normEmail_(email);
  if (!e) return "";

  const users = Array.isArray(reg && reg.users) ? reg.users : [];
  const row = users.find(u => {
    const uEmail = _normEmail_(u.userEmail || u.email || u.UserEmail || u.Email || "");
    return uEmail === e;
  });

  if (!row) return "";

  const name =
    row.fullName ||
    row.FullName ||
    row.fullNameFa ||
    row.FullNameFa ||
    row.name ||
    row.Name ||
    "";

  return String(name || "").trim();
}

/**
 * Current user email
 *
 * Priority:
 * 1) proxy.php session user (normal Hostwinds app requests)
 * 2) Session.getActiveUser() (GAS auth popup only)
 * 3) blank
 */
function app_getCurrentUserEmail_() {
  try {
    // 1) Normal Hostwinds proxied requests
    if (globalThis.__SESSION_USER__ && globalThis.__SESSION_USER__.email) {
      return String(globalThis.__SESSION_USER__.email || "").trim().toLowerCase();
    }

    // 2) GAS auth popup route only
    try {
      const active = Session.getActiveUser();
      const email = active && active.getEmail
        ? String(active.getEmail() || "").trim().toLowerCase()
        : "";
      if (email) return email;
    } catch (e1) {}

    return "";
  } catch (e) {
    return "";
  }
}

/**
 * STRICT session user for actual app access
 * Never fall back to ActiveUser / EffectiveUser here.
 */
function _getStrictSessionUserEmail_() {
  try {
    if (globalThis.__SESSION_USER__ && globalThis.__SESSION_USER__.email) {
      return String(globalThis.__SESSION_USER__.email || "").trim().toLowerCase();
    }
    return "";
  } catch (e) {
    return "";
  }
}

/**
 * Menu for CURRENT user
 * Returns: { ok, email, fullName, menu }
 *
 * IMPORTANT:
 * - Uses ONLY proxy session identity.
 */
function app_getMenuForCurrentUser() {
  try {
    const email = _getStrictSessionUserEmail_();

    if (!email) {
      return {
        ok: false,
        error: "No authenticated session user.",
        email: "",
        fullName: "",
        menu: []
      };
    }

    const reg = registryReadAll_();
    const menu = access_buildMenuForEmail_(email, reg);
    const fullName = _getFullNameForEmail_(reg, email);

    return {
      ok: true,
      email: email,
      fullName: fullName,
      menu: menu
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      email: "",
      fullName: "",
      menu: []
    };
  }
}

/**
 * Menu for a SPECIFIC email
 * Returns: { ok, email, fullName, menu }
 */
function app_getMenuForEmail(email) {
  email = _normEmail_(email);

  if (!email) {
    return {
      ok: false,
      error: "email is required.",
      email: "",
      fullName: "",
      menu: []
    };
  }

  const reg = registryReadAll_();
  const menu = access_buildMenuForEmail_(email, reg);
  const fullName = _getFullNameForEmail_(reg, email);

  return {
    ok: true,
    email: email,
    fullName: fullName,
    menu: menu
  };
}

/**
 * Returns current logged-in user's profile info.
 * Returns: { ok, email, fullName }
 *
 * IMPORTANT:
 * - Uses ONLY proxy session identity for app profile.
 */
function app_getCurrentUserProfile() {
  const email = _getStrictSessionUserEmail_();

  if (!email) {
    return {
      ok: false,
      error: "No authenticated session user."
    };
  }

  const reg = registryReadAll_();
  const fullName = _getFullNameForEmail_(reg, email);

  return {
    ok: true,
    email: email,
    fullName: fullName
  };
}

/**
 * Internal helper: read Google Form question titles for matching Options headers.
 * Returns: { ok, all:[], list:[], multipleChoice:[], error? }
 */
function _getFormQuestionTitles_(sourceFormId) {
  const out = { ok: true, all: [], list: [], multipleChoice: [] };
  const id = String(sourceFormId || "").trim();
  if (!id) return out;

  try {
    const gForm = FormApp.openById(id);
    const items = gForm.getItems();
    const all = [];
    const list = [];
    const mc = [];

    items.forEach(it => {
      const t = String(it.getTitle() || "").trim();
      if (!t) return;

      all.push(t);

      const type = it.getType();
      if (type === FormApp.ItemType.LIST) list.push(t);
      if (type === FormApp.ItemType.MULTIPLE_CHOICE) mc.push(t);
    });

    out.all = Array.from(new Set(all));
    out.list = Array.from(new Set(list));
    out.multipleChoice = Array.from(new Set(mc));
    return out;
  } catch (e) {
    return {
      ok: false,
      all: [],
      list: [],
      multipleChoice: [],
      error: String(e && e.message ? e.message : e)
    };
  }
}

function _menuContainsFormKey_(menu, formKey) {
  if (!Array.isArray(menu)) return false;

  for (const center of menu) {
    const forms = Array.isArray(center.forms) ? center.forms : [];
    for (const f of forms) {
      if (String(f.formKey || "").trim() === String(formKey || "").trim()) {
        return true;
      }
    }
  }

  return false;
}

/** Optional health check */
function app_ping() {
  return {
    ok: true,
    now: new Date().toISOString(),
    currentUserEmail: app_getCurrentUserEmail_(),
    strictSessionUserEmail: _getStrictSessionUserEmail_()
  };
}