const JETTY_SHEET_ID = '1JWANaTg7HKQzrEQyqv1Y5ksioj-4sqUfu6-IBRDjwXw';
const JETTY_TAB_ID = 1302148943;

function jettyFormSubmit(event) {
  if (!event || !event.range) throw new Error('Use an installed spreadsheet form-submit trigger.');
  const sheet = event.range.getSheet();
  if (sheet.getParent().getId() !== JETTY_SHEET_ID || sheet.getSheetId() !== JETTY_TAB_ID) return;
  jettySendRow(sheet, event.range.getRow());
}

function jettySendRow(sheet, row) {
  const properties = PropertiesService.getScriptProperties();
  const endpoint = properties.getProperty('JETTY_WEBHOOK_URL');
  const secret = properties.getProperty('JETTY_WEBHOOK_SECRET');
  if (endpoint !== 'https://jettyradio-desk.jettyradio-desk-api.workers.dev/api/submissions/ingest' || !secret || secret.length < 32)
    throw new Error('Configure JETTY_WEBHOOK_URL and JETTY_WEBHOOK_SECRET in Script Properties.');
  const headers = sheet.getRange(1, 1, 1, 9).getDisplayValues()[0];
  const prefixes = ['Timestamp', 'Show name w/ artist name', 'Link to show file!', 'Show art:', 'Track list (optional)', 'Track list art for second slide', 'Other notes?', 'Admin Pick Up Name', 'Completed?'];
  if (!prefixes.every((prefix, index) => headers[index].trim().startsWith(prefix)))
    throw new Error('The form columns changed. Update the mapping before syncing.');
  const range = sheet.getRange(row, 1, 1, 9);
  const raw = range.getValues()[0];
  if (!raw[0]) return;
  if (!(raw[0] instanceof Date) || !Number.isFinite(raw[0].getTime()))
    throw new Error('Response timestamp must be a Sheets date at row ' + row);
  const cells = range.getDisplayValues()[0];
  const submittedAt = raw[0].toISOString();
  // Content identity survives sheet sorting; admin edits do not create new submissions.
  const identity = JSON.stringify([JETTY_SHEET_ID, JETTY_TAB_ID, submittedAt].concat(cells.slice(1, 7)));
  const id = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, identity, Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
  const payload = { id, spreadsheetId: JETTY_SHEET_ID, sheetId: JETTY_TAB_ID, row, submittedAt,
    title: cells[1], audio: cells[2], artwork: cells[3], tracklist: cells[4], tracklistArt: cells[5],
    notes: cells[6], admin: cells[7], completed: cells[8] };
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: false,
  });
  if (response.getResponseCode() !== 200)
    throw new Error('Jetty intake returned HTTP ' + response.getResponseCode() + ' for row ' + row + '. Run jettyBackfill to retry.');
}

function jettyInstallTrigger() {
  const existing = ScriptApp.getProjectTriggers().some(trigger =>
    trigger.getHandlerFunction() === 'jettyFormSubmit' && trigger.getTriggerSourceId() === JETTY_SHEET_ID &&
    trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT);
  if (!existing) ScriptApp.newTrigger('jettyFormSubmit').forSpreadsheet(JETTY_SHEET_ID).onFormSubmit().create();
}

function jettyBackfill() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('A backfill is already running.');
  try {
    const properties = PropertiesService.getScriptProperties();
    const sheet = SpreadsheetApp.openById(JETTY_SHEET_ID).getSheetById(JETTY_TAB_ID);
    if (!sheet) throw new Error('Response tab not found.');
    const first = Number(properties.getProperty('JETTY_BACKFILL_ROW') || 2);
    const last = Math.min(sheet.getLastRow(), first + 49);
    for (let row = first; row <= last; row++) {
      jettySendRow(sheet, row);
      properties.setProperty('JETTY_BACKFILL_ROW', String(row + 1));
    }
    if (last >= sheet.getLastRow()) {
      properties.deleteProperty('JETTY_BACKFILL_ROW');
      console.log('Backfill complete.');
    } else console.log('Batch complete. Run jettyBackfill again to continue.');
  } finally { lock.releaseLock(); }
}
