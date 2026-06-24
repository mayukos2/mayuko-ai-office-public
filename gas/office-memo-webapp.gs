const EVENTS_SHEET_NAME = 'office_events';
const STATUS_SHEET_NAME = 'office_status';
const DEFAULT_PROJECT_ID = 'mayuko-ai-office';
const DEFAULT_PROJECT_NAME = 'まゆこAIオフィス';
const PUBLIC_MEMO_MAX_LENGTH = 300;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_PER_AGENT = 8;
const RATE_LIMIT_PER_PROJECT = 30;

const ALLOWED_STATUSES = [
  '未着手',
  '相談中',
  '素材待ち',
  'Codex投入待ち',
  '実務中',
  '確認待ち',
  '完了',
  '保留',
  '明日やることある'
];

const PUBLIC_STATUS_HEADERS = [
  'projectId',
  'プロジェクト名',
  'agentId',
  'taskKey',
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

const EVENT_HEADERS = [
  '受信日時',
  'source',
  'projectId',
  'プロジェクト名',
  '担当AI',
  'agentId',
  'taskKey',
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
  'projectId',
  'プロジェクト名',
  'agentId',
  'taskKey',
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
  migrateDefaultProject(statusSheet);
  seedStatusRows(statusSheet, DEFAULT_PROJECT_ID, DEFAULT_PROJECT_NAME);
  installFormSubmitTrigger();
}

function doGet(e) {
  const projectId = normalizeProjectId(e && e.parameter && e.parameter.projectId);
  if (!projectId) {
    return jsonResponse({ ok: false, error: 'invalid_project' });
  }
  const data = {
    ok: true,
    status: readStatusRows(projectId)
  };
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    if (!isValidJsonpCallback(callback)) {
      return jsonResponse({ ok: false, error: 'invalid_callback' });
    }
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(data)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(data);
}

function doPost(e) {
  const payload = parsePayload(e);
  const event = normalizePublicMemo(payload);
  if (!event) {
    return jsonResponse({ ok: false, error: 'invalid_payload' });
  }
  if (isRateLimited(`project:${event.projectId}`, RATE_LIMIT_PER_PROJECT, RATE_LIMIT_WINDOW_SECONDS) ||
      isRateLimited(`agent:${event.projectId}:${event.agentId}`, RATE_LIMIT_PER_AGENT, RATE_LIMIT_WINDOW_SECONDS)) {
    return jsonResponse({ ok: false, error: 'rate_limited' });
  }
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
  const agentId = normalizeAgentId(payload.agentId) || findAgentId(agentName);
  const projectId = normalizeProjectId(payload.projectId);
  if (!projectId || !agentId) return null;
  return {
    source: 'public_memo',
    projectId,
    projectName: safeText(payload.projectName, 160) || DEFAULT_PROJECT_NAME,
    agentName: agentName || findAgentName(agentId),
    agentId,
    taskKey: safeText(payload.taskKey, 120) || slugTask(payload.taskTitle || 'overview'),
    status: normalizeStatus(payload.status),
    taskTitle: safeText(payload.taskTitle, 120),
    nowWhere: '',
    waitingFor: '',
    memo: safeText(payload.memo, PUBLIC_MEMO_MAX_LENGTH),
    codex: '',
    lastUpdated: '',
    raw: {}
  };
}

function normalizeFormReport(e) {
  const named = e && e.namedValues ? e.namedValues : {};
  const projectName = firstNamed(named, ['プロジェクト名', '案件名', 'プロジェクト', 'projectName']) || DEFAULT_PROJECT_NAME;
  const projectId = normalizeProjectId(firstNamed(named, ['プロジェクトID', 'projectId']) || slugProject(projectName)) || DEFAULT_PROJECT_ID;
  const agentName = firstNamed(named, ['担当AI', 'AI社員', '担当']);
  const status = normalizeStatus(firstNamed(named, ['状態', 'ステータス']));
  const taskTitle = firstNamed(named, ['タスク名', '今お願いされていること', 'タスク']);
  const nowWhere = firstNamed(named, ['今どこまで', '進捗', '作業内容', 'どこまでやったか']);
  const waitingFor = firstNamed(named, ['何待ち', '待ち', '止まっている理由']);
  const nextAction = firstNamed(named, ['次の一手', '次のタスク']);
  const codex = firstNamed(named, ['Codex投入', 'Codex', 'Codex必要']);
  const lastUpdated = firstNamed(named, ['最終更新', '更新日']);

  return {
    source: 'chatgpt_report',
    projectId,
    projectName,
    agentName,
    agentId: findAgentId(agentName),
    taskKey: firstNamed(named, ['タスクID', 'taskKey']) || slugTask(taskTitle || nowWhere || nextAction || 'overview'),
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
  const sheet = getEventsSheet();
  const headers = getHeaders(sheet, EVENT_HEADERS);
  const row = headers.map((header) => eventValue(event, header));
  sheet.appendRow(row);
}

function upsertStatus(event) {
  const sheet = getStatusSheet();
  const headers = getHeaders(sheet, STATUS_HEADERS);
  migrateDefaultProject(sheet);

  const rows = sheet.getDataRange().getValues();
  const rowIndex = findStatusRowIndex(rows, headers, event);

  if (rowIndex === -1) {
    sheet.appendRow(buildStatusRow(headers, event));
    return;
  }

  const current = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const next = mergeStatusRow(current, headers, event);
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([next]);
}

function findStatusRowIndex(rows, headers, event) {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const sameProject = getCell(row, headers, 'projectId') === event.projectId ||
      (!getCell(row, headers, 'projectId') && event.projectId === DEFAULT_PROJECT_ID);
    const sameAgent = (event.agentId && getCell(row, headers, 'agentId') === event.agentId) ||
      (event.agentName && getCell(row, headers, '担当AI') === event.agentName);
    const sameTask = getCell(row, headers, 'taskKey') === event.taskKey ||
      (!getCell(row, headers, 'taskKey') && event.taskKey === slugTask(getCell(row, headers, 'タスク名') || getCell(row, headers, '今どこまで') || 'overview'));
    if (sameProject && sameAgent && sameTask) return i + 1;
  }
  return -1;
}

function mergeStatusRow(current, headers, event) {
  const row = current.slice();
  setCell(row, headers, 'projectId', event.projectId || getCell(row, headers, 'projectId') || DEFAULT_PROJECT_ID);
  setCell(row, headers, 'プロジェクト名', event.projectName || getCell(row, headers, 'プロジェクト名') || DEFAULT_PROJECT_NAME);
  setCell(row, headers, 'agentId', event.agentId || getCell(row, headers, 'agentId'));
  setCell(row, headers, 'taskKey', event.taskKey || getCell(row, headers, 'taskKey') || slugTask(event.taskTitle || 'overview'));
  setCell(row, headers, '担当AI', event.agentName || getCell(row, headers, '担当AI'));
  setCell(row, headers, 'lastSource', event.source);

  if (event.source === 'chatgpt_report') {
    setCell(row, headers, '状態', event.status || getCell(row, headers, '状態'));
    setCell(row, headers, 'タスク名', event.taskTitle || getCell(row, headers, 'タスク名'));
    setCell(row, headers, '今どこまで', event.nowWhere || getCell(row, headers, '今どこまで'));
    setCell(row, headers, '何待ち', event.waitingFor || getCell(row, headers, '何待ち'));
    setCell(row, headers, 'Codex投入', event.codex || getCell(row, headers, 'Codex投入'));
    setCell(row, headers, '最終更新', event.lastUpdated || formatDate(new Date()));
  }

  if (event.source === 'public_memo') {
    setCell(row, headers, '私のメモ', event.memo || getCell(row, headers, '私のメモ'));
    setCell(row, headers, '最終メモ日時', formatDateTime(new Date()));
  }

  return row;
}

function buildStatusRow(headers, event) {
  return headers.map((header) => eventValue(event, header));
}

function eventValue(event, header) {
  if (header === '受信日時') return new Date();
  if (header === 'source') return event.source;
  if (header === 'projectId') return event.projectId || DEFAULT_PROJECT_ID;
  if (header === 'プロジェクト名') return event.projectName || DEFAULT_PROJECT_NAME;
  if (header === 'agentId') return event.agentId;
  if (header === 'taskKey') return event.taskKey || slugTask(event.taskTitle || 'overview');
  if (header === '担当AI') return event.agentName;
  if (header === '状態') return event.status;
  if (header === 'タスク名') return event.taskTitle;
  if (header === '今どこまで') return event.nowWhere;
  if (header === '何待ち') return event.waitingFor;
  if (header === '私のメモ') return event.memo;
  if (header === 'Codex投入') return event.codex;
  if (header === '最終更新') return event.lastUpdated || (event.source === 'chatgpt_report' ? formatDate(new Date()) : '');
  if (header === '最終メモ日時') return event.source === 'public_memo' ? formatDateTime(new Date()) : '';
  if (header === 'lastSource') return event.source;
  if (header === 'raw') return JSON.stringify(event.raw);
  return '';
}

function getEventsSheet() {
  return getOrCreateSheet(EVENTS_SHEET_NAME, EVENT_HEADERS);
}

function getStatusSheet() {
  return getOrCreateSheet(STATUS_SHEET_NAME, STATUS_HEADERS);
}

function getOrCreateSheet(name, requiredHeaders) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  ensureHeaders(sheet, requiredHeaders);
  return sheet;
}

