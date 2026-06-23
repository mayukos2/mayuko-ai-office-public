const EVENTS_SHEET_NAME = 'office_events';
const STATUS_SHEET_NAME = 'office_status';

const EVENT_HEADERS = [
  '受信日時',
  'source',
  '担当AI',
  'agentId',
  '状態',
  'タスク名',
  '今どこまで',
  '何待ち',
  '私のメモ',
  'Codex投入',
  '最終更新',
  'raw'
];

const STATUS_HEADERS = [
  'agentId',
  '担当AI',
  '状態',
  'タスク名',
  '今どこまで',
  '何待ち',
  '私のメモ',
  'Codex投入',
  '最終更新',
  '最終メモ日時',
  'lastSource'
];

const AGENTS = [
  ['ceo-assistant', '社長補佐'],
  ['inner-guide', '内観ナビ'],
  ['energy-care', '体力管理係'],
  ['product-planner', '商品企画ちゃん'],
  ['editor-chief', '発信編集長'],
  ['world-designer', '世界観デザイナー'],
  ['investment-manager', '投資回収マネージャー'],
  ['archive-clerk', '資料整理係'],
  ['codex-translator', 'Codex通訳係'],
  ['emergency-responder', '緊急対応係']
];

function setupOfficeSheets() {
  getEventsSheet();
  const statusSheet = getStatusSheet();
  seedStatusRows(statusSheet);
  installFormSubmitTrigger();
}

function doGet(e) {
  const data = {
    ok: true,
    status: readStatusRows()
  };
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(data)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(data);
}

function doPost(e) {
  const payload = parsePayload(e);
  const event = normalizePublicMemo(payload);
  appendEvent(event);
  upsertStatus(event);

  return jsonResponse({ ok: true });
}

function handleFormSubmit(e) {
  const event = normalizeFormReport(e);
  appendEvent(event);
  upsertStatus(event);
}

function normalizePublicMemo(payload) {
  const agentName = safeText(payload.agentName, 80);
  const agentId = safeText(payload.agentId, 80) || findAgentId(agentName);
  return {
    source: 'public_memo',
    agentName: agentName || findAgentName(agentId),
    agentId,
    status: safeText(payload.status, 40),
    taskTitle: safeText(payload.taskTitle, 160),
    nowWhere: '',
    waitingFor: '',
    memo: safeText(payload.memo, 1000),
    codex: '',
    lastUpdated: '',
    raw: payload
  };
}

function normalizeFormReport(e) {
  const named = e && e.namedValues ? e.namedValues : {};
  const agentName = firstNamed(named, ['担当AI', 'AI社員', '担当']);
  const status = firstNamed(named, ['状態', 'ステータス']);
  const taskTitle = firstNamed(named, ['タスク名', '今お願いされていること', 'タスク']);
  const nowWhere = firstNamed(named, ['今どこまで', '進捗', '作業内容', 'どこまでやったか']);
  const waitingFor = firstNamed(named, ['何待ち', '待ち', '止まっている理由']);
  const nextAction = firstNamed(named, ['次の一手', '次のタスク']);
  const codex = firstNamed(named, ['Codex投入', 'Codex', 'Codex必要']);
  const lastUpdated = firstNamed(named, ['最終更新', '更新日']);

  return {
    source: 'chatgpt_report',
    agentName,
    agentId: findAgentId(agentName),
    status,
    taskTitle,
    nowWhere: nowWhere || taskTitle || nextAction,
    waitingFor: waitingFor || deriveWaitingFor(status, codex),
    memo: '',
    codex,
    lastUpdated,
    raw: named
  };
}

function appendEvent(event) {
  getEventsSheet().appendRow([
    new Date(),
    event.source,
    event.agentName,
    event.agentId,
    event.status,
    event.taskTitle,
    event.nowWhere,
    event.waitingFor,
    event.memo,
    event.codex,
    event.lastUpdated,
    JSON.stringify(event.raw)
  ]);
}

function upsertStatus(event) {
  const sheet = getStatusSheet();
  seedStatusRows(sheet);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf('agentId');
  const nameCol = headers.indexOf('担当AI');
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    if ((event.agentId && rows[i][idCol] === event.agentId) || (event.agentName && rows[i][nameCol] === event.agentName)) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    sheet.appendRow(buildStatusRow(event));
    return;
  }

  const current = sheet.getRange(rowIndex, 1, 1, STATUS_HEADERS.length).getValues()[0];
  const next = mergeStatusRow(current, event);
  sheet.getRange(rowIndex, 1, 1, STATUS_HEADERS.length).setValues([next]);
}

