/**
 * 30_AccessControl.gs
 *
 * Builds allowed menu for a user based on:
 * - Users tab (Enabled/Disabled)
 * - Access tab (Enabled/Disabled per (center, formKey) or per center for all forms)
 *
 * IMPORTANT RULES:
 * - If Access row has TransactionCenterKey set AND formKey is blank => user gets ALL forms in that center.
 * - If Access row has TransactionCenterKey + formKey => user gets that specific form only.
 * - NEW: If Access row has BOTH TransactionCenterKey blank AND formKey blank => user gets ALL centers + ALL forms.
 */
function access_buildMenuForEmail_(email, reg) {
  email = String(email || "").trim().toLowerCase();
  if (!email) return [];

  const centers = Array.isArray(reg.centers) ? reg.centers : [];
  const forms   = Array.isArray(reg.forms) ? reg.forms : [];
  const users   = Array.isArray(reg.users) ? reg.users : [];
  const access  = Array.isArray(reg.access) ? reg.access : [];

  // ---- 1) user must exist + be enabled ----
  const userRow = users.find(u =>
    String(u.userEmail || "").trim().toLowerCase() === email
  );
  if (!userRow) return [];
  if (String(userRow.AccessStatus || "").trim().toLowerCase() !== "enabled") return [];

  // ---- 2) create center lookup for names ----
  const centerByKey = {};
  centers.forEach(c => {
    const key = String(c.TransactionCenterKey || "").trim();
    if (!key) return;
    centerByKey[key] = {
      TransactionCenterKey: key,
      TransactionCenterNameFa: String(c.TransactionCenterNameFa || "").trim()
    };
  });

  // ---- 3) collect allowed access rules for this email ----
  let hasGlobalAccess = false;                 // NEW: if true => all centers + all forms
  const allowedAllFormsByCenter = new Set();   // centerKey => all forms allowed
  const allowedFormsByCenter = new Map();      // centerKey => Set(formKey)

  access.forEach(a => {
    const aEmail = String(a.userEmail || "").trim().toLowerCase();
    if (aEmail !== email) return;

    const status = String(a.AccessStatus || "").trim().toLowerCase();
    if (status !== "enabled") return;

    const centerKey = String(a.TransactionCenterKey || "").trim();
    const formKey   = String(a.formKey || "").trim();

    // NEW: Global access row => both empty
    if (!centerKey && !formKey) {
      hasGlobalAccess = true;
      return;
    }

    // Existing behavior (must have centerKey for scoped access)
    if (!centerKey) return;

    // If formKey blank => allow all forms in this center
    if (!formKey) {
      allowedAllFormsByCenter.add(centerKey);
      return;
    }

    // Else allow only that one formKey
    if (!allowedFormsByCenter.has(centerKey)) allowedFormsByCenter.set(centerKey, new Set());
    allowedFormsByCenter.get(centerKey).add(formKey);
  });

  // ---- 4) build menu, preserving center order from TransactionCenter tab ----
  const menu = [];

  centers.forEach(c => {
    const centerKey = String(c.TransactionCenterKey || "").trim();
    if (!centerKey) return;

    const allowAll = hasGlobalAccess || allowedAllFormsByCenter.has(centerKey);
    const allowSet = allowedFormsByCenter.get(centerKey) || new Set();

    // If user has no permission for this center at all, skip it
    if (!allowAll && allowSet.size === 0) return;

    // Choose forms for this center based on permissions
    const centerForms = forms
      .filter(f => String(f.TransactionCenterKey || "").trim() === centerKey)
      .filter(f => {
        const fk = String(f.formKey || "").trim();
        if (!fk) return false;
        if (allowAll) return true;
        return allowSet.has(fk);
      })
      .map(f => ({
        formKey: String(f.formKey || "").trim(),
        formNameFa: String(f.formNameFa || "").trim()
      }));

    if (centerForms.length === 0) return;

    // Attach TransactionCenterNameFa from master centers tab
    const centerInfo = centerByKey[centerKey] || {
      TransactionCenterKey: centerKey,
      TransactionCenterNameFa: ""
    };

    menu.push({
      TransactionCenterKey: centerInfo.TransactionCenterKey,
      TransactionCenterNameFa: centerInfo.TransactionCenterNameFa || centerKey,
      forms: centerForms
    });
  });

  return menu;
}

/**
 * Optional debug helper:
 * Run from editor after changing Access tab.
 */
function test_myAccess() {
  const email = "hamed@peyrovi.com"; // change anytime
  const reg = registryReadAll_();
  const menu = access_buildMenuForEmail_(email, reg);
  console.log(JSON.stringify(menu, null, 2));
  return menu;
}