function ensureHeaders(sheet, requiredHeaders) {
  const maxColumns = Math.max(sheet.getLastColumn(), requiredHeaders.length, 1);
  let headers = sheet.getRange(1, 1, 1, maxColumns).getValues()[0].filter((value) => value);

  if (!headers.length) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    sheet.setFrozenRows(1);
    return;
  }

  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
}

function getHeaders(sheet, requiredHeaders) {
  ensureHeaders(sheet, requiredHeaders);
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter((value) => value);
}

function migrateDefaultProject(sheet) {
  const headers = getHeaders(sheet, STATUS_HEADERS);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i].slice();
    let changed = false;
    if (!getCell(row, headers, 'projectId')) {
      setCell(row, headers, 'projectId', DEFAULT_PROJECT_ID);
      changed = true;
    }
    if (!getCell(row, headers, 'プロジェクト名')) {
      setCell(row, headers, 'プロジェクト名', DEFAULT_PROJECT_NAME);
      changed = true;
    }
    if (!getCell(row, headers, 'taskKey')) {
      setCell(row, headers, 'taskKey', slugTask(getCell(row, headers, 'タスク名') || getCell(row, headers, '今どこまで') || 'overview'));
      changed = true;
    }
    if (changed) {
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([fitRow(row, headers.length)]);
    }
  }
}

