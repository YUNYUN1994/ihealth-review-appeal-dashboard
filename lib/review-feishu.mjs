const API_BASE = 'https://open.feishu.cn/open-apis';

const OLD_TOKEN = () => process.env.FEISHU_REVIEW_OLD_SPREADSHEET_TOKEN || 'L58cs18QnhC9ketyJUYcJhQNnZe';
const NEW_TOKEN = () => process.env.FEISHU_REVIEW_NEW_SPREADSHEET_TOKEN || 'Zoa9sSFYhhUYRutX1yOcoObTnFf';

const OLD_SHEETS = [
  { name: '550lt+血氧-丰仪', id: 'XkWmDj', owner: '丰仪' },
  { name: '5811黑+723se-邵靖', id: 'erEUvD', owner: '邵靖' },
  { name: '723+300cl-李欢', id: 'a1LEsq', owner: '李欢' },
  { name: '5811白色+验孕4款-盼文', id: 'Qr7Ydw', owner: '盼文' },
];
const NEW_SHEETS = [{ name: '申诉记录', id: '5d73a2', owner: '晕晕+欧阳' }];

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

async function readSheet(accessToken, spreadsheetToken, config) {
  const range = `${config.id}!A1:${columnName(Number(process.env.FEISHU_REVIEW_MAX_COLS || 24))}${Number(process.env.FEISHU_REVIEW_MAX_ROWS || 5000)}`;
  const url = new URL(`${API_BASE}/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values_batch_get`);
  url.searchParams.set('ranges', range);
  url.searchParams.set('valueRenderOption', 'ToString');
  url.searchParams.set('dateTimeRenderOption', 'FormattedString');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await responseJson(response, `读取飞书工作表 ${config.name}`);
  const valueRange = json.data?.valueRanges?.[0] || json.data?.valueRange || json.data?.value_ranges?.[0];
  const matrix = valueRange?.values || [];
  const rows = [];
  let actualColCount = 0;
  matrix.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row.map(cell) : [];
    actualColCount = Math.max(actualColCount, values.length);
    if (values.some((item) => item.text !== '' || (item.value !== null && item.value !== undefined && item.value !== ''))) rows.push({ row: rowIndex, values });
  });
  if (rows.length <= 1) throw new Error(`工作表“${config.name}”未读取到有效数据`);
  return { id: config.id, name: config.name, owner: config.owner, rowCount: matrix.length, colCount: actualColCount, rows };
}

export async function readReviewSources() {
  const accessToken = await tenantAccessToken();
  const oldSheets = await Promise.all(OLD_SHEETS.map((sheet) => readSheet(accessToken, OLD_TOKEN(), sheet)));
  const newSheets = await Promise.all(NEW_SHEETS.map((sheet) => readSheet(accessToken, NEW_TOKEN(), sheet)));
  return {
    extractedAt: new Date().toISOString(),
    sources: {
      old: `https://open.feishu.cn/sheets/${OLD_TOKEN()}`,
      new: `https://open.feishu.cn/sheets/${NEW_TOKEN()}`,
    },
    old: { sheets: oldSheets },
    newer: { sheets: newSheets },
  };
}
