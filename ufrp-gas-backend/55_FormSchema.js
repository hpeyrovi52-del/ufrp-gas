/**
 * 55_FormSchema.gs (SAFE + NO asFileUploadItem)
 * - Never throws
 * - Supports FILE_UPLOAD without calling it.asFileUploadItem()
 */
function app_getFormSchemaForCurrentUser(formKey) {
  try {
    formKey = String(formKey || "").trim();
    if (!formKey) return { ok: false, error: "formKey is required." };

    const email = app_getCurrentUserEmail_();
    if (!email) {
      return {
        ok: false,
        error:
          "Could not detect your Google account email. " +
          "Deploy web app as 'Execute as: User accessing the web app'."
      };
    }

    const reg = registryReadAll_();

    const menu = access_buildMenuForEmail_(email, reg);
    if (!_menuContainsFormKey_(menu, formKey)) {
      return { ok: false, error: "Access denied for this form.", email, formKey };
    }

    const formRow = (reg.forms || []).find(f => String(f.formKey || "").trim() === formKey);
    if (!formRow) return { ok: false, error: "Form not found in registry.", formKey };

    const sourceFormId = String(formRow.sourceFormId || "").trim();
    if (!sourceFormId) return { ok: false, error: "sourceFormId missing for this formKey.", formKey };

    let form;
    try {
      form = FormApp.openById(sourceFormId);
    } catch (e) {
      return {
        ok: false,
        error:
          "Failed to open Google Form. Check sourceFormId + permissions. Details: " +
          (e && e.message ? e.message : String(e)),
        sourceFormId
      };
    }

    const items = form.getItems();
    const schema = [];

    for (const it of items) {
      const itemType = it.getType();
      const title = String(it.getTitle() || "").trim();
      if (!title) continue;

      const supported =
        itemType === FormApp.ItemType.TEXT ||
        itemType === FormApp.ItemType.PARAGRAPH_TEXT ||
        itemType === FormApp.ItemType.LIST ||
        itemType === FormApp.ItemType.MULTIPLE_CHOICE ||
        itemType === FormApp.ItemType.DATE ||
        itemType === FormApp.ItemType.DATETIME ||
        itemType === FormApp.ItemType.TIME ||
        itemType === FormApp.ItemType.FILE_UPLOAD;

      if (!supported) continue;

      const typeStr = _schema_typeToString_(itemType);
      const base = {
        itemId: it.getId(),
        title,
        type: typeStr,
        required: false
      };

      if (itemType === FormApp.ItemType.TEXT) {
        base.required = it.asTextItem().isRequired();
      } else if (itemType === FormApp.ItemType.PARAGRAPH_TEXT) {
        base.required = it.asParagraphTextItem().isRequired();
      } else if (itemType === FormApp.ItemType.LIST) {
        base.required = it.asListItem().isRequired();
        base.fromOptions = true;
      } else if (itemType === FormApp.ItemType.MULTIPLE_CHOICE) {
  const q = it.asMultipleChoiceItem();
  base.required = q.isRequired();
  base.choices = q.getChoices().map(c => c.getValue());
  base.fromOptions = false;

  // ✅ Support Google Forms "Other" option
  try { base.hasOther = !!q.hasOtherOption(); } catch (e) { base.hasOther = false; }
} else if (itemType === FormApp.ItemType.DATE) {
        base.required = it.asDateItem().isRequired();
      } else if (itemType === FormApp.ItemType.DATETIME) {
        base.required = it.asDateTimeItem().isRequired();
      } else if (itemType === FormApp.ItemType.TIME) {
        base.required = it.asTimeItem().isRequired();
      } else if (itemType === FormApp.ItemType.FILE_UPLOAD) {
        // IMPORTANT:
        // We intentionally do NOT call it.asFileUploadItem()
        // because in some environments it's not available.
        // We only need to render a file input in the UI.
        base.required = _safeIsRequired_(it);
        base.fromOptions = false;
        // optional safe metadata placeholders
        base.allowsMultiple = false;
      }

      schema.push(base);
    }

    return { ok: true, email, formKey, sourceFormId, schema };

  } catch (err) {
    return {
      ok: false,
      error: "SERVER_EXCEPTION: " + (err && err.stack ? err.stack : String(err))
    };
  }
}

function _schema_typeToString_(itemType) {
  if (itemType === FormApp.ItemType.TEXT) return "TEXT";
  if (itemType === FormApp.ItemType.PARAGRAPH_TEXT) return "PARAGRAPH_TEXT";
  if (itemType === FormApp.ItemType.LIST) return "LIST";
  if (itemType === FormApp.ItemType.MULTIPLE_CHOICE) return "MULTIPLE_CHOICE";
  if (itemType === FormApp.ItemType.DATE) return "DATE";
  if (itemType === FormApp.ItemType.DATETIME) return "DATETIME";
  if (itemType === FormApp.ItemType.TIME) return "TIME";
  if (itemType === FormApp.ItemType.FILE_UPLOAD) return "FILE_UPLOAD";
  return "UNKNOWN";
}

/**
 * Safely tries to detect "required" for any item without crashing.
 * (File upload item lacks asFileUploadItem in your environment.)
 */
function _safeIsRequired_(it) {
  try {
    const t = it.getType();
    if (t === FormApp.ItemType.TEXT) return it.asTextItem().isRequired();
    if (t === FormApp.ItemType.PARAGRAPH_TEXT) return it.asParagraphTextItem().isRequired();
    if (t === FormApp.ItemType.LIST) return it.asListItem().isRequired();
    if (t === FormApp.ItemType.MULTIPLE_CHOICE) return it.asMultipleChoiceItem().isRequired();
    if (t === FormApp.ItemType.DATE) return it.asDateItem().isRequired();
    if (t === FormApp.ItemType.DATETIME) return it.asDateTimeItem().isRequired();
    if (t === FormApp.ItemType.TIME) return it.asTimeItem().isRequired();
    // FILE_UPLOAD: can't safely access required in your environment; default false
    return false;
  } catch (e) {
    return false;
  }
}