function seedStatusRows(sheet, projectId, projectName) {
  const headers = getHeaders(sheet, STATUS_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const keys = new Set(rows.slice(1).map((row) => `${getCell(row, headers, 'projectId')}::${getCell(row, headers, 'agentId')}::${getCell(row, headers, 'taskKey')}`));
  AGENTS.forEach(([agentId, agentName]) => {
    const key = `${projectId}::${agentId}::overview`;
    if (!keys.has(key)) {
      sheet.appendRow(buildStatusRow(headers, {
        source: 'setup',
        projectId,
        projectName,
        agentId,
        taskKey: 'overview',
        agentName,
        status: '未着手',
        taskTitle: '',
        nowWhere: '',
        waitingFor: '報告待ち',
        memo: '',
        codex: '不要',
        lastUpdated: '',
        raw: {}
      }));
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

function readStatusRows(projectId) {
  const sheet = getStatusSheet();
  migrateDefaultProject(sheet);
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  return rows
    .filter((row) => row[0] || row[1])
    .map((row) => {
      const item = {};
      PUBLIC_STATUS_HEADERS.forEach((header) => item[header] = getCell(row, headers, header));
      if (!item.projectId) item.projectId = DEFAULT_PROJECT_ID;
      if (!item['プロジェクト名']) item['プロジェクト名'] = DEFAULT_PROJECT_NAME;
      if (!item.taskKey) item.taskKey = slugTask(item['タスク名'] || item['今どこまで'] || 'overview');
      return item;
    })
    .filter((item) => !projectId || item.projectId === projectId);
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

function getCell(row, headers, header) {
  return row[headers.indexOf(header)] || '';
}

function setCell(row, headers, header, value) {
  row[headers.indexOf(header)] = value;
}

function fitRow(row, length) {
  const next = row.slice(0, length);
  while (next.length < length) next.push('');
  return next;
}

function slugProject(projectName) {
  if (projectName === DEFAULT_PROJECT_NAME) return DEFAULT_PROJECT_ID;
  return safeText(projectName, 120)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-ぁ-んァ-ヶ一-龠]/g, '')
    .slice(0, 120) || DEFAULT_PROJECT_ID;
}

function slugTask(taskTitle) {
  const text = safeText(taskTitle || 'overview', 160);
  if (!text || text === 'overview') return 'overview';
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-ぁ-んァ-ヶ一-龠]/g, '')
    .slice(0, 160) || 'overview';
}

function safeText(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeProjectId(value) {
  const projectId = safeText(value, 120) || DEFAULT_PROJECT_ID;
  return projectId === DEFAULT_PROJECT_ID ? projectId : '';
}

function normalizeAgentId(value) {
  const agentId = safeText(value, 80);
  return AGENTS.some((item) => item[0] === agentId) ? agentId : '';
}

function normalizeStatus(value) {
  const status = safeText(value, 40);
  return ALLOWED_STATUSES.indexOf(status) >= 0 ? status : '';
}

function isValidJsonpCallback(callback) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(String(callback || ''));
}

function isRateLimited(key, limit, seconds) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `rate:${key}`;
  const current = Number(cache.get(cacheKey) || 0);
  if (current >= limit) return true;
  cache.put(cacheKey, String(current + 1), seconds);
  return false;
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
