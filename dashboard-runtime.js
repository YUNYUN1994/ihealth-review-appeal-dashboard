(function () {
  'use strict';

  const DATA = window.AMAZON_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const COLORS = ['#0f9d8a', '#2f9eb3', '#e7a23b', '#df6b59', '#5d7da4', '#8f6aa8', '#7c9e66', '#c07d4a', '#5c8c9f'];
  const METRICS = {
    qty: { label: '销量', unit: 'count' },
    sales: { label: '销售额', unit: 'money' },
    netSales: { label: '净销售额', unit: 'money' },
    returns: { label: '总回款', unit: 'money' },
    singleReturns: { label: '单个回款', unit: 'money' },
    profit: { label: '利润', unit: 'money' },
    adSpend: { label: '广告费', unit: 'money' },
    promoRate: { label: '推广费比', unit: 'percent' },
    refundRate: { label: '退款率', unit: 'percent' },
    singleProfit: { label: '单个利润', unit: 'money' },
  };
  const GRAIN_LABELS = { month: '月度', quarter: '季度', year: '年度', week: '周度' };
  const state = {
    dimension: 'lx',
    grain: 'month',
    year: '2026',
    period: '2026-09',
    group: 'line',
    detail: 'sku',
    metric: 'sales',
    search: '',
    line: '',
    lifecycle: '',
    type: '',
    owner: '',
  };
  const inventoryState = { search: '', line: '', type: '', risk: '', basis: 'totalWeeks', sort: 'totalWeeks', direction: 'desc' };
  const inventoryTextColumns = new Set(['asin', 'sku', 'line']);
  const inventoryMetricColumns = new Set(['recentQty', 'recent4Qty', 'dailySales', 'dailySales4', 'availableWeeks', 'reservedWeeks', 'totalWeeks', 'usLocalWeeks', 'endToEndWeeks', 'replenishmentQty']);
  const inventorySortColumns = new Set([...inventoryTextColumns, ...inventoryMetricColumns, 'available', 'reserved', 'inbound', 'total', 'warehouseExpected', 'oceanInTransit', 'factoryOpenOrders', 'usLocal', 'endToEnd']);
  const inventoryCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

  const sourceRows = (dimension = state.dimension, grain = state.grain) => {
    if (grain === 'month' || grain === 'week') return DATA.actuals?.[dimension]?.[grain] || [];
    return DATA.actuals?.[dimension]?.month || [];
  };
  const hardwareRows = (rows) => rows.filter((row) => row.type === '硬件');
  // The target workbook is hardware-only. Keep this boundary explicit so
  // any future non-hardware rows cannot enter completion calculations.
  const targetRows = () => hardwareRows(DATA.targets || []);
  const n = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const hasNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  function completionPace(rate, elapsed) {
    if (!hasNumber(rate) || !hasNumber(elapsed)) return 'neutral';
    const gap = rate - elapsed;
    // Compare unrounded values; tolerate only floating-point boundary noise.
    if (gap >= -1e-10) return 'ahead';
    return gap >= -0.05 - 1e-10 ? 'warning' : 'behind';
  }
  const sumNullable = (rows, key) => {
    const values = rows.filter((row) => hasNumber(row[key])).map((row) => row[key]);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const cleanText = (value) => String(value ?? '').trim();
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const yearOf = (row) => Number(row.year) || Number(String(row.period || '').slice(0, 4));

  function aggregate(rows) {
    const result = {};
    for (const key of ['qty', 'sales', 'netSales', 'returns', 'profit', 'adSpend', 'refundQty']) result[key] = sumNullable(rows, key);
    const qty = n(result.qty);
    const sales = n(result.sales);
    result.singleReturns = qty && result.returns !== null ? result.returns / qty : null;
    result.promoRate = sales && result.adSpend !== null ? n(result.adSpend) / Math.abs(sales) : null;
    const refundRows = rows.filter((row) => hasNumber(row.refundQty));
    result.refundRate = refundRows.length && refundRows.reduce((total, row) => total + n(row.qty), 0)
      ? refundRows.reduce((total, row) => total + n(row.refundQty), 0) / refundRows.reduce((total, row) => total + n(row.qty), 0)
      : null;
    return result;
  }

  function rowsForPeriod(rows, grain, period) {
    if (!period) return [];
    if (grain === 'month' || grain === 'week') return rows.filter((row) => row.period === period);
    if (grain === 'quarter') {
      const [year, quarter] = String(period).split('-');
      return rows.filter((row) => String(yearOf(row)) === year && row.quarter === quarter);
    }
    return rows.filter((row) => String(yearOf(row)) === String(period));
  }

  function selectedRows() {
    const rows = rowsForPeriod(sourceRows(), state.grain, state.period);
    return filterRows(rows);
  }

  function filterRows(rows) {
    const query = state.search.toLowerCase();
    return rows.filter((row) => {
      const searchable = [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase();
      return (!query || searchable.includes(query))
        && (!state.line || row.line === state.line)
        && (!state.lifecycle || row.lifecycle === state.lifecycle)
        && (!state.type || row.type === state.type)
        && (!state.owner || row.owner === state.owner);
    });
  }

  function targetScope(grain, period) {
    if (state.year !== '2026' || grain === 'week') return [];
    const rows = targetRows().filter((row) => n(row.qty) !== 0 || n(row.sales) !== 0 || hasNumber(row.returns)).filter((row) => {
      if (grain === 'month') return row.period === period;
      if (grain === 'quarter') return row.year === 2026 && row.quarter === String(period).split('-')[1];
      return row.year === 2026;
    });
    const query = state.search.toLowerCase();
    return rows.filter((row) => {
      const searchable = [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase();
      return (!query || searchable.includes(query))
        && (!state.line || row.line === state.line)
        && (!state.lifecycle || row.lifecycle === state.lifecycle)
        && (!state.type || row.type === state.type)
        && (!state.owner || row.owner === state.owner);
    });
  }

  function availableYears(grain = state.grain) {
    const years = new Set(sourceRows(state.dimension, grain).map(yearOf).filter(Boolean));
    return [...years].sort((a, b) => b - a).map(String);
  }

  function availablePeriods(grain = state.grain, year = state.year) {
    const rows = sourceRows(state.dimension, grain);
    if (grain === 'month' || grain === 'week') return [...new Set(rows.filter((row) => String(yearOf(row)) === String(year)).map((row) => row.period))].sort(periodSort);
    if (grain === 'quarter') return [...new Set(rows.filter((row) => String(yearOf(row)) === String(year)).map((row) => `${yearOf(row)}-${row.quarter}`))].sort(periodSort);
    return availableYears('month').filter((item) => item === String(year));
  }

  function periodSort(a, b) {
    const aText = String(a);
    const bText = String(b);
    const aMatch = aText.match(/(20\d{2}).*?(\d{1,2})/);
    const bMatch = bText.match(/(20\d{2}).*?(\d{1,2})/);
    if (aMatch && bMatch) return Number(aMatch[1]) - Number(bMatch[1]) || Number(aMatch[2]) - Number(bMatch[2]);
    return aText.localeCompare(bText, 'zh-CN', { numeric: true });
  }

  function format(value, metric) {
    if (!hasNumber(value)) return '—';
    const unit = METRICS[metric]?.unit;
    if (unit === 'percent') return `${(value * 100).toFixed(2)}%`;
    if (unit === 'money') return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return Math.round(value).toLocaleString('en-US');
  }

  function metricValue(summary, metric) {
    return summary?.[metric] ?? null;
  }

  function tooltipRows(rows) {
    return rows.map(([label, value]) => `<div class="tip-row"><span>${safe(label)}</span><b>${safe(value)}</b></div>`).join('');
  }

  function bindHover(element, html) {
    element.addEventListener('pointerenter', (event) => showTooltip(html(), event));
    element.addEventListener('pointermove', positionTooltip);
    element.addEventListener('pointerleave', hideTooltip);
  }

  function showTooltip(html, event) {
    const tip = $('#chartTooltip');
    tip.innerHTML = html;
    tip.classList.add('show');
    positionTooltip(event);
  }

  function hideTooltip() {
    const tip = $('#chartTooltip');
    if (!tip) return;
    tip.classList.remove('show');
    tip.style.left = '-9999px';
    tip.style.top = '-9999px';
  }

  function positionTooltip(event) {
    const tip = $('#chartTooltip');
    if (!tip || !tip.classList.contains('show')) return;
    const gap = 14;
    const rect = tip.getBoundingClientRect();
    let left = event.clientX + gap;
    let top = event.clientY + gap;
    if (left + rect.width > window.innerWidth - 8) left = event.clientX - rect.width - gap;
    if (top + rect.height > window.innerHeight - 8) top = event.clientY - rect.height - gap;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }

  function fillSelects() {
    const years = availableYears(state.grain);
    const yearSelect = $('#yearSelect');
    yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join('');
    if (!years.includes(String(state.year))) state.year = years[0] || '2026';
    yearSelect.value = String(state.year);
    const periods = availablePeriods(state.grain, state.year);
    const periodSelect = $('#periodSelect');
    if (!periods.includes(state.period)) state.period = periods[periods.length - 1] || '';
    periodSelect.innerHTML = periods.map((period) => {
      const cutoff = cutoffForPeriod(state.grain, period);
      return `<option value="${safe(period)}">${safe(periodLabel(period, state.grain))}${cutoff ? ` · 截至 ${safe(cutoff)}` : ''}</option>`;
    }).join('');
    periodSelect.value = state.period;
    fillFilter('#lineFilter', '全部产品线', uniqueValues('line'));
    fillFilter('#ownerFilter', '全部归属', uniqueValues('owner'));
    $('#lineFilter').value = state.line;
    $('#lifeFilter').value = state.lifecycle;
    $('#typeFilter').value = state.type;
    $('#ownerFilter').value = state.owner;
  }

  function fillFilter(selector, placeholder, values) {
    const select = $(selector);
    const current = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>${values.map((value) => `<option value="${safe(value)}">${safe(value)}</option>`).join('')}`;
    if (values.includes(current)) select.value = current;
  }

  function uniqueValues(field) {
    return [...new Set(sourceRows(state.dimension, state.grain).map((row) => row[field]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
  }

  function periodLabel(period, grain = state.grain) {
    if (!period) return '暂无数据';
    if (grain === 'month') {
      const [year, month] = period.split('-');
      return `${year}年${Number(month)}月`;
    }
    if (grain === 'quarter') {
      const match = String(period).match(/^(20\d{2})-Q(\d)$/);
      return match ? `${match[1]}年第${Number(match[2])}季度` : String(period);
    }
    if (grain === 'year') return `${period}年`;
    const parts = String(period).split('|');
    const weekText = parts[1] || '';
    const weekNumber = parts[2] || weekText.match(/(?:Week|W)\s*0*(\d{1,2})/i)?.[1] || '';
    const range = weekText.match(/\(([^)]*)\)/)?.[1] || '';
    return `${parts[0]}年第${Number(weekNumber)}周${range ? `（${range}）` : ''}`;
  }

  function isoDate(year, month, day) {
    if (!year || !month || !day) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function dateAt(value) {
    return value ? new Date(`${value}T00:00:00+08:00`) : null;
  }

  function weekEndDate(row) {
    const text = String(row?.weekRange || row?.week || '').replace(/[）]/g, ')');
    const match = text.match(/(?:\()?\s*(\d{1,2})[./-](\d{1,2})\s*-\s*(\d{1,2})[./-](\d{1,2})\s*\)?/);
    return match ? isoDate(Number(row.year), Number(match[3]), Number(match[4])) : '';
  }

  function cutoffForPeriod(grain = state.grain, period = state.period) {
    if (!period) return '';
    const monthly = sourceRows(state.dimension, 'month');
    if (grain === 'month') return DATA.coverage?.[state.dimension]?.month?.periods?.[period] || `${period}-01`;
    if (grain === 'quarter' || grain === 'year') {
      const rows = rowsForPeriod(monthly, grain, period);
      const latest = [...new Set(rows.map((row) => row.period).filter(Boolean))].sort(periodSort).pop();
      return latest ? (DATA.coverage?.[state.dimension]?.month?.periods?.[latest] || `${latest}-01`) : '';
    }
    const dates = sourceRows(state.dimension, 'week').filter((row) => row.period === period).map(weekEndDate).filter(Boolean).sort();
    return dates[dates.length - 1] || '';
  }

  function cutoffLabel(grain = state.grain, period = state.period) {
    const cutoff = cutoffForPeriod(grain, period);
    return cutoff ? `数据截至 ${cutoff}` : '暂无截止日期';
  }

  function periodBounds(grain = state.grain, period = state.period) {
    if (!period) return null;
    if (grain === 'month') {
      const match = String(period).match(/^(20\d{2})-(\d{2})$/);
      if (!match) return null;
      const start = dateAt(isoDate(Number(match[1]), Number(match[2]), 1));
      const end = new Date(Number(match[1]), Number(match[2]), 1);
      return { start, end };
    }
    if (grain === 'quarter') {
      const match = String(period).match(/^(20\d{2})-Q(\d)$/);
      if (!match) return null;
      const startMonth = (Number(match[2]) - 1) * 3;
      const start = new Date(Number(match[1]), startMonth, 1);
      const end = new Date(Number(match[1]), startMonth + 3, 1);
      return { start, end };
    }
    if (grain === 'year') {
      const year = Number(period);
      if (!year) return null;
      return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
    }
    if (grain === 'week') {
      const row = sourceRows(state.dimension, 'week').find((item) => item.period === period);
      const endDate = dateAt(weekEndDate(row));
      if (!endDate) return null;
      const start = new Date(endDate);
      start.setDate(start.getDate() - 6);
      const end = new Date(endDate);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    return null;
  }

  function periodForecastInfo(grain = state.grain, period = state.period) {
    if (grain === 'week') return null;
    const bounds = periodBounds(grain, period);
    const cutoffText = cutoffForPeriod(grain, period);
    const cutoff = dateAt(cutoffText);
    if (!bounds || !cutoff) return null;
    const total = bounds.end - bounds.start;
    const elapsed = cutoff - bounds.start + 86400000;
    if (!(total > 0) || !(elapsed > 0) || elapsed >= total) return null;
    return { cutoff: cutoffText, ratio: Math.max(0, Math.min(1, elapsed / total)) };
  }

  function forecastMetric(actual, metric, forecast) {
    if (!forecast || !hasNumber(actual)) return actual;
    if (METRICS[metric]?.unit === 'percent' || metric === 'singleReturns') return actual;
    return actual / forecast.ratio;
  }

  function priorPeriod(period = state.period, grain = state.grain) {
    if (!period) return '';
    if (grain === 'month') {
      const match = String(period).match(/^(20\d{2})-(\d{2})$/);
      return match ? `${Number(match[1]) - 1}-${match[2]}` : '';
    }
    if (grain === 'quarter') {
      const match = String(period).match(/^(20\d{2})-(Q\d)$/);
      return match ? `${Number(match[1]) - 1}-${match[2]}` : '';
    }
    if (grain === 'year') return String(Number(period) - 1);
    return '';
  }

  function comparisonRows(grain = state.grain, period = state.period) {
    if (grain === 'week') return [];
    const prior = priorPeriod(period, grain);
    if (!prior) return [];
    const rows = sourceRows(state.dimension, grain);
    return filterRows(rowsForPeriod(rows, grain, prior));
  }

  function yoyMarkup(actual, previous, metric, forecast = null) {
    if (state.grain === 'week') return '';
    if (!hasNumber(previous)) return `<div class="yoy muted" title="当前数据维度及筛选范围内，上年同期没有可用的${METRICS[metric].label}数据">同比暂无 · 缺少同期数据</div>`;
    if (!hasNumber(actual)) return '<div class="yoy muted">同比暂无 · 缺少当期数据</div>';
    const projected = forecastMetric(actual, metric, forecast);
    const label = forecast ? '同比预测' : '同比';
    const estimate = forecast && hasNumber(projected) ? ` · 预计 ${format(projected, metric)}` : '';
    if (previous === 0) return `<div class="yoy muted">${label} —（上年为 0${estimate}）</div>`;
    if (METRICS[metric]?.unit === 'percent') {
      const delta = (projected - previous) * 100;
      return `<div class="yoy ${delta >= 0 ? 'up' : 'down'}">${label} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} 个百分点${estimate}</div>`;
    }
    const rate = (projected - previous) / Math.abs(previous) * 100;
    return `<div class="yoy ${rate >= 0 ? 'up' : 'down'}">${label} ${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%${estimate}</div>`;
  }

  function renderCaption() {
    const dimensionLabel = state.dimension === 'pm' ? 'PM' : '领星订单利润';
    $('#periodCaption').textContent = `${periodLabel(state.period)} · ${cutoffLabel()} · 当前视图：${dimensionLabel}口径 · ${GRAIN_LABELS[state.grain]}`;
    $('#categoryCaption').textContent = cutoffLabel();
    const source = DATA.actuals?.[state.dimension]?.[state.grain === 'quarter' || state.grain === 'year' ? 'month' : state.grain] || [];
    const years = [...new Set(source.map(yearOf).filter(Boolean))].sort((a, b) => a - b);
    const availability = years.length ? `${state.dimension === 'pm' ? 'PM' : '领星'}${GRAIN_LABELS[state.grain]}源表年份：${years.join('、')}` : `${state.dimension === 'pm' ? 'PM' : '领星'}${GRAIN_LABELS[state.grain]}源表暂无记录`;
    const comparisonNote = state.grain === 'week' ? '' : '月、季、年的同比使用同一数据维度的上年同期记录；未结束周期按已发生时间外推完整周期后比较。';
    $('.source-strip small').textContent = `${availability}；当前选择${cutoffLabel()}。实际数据按飞书源表原记录展示；月度、周度不互相推算，季度和年度只汇总月度实际数据。${comparisonNote}完成进度仅在 2026 年且目标表有对应目标时显示。`;
    $('#categorySub').textContent = state.grain === 'week'
      ? '按硬件与试剂盒同时展示当前周实际数据'
      : '按硬件与试剂盒同时展示；有上年同期数据时展示同比，未结束周期按时间比例预测';
    const notice = $('#comparisonNotice');
    notice.hidden = true;
    notice.textContent = '';
    if (state.grain !== 'week' && state.period) {
      const prior = priorPeriod();
      const priorSource = rowsForPeriod(sourceRows(), state.grain, prior);
      if (!priorSource.length) {
        const monthlyPeriods = [...new Set(sourceRows(state.dimension, 'month').map((row) => row.period))].sort();
        const start = monthlyPeriods[0];
        notice.textContent = `${dimensionLabel}没有${periodLabel(prior)}的同期实际记录，当前无法计算同比。${start ? `当前${dimensionLabel}月度数据始于${periodLabel(start, 'month')}。` : ''}`;
        notice.hidden = false;
      } else if (!comparisonRows().length) {
        notice.textContent = `当前分类或搜索条件下，${periodLabel(prior)}没有可对比的同期数据。`;
        notice.hidden = false;
      }
    }
  }

  function renderKpis() {
    const summary = aggregate(selectedRows());
    const previous = aggregate(comparisonRows());
    const forecast = periodForecastInfo();
    const cards = ['qty', 'sales', 'netSales', 'returns', 'singleReturns', 'profit', 'adSpend', 'promoRate', 'refundRate']
      .filter((metric) => hasNumber(metricValue(summary, metric)));
    $('#kpiGrid').innerHTML = cards.map((metric) => {
      const value = metricValue(summary, metric);
      const unavailable = value === null;
      const comparable = hasNumber(previous[metric]) && previous[metric] !== 0;
      const note = metric === 'singleReturns' ? '总回款 ÷ 销量' : metric === 'promoRate' ? '广告费 ÷ 销售额' : metric === 'refundRate' ? '退款量 ÷ 销量' : forecast && comparable ? `源表实际值 · 同比按已发生${Math.round(forecast.ratio * 1000) / 10}%时间外推` : '源表实际值';
      return `<div class="kpi"><div class="kpi-label">${METRICS[metric].label}</div><div class="kpi-value">${unavailable ? '—' : format(value, metric)}</div>${unavailable ? '' : yoyMarkup(value, previous[metric], metric, forecast)}<div class="kpi-meta">${note}${unavailable ? ' · 源表未提供' : ''}</div></div>`;
    }).join('');
  }

  function renderCategoryOverview() {
    const rows = selectedRows();
    const previousRows = comparisonRows();
    const forecast = periodForecastInfo();
    const blocks = [...new Set(rows.map((row) => row.type).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'))
      .map((value) => ({ label: value === '测试盒' ? '试剂盒' : value, rows: rows.filter((row) => row.type === value), previousRows: previousRows.filter((row) => row.type === value) }));
    const metrics = ['qty', 'sales', 'netSales', 'returns', 'profit', 'adSpend', 'promoRate', 'refundRate'];
    $('#categoryOverview').innerHTML = blocks.map((block) => {
      const actual = aggregate(block.rows);
      const previous = aggregate(block.previousRows);
      const available = metrics.filter((metric) => hasNumber(actual[metric]) || hasNumber(previous[metric]));
      if (!available.length) return '';
      const cards = available.map((metric) => `<div class="overview-card"><div class="overview-label">${METRICS[metric].label}</div><div class="overview-value">${hasNumber(actual[metric]) ? format(actual[metric], metric) : '—'}</div>${yoyMarkup(actual[metric], previous[metric], metric, forecast)}</div>`).join('');
      return `<div class="category-block"><div class="category-title">${safe(block.label)}<span>${block.rows.length.toLocaleString('en-US')} 条明细</span></div><div class="category-metrics">${cards}</div></div>`;
    }).filter(Boolean).join('') || '<div class="empty">当前时间范围没有可展示的分类数据</div>';
  }

  function trendPeriods() {
    const rows = sourceRows(state.dimension, state.grain);
    if (state.grain === 'month' || state.grain === 'week') return [...new Set(rows.filter((row) => String(yearOf(row)) === String(state.year)).map((row) => row.period))].sort(periodSort);
    if (state.grain === 'quarter') return [...new Set(rows.filter((row) => String(yearOf(row)) === String(state.year)).map((row) => `${state.year}-${row.quarter}`))].sort(periodSort);
    return availableYears('month').sort((a, b) => Number(a) - Number(b));
  }

  function trendData() {
    const rows = sourceRows(state.dimension, state.grain);
    const query = state.search.toLowerCase();
    const filtered = rows.filter((row) => (!query || [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase().includes(query)) && (!state.line || row.line === state.line) && (!state.lifecycle || row.lifecycle === state.lifecycle) && (!state.type || row.type === state.type) && (!state.owner || row.owner === state.owner));
    return trendPeriods().map((period) => {
      const actual = state.grain === 'quarter' ? aggregate(rowsForPeriod(filtered, 'quarter', period)) : state.grain === 'year' ? aggregate(rowsForPeriod(filtered, 'year', period)) : aggregate(filtered.filter((row) => row.period === period));
      const target = aggregate(targetScopeForPeriod(period, state.grain));
      const actualValue = metricValue(actual, state.metric);
      return {
        period,
        label: periodLabel(period, state.grain),
        actual: actualValue,
        target: metricValue(target, state.metric),
      };
    });
  }

  function targetScopeForPeriod(period, grain = state.grain) {
    if (state.year !== '2026' || grain === 'week') return [];
    const rows = targetRows().filter((row) => n(row.qty) !== 0 || n(row.sales) !== 0 || hasNumber(row.returns)).filter((row) => {
      if (grain === 'month') return row.period === period;
      if (grain === 'quarter') return `${row.year}-${row.quarter}` === period;
      return String(row.year) === String(period);
    });
    const query = state.search.toLowerCase();
    return rows.filter((row) => (!query || [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase().includes(query)) && (!state.line || row.line === state.line) && (!state.lifecycle || row.lifecycle === state.lifecycle) && (!state.type || row.type === state.type) && (!state.owner || row.owner === state.owner));
  }

  function renderTrend() {
    const data = trendData().filter((row) => hasNumber(row.actual));
    const metric = state.metric;
    $('#trendTitle').textContent = `${METRICS[metric].label}趋势`;
    $('#trendSub').textContent = `按${GRAIN_LABELS[state.grain]}汇总 · ${cutoffLabel()}`;
    $('#trendTargetLegend').style.display = data.some((row) => hasNumber(row.target)) ? '' : 'none';
    const chart = $('#trendChart');
    if (!data.length) { chart.innerHTML = '<div class="empty">当前年份没有可用的源表记录</div>'; return; }
    const w = 760, h = 250, pad = { left: 50, right: 20, top: 20, bottom: 34 };
    const values = data.map((row) => n(row.actual));
    const targets = data.map((row) => hasNumber(row.target) ? row.target : null).filter(hasNumber);
    const max = Math.max(...values, ...(targets.length ? targets : [0]), 1);
    const x = (index) => pad.left + (data.length === 1 ? (w - pad.left - pad.right) / 2 : index * (w - pad.left - pad.right) / (data.length - 1));
    const y = (value) => h - pad.bottom - (value / max) * (h - pad.top - pad.bottom);
    const actualPoints = data.map((row, index) => `${x(index)},${y(n(row.actual))}`).join(' ');
    const targetPoints = data.map((row, index) => hasNumber(row.target) ? `${x(index)},${y(row.target)}` : '').filter(Boolean).join(' ');
    const grid = [0, .25, .5, .75, 1].map((ratio) => `<line class="gridline" x1="${pad.left}" x2="${w - pad.right}" y1="${y(max * ratio)}" y2="${y(max * ratio)}"/><text class="axis" x="8" y="${y(max * ratio) + 4}">${safe(format(max * ratio, metric))}</text>`).join('');
    const labelStep = Math.max(1, Math.ceil(data.length / 10));
    const labels = data.map((row, index) => (index % labelStep === 0 || index === data.length - 1) ? `<text class="axis" x="${x(index)}" y="${h - 8}" text-anchor="middle">${safe(row.label)}</text>` : '').join('');
    const points = data.map((row, index) => `<circle class="point" cx="${x(index)}" cy="${y(n(row.actual))}" r="4"/><rect class="trend-hit" data-index="${index}" x="${Math.max(pad.left, x(index) - 22)}" y="${pad.top}" width="44" height="${h - pad.top - pad.bottom}"/>`).join('');
    const actualLabels = data.map((row, index) => {
      if (row.period !== state.period) return '';
      const pointX = x(index);
      const actualY = y(n(row.actual));
      const anchor = pointX > w * .7 ? 'end' : 'start';
      const textX = anchor === 'end' ? pointX - 8 : pointX + 8;
      const actualLabelY = Math.min(h - pad.bottom - 7, actualY + 17);
      return `<text class="trend-value-label" x="${textX}" y="${actualLabelY}" text-anchor="${anchor}">实际 ${safe(format(row.actual, metric))}</text>`;
    }).join('');
    chart.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${safe(METRICS[metric].label)}趋势"><defs><linearGradient id="areaFillNew" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f9d8a" stop-opacity=".20"/><stop offset="1" stop-color="#0f9d8a" stop-opacity="0"/></linearGradient></defs>${grid}<polygon class="trend-area" points="${pad.left},${h - pad.bottom} ${actualPoints} ${w - pad.right},${h - pad.bottom}" fill="url(#areaFillNew)"/><polyline class="trend-line" points="${actualPoints}"/>${targets.length ? `<polyline points="${targetPoints}" fill="none" stroke="#e7a23b" stroke-width="2" stroke-dasharray="5 5"/>` : ''}${labels}${points}${actualLabels}</svg>`;
    $$('.trend-hit', chart).forEach((hit) => {
      const row = data[Number(hit.dataset.index)];
      bindHover(hit, () => `<div class="tip-title">${safe(row.label)}</div>${tooltipRows([["实际", format(row.actual, metric)], ['目标', hasNumber(row.target) ? format(row.target, metric) : '无目标'], ['完成率', hasNumber(row.target) && row.target !== 0 ? `${(row.actual / row.target * 100).toFixed(2)}%` : '—']])}`);
    });
  }

  function donutPath(start, end) {
    const cx = 92, cy = 92, outer = 86, inner = 50, stop = Math.min(end, start + 359.99), large = stop - start > 180 ? 1 : 0;
    const point = (radius, angle) => { const radians = (angle - 90) * Math.PI / 180; return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)]; };
    const a = point(outer, start), b = point(outer, stop), c = point(inner, stop), d = point(inner, start);
    return `M ${a[0]} ${a[1]} A ${outer} ${outer} 0 ${large} 1 ${b[0]} ${b[1]} L ${c[0]} ${c[1]} A ${inner} ${inner} 0 ${large} 0 ${d[0]} ${d[1]} Z`;
  }

  function renderMix() {
    const rows = selectedRows();
    const key = state.group === 'line' ? 'line' : state.group === 'lifecycle' ? 'lifecycle' : state.group === 'type' ? 'type' : state.group === 'owner' ? 'owner' : 'sku';
    const metric = state.metric;
    const map = new Map();
    for (const row of rows) {
      const name = row[key] || '未匹配';
      const value = metric === 'promoRate' || metric === 'refundRate' ? n(row.sales) : metric === 'singleReturns' ? (n(row.qty) ? n(row.returns) / n(row.qty) : 0) : n(row[metric]);
      map.set(name, (map.get(name) || 0) + value);
    }
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    const title = state.group === 'line' ? '产品线' : state.group === 'lifecycle' ? '新老品' : state.group === 'type' ? '硬件 / 测试盒' : state.group === 'owner' ? '归属' : 'SKU';
    $('#mixTitle').textContent = `${title}结构`;
    if (!entries.length || !total) { $('#mixChart').innerHTML = '<div class="empty">当前范围暂无可展示数据</div>'; return; }
    let cursor = 0;
    const segments = entries.map(([name, value], index) => { const start = cursor; cursor += value / total * 360; return `<path class="donut-segment" data-index="${index}" d="${donutPath(start, cursor)}" fill="${COLORS[index % COLORS.length]}"/>`; }).join('');
    const stops = entries.map(([, value], index) => { const before = entries.slice(0, index).reduce((sum, item) => sum + item[1], 0); return `${COLORS[index % COLORS.length]} ${before / total * 360}deg ${(before + value) / total * 360}deg`; }).join(',');
    const displayMetric = metric === 'promoRate' || metric === 'refundRate' ? 'sales' : metric;
    const legend = entries.map(([name, value], index) => `<div class="legend-item" data-index="${index}"><i class="dot" style="background:${COLORS[index % COLORS.length]}"></i><span class="name">${safe(name)}</span><span class="value">${format(value, displayMetric)}</span><span class="pct">${(value / total * 100).toFixed(1)}%</span></div>`).join('');
    $('#mixChart').innerHTML = `<div class="donut" style="background:conic-gradient(${stops})"><svg class="donut-overlay" viewBox="0 0 184 184" aria-label="${safe(title)}结构图">${segments}</svg><div class="donut-center"><strong>${entries.length}</strong><span>个分类</span></div></div><div class="legend-list">${legend}</div>`;
    $$('.donut-segment', $('#mixChart')).forEach((segment) => { const index = Number(segment.dataset.index); const [name, value] = entries[index]; bindHover(segment, () => `<div class="tip-title">${safe(name)}</div>${tooltipRows([['数值', format(value, displayMetric)], ['占比', `${(value / total * 100).toFixed(2)}%`], ['当前指标', METRICS[metric].label]])}`); });
    $$('.legend-item', $('#mixChart')).forEach((item) => { const index = Number(item.dataset.index); const [name, value] = entries[index]; bindHover(item, () => `<div class="tip-title">${safe(name)}</div>${tooltipRows([['数值', format(value, displayMetric)], ['占比', `${(value / total * 100).toFixed(2)}%`]])}`); });
  }

  function progressData() {
    if (state.year !== '2026') return null;
    const actual = aggregate(hardwareRows(selectedRows()));
    const currentTargetRows = targetScope(state.grain, state.period);
    const annualTargetRows = targetScopeForPeriod('2026', 'year');
    const yearRows = hardwareRows(sourceRows(state.dimension, 'month').filter((row) => yearOf(row) === 2026 && (!state.search || [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase().includes(state.search.toLowerCase())) && (!state.line || row.line === state.line) && (!state.lifecycle || row.lifecycle === state.lifecycle) && (!state.type || row.type === state.type) && (!state.owner || row.owner === state.owner)));
    const quarterPeriod = state.grain === 'quarter' ? state.period : state.grain === 'month' ? (() => { const m=Number(String(state.period).split('-')[1]); return m ? '2026-Q' + Math.ceil(m / 3) : ''; })() : '';
    const quarterActualRows = quarterPeriod ? hardwareRows(sourceRows(state.dimension, 'month').filter((row) => String(yearOf(row)) + '-' + row.quarter === quarterPeriod && (!state.search || [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase().includes(state.search.toLowerCase())) && (!state.line || row.line === state.line) && (!state.lifecycle || row.lifecycle === state.lifecycle) && (!state.type || row.type === state.type) && (!state.owner || row.owner === state.owner))) : [];
    return { actual, current: aggregate(currentTargetRows), quarterActual: aggregate(quarterActualRows), quarterTarget: aggregate(targetScopeForPeriod(quarterPeriod, 'quarter')), quarterPeriod, annualActual: aggregate(yearRows), annualTarget: aggregate(annualTargetRows) };
  }

  function timeProgress() {
    const coverage = DATA.coverage?.[state.dimension]?.month;
    if (state.year !== '2026' || !coverage?.cutoff) return null;
    const cutoff = new Date(`${coverage.cutoff}T00:00:00+08:00`);
    const yearStart = new Date('2026-01-01T00:00:00+08:00');
    const yearEnd = new Date('2027-01-01T00:00:00+08:00');
    const annual = Math.max(0, Math.min(1, (cutoff - yearStart + 86400000) / (yearEnd - yearStart)));
    let current = null;
    if (state.grain === 'month') {
      const [year, month] = state.period.split('-').map(Number);
      if (year && month) {
        const monthStart = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+08:00`);
        const monthEnd = new Date(year, month, 1);
        if (coverage.latestPeriod > state.period) current = 1;
        else if (coverage.latestPeriod === state.period) current = Math.max(0, Math.min(1, (cutoff - monthStart + 86400000) / (monthEnd - monthStart)));
        else current = 0;
      }
    } else if (state.grain === 'quarter') {
      const quarter = Number(String(state.period).match(/Q(\d)/)?.[1]);
      if (quarter) {
        const startMonth = (quarter - 1) * 3 + 1;
        const quarterStart = new Date(`2026-${String(startMonth).padStart(2, '0')}-01T00:00:00+08:00`);
        const quarterEnd = new Date(2026, startMonth + 2, 1);
        current = Math.max(0, Math.min(1, (cutoff - quarterStart + 86400000) / (quarterEnd - quarterStart)));
      }
    } else if (state.grain === 'year') current = annual;
    let quarter = null;
    const qPeriod = state.grain === 'quarter' ? state.period : state.grain === 'month' ? (() => { const m=Number(String(state.period).split('-')[1]); return m ? '2026-Q' + Math.ceil(m / 3) : ''; })() : '';
    if (qPeriod) { const q=Number(String(qPeriod).match(/Q(\d)/)?.[1]); if(q){ const startMonth=(q-1)*3+1; const qStart=new Date('2026-' + String(startMonth).padStart(2,'0') + '-01T00:00:00+08:00'); const qEnd=new Date(2026,startMonth+2,1); quarter=Math.max(0,Math.min(1,(cutoff-qStart+86400000)/(qEnd-qStart))); } }
    return { current, quarter, annual, cutoff: coverage.cutoff };
  }

  function renderProgress() {
    const progress = progressData();
    $('.goal-panel .completion-legend').hidden = true;
    if (!progress) {
      $('#progressDate').textContent = `${state.year}年 · 历史实际`;
      $('#progressGrid').innerHTML = '<div class="empty" style="grid-column:1/-1;padding:34px 12px">2023–2025 年只展示实际发生数据，不计算目标完成度。</div>';
      return;
    }
    const currentTargetAvailable = state.grain !== 'week' && ['qty', 'profit', 'returns'].some((key) => hasNumber(progress.current[key]));
    const annualTargetAvailable = ['qty', 'profit', 'returns'].some((key) => hasNumber(progress.annualTarget[key]));
    if (!currentTargetAvailable && !annualTargetAvailable) {
      $('#progressDate').textContent = `${periodLabel(state.period)} · 没有对应目标`;
      $('#progressGrid').innerHTML = '<div class="empty" style="grid-column:1/-1;padding:34px 12px">当前筛选范围没有 2026 年目标数据，因此不显示完成度。</div>';
      return;
    }
    const time = timeProgress();
    $('.goal-panel .completion-legend').hidden = false;
    $('#progressDate').textContent = `${state.dimension === 'pm' ? 'PM' : '领星'} · 硬件目标口径`;
    const metrics = [['qty', '销量'], ['profit', '利润'], ['returns', '总回款']];
    const percent = (ratio) => hasNumber(ratio) ? `${(ratio * 100).toFixed(2)}%` : '—';
    const width = (ratio) => Math.min(100, Math.max(0, ratio * 100));
    const card = (key, label, actual, target, elapsed, cutoff, scopeLabel) => {
      const rate = hasNumber(actual) && hasNumber(target) && target !== 0 ? actual / target : null;
      const gap = hasNumber(rate) && hasNumber(elapsed) ? Number(((rate - elapsed) * 100).toFixed(1)) : null;
      const pace = gap === null ? '' : gap === 0 ? '与时间进度持平' : `${gap > 0 ? '领先' : '落后'} ${Math.abs(gap).toFixed(1)} 个百分点`;
      const missing = !hasNumber(target) ? '未提供目标' : target === 0 ? '目标为 0，无法计算完成率' : '暂无实际数据';
      const tone = rate === null ? 'no-target' : completionPace(rate, elapsed);
      const difference = hasNumber(actual) && hasNumber(target) ? target - actual : null;
      const remainingLabel = difference === null ? '距目标还差' : difference > 0 ? '距目标还差' : difference < 0 ? '超出目标' : '已完成目标';
      const remainingValue = difference === null ? '—' : format(Math.abs(difference), key);
      const tip = safe(JSON.stringify([['范围', scopeLabel], ['指标', label], ['数据截至', cutoff],
        ['已完成', format(actual, key)], ['目标', format(target, key)], ['完成率', percent(rate)],
        ['时间进度', percent(elapsed)], ['进度对比', pace || (rate === null ? missing : '暂无时间进度')], [remainingLabel, remainingValue]]));
      const chart = rate === null ? `<div class="goal-no-target">${missing}</div>`
        : `<div class="goal-bar" tabindex="0" role="img" aria-label="${safe(`${label}完成 ${percent(rate)}，时间进度 ${percent(elapsed)}，${pace}`)}" data-goal-tip="${tip}">
            <div class="goal-track"><div class="goal-fill" style="width:${width(rate)}%"></div></div>
            ${hasNumber(elapsed) ? `<span class="goal-time-marker" style="left:${width(elapsed)}%" aria-hidden="true"></span>` : ''}
          </div>
          <div class="goal-scale"><span>时间 ${percent(elapsed)}</span><span>目标 100%</span></div>`;
      return `<article class="goal-card ${tone}" data-metric="${key}">
        <div class="goal-card-head"><h4>${label}</h4><span class="goal-status">${pace || (rate === null ? '暂无完成率' : '目标完成率')}</span></div>
        <div class="goal-value">${percent(rate)}<small>目标完成</small></div>
        ${chart}
        <dl class="goal-amounts"><div><dt>已完成</dt><dd>${format(actual, key)}</dd></div><div><dt>目标</dt><dd>${format(target, key)}</dd></div></dl>
        <div class="goal-remaining"><span>${remainingLabel}</span><strong>${remainingValue}</strong></div>
      </article>`;
    };
    const section = (scope, title, label, actual, target, elapsed, cutoff) => {
      const timeTip = safe(JSON.stringify([['范围', label], ['数据截至', cutoff], ['时间进度', percent(elapsed)], ['参照', '竖线表示已发生天数占完整周期的比例']]));
      return `<section class="goal-period" data-scope="${scope}">
        <div class="goal-period-head"><div><h3>${title}</h3><p class="goal-period-sub">${safe(label)} · 数据截至 ${safe(cutoff || '源表未提供')}</p></div>
          <span class="goal-time" data-goal-tip="${timeTip}"><i aria-hidden="true"></i>时间已过 <b>${percent(elapsed)}</b></span>
        </div>
        <div class="goal-cards">${metrics.map(([key, metric]) => card(key, metric, actual[key], target[key], elapsed, cutoff, label)).join('')}</div>
      </section>`;
    };
    const sections = [];
    if (state.grain === 'month' || state.grain === 'quarter') {
      sections.push(section('current', state.grain === 'month' ? '当月完成情况' : '当季完成情况', periodLabel(state.period),
        progress.actual, progress.current, time?.current, cutoffForPeriod()));
    } else if (state.grain === 'week') {
      sections.push('<p class="goal-notice">源表未提供周度目标，以下展示年度累计完成情况；年度实际按月度数据汇总。</p>');
    }
    if (state.grain === 'month' && progress.quarterPeriod && ['qty', 'profit', 'returns'].some((key) => hasNumber(progress.quarterTarget[key]))) {
      sections.push(section('quarter', '季度累计完成情况', progress.quarterPeriod.replace('-', '年').replace('Q', '年第') + '季度', progress.quarterActual, progress.quarterTarget, time?.quarter, cutoffForPeriod()));
    }
    if (annualTargetAvailable) {
      sections.push(section('annual', '年度累计完成情况', `${state.year}年 · 全年目标`,
        progress.annualActual, progress.annualTarget, time?.annual, time?.cutoff));
    }
    $('#progressGrid').innerHTML = sections.join('');
    $$('[data-goal-tip]', $('#progressGrid')).forEach((element) => {
      const html = () => `<div class="tip-title">完成进度</div>${tooltipRows(JSON.parse(element.dataset.goalTip))}`;
      bindHover(element, html);
      element.addEventListener('focus', () => { const rect = element.getBoundingClientRect(); showTooltip(html(), { clientX: rect.left, clientY: rect.bottom }); });
      element.addEventListener('blur', hideTooltip);
    });
  }

  function targetBySku(rows) {
    const map = new Map();
    for (const row of rows) {
      const existing = map.get(row.sku) || [];
      existing.push(row);
      map.set(row.sku, existing);
    }
    return map;
  }

  function renderTable() {
    const rows = selectedRows();
    const time = timeProgress();
    const progressRows = hardwareRows(rows);
    const targetCurrent = targetBySku(targetScope(state.grain, state.period));
    const targetAnnual = targetBySku(targetScopeForPeriod('2026', 'year'));
    const annualActualRows = hardwareRows(filterRows(sourceRows(state.dimension, 'month').filter((row) => yearOf(row) === 2026)));
    const actualAnnual = targetBySku(annualActualRows);
    const groupKey = state.detail === 'sku' ? 'sku' : state.detail === 'line' ? 'line' : 'lifecycle';
    const grouped = new Map();
    for (const row of rows) {
      const name = row[groupKey] || '未匹配';
      const list = grouped.get(name) || [];
      list.push(row);
      grouped.set(name, list);
    }
    const data = [...grouped.entries()].map(([name, list]) => {
      const actual = aggregate(list);
      const progressActual = aggregate(progressRows.filter((row) => (groupKey === 'sku' ? row.sku : row[groupKey]) === name));
      const currentTarget = aggregate([...targetCurrent.values()].flat().filter((row) => (groupKey === 'sku' ? row.sku : row[groupKey]) === name));
      const annualTarget = aggregate([...targetAnnual.values()].flat().filter((row) => (groupKey === 'sku' ? row.sku : row[groupKey]) === name));
      const annualRows = [...actualAnnual.values()].flat().filter((row) => (groupKey === 'sku' ? row.sku : row[groupKey]) === name && (!state.search || [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase().includes(state.search.toLowerCase())) && (!state.line || row.line === state.line) && (!state.lifecycle || row.lifecycle === state.lifecycle) && (!state.type || row.type === state.type) && (!state.owner || row.owner === state.owner));
      return { name, actual, progressActual, currentTarget, annualTarget, annualActual: aggregate(annualRows) };
    }).sort((a, b) => n(b.actual[state.metric]) - n(a.actual[state.metric]));
    const completion = (actual, target, elapsed, scope) => {
      if (state.year !== '2026' || !hasNumber(actual) || !hasNumber(target) || target === 0) return '';
      const rate = actual / target;
      const pace = completionPace(rate, elapsed);
      const gap = hasNumber(elapsed) ? (rate - elapsed) * 100 : null;
      const comparison = gap === null ? '暂无时间进度' : Math.abs(gap) < 1e-8 ? '与时间进度持平'
        : `${gap >= 0 ? '领先' : '落后'}时间进度 ${Math.abs(gap).toFixed(1)} 个百分点`;
      const tip = `${scope}完成率 ${(rate * 100).toFixed(1)}% · ${scope}时间进度 ${hasNumber(elapsed) ? `${(elapsed * 100).toFixed(2)}%` : '—'} · ${comparison}`;
      return `<span class="pill pace-${pace}" title="${safe(tip)}" data-rate="${rate}" data-time="${hasNumber(elapsed) ? elapsed : ''}">${(rate * 100).toFixed(1)}%</span>`;
    };
    const columns = [
      { label: state.detail === 'sku' ? 'SKU' : state.detail === 'line' ? '产品线' : '新老品', value: (item) => `<strong>${safe(item.name)}</strong>`, keep: true },
      { label: '销量', metric: 'qty', value: (item) => format(item.actual.qty, 'qty') },
      { label: '销售额', metric: 'sales', value: (item) => format(item.actual.sales, 'sales') },
      { label: '净销售额', metric: 'netSales', value: (item) => format(item.actual.netSales, 'netSales') },
      { label: '总回款', metric: 'returns', value: (item) => format(item.actual.returns, 'returns') },
      { label: '单个回款', metric: 'singleReturns', value: (item) => format(item.actual.singleReturns, 'singleReturns') },
      { label: '利润', metric: 'profit', value: (item) => format(item.actual.profit, 'profit'), className: (item) => n(item.actual.profit) < 0 ? 'negative' : 'positive' },
      { label: '广告费', metric: 'adSpend', value: (item) => format(item.actual.adSpend, 'adSpend') },
      { label: '推广费比', metric: 'promoRate', value: (item) => format(item.actual.promoRate, 'promoRate') },
      { label: '退款率', metric: 'refundRate', value: (item) => format(item.actual.refundRate, 'refundRate') },
      { label: '当期销量完成', progress: true, value: (item) => completion(item.progressActual.qty, item.currentTarget.qty, time?.current, '当期'), available: (item) => hasNumber(item.currentTarget.qty) && item.currentTarget.qty !== 0 },
      { label: '当期销售额完成', progress: true, value: (item) => completion(item.progressActual.sales, item.currentTarget.sales, time?.current, '当期'), available: (item) => hasNumber(item.currentTarget.sales) && item.currentTarget.sales !== 0 },
      { label: '当期回款完成', progress: true, value: (item) => completion(item.progressActual.returns, item.currentTarget.returns, time?.current, '当期'), available: (item) => hasNumber(item.currentTarget.returns) && item.currentTarget.returns !== 0 },
      { label: '年度销量完成', progress: true, value: (item) => completion(item.annualActual.qty, item.annualTarget.qty, time?.annual, '年度'), available: (item) => hasNumber(item.annualTarget.qty) && item.annualTarget.qty !== 0 },
      { label: '年度销售额完成', progress: true, value: (item) => completion(item.annualActual.sales, item.annualTarget.sales, time?.annual, '年度'), available: (item) => hasNumber(item.annualTarget.sales) && item.annualTarget.sales !== 0 },
      { label: '年度回款完成', progress: true, value: (item) => completion(item.annualActual.returns, item.annualTarget.returns, time?.annual, '年度'), available: (item) => hasNumber(item.annualTarget.returns) && item.annualTarget.returns !== 0 },
    ].filter((column) => column.keep || (column.progress ? data.some((item) => column.available(item)) : data.some((item) => hasNumber(item.actual[column.metric]))));
    $('#tableHead').innerHTML = `<tr>${columns.map((column) => `<th>${column.label}</th>`).join('')}</tr>`;
    $('#tableBody').innerHTML = data.length ? data.map((item) => `<tr>${columns.map((column) => `<td class="${column.className ? column.className(item) : ''}">${column.value(item)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty">当前时间范围没有源表记录</td></tr>`;
    $('#rowCount').textContent = `${data.length} ${state.detail === 'sku' ? '个 SKU' : state.detail === 'line' ? '个产品线' : '个新老品分类'} · ${rows.length} 条源表明细`;
    $('#tableTitle').textContent = state.detail === 'sku' ? 'SKU 明细' : state.detail === 'line' ? '产品线明细' : '新老品汇总';
    $('#tableSub').textContent = `当前选择：${periodLabel(state.period)} · ${cutoffLabel()}。普通指标按当前筛选范围展示；完成度只匹配 2026 年硬件目标，实际完成值不含试剂盒，空白目标显示为 —。`;
    $('#completionLegend').hidden = !time || !columns.some((column) => column.progress);
    const timeItem = (label, value, unavailableText = '') => {
      const available = hasNumber(value);
      const percentage = available ? value * 100 : 0;
      const display = available ? `${percentage.toFixed(2)}%` : '—';
      const tip = available
        ? `${label}|数据截至 ${time.cutoff}|时间进度 ${display}`
        : `${label}|${unavailableText || '当前粒度无法计算'}|数据截至 ${time.cutoff}`;
      return `<div class="table-time-item" data-tip="${safe(tip)}"><span>${label}</span><b>${display}</b><div class="table-time-track" role="img" aria-label="${label} ${display}"><div class="table-time-fill" style="width:${Math.max(0, Math.min(100, percentage))}%"></div></div></div>`;
    };
    $('#tableTimeProgress').innerHTML = time
      ? timeItem('当期时间进度', time.current, '周度源表未提供可精确计算的日进度') + timeItem('年度时间进度', time.annual)
      : '';
    $$('.table-time-item[data-tip]', $('#tableTimeProgress')).forEach((item) => bindHover(item, () => `<div class="tip-title">时间进度</div>${tooltipRows(item.dataset.tip.split('|').map((part, index) => index === 0 ? ['范围', part] : [part.split(' ')[0], part.slice(part.indexOf(' ') + 1)]))}`));
  }

  const inventoryHealthRanges = {
    usLocalWeeks: { label: '美国本地库存', min: 18, max: 20, red: 24 },
    endToEndWeeks: { label: '全链条库存', min: 22, max: 24, red: 36 },
  };

  function inventoryLevel(weeks, basis = 'totalWeeks', isTestKit = false) {
    if (!hasNumber(weeks) || weeks < 0) return 'neutral';
    if (isTestKit && ['availableWeeks', 'reservedWeeks', 'totalWeeks'].includes(basis)) {
      if (basis === 'availableWeeks') return weeks < 8 ? 'red' : weeks > 24 ? 'yellow' : 'green';
      const target = { reservedWeeks: 12, totalWeeks: 16 }[basis];
      return weeks >= target ? 'green' : 'red';
    }
    const range = inventoryHealthRanges[basis];
    if (range) return weeks > range.red ? 'red' : weeks >= range.min && weeks <= range.max ? 'green' : 'yellow';
    return weeks > 24 ? 'red' : weeks > 20 ? 'orange' : weeks > 12 ? 'yellow' : 'green';
  }

  function inventoryStatus(weeks, basis, isTestKit = false) {
    const level = inventoryLevel(weeks, basis, isTestKit);
    if (isTestKit && basis === 'availableWeeks') return level === 'red' ? '低于安全线' : level === 'yellow' ? '可售偏高' : '达标';
    if (isTestKit && ['reservedWeeks', 'totalWeeks'].includes(basis)) return level === 'green' ? '达标' : '低于安全线';
    const range = inventoryHealthRanges[basis];
    if (range && level === 'green') return '健康';
    if (range && level === 'yellow') return weeks < range.min ? '偏低' : '偏高';
    return { green: '正常', yellow: '预警', orange: '偏高', red: '高库存', neutral: '待核实' }[level];
  }

  function inventoryRuleOptions(basis) {
    const range = inventoryHealthRanges[basis];
    return range ? [
      ['green', `健康：${range.min}–${range.max} 周`],
      ['yellow', `预警：<${range.min} 周或 >${range.max}–${range.red} 周`],
      ['red', `高库存：>${range.red} 周`],
      ['neutral', '待核实'],
    ] : [
      ['green', '正常：≤12 周'], ['yellow', '预警：>12–20 周'],
      ['orange', '偏高：>20–24 周'], ['red', '高库存：>24 周'], ['neutral', '待核实'],
    ];
  }

  function inventoryReplenishmentLabel(row, recommendation) {
    if (!row.isTestKit && recommendation?.status === 'ok') return recommendation.recommendedQty > 0 ? `建议补货 ${format(recommendation.recommendedQty, 'qty')} 件` : '暂无需补货';
    if (!row.isTestKit && recommendation?.status === 'no-demand') return '暂无有效销量';
    if (!row.isTestKit && recommendation?.status !== 'ok') return '暂不可计算';
    if (recommendation?.status !== 'ok') return '暂不可计算';
    return recommendation.recommendedQty > 0 ? `建议补货 ${format(recommendation.recommendedQty, 'qty')} 件` : '无需补货';
  }

  function inventoryReplenishmentSubtext(row, recommendation) {
    if (!row.isTestKit && recommendation?.status === 'ok') return `${recommendation.executionTiming || '计划执行'} · ${recommendation.executionDate}执行 · ${recommendation.arrivalDate}到货`;
    if (!row.isTestKit) return recommendation?.reason || '近7天/近30天销量不足';
    if (recommendation?.status !== 'ok') return recommendation?.reason || '销量不足';
    const forecast = format(recommendation.forecastNextWeekQty, 'qty');
    return recommendation.recommendedQty > 0 ? `下周预计销量 ${forecast} 件 · 补后保留 12 周` : `下周预计销量 ${forecast} 件 · 当前库存足够`;
  }

  function renderInventory() {
    if (!$('#inventoryPanel')) return;
    const riskOptions = inventoryRuleOptions(inventoryState.basis);
    if (!riskOptions.some(([key]) => key === inventoryState.risk)) inventoryState.risk = '';
    $('#inventoryRiskFilter').innerHTML = '<option value="">全部库存状态</option>' + riskOptions.map(([key, label]) => `<option value="${key}">${safe(label)}</option>`).join('');
    $('#inventoryRiskFilter').value = inventoryState.risk;
    $('#inventoryLegend').innerHTML = [
      ['totalWeeks', '普通硬件：可售 / 可售+预留 / FBA'],
      ['usLocalWeeks', '美国本地库存'],
      ['endToEndWeeks', '全链条库存'],
    ].map(([basis, label]) => `<div class="inventory-legend-row"><span class="inventory-legend-label">${label}：</span>${inventoryRuleOptions(basis).filter(([key]) => key !== 'neutral').map(([key, text]) => `<span><i class="${key}" aria-hidden="true"></i>${safe(text)}</span>`).join('')}</div>`).join('')
      + '<div class="inventory-legend-row"><span class="inventory-legend-label">试剂盒：</span><span><i class="green" aria-hidden="true"></i>可售8–24周</span><span><i class="yellow" aria-hidden="true"></i>可售&gt;24周</span><span><i class="green" aria-hidden="true"></i>可售+预留≥12周</span><span><i class="green" aria-hidden="true"></i>FBA≥16周</span><span><i class="red" aria-hidden="true"></i>低于对应安全线</span></div>';
    $$('#inventoryPanel [data-inventory-sort]').forEach((button) => {
      const active = button.dataset.inventorySort === inventoryState.sort;
      const direction = inventoryState.direction === 'asc' ? 'ascending' : 'descending';
      button.closest('th').setAttribute('aria-sort', active ? direction : 'none');
      $('.inventory-sort-arrow', button).textContent = active ? (inventoryState.direction === 'asc' ? '↑' : '↓') : '↕';
      const next = active ? (inventoryState.direction === 'asc' ? '降序' : '升序') : inventoryTextColumns.has(button.dataset.inventorySort) ? '升序' : '降序';
      const label = $('span', button).textContent;
      button.title = `${active ? `当前${inventoryState.direction === 'asc' ? '升序' : '降序'}，` : ''}点击按${label}${next}排列`;
      button.setAttribute('aria-label', button.title);
    });
    const inventory = DATA.inventory;
    if (!inventory?.rows?.length) {
      $('#inventoryCaption').textContent = '尚未取得库存数据，请点击“立即更新数据”获取库存表。';
      $('#inventoryBody').innerHTML = '<tr><td colspan="22" class="inventory-empty">暂无库存快照</td></tr>';
      return;
    }
    const sourceName = state.dimension === 'pm' ? 'PM' : '领星';
    const windowInfo = inventory.salesWindows[state.dimension];
    const periods = windowInfo?.periods || [];
    const twoWeekWindow = inventory.twoWeekWindows?.[state.dimension];
    const twoWeekPeriods = twoWeekWindow?.periods || [];
    const snapshot = inventory.source.snapshotDate || '源表未注明';
    $('#inventoryCaption').textContent = `库存快照：${snapshot} · 所有库存周数按${sourceName}最近四周平均日销计算 · 同时保留最近两周销量作趋势对比 · 库存独立于上方历史年月筛选`;
    const dates = windowInfo?.valid
      ? `${periods[0].start} 至 ${periods[periods.length - 1].end}（${periods.map((period) => period.label).join('、')}，共 28 天）`
      : windowInfo?.reason || '周度数据不足';
    const twoWeekDates = twoWeekWindow?.valid
      ? `${twoWeekPeriods[0].start} 至 ${twoWeekPeriods[twoWeekPeriods.length - 1].end}（${twoWeekPeriods.map((period) => period.label).join('、')}，共 14 天）`
      : twoWeekWindow?.reason || '周度数据不足';
    $('#inventoryMeta').textContent = `库存周数计算窗口（近四周）：${dates}；趋势对比窗口（近两周）：${twoWeekDates}。抓取时间：${localDateTime(inventory.source.extractedAt)}。SKU 与 ASIN 对照产品；指定 SKU 规则优先，其余同 ASIN 下不同 SKU 的八项库存数量全部相同只计一次，不同则相加。以下汇总随本版块筛选变化。`;
    const typeLabel = (value) => value === '测试盒' ? '试剂盒' : value;
    const lines = [...new Set(inventory.rows.map((row) => cleanText(row.line)).filter(Boolean))].sort((a, b) => inventoryCollator.compare(a, b));
    $('#inventoryLineFilter').innerHTML = '<option value="">全部产品线</option>' + lines.map((line) => `<option value="${safe(line)}">${safe(line)}</option>`).join('');
    if (!lines.includes(inventoryState.line)) inventoryState.line = '';
    $('#inventoryLineFilter').value = inventoryState.line;
    const types = [...new Set(inventory.rows.map((row) => row.type))].sort();
    $('#inventoryTypeFilter').innerHTML = '<option value="">全部类型</option>' + types.map((type) => `<option value="${safe(type)}">${safe(typeLabel(type))}</option>`).join('');
    if (!types.includes(inventoryState.type)) inventoryState.type = '';
    $('#inventoryTypeFilter').value = inventoryState.type;
    const query = inventoryState.search.trim().toLowerCase();
    const rows = inventory.rows.filter((row) => {
      const metrics = row.metrics[state.dimension];
      return (!query || [row.asin, row.sku, ...(row.inventorySkus || []), row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase().includes(query))
        && (!inventoryState.line || row.line === inventoryState.line)
        && (!inventoryState.type || row.type === inventoryState.type)
        && (!inventoryState.risk || inventoryLevel(metrics?.[inventoryState.basis], inventoryState.basis, row.isTestKit) === inventoryState.risk);
    }).sort((a, b) => {
      const key = inventoryState.sort;
      const metricSource = (row) => (key === 'recentQty' || key === 'dailySales')
        ? row.twoWeekMetrics?.[state.dimension]
        : key === 'replenishmentQty' ? row.replenishment?.[state.dimension]
          : row.metrics?.[state.dimension];
      const metricKey = key === 'recent4Qty' ? 'recentQty' : key === 'dailySales4' ? 'dailySales' : key === 'replenishmentQty' ? 'recommendedQty' : key;
      const left = inventoryMetricColumns.has(key) ? metricSource(a)?.[metricKey] : a[key];
      const right = inventoryMetricColumns.has(key) ? metricSource(b)?.[metricKey] : b[key];
      let comparison;
      if (inventoryTextColumns.has(key)) {
        comparison = inventoryCollator.compare(cleanText(left), cleanText(right));
      } else {
        // Keep missing values last in both directions; zero remains a valid number.
        if (hasNumber(left) !== hasNumber(right)) return hasNumber(left) ? -1 : 1;
        comparison = n(left) - n(right);
      }
      return comparison * (inventoryState.direction === 'asc' ? 1 : -1) || inventoryCollator.compare(a.asin, b.asin);
    });
    $('#inventoryCount').textContent = `${rows.length} / ${inventory.rows.length} 个 ASIN · ${inventory.audit.sourceRows} 条源记录 · 已去重 ${inventory.audit.deduplicatedRows || 0} 条${inventory.audit.overrideExcludedRows ? ` · 指定 SKU 排除 ${inventory.audit.overrideExcludedRows} 条` : ''}`;
    $('#inventorySummary').innerHTML = [
      ['available', '可售库存', 'available'],
      ['reserved', '预留库存', 'FC Processing + Staging'],
      ['inbound', 'FBA 在途库存', 'inbound-received + no-sale-last-6-months'],
      ['total', 'FBA 总库存', '可售 + 预留 + FBA 在途'],
      ['usLocal', '美国本地库存', 'FBA 总库存 + iHealth 仓库-US 预计库存'],
      ['endToEnd', '全链条库存', '美国本地库存 + 头程海上在途 + 工厂执行订单'],
    ].map(([key, label, formula]) => `<div class="inventory-stat"><span>${label}</span><strong>${format(rows.reduce((total, row) => total + row[key], 0), 'qty')}</strong><small>${safe(formula)}</small></div>`).join('');
    const warnings = [];
    if (inventory.audit.unmatchedAsins.length) warnings.push(`${inventory.audit.unmatchedAsins.length} 个 ASIN 未匹配产品资料，仍保留库存`);
    if (inventory.audit.mappingConflicts.length) warnings.push(`${new Set(inventory.audit.mappingConflicts.map((item) => item.asin)).size} 个 ASIN 的产品分类有冲突`);
    if (inventory.audit.identifierConflicts?.length) warnings.push(`${inventory.audit.identifierConflicts.length} 组 SKU 与产品表 ASIN 不一致，已按库存 ASIN 核对并保留标记`);
    const extendedBlankLabels = [
      ['warehouseExpected', 'iHealth仓库-US 预计库存'],
      ['oceanInTransit', '头程海上在途'],
      ['factoryOpenOrders', 'iHealth Open 订单-工厂在执行订单'],
    ].filter(([, label]) => inventory.audit.blankCellsByColumn?.[label] === inventory.audit.sourceRows).map(([, label]) => label);
    if (extendedBlankLabels.length) warnings.push(`${extendedBlankLabels.join('、')}源列当前全部为空，按 0 计算`);
    const alert = $('#inventoryAlert');
    alert.hidden = !warnings.length;
    alert.textContent = warnings.length ? `源表核对提示：${warnings.join('；')}。` : '';
    const deduplication = inventory.audit.deduplicatedGroups || [];
    const overrides = inventory.audit.skuOverrides || [];
    if ($('#inventoryDeduplication')) {
      $('#inventoryDeduplication').hidden = !deduplication.length && !overrides.length;
      $('#inventoryDedupSummary').textContent = `库存取值记录：${overrides.length} 条指定 SKU 规则 · ${deduplication.length} 组相同库存去重 · 共排除 FBA 库存 ${format(inventory.audit.removedTotals?.total, 'qty')}`;
      const overrideNotes = overrides.map((rule) => `<li>${safe(rule.asin)}：指定只取 ${safe(rule.sku)}。${rule.excludedSkus.length ? `排除 ${safe(rule.excludedSkus.join('、'))}，对应可售 ${format(rule.removedQuantities.available, 'qty')}、预留 ${format(rule.removedQuantities.reserved, 'qty')}、在途 ${format(rule.removedQuantities.inbound, 'qty')}。` : '源表中无其他 SKU 需要排除。'}</li>`).join('');
      $('#inventoryDedupDetails').innerHTML = overrideNotes + deduplication.map((group) => `<li>${safe(group.asin)}：保留 ${safe(group.keptSku)}；${safe(group.skippedSkus.join('、'))} 的八项库存数量相同，不重复计入。扣除可售 ${format(group.removedQuantities.available, 'qty')}、预留 ${format(group.removedQuantities.reserved, 'qty')}、在途 ${format(group.removedQuantities.inbound, 'qty')}。</li>`).join('');
    }
    const decimal = (value) => hasNumber(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const stockBreakdown = (row, localOnly) => [
      ['FBA 总库存', format(row.total, 'qty')],
      ['iHealth仓库-US 预计库存', format(row.warehouseExpected, 'qty')],
      ...(!localOnly ? [['头程海上在途', format(row.oceanInTransit, 'qty')], ['iHealth Open 订单-工厂在执行订单', format(row.factoryOpenOrders, 'qty')]] : []),
    ];
    const stockAmount = (row, key) => `<span class="inventory-stock" tabindex="0" data-asin="${safe(row.asin)}" data-stock="${key}">${format(row[key], 'qty')}</span>`;
    const badge = (row, metrics, key) => {
      const weeks = metrics?.[key];
      const level = inventoryLevel(weeks, key, row.isTestKit);
      const statusLabel = inventoryStatus(weeks, key, row.isTestKit);
      const text = hasNumber(weeks) ? `${decimal(weeks)} 周` : metrics?.status === 'zero-sales' ? '近四周无销量' : '销量不足';
      return `<span class="inventory-weeks ${level}" tabindex="0" data-asin="${safe(row.asin)}" data-weeks="${key}" aria-label="${safe(text)}，库存状态${statusLabel}" title="${safe(metrics?.reason || `${weeks} 周 · ${statusLabel}`)}"><b>${text}</b><small class="inventory-risk-label">${statusLabel}</small></span>`;
    };
    $('#inventoryBody').innerHTML = rows.length ? rows.map((row) => {
      const metrics = row.metrics[state.dimension];
      const twoWeekMetrics = row.twoWeekMetrics?.[state.dimension];
      const provenance = `源表第 ${row.sourceRows.map((index) => index + 1).join('、')} 行${row.deduplicatedRows ? `；去重排除第 ${row.deduplicatedSourceRows.map((index) => index + 1).join('、')} 行` : ''}${row.skuOverride?.excludedSourceRows.length ? `；指定 SKU 规则排除第 ${row.skuOverride.excludedSourceRows.map((index) => index + 1).join('、')} 行` : ''}`;
      const notes = [row.mapped ? typeLabel(row.type) : '产品资料未匹配', row.skuOverride ? `指定只取 ${row.skuOverride.sku}` : row.deduplicatedRows ? `${row.sourceRows.length} 条源记录 · 相同库存已去重 ${row.deduplicatedRows} 条` : row.sourceRows.length > 1 ? `${row.sourceRows.length} 条不同库存相加` : ''].filter(Boolean).join(' · ');
      const skuList = (row.inventorySkus || []).join(' / ');
      const inventoryLabel = row.skuOverride
        ? (row.skuOverride.excludedSkus.length ? `<small class="inventory-note">已排除：${safe(row.skuOverride.excludedSkus.join(' / '))}</small>` : '')
        : skuList && skuList !== row.sku ? `<small class="inventory-note">库存 SKU：${safe(skuList)}</small>` : '';
      const replenishment = row.replenishment?.[state.dimension];
      const replenishmentLabel = inventoryReplenishmentLabel(row, replenishment);
      const replenishmentClass = replenishment?.status === 'ok' && replenishment.recommendedQty > 0 ? 'warning' : replenishment?.status === 'ok' ? 'ok' : 'neutral';
      return `<tr><td><div class="inventory-product">${safe(row.sku)}</div>${inventoryLabel}<small class="inventory-note">${safe(notes)}</small></td><td title="${safe(provenance)}">${safe(row.asin)}</td><td>${safe(row.line)}</td><td>${format(row.available, 'qty')}</td><td>${format(row.reserved, 'qty')}</td><td>${format(row.inbound, 'qty')}</td><td>${format(row.total, 'qty')}</td><td>${format(row.warehouseExpected, 'qty')}</td><td>${format(row.oceanInTransit, 'qty')}</td><td>${format(row.factoryOpenOrders, 'qty')}</td><td>${stockAmount(row, 'usLocal')}</td><td>${stockAmount(row, 'endToEnd')}</td><td title="近两周销量；${safe(twoWeekMetrics?.reason || '用于趋势对比')}">${format(twoWeekMetrics?.recentQty, 'qty')}</td><td title="近四周销量；${safe(metrics?.reason || '用于库存可售周数计算')}">${format(metrics?.recentQty, 'qty')}</td><td title="近两周销量 ÷ 14；用于趋势对比">${decimal(twoWeekMetrics?.dailySales)}</td><td title="近四周销量 ÷ 28；用于库存可售周数计算">${decimal(metrics?.dailySales)}</td><td>${badge(row, metrics, 'availableWeeks')}</td><td>${badge(row, metrics, 'reservedWeeks')}</td><td>${badge(row, metrics, 'totalWeeks')}</td><td>${badge(row, metrics, 'usLocalWeeks')}</td><td>${badge(row, metrics, 'endToEndWeeks')}</td><td><span class="inventory-replenishment ${replenishmentClass}" tabindex="0" data-asin="${safe(row.asin)}" data-replenishment="true" aria-label="${safe(replenishmentLabel)}">${safe(replenishmentLabel)}<small>${safe(inventoryReplenishmentSubtext(row, replenishment))}</small></span></td></tr>`;
    }).join('') : '<tr><td colspan="22" class="inventory-empty">没有符合当前筛选条件的库存记录</td></tr>';
    const byAsin = new Map(rows.map((row) => [row.asin, row]));
    $$('.inventory-stock', $('#inventoryBody')).forEach((element) => {
      const row = byAsin.get(element.dataset.asin);
      const localOnly = element.dataset.stock === 'usLocal';
      const label = localOnly ? '美国本地库存' : '全链条库存';
      const tip = () => `<div class="tip-title">${safe(row.asin)} · ${label}</div>${tooltipRows([
        ...stockBreakdown(row, localOnly), [label, format(row[element.dataset.stock], 'qty')],
        ['计算方法', '以上库存分项相加'], ['库存快照', snapshot],
      ])}`;
      bindHover(element, tip);
      element.addEventListener('focus', () => { const rect = element.getBoundingClientRect(); showTooltip(tip(), { clientX: rect.left, clientY: rect.top }); });
      element.addEventListener('blur', hideTooltip);
    });
    $$('.inventory-weeks', $('#inventoryBody')).forEach((element) => {
      const row = byAsin.get(element.dataset.asin);
      const metrics = row.metrics[state.dimension];
      const key = element.dataset.weeks;
      const [label, stock] = key === 'availableWeeks' ? ['可售库存', row.available]
        : key === 'reservedWeeks' ? ['可售 + 预留', row.availableReserved]
          : key === 'totalWeeks' ? ['FBA 总库存', row.total]
            : key === 'usLocalWeeks' ? ['美国本地库存', row.usLocal]
              : ['全链条库存', row.endToEnd];
      const tip = () => `<div class="tip-title">${safe(row.asin)} · ${label}可售周数</div>${tooltipRows([
        ['对应库存', format(stock, 'qty')], ['近四周销量', format(metrics.recentQty, 'qty')], ['平均日销（4 周）', decimal(metrics.dailySales)],
        ['近两周销量（对比）', format(row.twoWeekMetrics?.[state.dimension]?.recentQty, 'qty')], ['可售周数', hasNumber(metrics[key]) ? `${decimal(metrics[key])} 周` : metrics.reason],
        ['库存状态', inventoryStatus(metrics[key], key, row.isTestKit)],
        ...(row.isTestKit && metrics.targets?.[key] ? [['试剂盒安全线', `${metrics.targets[key]} 周`]] : []),
        ...(inventoryHealthRanges[key] ? [['健康区间', `${inventoryHealthRanges[key].min}–${inventoryHealthRanges[key].max} 周`], ['红色预警', `>${inventoryHealthRanges[key].red} 周`]] : []),
        ...(['usLocalWeeks', 'endToEndWeeks'].includes(key) ? stockBreakdown(row, key === 'usLocalWeeks') : []),
        ['公式', `${label} ÷（近四周销量 ÷ 28 × 7）`], ['销量窗口', dates], ['库存快照', snapshot], ['销量口径', sourceName],
      ])}`;
      bindHover(element, tip);
      element.addEventListener('focus', () => { const rect = element.getBoundingClientRect(); showTooltip(tip(), { clientX: rect.left, clientY: rect.top }); });
      element.addEventListener('blur', hideTooltip);
    });
    $$('.inventory-replenishment', $('#inventoryBody')).forEach((element) => {
      const row = byAsin.get(element.dataset.asin);
      const recommendation = row.replenishment?.[state.dimension];
      const tip = () => `<div class="tip-title">${safe(row.asin)} · 补货建议</div>${tooltipRows(row.isTestKit ? [
        ['结论', inventoryReplenishmentLabel(row, recommendation)],
        ['当前可售+预留', format(recommendation?.currentAvailableReserved, 'qty')],
        ['当前近四周销量', format(recommendation?.current4WeekQty, 'qty')],
        ['历史同期四周销量', format(recommendation?.historical4WeekQty, 'qty')],
        ['下周预计销量', decimal(recommendation?.forecastNextWeekQty)],
        ['下周销售后需保留', recommendation?.forecastNextWeekQty != null ? `${format(recommendation.forecastNextWeekQty * (recommendation.targetWeeks || 12), 'qty')} 件（${recommendation.targetWeeks || 12} 周）` : '—'],
        ['补货后下周可售+预留', recommendation?.recommendedQty != null && recommendation?.forecastNextWeekQty != null ? `${format(recommendation.currentAvailableReserved + recommendation.recommendedQty - recommendation.forecastNextWeekQty, 'qty')} 件` : '—'],
        ['计算依据', recommendation?.basis || '—'],
        ['建议量公式', recommendation?.recommendedQty != null ? `先覆盖下周销量，再保留 12 周：向上取整（${decimal(recommendation.forecastNextWeekQty)} × 13 − ${format(recommendation.currentAvailableReserved, 'qty')}） = ${format(recommendation.recommendedQty, 'qty')} 件` : recommendation?.reason || '—'],
      ] : [
        ['结论', inventoryReplenishmentLabel(row, recommendation)], ['当前可售+预留', format(recommendation?.currentAvailableReserved, 'qty')],
        ['近7天销量', format(recommendation?.recent7DayQty, 'qty')], ['近30天销量', format(recommendation?.recent30DayQty, 'qty')],
        ['近7天日均', decimal(recommendation?.recent7DailySales)], ['近30天日均', decimal(recommendation?.recent30DailySales)],
        ['采用预测日均', decimal(recommendation?.forecastDailySales)], ['预计库存可覆盖', hasNumber(recommendation?.coverageWeeks) ? `${decimal(recommendation.coverageWeeks)} 周` : '—'],
        ['预计执行日期', recommendation?.executionDate || '—'], ['预计到货日期', recommendation?.arrivalDate || '—'], ['建议补货量', format(recommendation?.recommendedQty, 'qty')],
        ['计算依据', recommendation?.basis || recommendation?.reason || '—'],
      ])}`;
      bindHover(element, tip);
      element.addEventListener('focus', () => { const rect = element.getBoundingClientRect(); showTooltip(tip(), { clientX: rect.left, clientY: rect.top }); });
      element.addEventListener('blur', hideTooltip);
    });
  }


  const annualProductState = { dimension: 'pm', grain: 'year', line: '', sku: '', lifecycle: '' };
  const annualProductDraft = { ...annualProductState };
  function renderAnnualProduct() {
    const sourceGrain = annualProductState.grain === 'year' ? 'month' : annualProductState.grain;
    const rows = DATA.actuals?.[annualProductState.dimension]?.[sourceGrain] || [];
    const products = DATA.productMap || [];
    const bySku = new Map(products.map(p => [p.sku, p]));
    const filtered = rows.filter(r => { const p=bySku.get(r.sku)||r; return (!annualProductState.line || p.line===annualProductState.line) && (!annualProductState.sku || r.sku===annualProductState.sku) && (!annualProductState.lifecycle || p.lifecycle===annualProductState.lifecycle); });
    const periods = [...new Set(filtered.map(r => annualProductState.grain==='year' ? String(yearOf(r)) : r.period))].sort(periodSort);
    const metricDefs=[['qty','销量'],['returns','总回款'],['singleReturns','单个回款'],['refundRate','退货率'],['profit','总利润'],['singleProfit','单个利润']];
    const agg=period=>{ const a=aggregate(filtered.filter(r => (annualProductState.grain==='year'?String(yearOf(r)):r.period)===period)); a.singleProfit=a.qty&&a.profit!==null?a.profit/a.qty:null; return a; };
    $('#annualProductHead').innerHTML='<tr><th>时间周期</th>'+metricDefs.map(x=>'<th>'+x[1]+'</th>').join('')+'</tr>';
    const annualCutoff = DATA.coverage?.[annualProductState.dimension]?.month?.cutoff; const annualLatest = DATA.coverage?.[annualProductState.dimension]?.month?.latestPeriod; $('#annualProductBody').innerHTML=periods.length ? periods.map(period=>{const a=agg(period); const cutoffLabel=annualProductState.grain==='year' && String(period)===String(annualLatest||'').slice(0,4) && annualCutoff ? '（截至'+annualCutoff+'）' : ''; return '<tr><td class="period-cell">'+safe(period)+safe(cutoffLabel)+'</td>'+metricDefs.map(x=>'<td>'+format(a[x[0]],x[0])+'</td>').join('')+'</tr>';}).join('') : '<tr><td colspan="7" class="annual-product-empty">没有符合筛选条件的数据</td></tr>';
    $('#annualProductCaption').textContent = (annualProductState.dimension==='pm'?'PM':'领星')+' · '+(annualProductState.grain==='year'?'年度汇总':annualProductState.grain==='month'?'月度明细':'周度明细')+' · '+filtered.length+' 条源记录';
    const vals={line:[...new Set(products.map(p=>p.line).filter(Boolean))],sku:[...new Set(products.map(p=>p.sku).filter(Boolean))]};
    for(const [id,key,label] of [['annualProductLine','line','全部产品线'],['annualProductSku','sku','全部 SKU']]) { const el=$('#'+id); const old=el.value; el.innerHTML='<option value="">'+label+'</option>'+vals[key].sort().map(v=>'<option>'+safe(v)+'</option>').join(''); el.value=old; }
  }

  function renderAll() {
    hideTooltip();
    fillSelects();
    renderCaption();
    renderKpis();
    renderCategoryOverview();
    renderTrend();
    renderMix();
    renderProgress();
    renderInventory();
    renderTable();
    renderAnnualProduct();
  }

  function localDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  let toastTimer = null;

  function showToast(message, type = '') {
    const element = $('#toast');
    element.textContent = message;
    element.classList.toggle('success', type === 'success');
    element.classList.toggle('error', type === 'error');
    element.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('show'), type === 'success' ? 6000 : 4000);
  }

  function storedJson(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function showStoredRefreshNotice() {
    const notice = storedJson('amazonRefreshNotice');
    if (!notice) return;
    sessionStorage.removeItem('amazonRefreshNotice');
    showToast(notice.message, notice.type);
  }

  function renderRefreshStatus(status) {
    const button = $('#refreshDataBtn');
    const label = $('#refreshButtonLabel');
    const summary = $('#refreshStatus');
    button.disabled = Boolean(status.running);
    button.classList.toggle('refreshing', Boolean(status.running));
    summary.classList.toggle('running', Boolean(status.running));
    summary.classList.toggle('error', Boolean(!status.running && status.lastError));
    if (status.running) {
      label.textContent = '正在更新数据';
      const sheetProgress = status.totalSheets ? `（${status.currentSheet || 0}/${status.totalSheets}）` : '';
      summary.textContent = `${status.progress || '正在抓取飞书数据'}${sheetProgress}`;
    } else if (status.lastError) {
      label.textContent = '重新更新数据';
      summary.textContent = `上次更新失败：${status.lastError}。网页仍保留上次成功数据`;
    } else {
      label.textContent = '立即更新数据';
      const updated = status.lastSuccessAt ? `上次更新：${localDateTime(status.lastSuccessAt)}` : `当前数据生成于：${localDateTime(status.dataGeneratedAt || DATA.generatedAt)}`;
      summary.textContent = `${updated} · 下次自动更新：${localDateTime(status.nextScheduledAt)}`;
    }
  }

  function refreshServiceAvailable() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  function renderProductionRefreshStatus() {
    const button = $('#refreshDataBtn');
    const label = $('#refreshButtonLabel');
    const summary = $('#refreshStatus');
    if (!button || !summary) return;
    button.disabled = true;
    button.title = '生产网页只展示已发布数据；自动抓取需要通过本地服务运行';
    if (label) label.textContent = '生产版不可抓取';
    summary.classList.remove('running', 'error');
    summary.textContent = '生产版已发布数据 · 自动抓取请通过本地服务打开';
  }
  async function updateRefreshStatus() {
    if (!refreshServiceAvailable()) { renderProductionRefreshStatus(); return; }
    try {
      const response = await fetch('/api/refresh/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`状态接口返回 ${response.status}`);
      const status = await response.json();
      renderRefreshStatus(status);
      const pending = storedJson('amazonManualRefreshPending');
      if (pending && !status.running) {
        if (status.lastError) {
          sessionStorage.removeItem('amazonManualRefreshPending');
          showToast(`数据更新失败：${status.lastError}。网页仍保留上次成功数据`, 'error');
        } else if (status.lastSuccessAt && new Date(status.lastSuccessAt).getTime() >= pending.requestedAt - 2000) {
          sessionStorage.removeItem('amazonManualRefreshPending');
          if (status.dataGeneratedAt && status.dataGeneratedAt !== DATA.generatedAt) {
            sessionStorage.setItem('amazonRefreshNotice', JSON.stringify({ type: 'success', message: '数据更新完成，页面已加载最新数据' }));
            window.location.reload();
            return;
          }
          showToast('数据更新完成，当前页面已是最新数据', 'success');
        }
      } else if (!status.running && status.dataGeneratedAt && status.dataGeneratedAt !== DATA.generatedAt) {
        // Reload only when the server has a newer dataset. A locally prepared
        // preview can intentionally have a later timestamp than refresh-status;
        // reloading in that case creates an endless 5-second refresh loop.
        const serverTime = new Date(status.dataGeneratedAt).getTime();
        const pageTime = new Date(DATA.generatedAt).getTime();
        if (Number.isFinite(serverTime) && Number.isFinite(pageTime) && serverTime > pageTime) window.location.reload();
      }
    } catch {
      $('#refreshDataBtn').disabled = true;
      $('#refreshStatus').classList.add('error');
      $('#refreshStatus').textContent = '自动更新服务未连接，请通过本地服务打开此页面';
    }
  }

  async function requestDataRefresh() {
    if (!refreshServiceAvailable()) { renderProductionRefreshStatus(); showToast('生产网页不能直接连接本地抓取服务，请使用本地服务打开后更新数据', 'error'); return; }
    const button = $('#refreshDataBtn');
    button.disabled = true;
    button.classList.add('refreshing');
    $('#refreshButtonLabel').textContent = '正在启动更新';
    $('#refreshStatus').classList.remove('error');
    $('#refreshStatus').classList.add('running');
    $('#refreshStatus').textContent = '正在连接飞书并准备抓取全部数据';
    try {
      const response = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' });
      const result = await response.json();
      if (!response.ok && response.status !== 409) throw new Error(result.message || `更新接口返回 ${response.status}`);
      sessionStorage.setItem('amazonManualRefreshPending', JSON.stringify({ requestedAt: Date.now(), baselineGeneratedAt: DATA.generatedAt }));
      showToast(result.message || '已开始更新数据');
      renderRefreshStatus(result.status || { running: true, progress: '正在连接飞书' });
    } catch (error) {
      sessionStorage.removeItem('amazonManualRefreshPending');
      showToast(`无法开始更新：${error.message}`, 'error');
      await updateRefreshStatus();
    }
  }

  function bind() {

    ['annualProductDimension','annualProductGrain','annualProductLine','annualProductSku','annualProductLifecycle'].forEach(id => $('#'+id)?.addEventListener('change', e => { annualProductDraft[id.replace('annualProduct','').toLowerCase()] = e.target.value; }));
    $('#annualProductApply')?.addEventListener('click', () => { Object.assign(annualProductState, annualProductDraft); renderAnnualProduct(); });
    $$('#dimensionSeg button').forEach((button) => button.addEventListener('click', () => { $$('#dimensionSeg button').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }); state.dimension = button.dataset.value; state.year = availableYears(state.grain)[0] || '2026'; state.period = ''; renderAll(); }));
    $$('#grainSeg button').forEach((button) => button.addEventListener('click', () => { $$('#grainSeg button').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }); state.grain = button.dataset.value; state.period = ''; renderAll(); }));
    $$('#detailSeg button').forEach((button) => button.addEventListener('click', () => { state.detail = button.dataset.value; $$('#detailSeg button').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }); renderTable(); }));
    $('#yearSelect').addEventListener('change', (event) => { state.year = event.target.value; state.period = ''; renderAll(); });
    $('#periodSelect').addEventListener('change', (event) => { state.period = event.target.value; renderAll(); });
    $('#groupSelect').addEventListener('change', (event) => { state.group = event.target.value; renderAll(); });
    $('#metricSelect').addEventListener('change', (event) => { state.metric = event.target.value; renderAll(); });
    [['searchInput', 'search'], ['lineFilter', 'line'], ['lifeFilter', 'lifecycle'], ['typeFilter', 'type'], ['ownerFilter', 'owner']].forEach(([id, key]) => $('#' + id).addEventListener('input', (event) => { state[key] = event.target.value; renderAll(); }));
    $('#exportBtn').addEventListener('click', exportView);
    $('#refreshDataBtn').addEventListener('click', requestDataRefresh);
    [['inventorySearch', 'search'], ['inventoryLineFilter', 'line'], ['inventoryTypeFilter', 'type'], ['inventoryRiskFilter', 'risk'], ['inventoryCoverBasis', 'basis']].forEach(([id, key]) => {
      $('#' + id)?.addEventListener('input', (event) => { inventoryState[key] = event.target.value; hideTooltip(); renderInventory(); });
    });
    $('#inventoryPanel thead')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-inventory-sort]');
      const key = button?.dataset.inventorySort;
      if (!inventorySortColumns.has(key)) return;
      inventoryState.direction = inventoryState.sort === key
        ? (inventoryState.direction === 'asc' ? 'desc' : 'asc')
        : inventoryTextColumns.has(key) ? 'asc' : 'desc';
      inventoryState.sort = key;
      hideTooltip();
      renderInventory();
      $('#inventoryPanel .inventory-table-scroll').scrollTop = 0;
    });
    const setFilterDrawer = (open) => {
      $('#controlbar').classList.toggle('drawer-open', open);
      $('#filterBackdrop').classList.toggle('show', open);
      $('#filterFab').setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('filter-drawer-open', open);
    };
    const syncFilterFab = () => $('#filterFab').classList.toggle('show', window.scrollY > 360);
    $('#filterFab').addEventListener('click', () => setFilterDrawer(!$('#controlbar').classList.contains('drawer-open')));
    $('#filterClose').addEventListener('click', () => setFilterDrawer(false));
    $('#filterBackdrop').addEventListener('click', () => setFilterDrawer(false));
    if ('IntersectionObserver' in window) {
      const filterObserver = new IntersectionObserver(([entry]) => $('#filterFab').classList.toggle('show', !entry.isIntersecting), { threshold: 0 });
      filterObserver.observe($('#controlbar'));
    }
    window.addEventListener('scroll', syncFilterFab, { passive: true });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setFilterDrawer(false); });
    syncFilterFab();
    $('#resetBtn').addEventListener('click', () => {
      Object.assign(state, { dimension: 'lx', grain: 'month', year: '2026', period: '2026-09', group: 'line', detail: 'sku', metric: 'sales', search: '', line: '', lifecycle: '', type: '', owner: '' });
      Object.assign(inventoryState, { search: '', line: '', type: '', risk: '', basis: 'totalWeeks', sort: 'totalWeeks', direction: 'desc' });
      $$('#dimensionSeg button').forEach((button) => {
        const active = button.dataset.value === 'lx';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      $$('#grainSeg button').forEach((button) => {
        const active = button.dataset.value === 'month';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      $$('#detailSeg button').forEach((button) => {
        const active = button.dataset.value === 'sku';
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      $('#groupSelect').value = 'line'; $('#metricSelect').value = 'sales'; $('#searchInput').value = '';
      $('#inventorySearch').value = ''; $('#inventoryLineFilter').value = ''; $('#inventoryTypeFilter').value = '';
      $('#inventoryRiskFilter').value = ''; $('#inventoryCoverBasis').value = 'totalWeeks';
      renderAll();
    });
  }

  function exportView() {
    const rows = selectedRows();
    const header = ['SKU', 'ASIN', '产品线', '新老品', '硬件/测试盒', '归属', '销量', '销售额', '净销售额', '总回款', '利润', '广告费', '推广费比', '退款率', '期间'];
    const body = rows.map((row) => [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner, row.qty, row.sales, row.netSales, row.returns, row.profit, row.adSpend, row.promoRate, row.refundRate, row.period]);
    const csv = [header, ...body].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `amazon-${state.dimension}-${state.grain}-${state.period || 'no-data'}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  bind();
  renderAll();
  showStoredRefreshNotice();
  updateRefreshStatus();
  window.setInterval(updateRefreshStatus, 5000);
})();


