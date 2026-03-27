/**
 * 62_SyncUrlsBackfill.gs
 *
 * One-time backfill utility for URL sync/formatting.
 *
 * Purpose:
 * - Backfill excluded URL columns (for example L,M) into sync tabs
 * - Use the same registry-driven configuration as the live system
 * - Process one formKey at a time
 *
 * How it works:
 * - Reads the target spreadsheet and destination responses tab from Forms
 * - Reads sync tab config rows from SycUrls
 * - Reads existing __SubmissionUID values from the configured DestUidCol
 * - For each row that has a UID, copies raw URL values from the source row
 *   and writes rich-text hyperlinks into the configured sync tabs/columns
 *
 * Important:
 * - This is for one-time historical backfill
 * - New live submissions continue to use your existing working sync system
 * - This does NOT call the standalone web app
 * - The source UID column is NOT hardcoded anymore
 */

/**
 * MAIN ONE-TIME ENTRYPOINT
 *
 * Change only this value before running.
 */
function runOneTimeSyncUrlsBackfillForFormKey() {
  const formKey = "oro_private"; // <-- CHANGE THIS PER RUN

  const BATCH_SIZE = 50; // safe size for Apps Script runtime
  const PROP_KEY = "BACKFILL_OFFSET_" + formKey;

  const props = PropertiesService.getScriptProperties();
  const offset = Number(props.getProperty(PROP_KEY) || 0);

  const result = backfillSyncUrlsForFormKey_Batched_(formKey, offset, BATCH_SIZE);

  Logger.log(JSON.stringify(result));

  if (result.done) {
    props.deleteProperty(PROP_KEY);
    Logger.log("Backfill complete");
  } else {
    props.setProperty(PROP_KEY, String(result.nextOffset));
    Logger.log("Continue from offset: " + result.nextOffset);
  }

  return result;
}

/**
 * Backfill URL sync rows for one formKey in batches.
 *
 * Why batched:
 * - avoids Apps Script timeout on large historical datasets
 * - keeps progress in Script Properties
 * - you can rerun safely until complete
 */
