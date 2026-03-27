/**
 * 54_FormBundle.gs
 * Minimal bundle endpoint used by client prefetch:
 * - returns schema + a little metadata in one call
 * - never throws
 *
 * Added:
 * - syncUrls: rows from Master Registry tab "SycUrls" filtered by formKey
 *   so the frontend/backend can later forward them to the standalone sync web app.
 */
function app_getFormBundleForCurrentUser(formKey) {
  try {
    formKey = String(formKey || "").trim();
    if (!formKey) return { ok: false, error: "کلید فرم نامعتبر است." };

    // Reuse your existing schema function (source of truth)
    const schemaRes = app_getFormSchemaForCurrentUser(formKey);
    if (!schemaRes || !schemaRes.ok) {
      return schemaRes || { ok: false, error: "خطا در دریافت ساختار فرم." };
    }

    // Build extra metadata from registry
    let formNameFa = "";
    let syncUrls = [];

    try {
      const reg = registryReadAll_();

      const row = (reg && reg.forms ? reg.forms : []).find(
        f => String(f.formKey || "").trim() === formKey
      );
      if (row) {
        formNameFa = String(row.formNameFa || row.titleFa || row.nameFa || "").trim();
      }

      // Collect all SyncUrls rows for this formKey
      syncUrls = (reg && reg.syncUrls ? reg.syncUrls : []).filter(
        r => String(r.formKey || "").trim() === formKey
      );

    } catch (_) {
      // keep optional fields empty if registry read fails
    }

    // Return bundle expected by client cache + include form metadata + sync config
    return {
      ok: true,
      formKey: schemaRes.formKey,
      email: schemaRes.email,
      sourceFormId: schemaRes.sourceFormId,
      schema: schemaRes.schema,

      // Metadata so UI can show Persian name
      form: {
        formKey: schemaRes.formKey,
        formNameFa: formNameFa
      },

      // New: sync URL config rows from registry
      syncUrls: syncUrls
    };

  } catch (e) {
    return { ok: false, error: "خطای داخلی سرور." };
  }
}