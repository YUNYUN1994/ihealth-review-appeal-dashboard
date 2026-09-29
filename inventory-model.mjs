const DAY = 86_400_000;
const clean = (value) => String(value ?? '').trim();
const asinKey = (value) => clean(value).toUpperCase();
const headerKey = (value) => clean(value).toLowerCase().replace(/[\s_-]+/g, '');
const cellValue = (row, index) => row?.values?.[index]?.value;
const cellText = (row, index) => row?.values?.[index]?.text || cellValue(row, index);
const blank = (value) => value === undefined || value === null || clean(value) === '';
const STOCK_COLUMNS = {
  available: 'available',
  processing: 'Reserved FC Processing',
  staging: 'Reserved Staging',
  received: 'inbound-received',
  noSale: 'no-sale-last-6-months',
  warehouseExpected: 'iHealth仓库-US 预计库存',
  oceanInTransit: '头程海上在途',
  factoryOpenOrders: 'iHealth Open 订单-工厂在执行订单',
};
// Explicit inventory selections take priority over equal-quantity deduplication.
const INVENTORY_SKU_OVERRIDES = {
  B00J6P2KB2: 'PO3-20151014',
  B0D3T1X1FS: 'COV-FLU-4',
};

export function inventoryLevel(weeks, basis = 'totalWeeks', type = '') {
  if (weeks === null || !Number.isFinite(weeks) || weeks < 0) return 'neutral';
  if (isTestKitType(type)) {
    // Test-kit available stock has a healthy range of 8–24 weeks. Keep
    // surplus above 24 weeks visible as a warning instead of treating it as
    // healthy indefinitely; the reserved and total stock bases retain their
    // minimum-only safety thresholds below.
    if (basis === 'availableWeeks') {
      if (weeks < 8) return 'red';
      if (weeks > 24) return 'yellow';
      return 'green';
    }
    const target = inventoryTargetsForType(type)[basis];
    if (Number.isFinite(target)) return weeks >= target ? 'green' : 'red';
  }
  if (basis === 'usLocalWeeks') {
    if (weeks > 24) return 'red';
    return weeks >= 18 && weeks <= 20 ? 'green' : 'yellow';
  }
  if (basis === 'endToEndWeeks') {
    if (weeks > 36) return 'red';
    return weeks >= 22 && weeks <= 24 ? 'green' : 'yellow';
  }
  if (weeks > 24) return 'red';
  if (weeks > 20) return 'orange';
  if (weeks > 12) return 'yellow';
  return 'green';
}

// Test kits have a tighter minimum coverage requirement than hardware.  Keep
// this helper in the model so the browser can apply the same rules when it
// renders a row and when callers consume the inventory JSON directly.
export function isTestKitType(type) {
  if (type === true) return true;
  const normalized = clean(type).toLowerCase().replace(/[\s_-]+/g, '');
  return normalized.includes('测试盒') || normalized.includes('试剂盒') || normalized.includes('testkit');
}

export function inventoryTargetsForType(type) {
  if (isTestKitType(type)) {
    return { isTestKit: true, availableWeeks: 8, reservedWeeks: 12, totalWeeks: 16 };
  }
  return { isTestKit: false, availableWeeks: null, reservedWeeks: null, totalWeeks: null };
}