function backfillSyncUrlsForFormKey_Batched_(formKey, offset, batchSize) {
  formKey = String(formKey || "").trim();
  if (!formKey) throw new Error("formKey is required.");

  offset = Number(offset || 0);
  batchSize = Number(batchSize || 50);

  const reg = registryReadAll_();

  const formRow = (reg.forms || []).find(
    r => String(r.formKey || "").trim() === formKey
  );
  if (!formRow) {
    throw new Error("Form not found in Forms tab for formKey: " + formKey);
  }

  const syncRows = (reg.syncUrls || []).filter(
    r => String(r.formKey || "").trim() === formKey
  );
  if (!syncRows.length) {
    throw new Error("No SycUrls rows found for formKey: " + formKey);
  }

  const destSpreadsheetId = _pickFirstNonEmpty_(formRow, [
    "spreadsheetId",
    "responsesSpreadsheetId",
    "destinationSpreadsheetId",
    "destSpreadsheetId",
    "sheetId"
  ]);

  const responsesSheetName = _pickFirstNonEmpty_(formRow, [
    "destination",
    "responsesSheetName",
    "destinationSheetName",
    "destSheetName",
    "sheetName",
    "tabName"
  ]);

  if (!destSpreadsheetId) {
    throw new Error("Destination spreadsheetId missing for formKey: " + formKey);
  }

  if (!responsesSheetName) {
    throw new Error("Destination responses sheet name missing for formKey: " + formKey);
  }

  // All rows for the same formKey should use the same source URL columns.
  const destUrlCols = parseColLettersListBackfill_(String(syncRows[0].DestUrlCols || "").trim());
  if (!destUrlCols.length) {
    throw new Error("DestUrlCols missing/invalid in SycUrls for formKey: " + formKey);
  }

  // All rows for the same formKey should point to the same source UID column.
  const sourceUidCol = getSourceUidColFromSyncRowsBackfill_(syncRows);
  if (!sourceUidCol) {
    throw new Error("DestUidCol missing/invalid in SycUrls for formKey: " + formKey);
  }

  const ss = SpreadsheetApp.openById(destSpreadsheetId);
  const source = ss.getSheetByName(responsesSheetName);
  if (!source) {
    throw new Error('Responses sheet not found: "' + responsesSheetName + '"');
  }

  const startRow = 2;
  const lastRow = source.getLastRow();

  if (lastRow < startRow) {
    return {
      ok: true,
      formKey: formKey,
      processedRows: 0,
      updatedCells: 0,
      skippedRows: 0,
      done: true,
      nextOffset: 0
    };
  }

  const rowCount = lastRow - startRow + 1;
  const uidValues = source.getRange(startRow, sourceUidCol, rowCount, 1).getValues();

  let processedRows = 0;
  let skippedRows = 0;
  let updatedCells = 0;

  const endExclusive = Math.min(offset + batchSize, uidValues.length);

  // Process only the current batch window
  for (let i = offset; i < endExclusive; i++) {
    const sourceRowIndex = startRow + i;
    const submissionUid = String(uidValues[i][0] || "").trim();

    // Historical rows without UID cannot be matched to sync tabs
    if (!submissionUid) {
      skippedRows++;
      continue;
    }

    const updatedForThisRow = syncAndFormatSingleSourceRowBackfill_(
      ss,
      source,
      sourceRowIndex,
      submissionUid,
      destUrlCols,
      syncRows
    );

    processedRows++;
    updatedCells += updatedForThisRow;
  }

  const done = endExclusive >= uidValues.length;

  return {
    ok: true,
    formKey: formKey,
    processedRows: processedRows,
    updatedCells: updatedCells,
    skippedRows: skippedRows,
    done: done,
    nextOffset: endExclusive
  };
}

/**
 * Read source UID column from the first valid SycUrls row for this formKey.
 *
 * All sync rows for the same formKey should point to the same destination
 * responses tab, so DestUidCol is expected to be the same across them.
 */
function getSourceUidColFromSyncRowsBackfill_(syncRows) {
  for (const row of syncRows || []) {
    const colLetter = String(row && row.DestUidCol || "").trim();
    const colIndex = colLetterToIndexBackfill_(colLetter);
    if (colIndex > 0) return colIndex;
  }
  return 0;
}

/**
 * Sync and format one existing source row into all configured sync tabs.
 *
 * Returns:
 * - number of target cells updated
 */
function syncAndFormatSingleSourceRowBackfill_(ss, source, sourceRowIndex, submissionUid, destUrlCols, syncRows) {
  let updatedCount = 0;

  // Read raw source URL values once
  const sourceRawValues = {};
  for (const colIndex of destUrlCols) {
    sourceRawValues[colIndex] = String(source.getRange(sourceRowIndex, colIndex).getValue() || "").trim();
  }

  // No need for Utilities.sleep() here because this is historical backfill.
  // QUERY rows should already be present.
  for (const rawTarget of syncRows) {
    const target = normalizeTargetConfigBackfill_(rawTarget);
    if (!target) continue;

    const sh = ss.getSheetByName(target.sheetName);
    if (!sh) continue;

    const targetRow = findRowByUidBackfill_(sh, target.uidCol, submissionUid, target.headerRow + 1);
    if (!targetRow) continue;

    for (let i = 0; i < Math.min(destUrlCols.length, target.syncUrlCols.length); i++) {
      const sourceColIndex = destUrlCols[i];
      const targetColIndex = target.syncUrlCols[i];
      const rawText = String(sourceRawValues[sourceColIndex] || "").trim();

      const headerLabel = String(
        sh.getRange(target.headerRow, targetColIndex).getDisplayValue() || ""
      ).trim() || "فایل";

      const richValue = buildMultiRichLinkCellFromRawUrlsBackfill_(rawText, headerLabel);

      sh.getRange(targetRow, targetColIndex).setRichTextValue(richValue);
      sh.getRange(targetRow, targetColIndex).setWrap(true);

      updatedCount++;
    }
  }

  return updatedCount;
}

