const API_BASE = 'https://open.feishu.cn/open-apis';

export const FEISHU_SHEETS = [
  { name: '所有产品对应表', id: '0AyhfQ', minRows: 50, minCols: 13 },
  { name: 'Coupon对应表', id: 'mMzAyH', minRows: 80, minCols: 2 },
  { name: '硬件_2026年目标数据', id: '5IvgIM', minRows: 280, minCols: 30 },
  { name: 'PM_年月数据', id: '1rDHzo', minRows: 900, minCols: 33 },
  { name: 'PM_周度数据', id: 's7I1hc', minRows: 2200, minCols: 30 },
  { name: '领星_月度订单利润', id: '2yzuLZ', minRows: 250, minCols: 70 },
  { name: '领星_周度订单利润', id: '3XByVf', minRows: 2700, minCols: 40 },
  { name: '库存表', id: 'DXEtyQ', minRows: 2, minCols: 102 },
];

const tokenFromUrl = () => process.env.FEISHU_SPREADSHEET_TOKEN || 'R4Bks0mjWhnjDbtYmwdcffFsnZd';

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
  if (!appId || !appSecret) throw new Error('缺少 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
  const response = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await responseJson(response, '获取飞书访问令牌');
  if (!json.tenant_access_token) throw new Error('飞书未返回 tenant_access_token');
  return json.tenant_access_token;
}

function cell(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value.text ?? value.value ?? value.name ?? '';
    return { value: candidate, text: String(candidate ?? '') };
  }
  const text = Array.isArray(value) ? value.map((item) => item?.text ?? item?.value ?? item ?? '').join('') : String(value ?? '');
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

async function querySheetMetadata(accessToken) {
  const url = `${API_BASE}/sheets/v3/spreadsheets/${encodeURIComponent(tokenFromUrl())}/sheets/query`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await responseJson(response, '获取飞书工作表列表');
  return json.data?.sheets || [];
}

export async function readSheet(accessToken, sheet) {
  const rowCount = Math.max(Number(sheet.rowCount) || 0, sheet.minRows || 1);
  const colCount = Math.max(Number(sheet.colCount) || 0, sheet.minCols || 1);
  const range = `${sheet.id}!A1:${columnName(colCount)}${rowCount}`;
  const url = new URL(`${API_BASE}/sheets/v2/spreadsheets/${encodeURIComponent(tokenFromUrl())}/values_batch_get`);
  url.searchParams.set('ranges', range);
  url.searchParams.set('valueRenderOption', 'ToString');
  url.searchParams.set('dateTimeRenderOption', 'FormattedString');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await responseJson(response, `读取${sheet.name}（范围 ${range}）`);
  const valueRange = json.data?.valueRanges?.[0] || json.data?.valueRange || json.data?.value_ranges?.[0];
  const matrix = valueRange?.values || [];
  const rows = [];
  let actualColCount = 0;
  matrix.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row.map(cell) : [];
    actualColCount = Math.max(actualColCount, values.length);
    if (values.some((item) => item.text !== '' || (item.value !== null && item.value !== undefined && item.value !== ''))) rows.push({ row: rowIndex, values });
  });
  if (rows.length < sheet.minRows) throw new Error(`${sheet.name} 只读取到 ${rows.length} 行，低于安全下限 ${sheet.minRows} 行`);
  if (actualColCount < sheet.minCols) throw new Error(`${sheet.name} 只读取到 ${actualColCount} 列，低于安全下限 ${sheet.minCols} 列`);
  return { id: sheet.id, name: sheet.name, rowCount: matrix.length, colCount: actualColCount, rows };
}

export async function readAllSheets() {
  const accessToken = await tenantAccessToken();
  const metadata = await querySheetMetadata(accessToken);
  const metadataByTitle = new Map(metadata.map((sheet) => [String(sheet.title || '').trim(), sheet]));
  const sheets = {};
  for (const configured of FEISHU_SHEETS) {
    const live = metadataByTitle.get(configured.name);
    if (!live?.sheet_id) throw new Error(`找不到飞书工作表“${configured.name}”，请检查表名是否被修改`);
    const grid = live.grid_properties || {};
    sheets[configured.name] = await readSheet(accessToken, {
      ...configured,
      id: live.sheet_id,
      rowCount: grid.row_count,
      colCount: grid.column_count,
    });
  }
  return { source: `https://open.feishu.cn/sheets/${tokenFromUrl()}`, extractedAt: new Date().toISOString(), sheets };
}