/**
 * 20_RegistryRead.gs
 * Reads Master Financial Recording Registry
 *
 * Requires in 00_Config.gs:
 * const MASTER_REGISTRY_ID = "YOUR_MASTER_REGISTRY_ID";
 *
 * Tabs required in the Master sheet:
 * - TransactionCenter
 * - Forms
 * - Users
 * - Access
 * - SycUrls
 */

/**
 * Reads all registry tabs and returns normalized structure.
 * IMPORTANT: name ends with underscore because other files call registryReadAll_()
 *
 * Added:
 * - syncUrls: reads the SycUrls tab so other GAS files can collect
 *   per-form sync/URL formatting configuration.
 */
function registryReadAll_() {
  const ss = SpreadsheetApp.openById(MASTER_REGISTRY_ID);

  const centers  = registryReadTab_(ss, "TransactionCenter");
  const forms    = registryReadTab_(ss, "Forms");
  const users    = registryReadTab_(ss, "Users");
  const access   = registryReadTab_(ss, "Access");
  const syncUrls = registryReadTab_(ss, "SycUrls");

  return { centers, forms, users, access, syncUrls };
}

/**
 * Reads a sheet tab as array of objects.
 * Row 1 = headers
 * Row 2+ = data
 * Empty rows are skipped.
 *
 * Key fix:
 * - Header normalization removes invisible characters (NBSP, zero-width, BOM)
 * - Prevents cases where a header exists visually but fails in code
 */
function registryReadTab_(ss, tabName) {
  const sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error("Registry tab not found: " + tabName);

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  // Normalize header text hard (removes invisible chars + trims)
  const normHeader_ = (h) => {
    return String(h || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars + BOM
      .replace(/\u00A0/g, " ")               // NBSP -> normal space
      .trim();
  };

  const headers = values[0].map(normHeader_);
  const out = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];

    // Skip completely empty rows
    const isEmpty = row.every(v => String(v ?? "").trim() === "");
    if (isEmpty) continue;

    const obj = {};
    headers.forEach((h, c) => {
      if (!h) return; // ignore empty header cells
      obj[h] = row[c];
    });

    out.push(obj);
  }

  return out;
}

/**
 * Simple debug function to verify registry works.
 * Run this manually from dropdown.
 */
function debug_registryReadAll() {
  const reg = registryReadAll_();

  console.log("TransactionCenters:", reg.centers.length);
  console.log("Forms:", reg.forms.length);
  console.log("Users:", reg.users.length);
  console.log("Access:", reg.access.length);
  console.log("SycUrls:", reg.syncUrls.length);

  if (reg.centers[0]) console.log("First center:", reg.centers[0]);
  if (reg.forms[0]) console.log("First form:", reg.forms[0]);
  if (reg.syncUrls[0]) console.log("First syncUrls row:", reg.syncUrls[0]);
}