import fs from 'node:fs';
import path from 'node:path';

const inputFile = path.resolve(process.argv[2] || 'feishu-raw.json');
const outputFile = path.resolve(process.argv[3] || 'amazon-data.js');
const raw = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const cleanText = (value) => String(value ?? '').replace(/[⾎]/g, '血').trim();
const keyText = (value) => cleanText(value).toUpperCase();
const valueAt = (row, index) => row?.values?.[index]?.value;
const textAt = (row, index) => row?.values?.[index]?.text ?? valueAt(row, index);
const isBlank = (value) => value === null || value === undefined || value === '' || value === '***';
const numberOrNull = (value) => {
  if (isBlank(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/[,$\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};
const absNumberOrNull = (value) => {
  const number = numberOrNull(value);
  return number === null ? null : Math.abs(number);
};

function ownerName(value) {
  const owner = cleanText(value);
  return owner === '550BT' ? '550' : owner || '其他';
}

function monthKey(value, text = '') {
  const source = String(text || value || '');
  const match = source.match(/(20\d{2})[^0-9]?(\d{1,2})/);
  return match ? `${match[1]}-${String(match[2]).padStart(2, '0')}` : '';
}

function yearFromMonth(month) {
  const match = String(month).match(/^(20\d{2})-/);
  return match ? Number(match[1]) : null;
}

function quarterForMonth(month) {
  const match = String(month).match(/-(\d{2})$/);
  if (!match) return '';
  return `Q${Math.ceil(Number(match[1]) / 3)}`;
}

function weekNumber(value) {
  const match = String(value || '').match(/(?:Week|W)\s*0*(\d{1,2})/i);
  return match ? Number(match[1]) : null;
}

function weekKey(year, value) {
  const number = weekNumber(value);
  return number === null ? '' : `${Number(year)}|${String(value).trim()}|${String(number).padStart(2, '0')}`;
}

function productRecord(row) {
  const asin = cleanText(valueAt(row, 0));
  const msku = cleanText(valueAt(row, 1));
  const line = cleanText(valueAt(row, 3));
  const lifecycle = cleanText(valueAt(row, 4));
  const owner = ownerName(valueAt(row, 5));
  const type = cleanText(valueAt(row, 12)) || '未匹配';
  return {
    asin,
    sku: msku,
    line: line || '未匹配',
    lifecycle: lifecycle || '未匹配',
    owner,
    type,
    testCount: numberOrNull(valueAt(row, 6)),
  };
}

const productRows = raw.sheets['所有产品对应表'].rows.slice(1).map(productRecord).filter((row) => row.asin || row.sku);
const targetSkuKeys = new Set(raw.sheets['硬件_2026年目标数据'].rows.slice(1).map((row) => keyText(valueAt(row, 0))).filter(Boolean));
const byAsin = new Map();
const bySku = new Map();
for (const product of productRows) {
  if (product.asin) {
    const candidates = byAsin.get(keyText(product.asin)) || [];
    candidates.push(product);
    byAsin.set(keyText(product.asin), candidates);
  }
  if (product.sku) bySku.set(keyText(product.sku), product);
}

function mapProduct({ asin = '', sku = '', line = '', lifecycle = '', owner = '', type = '' } = {}) {
  const asinCandidates = byAsin.get(keyText(asin)) || [];
  const mapped = asinCandidates.find((candidate) => targetSkuKeys.has(keyText(candidate.sku))) || asinCandidates[0] || bySku.get(keyText(sku));
  return {
    sku: cleanText(sku) || mapped?.sku || cleanText(asin) || '未匹配',
    asin: cleanText(asin) || mapped?.asin || '',
    line: cleanText(line) || mapped?.line || '未匹配',
    lifecycle: cleanText(lifecycle) || mapped?.lifecycle || '未匹配',
    owner: ownerName(owner || mapped?.owner),
    type: cleanText(type) || mapped?.type || '未匹配',
  };
}

function actualRow({ source, grain, period, year, week = '', weekRange = '', store = '', product, values, sourceRow, metrics, refundQty, refundRate }) {
  const row = {
    id: `${source}-${grain}-${sourceRow}`,
    source,
    grain,
    sourceRow,
    year,
    period,
    quarter: grain === 'month' ? quarterForMonth(period) : '',
    week,
    weekRange: cleanText(weekRange),
    store: cleanText(store),
    ...product,
    qty: numberOrNull(values.qty),
    sales: numberOrNull(values.sales),
    netSales: numberOrNull(values.netSales),
    returns: numberOrNull(values.returns),
    profit: numberOrNull(values.profit),
    adSpend: absNumberOrNull(values.adSpend),
    refundQty: numberOrNull(refundQty),
    refundRate: numberOrNull(refundRate),
    promoRate: numberOrNull(values.promoRate),
  };
  if (row.promoRate === null && row.sales !== null && row.sales !== 0 && row.adSpend !== null) row.promoRate = row.adSpend / Math.abs(row.sales);
  if (row.refundRate === null && row.qty !== null && row.qty !== 0 && row.refundQty !== null) row.refundRate = row.refundQty / Math.abs(row.qty);
  return row;
}

function parsePmMonth() {
  const rows = raw.sheets['PM_年月数据'].rows.slice(1);
  return rows.map((row) => {
    const month = monthKey(valueAt(row, 1), textAt(row, 1));
    const product = mapProduct({ sku: valueAt(row, 3), asin: valueAt(row, 4) });
    return actualRow({
      source: 'pm', grain: 'month', period: month, year: yearFromMonth(month), product, sourceRow: row.row,
      values: { qty: valueAt(row, 5), sales: valueAt(row, 6), netSales: valueAt(row, 29), returns: valueAt(row, 19), profit: valueAt(row, 24), adSpend: valueAt(row, 11), promoRate: valueAt(row, 26) },
      refundQty: valueAt(row, 16), refundRate: valueAt(row, 17),
    });
  }).filter((row) => row.period && row.sku !== '未匹配');
}

function parsePmWeek() {
  const rows = raw.sheets['PM_周度数据'].rows.slice(1);
  return rows.map((row) => {
    const year = Number(valueAt(row, 0));
    const rawWeek = cleanText(valueAt(row, 1));
    const product = mapProduct({ sku: valueAt(row, 3) });
    return actualRow({
      source: 'pm', grain: 'week', period: weekKey(year, rawWeek), year, week: rawWeek, weekRange: valueAt(row, 2), product, sourceRow: row.row,
      values: { qty: valueAt(row, 4), sales: valueAt(row, 6), netSales: valueAt(row, 21), returns: valueAt(row, 18), profit: valueAt(row, 25), adSpend: valueAt(row, 13), promoRate: valueAt(row, 20) },
      refundQty: valueAt(row, 15), refundRate: valueAt(row, 27),
    });
  }).filter((row) => row.period && row.sku !== '未匹配');
}

function parseLxMonth() {
  const rows = raw.sheets['领星_月度订单利润'].rows.slice(1);
  return rows.map((row) => {
    const month = monthKey(valueAt(row, 0), textAt(row, 0));
    const product = mapProduct({ asin: valueAt(row, 1), sku: valueAt(row, 6), line: valueAt(row, 68), type: valueAt(row, 69) });
    return actualRow({
      source: 'lx', grain: 'month', period: month, year: yearFromMonth(month), product, sourceRow: row.row,
      store: valueAt(row, 3),
      values: { qty: valueAt(row, 17), sales: valueAt(row, 23), netSales: valueAt(row, 25), returns: valueAt(row, 13), profit: valueAt(row, 66), adSpend: valueAt(row, 43), promoRate: valueAt(row, 44) },
      refundQty: valueAt(row, 31), refundRate: valueAt(row, 33),
    });
  }).filter((row) => row.period && row.sku !== '未匹配');
}

function parseLxWeek() {
  const rows = raw.sheets['领星_周度订单利润'].rows.slice(1);
  return rows.map((row) => {
    const year = Number(valueAt(row, 0));
    const rawWeek = cleanText(valueAt(row, 1));
    // 领星周度的可用 SKU、产品线和分类是公式列 28、38、39；原始导入列 5 为空。
    const product = mapProduct({ asin: valueAt(row, 2), sku: valueAt(row, 28), line: valueAt(row, 38), type: valueAt(row, 39) });
    return actualRow({
      source: 'lx', grain: 'week', period: weekKey(year, rawWeek), year, week: rawWeek, weekRange: rawWeek, product, sourceRow: row.row,
      store: valueAt(row, 3),
      values: { qty: valueAt(row, 10), sales: valueAt(row, 15), netSales: valueAt(row, 16), returns: valueAt(row, 7), profit: valueAt(row, 36), adSpend: valueAt(row, 27), promoRate: valueAt(row, 37) },
      refundQty: valueAt(row, 21), refundRate: null,
    });
  }).filter((row) => row.period && row.sku !== '未匹配');
}

function parseTargets() {
  const rows = raw.sheets['硬件_2026年目标数据'].rows.slice(1);
  return rows.map((row) => {
    const month = monthKey(valueAt(row, 1), textAt(row, 1));
    const product = mapProduct({ sku: valueAt(row, 0), asin: valueAt(row, 29), line: valueAt(row, 26), lifecycle: valueAt(row, 27), owner: valueAt(row, 28) });
    return {
      id: `target-${row.row}`,
      source: 'target',
      grain: 'month',
      sourceRow: row.row,
      year: yearFromMonth(month),
      period: month,
      quarter: quarterForMonth(month),
      ...product,
      qty: numberOrNull(valueAt(row, 4)),
      sales: numberOrNull(valueAt(row, 8)),
      netSales: numberOrNull(valueAt(row, 9)),
      returns: numberOrNull(valueAt(row, 19)),
      profit: numberOrNull(valueAt(row, 24)),
      adSpend: numberOrNull(valueAt(row, 14)),
      promoRate: numberOrNull(valueAt(row, 16)),
      refundRate: numberOrNull(valueAt(row, 17)),
    };
  }).filter((row) => row.period && row.sku !== '未匹配');
}

const actuals = {
  pm: { month: parsePmMonth(), week: parsePmWeek() },
  lx: { month: parseLxMonth(), week: parseLxWeek() },
};
const targets = parseTargets();

function monthCutoff(dimension, latestPeriod) {
  if (!latestPeriod) return '';
  const [year, month] = latestPeriod.split('-').map(Number);
  let day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (dimension === 'lx') {
    const latestSource = raw.sheets['领星_月度订单利润'].rows.find((row) => monthKey(valueAt(row, 0), textAt(row, 0)) === latestPeriod);
    const partialDay = String(textAt(latestSource, 0) || '').match(/截至\s*(\d{1,2})\s*日/);
    if (partialDay) day = Number(partialDay[1]);
  }
  return `${latestPeriod}-${String(day).padStart(2, '0')}`;
}

function monthlyCoverage(dimension, rows) {
  const periods = [...new Set(rows.map((row) => row.period).filter(Boolean))].sort();
  const latestPeriod = periods[periods.length - 1] || '';
  if (!latestPeriod) return { latestPeriod: '', cutoff: '' };
  return { latestPeriod, cutoff: monthCutoff(dimension, latestPeriod), periods: Object.fromEntries(periods.map((period) => [period, monthCutoff(dimension, period)])) };
}

const periodSort = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const summarize = (rows) => {
  const years = [...new Set(rows.map((row) => row.year).filter(Boolean))].sort((a, b) => a - b);
  const periods = [...new Set(rows.map((row) => row.period).filter(Boolean))].sort(periodSort);
  const skus = new Set(rows.map((row) => row.sku).filter(Boolean));
  const missing = {};
  for (const field of ['qty', 'sales', 'netSales', 'returns', 'profit', 'adSpend', 'refundQty', 'refundRate', 'promoRate']) missing[field] = rows.filter((row) => row[field] === null).length;
  return { rows: rows.length, years, periods, skuCount: skus.size, missing };
};

const output = {
  generatedAt: new Date().toISOString(),
  source: raw.source,
  productMap: productRows,
  actuals,
  targets,
  coverage: {
    pm: { month: monthlyCoverage('pm', actuals.pm.month) },
    lx: { month: monthlyCoverage('lx', actuals.lx.month) },
  },
  audit: {
    productRows: productRows.length,
    actuals: { pm: { month: summarize(actuals.pm.month), week: summarize(actuals.pm.week) }, lx: { month: summarize(actuals.lx.month), week: summarize(actuals.lx.week) } },
    targets: summarize(targets),
  },
};

fs.writeFileSync(outputFile, `window.AMAZON_DATA = ${JSON.stringify(output)};`);
console.log(JSON.stringify(output.audit, null, 2));