function mergeStatusRow(current, event) {
  const row = current.slice();
  setCell(row, 'agentId', event.agentId || getCell(row, 'agentId'));
  setCell(row, '担当AI', event.agentName || getCell(row, '担当AI'));
  setCell(row, 'lastSource', event.source);

  if (event.source === 'chatgpt_report') {
    setCell(row, '状態', event.status || getCell(row, '状態'));
    setCell(row, 'タスク名', event.taskTitle || getCell(row, 'タスク名'));
    setCell(row, '今どこまで', event.nowWhere || getCell(row, '今どこまで'));
    setCell(row, '何待ち', event.waitingFor || getCell(row, '何待ち'));
    setCell(row, 'Codex投入', event.codex || getCell(row, 'Codex投入'));
    setCell(row, '最終更新', event.lastUpdated || formatDate(new Date()));
  }

  if (event.source === 'public_memo') {
    setCell(row, '私のメモ', event.memo || getCell(row, '私のメモ'));
    setCell(row, '最終メモ日時', formatDateTime(new Date()));
  }

  return row;
}

function buildStatusRow(event) {
  return STATUS_HEADERS.map((header) => {
    if (header === 'agentId') return event.agentId;
    if (header === '担当AI') return event.agentName;
    if (header === '状態') return event.status;
    if (header === 'タスク名') return event.taskTitle;
    if (header === '今どこまで') return event.nowWhere;
    if (header === '何待ち') return event.waitingFor;
    if (header === '私のメモ') return event.memo;
    if (header === 'Codex投入') return event.codex;
    if (header === '最終更新') return event.lastUpdated || formatDate(new Date());
    if (header === '最終メモ日時') return event.source === 'public_memo' ? formatDateTime(new Date()) : '';
    if (header === 'lastSource') return event.source;
    return '';
  });
}

function getEventsSheet() {
  return getOrCreateSheet(EVENTS_SHEET_NAME, EVENT_HEADERS);
}

function getStatusSheet() {
  return getOrCreateSheet(STATUS_SHEET_NAME, STATUS_HEADERS);
}

function getOrCreateSheet(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = firstRow.some((value) => value);
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function seedStatusRows(sheet) {
  const rows = sheet.getDataRange().getValues();
  const ids = new Set(rows.slice(1).map((row) => row[0]).filter(Boolean));
  AGENTS.forEach(([agentId, agentName]) => {
    if (!ids.has(agentId)) {
      sheet.appendRow([agentId, agentName, '未着手', '', '', '報告待ち', '', '不要', '', '', 'setup']);
    }
  });
}

function installFormSubmitTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some((trigger) => trigger.getHandlerFunction() === 'handleFormSubmit');
  if (!exists) {
    ScriptApp.newTrigger('handleFormSubmit')
      .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
      .onFormSubmit()
      .create();
  }
}

function readStatusRows() {
  const sheet = getStatusSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  return rows
    .filter((row) => row[0] || row[1])
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => item[header] = row[index]);
      return item;
    });
}

function parsePayload(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return {};
  }
}

function firstNamed(namedValues, names) {
  for (const name of names) {
    const value = namedValues[name];
    if (Array.isArray(value) && value[0]) return safeText(value[0], 1000);
    if (value) return safeText(value, 1000);
  }
  return '';
}

function deriveWaitingFor(status, codex) {
  if (codex === '必要' || status === 'Codex投入待ち') return 'Codex投入待ち';
  if (status === '素材待ち') return '素材待ち';
  if (status === '確認待ち') return '確認待ち';
  if (status === '相談中') return '相談の続き待ち';
  if (status === '実務中') return '作業中';
  if (status === '完了') return '完了';
  if (status === '保留') return '再開待ち';
  return status || '報告待ち';
}

function findAgentId(agentName) {
  const pair = AGENTS.find((item) => item[1] === agentName);
  return pair ? pair[0] : '';
}

function findAgentName(agentId) {
  const pair = AGENTS.find((item) => item[0] === agentId);
  return pair ? pair[1] : '';
}

function getCell(row, header) {
  return row[STATUS_HEADERS.indexOf(header)] || '';
}

function setCell(row, header, value) {
  row[STATUS_HEADERS.indexOf(header)] = value;
}

function safeText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function formatDate(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}

function formatDateTime(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
