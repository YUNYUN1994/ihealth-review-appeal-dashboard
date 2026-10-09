import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://open.feishu.cn/open-apis';
const DEFAULT_MAX_ROWS = 5000;
const DEFAULT_MAX_COLS = 24;

function sourceConfigPath() {
  return process.env.FEISHU_SOURCES_FILE || '/etc/ihealth-apps/review-appeals.feishu.json';
}

async function loadSourceConfig() {
  const filename = sourceConfigPath();
  let config;
  try {
    config = JSON.parse(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 FEISHU_SOURCES_FILE：${filename}（${error.message}）`);
  }
  if (!config || config.version !== 1 || config.appSlug !== process.env.APP_SLUG) {
    throw new Error('FEISHU_SOURCES_FILE 的 version 或 appSlug 与本应用不匹配');
  }
  if (!Array.isArray(config.sources) || config.sources.length === 0) throw new Error('FEISHU_SOURCES_FILE 未配置 sources');
  if (config.salesSources !== undefined && !Array.isArray(config.salesSources)) throw new Error('FEISHU_SOURCES_FILE 的 salesSources 必须是数组');
  const seen = new Set();
  for (const source of config.sources) {
    if (!source?.sourceKey || !source.spreadsheetToken || !Array.isArray(source.sheets) || !source.sheets.length) {
      throw new Error('FEISHU_SOURCES_FILE 存在不完整的 source 配置');
    }
    for (const sheet of source.sheets) {
      if (!sheet?.sheetId || !sheet.expectedTitle || !sheet.owner) throw new Error(`工作表 ${source.sourceKey} 缺少 sheetId、expectedTitle 或 owner`);
      const key = `${source.spreadsheetToken}:${sheet.sheetId}`;
      if (seen.has(key)) throw new Error(`FEISHU_SOURCES_FILE 存在重复工作表：${key}`);
      seen.add(key);
    }
  }
  for (const source of config.salesSources || []) {
    if (!source?.sourceKey || !source.spreadsheetToken || !Array.isArray(source.sheets) || !source.sheets.length) {
      throw new Error('FEISHU_SOURCES_FILE 存在不完整的 salesSource 配置');
    }
    for (const sheet of source.sheets) {
      if (!sheet?.sheetId || !sheet.expectedTitle) throw new Error(`销量工作表 ${source.sourceKey} 缺少 sheetId 或 expectedTitle`);
      const key = `${source.spreadsheetToken}:${sheet.sheetId}`;
      if (seen.has(key)) throw new Error(`FEISHU_SOURCES_FILE 存在重复工作表：${key}`);
      seen.add(key);
    }
  }
  return config;
}

async function responseJson(response, label) {
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch { throw new Error(`${label} 返回非 JSON：${body.slice(0, 300)}`); }
  if (!response.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`${label} 失败：${json.msg || json.message || `HTTP ${response.status}`}`);
  }
  return json;
}

export async function tenantAccessToken() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error('生产环境缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
  const response = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await responseJson(response, '获取飞书 tenant_access_token');
  if (!json.tenant_access_token) throw new Error('飞书未返回 tenant_access_token');
  return json.tenant_access_token;
}

function cell(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value.text ?? value.value ?? value.name ?? '';
    return { value: candidate, text: String(candidate ?? '') };
  }
  const text = Array.isArray(value)
    ? value.map((item) => item?.text ?? item?.value ?? item ?? '').join('')
    : String(value ?? '');
  return { value, text };
}

function columnName(number) {
  let value = Math.max(1, Number(number) || 1);
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

async function listSheets(accessToken, token) {
  const found = [];
  let pageToken = '';
  do {
    const url = new URL(`${API_BASE}/sheets/v3/spreadsheets/${encodeURIComponent(token)}/sheets/query`);
    url.searchParams.set('page_size', '100');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await responseJson(response, `读取飞书电子表格元数据 ${token.slice(0, 6)}…`);
    found.push(...(json.data?.sheets || []));
    pageToken = json.data?.page_token || '';
  } while (pageToken);
  return found;
}

async function validateSheetMetadata(accessToken, source, config) {
  const sheets = await listSheets(accessToken, source.spreadsheetToken);
  const actual = sheets.find((sheet) => String(sheet.sheet_id || sheet.sheetId) === String(config.sheetId));
  if (!actual) throw new Error(`飞书工作表不存在：${config.expectedTitle}（${config.sheetId}）`);
  const actualTitle = String(actual.title || actual.name || '');
  if (actualTitle !== config.expectedTitle) {
    throw new Error(`飞书工作表名称不匹配：${config.sheetId} 实际为“${actualTitle}”，期望“${config.expectedTitle}”`);
  }
  return { ...config, title: actualTitle };
}

function headerText(row) { return (row || []).map((value) => String(value?.text ?? value?.value ?? '').trim()); }

async function readSheet(accessToken, source, config, defaultRequiredHeaders = ['申诉日期', '产品', 'ASIN', '评论链接', '星级', '评论日期', '申诉方向', '申诉状态', '二次申诉状态']) {
  const range = `${config.sheetId}!A1:${columnName(Number(config.maxCols || process.env.FEISHU_REVIEW_MAX_COLS || DEFAULT_MAX_COLS))}${Number(config.maxRows || process.env.FEISHU_REVIEW_MAX_ROWS || DEFAULT_MAX_ROWS)}`;
  const url = new URL(`${API_BASE}/sheets/v2/spreadsheets/${encodeURIComponent(source.spreadsheetToken)}/values_batch_get`);
  url.searchParams.set('ranges', range);
  url.searchParams.set('valueRenderOption', 'ToString');
  url.searchParams.set('dateTimeRenderOption', 'FormattedString');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await responseJson(response, `读取飞书工作表 ${config.expectedTitle}`);
  const valueRange = json.data?.valueRanges?.[0] || json.data?.valueRange || json.data?.value_ranges?.[0];
  const matrix = valueRange?.values || [];
  const rows = [];
  let actualColCount = 0;
  matrix.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row.map(cell) : [];
    actualColCount = Math.max(actualColCount, values.length);
    if (values.some((item) => item.text !== '' || (item.value !== null && item.value !== undefined && item.value !== ''))) rows.push({ row: rowIndex, values });
  });
  const headers = headerText(rows[0]?.values);
  if (rows.length < Number(config.minRows || 2)) throw new Error(`工作表“${config.expectedTitle}”未读取到足够数据`);
  if (actualColCount < Number(config.minCols || 1)) throw new Error(`工作表“${config.expectedTitle}”缺少必需列：实际 ${actualColCount} 列`);
  const normalizeHeader = (value) => String(value ?? '').replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
  const requiredHeaders = config.requiredHeaders || defaultRequiredHeaders;
  const normalizedHeaders = headers.map(normalizeHeader);
  const missing = requiredHeaders.filter((header) => !normalizedHeaders.includes(normalizeHeader(header)));
  if (missing.length) throw new Error(`工作表“${config.expectedTitle}”缺少必需字段：${missing.join('、')}`);
  return { id: config.sheetId, name: config.expectedTitle, owner: config.owner, sourceKey: source.sourceKey, rowCount: matrix.length, colCount: actualColCount, headers, rows };
}

export async function readReviewSources() {
  const config = await loadSourceConfig();
  const accessToken = await tenantAccessToken();
  const result = { extractedAt: new Date().toISOString(), configVersion: config.version, sources: {} };
  for (const source of config.sources) {
    const sheets = [];
    for (const sheetConfig of source.sheets) {
      const validated = await validateSheetMetadata(accessToken, source, sheetConfig);
      sheets.push(await readSheet(accessToken, source, validated));
    }
    result.sources[source.sourceKey] = {
      spreadsheetTokenMasked: `${source.spreadsheetToken.slice(0, 6)}…${source.spreadsheetToken.slice(-4)}`,
      sheets,
    };
  }
  result.salesSources = {};
  for (const source of config.salesSources || []) {
    const sheets = [];
    for (const sheetConfig of source.sheets) {
      const validated = await validateSheetMetadata(accessToken, source, sheetConfig);
      sheets.push(await readSheet(accessToken, source, validated, ['年份', '周数', 'ASIN', '销量']));
    }
    result.salesSources[source.sourceKey] = {
      spreadsheetTokenMasked: `${source.spreadsheetToken.slice(0, 6)}…${source.spreadsheetToken.slice(-4)}`,
      sheets,
    };
  }
  return result;
}

export async function readConfiguredSourceSummary() {
  const config = await loadSourceConfig();
  return { version: config.version, sources: config.sources.map((source) => ({ sourceKey: source.sourceKey, spreadsheetTokenMasked: `${source.spreadsheetToken.slice(0, 6)}…${source.spreadsheetToken.slice(-4)}`, sheets: source.sheets.map((sheet) => ({ sheetId: sheet.sheetId, expectedTitle: sheet.expectedTitle, owner: sheet.owner })) })), salesSources: (config.salesSources || []).map((source) => ({ sourceKey: source.sourceKey, spreadsheetTokenMasked: `${source.spreadsheetToken.slice(0, 6)}…${source.spreadsheetToken.slice(-4)}`, sheets: source.sheets.map((sheet) => ({ sheetId: sheet.sheetId, expectedTitle: sheet.expectedTitle })) })) };
}