function parseNumber(value) {
  if (blank(value)) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const normalized = typeof value === 'string' ? value.replace(/[,\s]/g, '') : value;
  if (typeof normalized === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function dateOnly(value) {
  const match = clean(value).match(/(?:^|\D)(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|\D|$)/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

function snapshotDateAt(row, index) {
  const displayed = dateOnly(cellText(row, index));
  if (displayed) return displayed;
  const value = cellValue(row, index);
  if (typeof value === 'number' && value >= 36_526 && value < 73_050) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * DAY).toISOString().slice(0, 10);
  }
  return null;
}

function findHeader(sheet) {
  const required = { asin: 'asin', sku: 'sku', ...STOCK_COLUMNS };
  let nearest = [];
  for (let index = 0; index < (sheet?.rows?.length || 0); index++) {
    const row = sheet.rows[index];
    const keys = (row.values || []).map((_, column) => headerKey(cellText(row, column)));
    const missing = Object.values(required).filter((name) => !keys.includes(headerKey(name)));
    if (!nearest.length || missing.length < nearest.length) nearest = missing;
    if (missing.length) continue;
    const columns = Object.fromEntries(Object.entries(required).map(([key, name]) => {
      const matches = keys.flatMap((value, column) => value === headerKey(name) ? [column] : []);
      if (matches.length !== 1) throw new Error(`库存表存在重复字段：${name}`);
      return [key, matches[0]];
    }));
    columns.snapshotDate = keys.indexOf(headerKey('snapshot-date'));
    columns.fnsku = keys.indexOf(headerKey('fnsku'));
    return { index, columns };
  }
  throw new Error(`库存表缺少必需字段：${nearest.join('、') || Object.values(required).join('、')}`);
}

function isoYearStart(year) {
  const date = new Date(Date.UTC(year, 0, 4));
  return date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY;
}

function weekInfo(row) {
  const year = Number(row.year);
  const match = clean(row.week || row.period).match(/(?:Week|W)\s*0*(\d{1,2})/i);
  const week = match ? Number(match[1]) : null;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !week || week > 53) return null;
  const isoStart = isoYearStart(year) + (week - 1) * 7 * DAY;
  let start = isoStart;
  let end = start + 6 * DAY;
  let invalidReason = '';
  const range = clean(row.weekRange || row.week).match(/(\d{1,2})[/.](\d{1,2})\s*[-–~至]\s*(\d{1,2})[/.](\d{1,2})/);
  if (!range && isoStart >= isoYearStart(year + 1)) invalidReason = '源表缺少周日期，且该周数不是有效 ISO 周';
  if (range) {
    const [startMonth, startDay, endMonth, endDay] = range.slice(1).map(Number);
    const dates = [year - 1, year, year + 1].map((candidateYear) => ({
      year: candidateYear, time: Date.UTC(candidateYear, startMonth - 1, startDay),
    })).sort((a, b) => Math.abs(a.time - isoStart) - Math.abs(b.time - isoStart));
    start = dates[0].time;
    const endYear = dates[0].year + (endMonth < startMonth ? 1 : 0);
    end = Date.UTC(endYear, endMonth - 1, endDay);
    if (new Date(start).getUTCMonth() !== startMonth - 1 || new Date(start).getUTCDate() !== startDay
      || new Date(end).getUTCMonth() !== endMonth - 1 || new Date(end).getUTCDate() !== endDay || end - start !== 6 * DAY) {
      invalidReason = '源表周日期不是完整七天，无法计算日均销量和可售周数';
    }
  }
  return {
    key: `${year}-W${String(week).padStart(2, '0')}`,
    period: row.period,
    year,
    week,
    start: new Date(start).toISOString().slice(0, 10),
    end: new Date(end).toISOString().slice(0, 10),
    label: `${year}年 Week${String(week).padStart(2, '0')}`,
    dateSource: range ? 'source' : 'iso-week-fallback',
    ...(invalidReason ? { invalidReason } : {}),
  };
}

function salesWindow(rows, count = 4) {
  const weeks = new Map();
  for (const row of rows) {
    const info = weekInfo(row);
    if (!info) continue;
    const existing = weeks.get(info.key);
    if (!existing) weeks.set(info.key, info);
    else if (info.invalidReason || existing.start !== info.start || existing.end !== info.end) {
      existing.invalidReason = info.invalidReason || '源表同一周的日期范围不一致';
    }
  }
  const periods = [...weeks.values()].sort((a, b) => a.year - b.year || a.week - b.week).slice(-count);
  const periodLabel = count === 4 ? '最近四周' : '最近两周';
  if (periods.length !== count) return { periods, valid: false, reason: `周度源表不足${count}个实际周，无法计算${periodLabel}日均销量` };
  const invalid = periods.find((period) => period.invalidReason);
  if (invalid) return { periods, valid: false, reason: invalid.invalidReason };
  for (let index = 1; index < periods.length; index += 1) {
    if (Date.parse(periods[index].start) - Date.parse(periods[index - 1].start) !== 7 * DAY) {
      return { periods, valid: false, reason: `${periodLabel}实际周不连续，无法计算${periodLabel}日均销量` };
    }
  }
  return { periods, valid: true, reason: '' };
}

function salesByAsin(rows, window) {
  const periods = new Set(window.periods.map((period) => period.key));
  const result = new Map();
  for (const row of rows) {
    const info = weekInfo(row);
    const asin = asinKey(row.asin);
    if (!asin || !info || !periods.has(info.key)) continue;
    if (!result.has(asin)) result.set(asin, new Map());
    const byWeek = result.get(asin);
    const entry = byWeek.get(info.key) || { qty: 0, invalid: false, rows: 0 };
    const qty = parseNumber(row.qty);
    entry.rows += 1;
    if (qty === null) entry.invalid = true;
    else entry.qty += qty;
    byWeek.set(info.key, entry);
  }
  return result;
}

// Build the four-week window one year before the current window.  Historical
// data is only used when every corresponding week is present; a partial prior
// year must never be treated as a complete comparison period.
function historicalWindow(rows, currentWindow) {
  if (!currentWindow?.valid || !currentWindow.periods?.length) {
    return { periods: [], valid: false, reason: '当前四周销量窗口无效，无法匹配历史同期' };
  }
  const byKey = new Map();
  for (const row of rows) {
    const info = weekInfo(row);
    if (!info) continue;
    const existing = byKey.get(info.key);
    if (!existing) byKey.set(info.key, info);
    else if (info.invalidReason || existing.start !== info.start || existing.end !== info.end) {
      existing.invalidReason = info.invalidReason || '源表同一周的日期范围不一致';
    }
  }
  const periods = currentWindow.periods.map((period) => byKey.get(`${period.year - 1}-W${String(period.week).padStart(2, '0')}`)).filter(Boolean);
  if (periods.length !== currentWindow.periods.length) {
    return { periods, valid: false, reason: '没有完整的去年同期四周销量数据' };
  }
  const invalid = periods.find((period) => period.invalidReason);
  if (invalid) return { periods, valid: false, reason: invalid.invalidReason };
  return { periods, valid: true, reason: '' };
}

function metricsFor(stock, window, sales) {
  const demand = demandMetricsFor(window, sales);
  const empty = { availableWeeks: null, reservedWeeks: null, totalWeeks: null, usLocalWeeks: null, endToEndWeeks: null };
  if (demand.status !== 'ok') return { ...demand, ...empty };
  const { dailySales } = demand;
  return {
    ...demand,
    availableWeeks: stock.available / (dailySales * 7),
    reservedWeeks: stock.availableReserved / (dailySales * 7),
    totalWeeks: stock.total / (dailySales * 7),
    usLocalWeeks: stock.usLocal / (dailySales * 7),
    endToEndWeeks: stock.endToEnd / (dailySales * 7),
  };
}

function demandMetricsFor(window, sales) {
  const empty = { recentQty: null, dailySales: null, status: 'insufficient-weeks', reason: window?.reason || '周度数据不足，无法计算日均销量' };
  if (!window?.valid) return empty;
  const periodLabel = window.periods.length === 4 ? '最近四周' : '最近两周';
  const missing = window.periods.filter((period) => !sales?.has(period.key));
  if (missing.length) return { ...empty, status: 'missing-sales', reason: `该 ASIN 缺少 ${missing.map((period) => period.label).join('、')} 销量记录` };
  if ([...sales.values()].some((entry) => entry.invalid)) {
    return { ...empty, status: 'missing-sales', reason: `${periodLabel}存在空白或无效销量，暂不计算日均销量和可售周数` };
  }
  const recentQty = [...sales.values()].reduce((total, entry) => total + entry.qty, 0);
  const dailySales = recentQty / (window.periods.length * 7);
  return { recentQty, dailySales, status: recentQty > 0 ? 'ok' : 'zero-sales', reason: recentQty > 0 ? '' : `${periodLabel}销量为零或负数，无法计算可售周数` };
}

function replenishmentFor(stock, isTestKit, currentWindow, currentSales, historicalWindowInfo, historicalSales, recent7Window, recent7Sales, recent30Window, recent30Sales, asOfDate) {
  const targetWeeks = 12;
  const base = {
    status: isTestKit ? 'no-demand' : 'insufficient-data',
    currentAvailableReserved: stock.availableReserved,
    forecastNextWeekQty: null,
    targetWeeks,
    recommendedQty: 0,
    basis: isTestKit ? '当前最近四周实际销量；有完整历史同期时按 80%/20% 加权' : '近7天与近30天完整周销量，预测日均取两者较高值；按3周到货并提前2周执行',
    reason: '',
    current4WeekQty: null,
    historical4WeekQty: null,
  };
  if (!isTestKit) {
    const r7 = demandMetricsFor(recent7Window, recent7Sales);
    const r30 = demandMetricsFor(recent30Window, recent30Sales);
    base.recent7DayQty = r7.recentQty; base.recent30DayQty = r30.recentQty;
    base.recent7DailySales = r7.dailySales; base.recent30DailySales = r30.dailySales;
    const daily = Math.max(r7.dailySales || 0, r30.dailySales || 0);
    if (!(daily > 0)) { base.status = 'no-demand'; base.reason = '近7天和近30天没有有效销量，暂不建议补货'; return base; }
    const leadTimeDays = 21, executionLeadDays = 14, targetCoverageDays = 35;
    const coverageDays = stock.availableReserved / daily;
    const executionDate = new Date(`${asOfDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    if (coverageDays > targetCoverageDays) executionDate.setUTCDate(executionDate.getUTCDate() + Math.ceil(coverageDays - targetCoverageDays));
    const iso = (d) => d.toISOString().slice(0, 10);
    const arrivalDate = new Date(executionDate); arrivalDate.setUTCDate(arrivalDate.getUTCDate() + leadTimeDays);
    base.status = 'ok'; base.forecastDailySales = daily; base.leadTimeDays = leadTimeDays; base.executionLeadDays = executionLeadDays;
    base.targetCoverageDays = targetCoverageDays; base.coverageDays = coverageDays; base.coverageWeeks = coverageDays / 7;
    base.executionDate = iso(executionDate); base.arrivalDate = iso(arrivalDate);
    base.executionTiming = coverageDays <= targetCoverageDays ? '现在执行' : (coverageDays <= targetCoverageDays + executionLeadDays ? '未来两周内执行' : '计划执行');
    base.recommendedQty = Math.max(0, Math.ceil(daily * targetCoverageDays - stock.availableReserved));
    base.reason = base.recommendedQty > 0 ? `预计${base.executionTiming}，需覆盖到货前及提前执行缓冲` : '当前库存覆盖目标周期，暂不需要补货';
    return base;
  }

  const current = demandMetricsFor(currentWindow, currentSales);
  const history = historicalWindowInfo?.valid
    ? demandMetricsFor(historicalWindowInfo, historicalSales)
    : { status: 'missing-sales', recentQty: null, dailySales: null, reason: historicalWindowInfo?.reason || '没有完整的历史同期销量数据' };
  base.current4WeekQty = current.recentQty;
  base.historical4WeekQty = history.recentQty;
  // A zero-sales current window is an explicit no-demand signal.  Do not let
  // an older seasonal window create a replenishment order when this year's
  // actual sales are currently zero.
  if (current.status !== 'ok') {
    base.forecastNextWeekQty = 0;
    base.reason = current.status === 'zero-sales'
      ? '当前及历史同期没有有效销量，不建议补货'
      : current.reason || '最近四周销量不足，无法预测下周销量';
    return base;
  }

  const currentWeekly = Number.isFinite(current.recentQty) ? current.recentQty / 4 : 0;
  const historicalWeekly = history.status === 'ok' && Number.isFinite(history.recentQty) ? history.recentQty / 4 : null;
  // Current-year demand carries the larger weight.  Historical data only
  // participates when the complete corresponding four-week window exists.
  const hasHistory = Number.isFinite(historicalWeekly);
  const forecastNextWeekQty = hasHistory ? currentWeekly * 0.8 + historicalWeekly * 0.2 : currentWeekly;
  base.forecastNextWeekQty = forecastNextWeekQty;
  base.basis = hasHistory
    ? '当前最近四周实际 80% + 历史同期四周实际 20%'
    : '当前最近四周实际（无完整历史同期数据）';
  if (!(forecastNextWeekQty > 0)) {
    base.reason = '当前及历史同期没有有效销量，不建议补货';
    base.recommendedQty = 0;
    return base;
  }
  // The order placed now should cover the coming week plus the desired
  // twelve-week available+reserved buffer.
  base.recommendedQty = Math.max(0, Math.ceil(forecastNextWeekQty * (targetWeeks + 1) - stock.availableReserved));
  base.status = 'ok';
  base.reason = base.recommendedQty > 0
    ? `可售+预留库存不足未来 1 周销量及 ${targetWeeks} 周安全库存`
    : `可售+预留库存已覆盖未来 1 周销量及 ${targetWeeks} 周安全库存`;
  return base;
}

const emptyQuantities = () => Object.fromEntries(Object.keys(STOCK_COLUMNS).map((field) => [field, 0]));
function addQuantities(target, quantities) {
  for (const field of Object.keys(STOCK_COLUMNS)) target[field] += quantities[field];
  return target;
}
function quantityTotals(quantities) {
  const reserved = quantities.processing + quantities.staging;
  const inbound = quantities.received + quantities.noSale;
  const availableReserved = quantities.available + reserved;
  const total = availableReserved + inbound;
  const usLocal = total + quantities.warehouseExpected;
  const endToEnd = usLocal + quantities.oceanInTransit + quantities.factoryOpenOrders;
  return { ...quantities, reserved, inbound, availableReserved, total, usLocal, endToEnd };
}

/** Compare SKU and ASIN together; distinct SKUs sharing all eight stock quantities count once per ASIN. */
export function buildInventory({ sheet, productRows = [], actuals = {}, extractedAt = null }) {
  if (!sheet) throw new Error('未找到库存表，不能发布缺失库存的数据');
  const { index: headerIndex, columns } = findHeader(sheet);
  const audit = {
    sourceRows: 0, asinCount: 0, duplicateAsinRows: 0,
    historicalRowsIgnored: 0, blankRowsIgnored: 0,
    blankCellsByColumn: Object.fromEntries(Object.values(STOCK_COLUMNS).map((name) => [name, 0])),
    blankInventoryConvention: '库存数量空白按0计；缺失销量不按0计',
    unmatchedAsins: [], mappingConflicts: [], identifierConflicts: [], duplicateFnsku: [], deduplicatedGroups: [], skuOverrides: [],
    countedSourceRows: 0, deduplicatedRows: 0, deduplicatedSkuGroups: 0,
    columns: Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, column])),
  };
  const candidates = [];
  for (const row of sheet.rows.slice(headerIndex + 1)) {
    const asin = asinKey(cellValue(row, columns.asin));
    if (!asin) {
      if ((row.values || []).some((cell) => !blank(cell?.value))) throw new Error(`库存表第 ${row.row + 1} 行 ASIN 为空`);
      audit.blankRowsIgnored += 1;
      continue;
    }
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error(`库存表第 ${row.row + 1} 行 ASIN 无效：${asin}`);
    const snapshotDate = columns.snapshotDate >= 0 ? snapshotDateAt(row, columns.snapshotDate) : null;
    if (columns.snapshotDate >= 0 && !snapshotDate) throw new Error(`库存表第 ${row.row + 1} 行 snapshot-date 无效或为空`);
    candidates.push({ row, asin, snapshotDate });
  }
  if (!candidates.length) throw new Error('库存表没有有效数据行');
  const snapshotDates = [...new Set(candidates.map((entry) => entry.snapshotDate).filter(Boolean))].sort();
  const snapshotDate = snapshotDates.at(-1) || dateOnly(sheet.snapshotDate || sheet.title || sheet.name);
  const selected = candidates.filter((entry) => !entry.snapshotDate || entry.snapshotDate === snapshotDate);
  audit.historicalRowsIgnored = candidates.length - selected.length;
  const products = new Map();
  const productsBySku = new Map();
  for (const row of productRows) {
    const asin = asinKey(row.asin);
    if (asin) {
      const entries = products.get(asin) || [];
      entries.push(row);
      products.set(asin, entries);
    }
    const sku = asinKey(row.sku);
    if (sku) {
      const entries = productsBySku.get(sku) || [];
      entries.push(row);
      productsBySku.set(sku, entries);
    }
  }
  const grouped = new Map();
  const byFnsku = new Map();
  const sourceQuantities = emptyQuantities();
  const removedQuantities = emptyQuantities();
  for (const { row, asin } of selected) {
    const quantities = {};
    for (const [key, name] of Object.entries(STOCK_COLUMNS)) {
      const rawValue = cellValue(row, columns[key]);
      if (blank(rawValue)) {
        quantities[key] = 0;
        audit.blankCellsByColumn[name] += 1;
      } else {
        const value = parseNumber(rawValue);
        if (value === null || value < 0) throw new Error(`库存表第 ${row.row + 1} 行 ${name} 不是有效非负数量：${clean(rawValue)}`);
        quantities[key] = value;
      }
    }
    addQuantities(sourceQuantities, quantities);
    const sku = columns.sku >= 0 ? clean(cellValue(row, columns.sku)) : '';
    const fnsku = columns.fnsku >= 0 ? asinKey(cellValue(row, columns.fnsku)) : '';
    if (fnsku) {
      const key = `${asin}|${fnsku}`;
      const entries = byFnsku.get(key) || [];
      entries.push({
        sourceRow: row.row,
        sku,
        ...quantities,
      });
      byFnsku.set(key, entries);
    }
    const group = grouped.get(asin) || { asin, sourceRows: [], skuGroups: new Map() };
    group.sourceRows.push(row.row);
    const skuGroup = group.skuGroups.get(asinKey(sku)) || { sku, sourceRows: [], quantities: emptyQuantities() };
    skuGroup.sourceRows.push(row.row);
    addQuantities(skuGroup.quantities, quantities);
    group.skuGroups.set(asinKey(sku), skuGroup);
    grouped.set(asin, group);
  }
  const stocks = [];
  const removedRows = new Set();
  const duplicateRows = new Set();
  const overrideRows = new Set();
  const overrideQuantities = emptyQuantities();
  const duplicateQuantities = emptyQuantities();
  for (const group of grouped.values()) {
    const signatures = new Map();
    const counted = emptyQuantities();
    const skippedRows = new Set();
    const preferredSku = INVENTORY_SKU_OVERRIDES[group.asin];
    let skuGroups = [...group.skuGroups.values()];
    let skuOverride = null;
    if (preferredSku) {
      const preferred = group.skuGroups.get(asinKey(preferredSku));
      if (!preferred) throw new Error(`库存特殊规则：${group.asin} 缺少指定 SKU ${preferredSku}，不能改取其他 SKU`);
      const excluded = skuGroups.filter((entry) => entry !== preferred);
      const quantities = emptyQuantities();
      for (const entry of excluded) {
        addQuantities(quantities, entry.quantities);
        for (const sourceRow of entry.sourceRows) {
          overrideRows.add(sourceRow);
          removedRows.add(sourceRow);
        }
      }
      addQuantities(removedQuantities, quantities);
      addQuantities(overrideQuantities, quantities);
      skuOverride = {
        asin: group.asin, sku: preferredSku, keptSourceRows: [...preferred.sourceRows],
        excludedSkus: excluded.map((entry) => entry.sku),
        excludedSourceRows: excluded.flatMap((entry) => entry.sourceRows),
        removedQuantities: quantityTotals(quantities),
      };
      audit.skuOverrides.push(skuOverride);
      skuGroups = [preferred];
    }
    for (const skuGroup of skuGroups) {
      const signature = JSON.stringify(Object.keys(STOCK_COLUMNS).map((field) => skuGroup.quantities[field]));
      // A missing SKU is not evidence of a different SKU, so keep its rows additive.
      const existing = skuGroup.sku ? signatures.get(signature) : null;
      if (existing) {
        if (!existing.audit) {
          existing.audit = {
            asin: group.asin, keptSku: existing.group.sku, skippedSkus: [],
            sourceRows: [...existing.group.sourceRows], keptSourceRows: [...existing.group.sourceRows], skippedSourceRows: [],
            removedQuantities: emptyQuantities(),
          };
          audit.deduplicatedGroups.push(existing.audit);
        }
        existing.audit.skippedSkus.push(skuGroup.sku);
        existing.audit.sourceRows.push(...skuGroup.sourceRows);
        existing.audit.skippedSourceRows.push(...skuGroup.sourceRows);
        addQuantities(existing.audit.removedQuantities, skuGroup.quantities);
        addQuantities(removedQuantities, skuGroup.quantities);
        addQuantities(duplicateQuantities, skuGroup.quantities);
        for (const sourceRow of skuGroup.sourceRows) {
          skippedRows.add(sourceRow);
          duplicateRows.add(sourceRow);
          removedRows.add(sourceRow);
        }
        audit.deduplicatedSkuGroups += 1;
      } else {
        addQuantities(counted, skuGroup.quantities);
        if (skuGroup.sku) signatures.set(signature, { group: skuGroup, audit: null });
      }
    }
    const exact = [];
    const skuWithoutAsin = [];
    for (const skuGroup of skuGroups) {
      if (!skuGroup.sku) continue;
      const skuCandidates = productsBySku.get(asinKey(skuGroup.sku)) || [];
      const matching = skuCandidates.filter((product) => asinKey(product.asin) === group.asin);
      const noAsin = skuCandidates.filter((product) => !asinKey(product.asin));
      exact.push(...matching);
      skuWithoutAsin.push(...noAsin);
      if (skuCandidates.length && !matching.length && !noAsin.length) {
        audit.identifierConflicts.push({
          asin: group.asin, sku: skuGroup.sku,
          productAsins: [...new Set(skuCandidates.map((product) => asinKey(product.asin)))],
          sourceRows: [...skuGroup.sourceRows],
        });
      }
    }
    const asinCandidates = products.get(group.asin) || [];
    const mappings = [...new Set(exact.length ? exact : skuWithoutAsin.length ? skuWithoutAsin : asinCandidates)];
    const mappingMethod = exact.length ? 'sku-asin' : skuWithoutAsin.length ? 'sku-without-asin' : asinCandidates.length ? 'asin' : 'unmatched';
    stocks.push({
      asin: group.asin,
      sourceRows: group.sourceRows,
      countedSourceRows: group.sourceRows.filter((sourceRow) => !removedRows.has(sourceRow)),
      deduplicatedSourceRows: group.sourceRows.filter((sourceRow) => skippedRows.has(sourceRow)),
      deduplicatedRows: skippedRows.size,
      skuOverride,
      inventorySkus: [...group.skuGroups.values()].map((entry) => entry.sku).filter(Boolean),
      ...quantityTotals(counted),
      mappings, mappingMethod,
    });
  }
  for (const group of audit.deduplicatedGroups) group.removedQuantities = quantityTotals(group.removedQuantities);
  for (const [key, entries] of byFnsku) {
    if (entries.length < 2) continue;
    const [asin, fnsku] = key.split('|');
    audit.duplicateFnsku.push({
      asin, fnsku,
      sourceRows: entries.map((entry) => entry.sourceRow),
      countedSourceRows: entries.filter((entry) => !removedRows.has(entry.sourceRow)).map((entry) => entry.sourceRow),
      deduplicatedSourceRows: entries.filter((entry) => duplicateRows.has(entry.sourceRow)).map((entry) => entry.sourceRow),
      overrideExcludedSourceRows: entries.filter((entry) => overrideRows.has(entry.sourceRow)).map((entry) => entry.sourceRow),
      identicalStock: entries.every((entry) => Object.keys(STOCK_COLUMNS).every((field) => entry[field] === entries[0][field])),
      entries,
      handling: INVENTORY_SKU_OVERRIDES[asin] ? `指定只取 ${INVENTORY_SKU_OVERRIDES[asin]}` : '同 ASIN 先合计各 SKU；不同 SKU 的八项库存数量完全一致只计一次，不同则相加',
    });
  }
  const salesWindows = {};
  const weekWindows = {};
  const twoWeekWindows = {};
  const trendWindows = {};
  const historicalWindows = {};
  const sales = {};
  const twoWeekSales = {};
  const historicalSales = {};
  const weekSales = {};
  for (const dimension of ['pm', 'lx']) {
    const rows = actuals[dimension]?.week || [];
    weekWindows[dimension] = { recent7: salesWindow(rows, 1), recent30: salesWindow(rows, 4) };
    weekSales[dimension] = {
      recent7: salesByAsin(rows, weekWindows[dimension].recent7),
      recent30: salesByAsin(rows, weekWindows[dimension].recent30),
    };
    salesWindows[dimension] = salesWindow(rows, 4);
    twoWeekWindows[dimension] = salesWindow(rows, 2);
    trendWindows[dimension] = salesWindows[dimension];
    historicalWindows[dimension] = historicalWindow(rows, salesWindows[dimension]);
    sales[dimension] = salesByAsin(rows, salesWindows[dimension]);
    twoWeekSales[dimension] = salesByAsin(rows, twoWeekWindows[dimension]);
    historicalSales[dimension] = salesByAsin(rows, historicalWindows[dimension]);
  }
  const rows = stocks.map(({ mappings, ...row }) => {
    const mapped = mappings.length > 0;
    const labels = {};
    for (const field of ['sku', 'line', 'lifecycle', 'type', 'owner']) {
      const values = [...new Set(mappings.map((product) => clean(product[field])).filter(Boolean))];
      if (field === 'sku') labels[field] = values.join(' / ') || row.asin;
      else if (values.length === 1) labels[field] = values[0];
      else {
        labels[field] = '未匹配';
        if (values.length > 1) audit.mappingConflicts.push({ asin: row.asin, field, values });
      }
    }
    if (!mapped) audit.unmatchedAsins.push(row.asin);
    row.availableReserved = row.available + row.reserved;
    row.total = row.availableReserved + row.inbound;
    row.usLocal = row.total + row.warehouseExpected;
    row.endToEnd = row.usLocal + row.oceanInTransit + row.factoryOpenOrders;
    const isTestKit = isTestKitType(labels.type);
    const inventoryTargets = inventoryTargetsForType(labels.type);
    const metrics = Object.fromEntries(['pm', 'lx'].map((dimension) => {
      const metric = metricsFor(row, salesWindows[dimension], sales[dimension].get(row.asin));
      return [dimension, isTestKit ? { ...metric, targets: inventoryTargets } : metric];
    }));
    return {
      ...row,
      ...labels,
      isTestKit,
      inventoryTargets,
      mapped,
      metrics,
      replenishment: Object.fromEntries(['pm', 'lx'].map((dimension) => [
        dimension,
        replenishmentFor(row, isTestKit, salesWindows[dimension], sales[dimension].get(row.asin), historicalWindows[dimension], historicalSales[dimension].get(row.asin), weekWindows[dimension].recent7, weekSales[dimension].recent7.get(row.asin), weekWindows[dimension].recent30, weekSales[dimension].recent30.get(row.asin), snapshotDate),
      ])),
      twoWeekMetrics: Object.fromEntries(['pm', 'lx'].map((dimension) => [
        dimension, demandMetricsFor(twoWeekWindows[dimension], twoWeekSales[dimension].get(row.asin)),
      ])),
      trendMetrics: Object.fromEntries(['pm', 'lx'].map((dimension) => [
        dimension, demandMetricsFor(trendWindows[dimension], sales[dimension].get(row.asin)),
      ])),
    };
  }).sort((a, b) => b.total - a.total || a.asin.localeCompare(b.asin));
  audit.sourceRows = selected.length;
  audit.asinCount = rows.length;
  audit.duplicateAsinRows = selected.length - rows.length;
  audit.countedSourceRows = selected.length - removedRows.size;
  audit.deduplicatedRows = duplicateRows.size;
  audit.overrideExcludedRows = overrideRows.size;
  audit.deduplicatedTotals = quantityTotals(duplicateQuantities);
  audit.overrideRemovedTotals = quantityTotals(overrideQuantities);
  audit.sourceTotals = quantityTotals(sourceQuantities);
  audit.removedTotals = quantityTotals(removedQuantities);
  audit.totals = Object.fromEntries(['available', 'reserved', 'inbound', 'availableReserved', 'total', 'warehouseExpected', 'oceanInTransit', 'factoryOpenOrders', 'usLocal', 'endToEnd'].map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)]));
  return {
    source: { sheetId: sheet.id || sheet.sheetId || '', sheetName: sheet.name || sheet.sheetName || '库存表', extractedAt, snapshotDate },
    rows, salesWindows, weekWindows, twoWeekWindows, trendWindows, historicalWindows, audit,
  };
}
