const SHEET_NAME = 'office_memos';

function doGet() {
  return jsonResponse({
    ok: true,
    app: 'mayuko-ai-office-memo',
    message: 'memo endpoint is ready'
  });
}

function doPost(e) {
  const payload = parsePayload(e);
  const sheet = getOrCreateSheet();

  sheet.appendRow([
    new Date(),
    safeText(payload.agentName, 80),
    safeText(payload.agentId, 80),
    safeText(payload.status, 40),
    safeText(payload.taskTitle, 160),
    safeText(payload.memo, 1000),
    safeText(payload.sentAt, 80)
  ]);

  return jsonResponse({ ok: true });
}

function getOrCreateSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      '受信日時',
      '担当AI',
      '担当AI ID',
      '状態',
      'タスク名',
      '私のメモ',
      '送信日時'
    ]);
  }

  return sheet;
}

function parsePayload(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return {};
  }
}

function safeText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