/**
 * Normalize one SycUrls row.
 */
function normalizeTargetConfigBackfill_(row) {
  if (!row || typeof row !== "object") return null;

  const sheetName = String(row.SyncTab || "").trim();
  const headerRow = Number(row.SyncHeaderRow || 0);
  const syncUrlCols = parseColLettersListBackfill_(row.SyncUrlCols);
  const uidCol = colLetterToIndexBackfill_(String(row.SyncUidCol || "").trim());

  if (!sheetName || !headerRow || !syncUrlCols.length || !uidCol) return null;

  return {
    sheetName: sheetName,
    headerRow: headerRow,
    syncUrlCols: syncUrlCols,
    uidCol: uidCol
  };
}

/**
 * Find matching row in a sync tab by helper UID column.
 */
function findRowByUidBackfill_(sheet, uidCol, submissionUid, startRow) {
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return 0;

  const values = sheet.getRange(startRow, uidCol, lastRow - startRow + 1, 1).getValues();

  for (let i = values.length - 1; i >= 0; i--) {
    const uid = String(values[i][0] || "").trim();
    if (uid === submissionUid) {
      return startRow + i;
    }
  }

  return 0;
}

/**
 * Build one rich-text cell from newline-separated raw URLs.
 * - single link: header label
 * - multi links: header label ۱ / ۲ / ۳ ...
 */
function buildMultiRichLinkCellFromRawUrlsBackfill_(rawText, baseLabel) {
  const urls = extractUrlsFromPlainCellBackfill_(rawText);
  const labelBase = String(baseLabel || "").trim() || "فایل";

  if (!urls.length) {
    return SpreadsheetApp.newRichTextValue().setText("").build();
  }

  if (urls.length === 1) {
    return SpreadsheetApp.newRichTextValue()
      .setText(labelBase)
      .setLinkUrl(urls[0])
      .build();
  }

  const lines = urls.map((_, i) => labelBase + " " + toFaDigitsBackfill_(i + 1));
  const fullText = lines.join("\n");

  let builder = SpreadsheetApp.newRichTextValue().setText(fullText);
  let pos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = pos;
    const end = pos + line.length;
    builder = builder.setLinkUrl(start, end, urls[i]);
    pos = end + 1;
  }

  return builder.build();
}

/**
 * Extract raw URLs from plain text cell content.
 */
function extractUrlsFromPlainCellBackfill_(plainValue) {
  const text = String(plainValue || "").trim();
  if (!text) return [];

  const out = [];
  const seen = {};

  const push = (url) => {
    url = String(url || "").trim();
    if (!url || seen[url]) return;
    seen[url] = true;
    out.push(url);
  };

  const parts = text.split(/\r?\n+/).map(x => String(x || "").trim()).filter(Boolean);

  for (const p of parts) {
    if (/^https?:\/\/\S+$/i.test(p)) {
      push(p);
      continue;
    }

    const embedded = p.match(/https?:\/\/\S+/ig) || [];
    embedded.forEach(push);
  }

  return out;
}

/**
 * Convert Western digits to Persian digits for numbered link labels.
 */
function toFaDigitsBackfill_(n) {
  const fa = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
  return String(n).replace(/\d/g, d => fa[Number(d)]);
}

/**
 * Convert one column letter like L or AG into numeric index.
 */
function colLetterToIndexBackfill_(letter) {
  letter = String(letter || "").trim().toUpperCase();
  if (!letter) return 0;

  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }

  return col;
}

/**
 * Convert "L,M" into [12, 13].
 */
function parseColLettersListBackfill_(value) {
  return String(value || "")
    .split(",")
    .map(s => colLetterToIndexBackfill_(s))
    .filter(n => Number(n) > 0);
}