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
    if (unit === 'percent') return `${(value * 100).toFixed(1)}%`;
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
    const parts = String(period).split('|');
    const year = Number(parts[0]);
    const week = parts[2] || String(parts[1] || '').match(/(?:Week|W)\s*0*(\d{1,2})/i)?.[1];
    return year && week ? { year: year - 1, week: Number(week) } : '';
  }

  function comparisonRows(grain = state.grain, period = state.period) {
    const prior = priorPeriod(period, grain);
    if (!prior) return [];
    const rows = sourceRows(state.dimension, grain);
    if (grain === 'week' && typeof prior === 'object') {
      return filterRows(rows.filter((row) => yearOf(row) === prior.year && Number(String(row.week || '').match(/(?:Week|W)\s*0*(\d{1,2})/i)?.[1]) === prior.week));
    }
    return filterRows(rowsForPeriod(rows, grain, prior));
  }

  function yoyMarkup(actual, previous, metric, forecast = null) {
    if (!hasNumber(previous)) return '<div class="yoy muted">同比 —</div>';
    if (!hasNumber(actual)) return '<div class="yoy muted">同比 —</div>';
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
    $('.source-strip small').textContent = `${availability}；当前选择${cutoffLabel()}。实际数据按飞书源表原记录展示；月度、周度不互相推算，季度和年度只汇总月度实际数据。未结束周期的同比按已发生时间外推完整周期，并与上年完整周期比较。完成进度仅在 2026 年且目标表有对应目标时显示。`;
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
      const note = metric === 'singleReturns' ? '总回款 ÷ 销量' : metric === 'promoRate' ? '广告费 ÷ 销售额' : metric === 'refundRate' ? '退款量 ÷ 销量' : forecast ? `源表实际值 · 同比按已发生${Math.round(forecast.ratio * 1000) / 10}%时间外推` : '源表实际值';
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
      const forecast = period === state.period ? periodForecastInfo(state.grain, period) : null;
      return {
        period,
        label: periodLabel(period, state.grain),
        actual: actualValue,
        expected: forecast ? forecastMetric(actualValue, state.metric, forecast) : null,
        forecast,
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
    $('#trendSub').textContent = `按${GRAIN_LABELS[state.grain]}汇总 · ${cutoffLabel()} · 未结束周期同时标注实际值与预期值`;
    $('#trendForecastLegend').style.display = data.some((row) => row.forecast && hasNumber(row.expected)) ? '' : 'none';
    $('#trendTargetLegend').style.display = data.some((row) => hasNumber(row.target)) ? '' : 'none';
    const chart = $('#trendChart');
    if (!data.length) { chart.innerHTML = '<div class="empty">当前年份没有可用的源表记录</div>'; return; }
    const w = 760, h = 250, pad = { left: 50, right: 20, top: 20, bottom: 34 };
    const values = data.map((row) => n(row.actual));
    const expectedValues = data.map((row) => row.forecast && hasNumber(row.expected) ? row.expected : null).filter(hasNumber);
    const targets = data.map((row) => hasNumber(row.target) ? row.target : null).filter(hasNumber);
    const max = Math.max(...values, ...(expectedValues.length ? expectedValues : [0]), ...(targets.length ? targets : [0]), 1);
    const x = (index) => pad.left + (data.length === 1 ? (w - pad.left - pad.right) / 2 : index * (w - pad.left - pad.right) / (data.length - 1));
    const y = (value) => h - pad.bottom - (value / max) * (h - pad.top - pad.bottom);
    const actualPoints = data.map((row, index) => `${x(index)},${y(n(row.actual))}`).join(' ');
    const targetPoints = data.map((row, index) => hasNumber(row.target) ? `${x(index)},${y(row.target)}` : '').filter(Boolean).join(' ');
    const grid = [0, .25, .5, .75, 1].map((ratio) => `<line class="gridline" x1="${pad.left}" x2="${w - pad.right}" y1="${y(max * ratio)}" y2="${y(max * ratio)}"/><text class="axis" x="8" y="${y(max * ratio) + 4}">${safe(format(max * ratio, metric))}</text>`).join('');
    const labelStep = Math.max(1, Math.ceil(data.length / 10));
    const labels = data.map((row, index) => (index % labelStep === 0 || index === data.length - 1) ? `<text class="axis" x="${x(index)}" y="${h - 8}" text-anchor="middle">${safe(row.label)}</text>` : '').join('');
    const points = data.map((row, index) => `<circle class="point" cx="${x(index)}" cy="${y(n(row.actual))}" r="4"/><rect class="trend-hit" data-index="${index}" x="${Math.max(pad.left, x(index) - 22)}" y="${pad.top}" width="44" height="${h - pad.top - pad.bottom}"/>`).join('');
    const forecastMarks = data.map((row, index) => {
      if (!row.forecast || !hasNumber(row.expected)) return '';
      const pointX = x(index);
      const actualY = y(n(row.actual));
      const expectedY = y(row.expected);
      const anchor = pointX > w * .7 ? 'end' : 'start';
      const textX = anchor === 'end' ? pointX - 8 : pointX + 8;
      const actualLabelY = Math.min(h - pad.bottom - 7, actualY + (expectedY <= actualY ? 17 : -9));
      const expectedLabelY = Math.max(pad.top + 10, expectedY + (expectedY <= actualY ? -9 : 17));
      return `<line class="forecast-line" x1="${pointX}" x2="${pointX}" y1="${actualY}" y2="${expectedY}"/><circle class="forecast-point" cx="${pointX}" cy="${expectedY}" r="5"/><text class="trend-value-label" x="${textX}" y="${actualLabelY}" text-anchor="${anchor}">实际 ${safe(format(row.actual, metric))}</text><text class="trend-value-label forecast" x="${textX}" y="${expectedLabelY}" text-anchor="${anchor}">预期 ${safe(format(row.expected, metric))}</text>`;
    }).join('');
    chart.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${safe(METRICS[metric].label)}趋势"><defs><linearGradient id="areaFillNew" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f9d8a" stop-opacity=".20"/><stop offset="1" stop-color="#0f9d8a" stop-opacity="0"/></linearGradient></defs>${grid}<polygon class="trend-area" points="${pad.left},${h - pad.bottom} ${actualPoints} ${w - pad.right},${h - pad.bottom}" fill="url(#areaFillNew)"/><polyline class="trend-line" points="${actualPoints}"/>${targets.length ? `<polyline points="${targetPoints}" fill="none" stroke="#e7a23b" stroke-width="2" stroke-dasharray="5 5"/>` : ''}${labels}${points}${forecastMarks}</svg>`;
    $$('.trend-hit', chart).forEach((hit) => {
      const row = data[Number(hit.dataset.index)];
      bindHover(hit, () => `<div class="tip-title">${safe(row.label)}</div>${tooltipRows([["实际", format(row.actual, metric)], ['预期', row.forecast && hasNumber(row.expected) ? format(row.expected, metric) : '完整周期，无需预测'], ['目标', hasNumber(row.target) ? format(row.target, metric) : '无目标'], ['完成率', hasNumber(row.target) && row.target !== 0 ? `${(row.actual / row.target * 100).toFixed(1)}%` : '—']])}`);
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
    $$('.donut-segment', $('#mixChart')).forEach((segment) => { const index = Number(segment.dataset.index); const [name, value] = entries[index]; bindHover(segment, () => `<div class="tip-title">${safe(name)}</div>${tooltipRows([['数值', format(value, displayMetric)], ['占比', `${(value / total * 100).toFixed(1)}%`], ['当前指标', METRICS[metric].label]])}`); });
    $$('.legend-item', $('#mixChart')).forEach((item) => { const index = Number(item.dataset.index); const [name, value] = entries[index]; bindHover(item, () => `<div class="tip-title">${safe(name)}</div>${tooltipRows([['数值', format(value, displayMetric)], ['占比', `${(value / total * 100).toFixed(1)}%`]])}`); });
  }

  function progressData() {
    if (state.year !== '2026') return null;
    const actual = aggregate(hardwareRows(selectedRows()));
    const currentTargetRows = targetScope(state.grain, state.period);
    const annualTargetRows = targetScopeForPeriod('2026', 'year');
    const yearRows = hardwareRows(sourceRows(state.dimension, 'month').filter((row) => yearOf(row) === 2026 && (!state.search || [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner].join(' ').toLowerCase().includes(state.search.toLowerCase())) && (!state.line || row.line === state.line) && (!state.lifecycle || row.lifecycle === state.lifecycle) && (!state.type || row.type === state.type) && (!state.owner || row.owner === state.owner)));
    return { actual, current: aggregate(currentTargetRows), annualActual: aggregate(yearRows), annualTarget: aggregate(annualTargetRows) };
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
    return { current, annual, cutoff: coverage.cutoff };
  }

  function renderProgress() {
    const progress = progressData();
    if (!progress) {
      $('#progressDate').textContent = `${state.year}年 · 历史实际`;
      $('#progressGrid').innerHTML = '<div class="empty" style="grid-column:1/-1;padding:34px 12px">2023–2025 年只展示实际发生数据，不计算目标完成度。</div>';
      return;
    }
    const currentTargetAvailable = state.grain !== 'week' && ['qty', 'sales', 'returns'].some((key) => hasNumber(progress.current[key]));
    const annualTargetAvailable = ['qty', 'sales', 'returns'].some((key) => hasNumber(progress.annualTarget[key]));
    if (!currentTargetAvailable && !annualTargetAvailable) {
      $('#progressDate').textContent = `${periodLabel(state.period)} · 没有对应目标`;
      $('#progressGrid').innerHTML = '<div class="empty" style="grid-column:1/-1;padding:34px 12px">当前筛选范围没有 2026 年目标数据，因此不显示完成度。</div>';
      return;
    }
    const time = timeProgress();
    $('#progressDate').textContent = `${periodLabel(state.period)} · ${cutoffLabel()} · 当前${GRAIN_LABELS[state.grain]}与年度累计${time ? ` · 数据源最新截至 ${time.cutoff}` : ''}`;
    const metrics = [['qty', '销量'], ['sales', '销售额'], ['returns', '总回款']];
    const timeCard = time ? `<div class="progress-card"><h3>时间进度 · 当期</h3><div class="progress-number">${time.current === null ? '—' : `${(time.current * 100).toFixed(1)}%`}</div>${time.current === null ? '<div class="progress-unavailable">当前粒度无法比较</div>' : `<div class="progress-bar" data-tip="时间进度 · 当前${GRAIN_LABELS[state.grain]}|数据截至 ${time.cutoff}|时间进度 ${(time.current * 100).toFixed(1)}%"><div class="progress-fill" style="width:${time.current * 100}%"></div></div>`}<div class="progress-foot"><span>数据截至 ${time.cutoff}</span><span>期间结束 100%</span></div><div style="margin-top:12px"><h3>时间进度 · 年度</h3><div class="progress-bar" data-tip="时间进度 · 年度|数据截至 ${time.cutoff}|时间进度 ${(time.annual * 100).toFixed(1)}%"><div class="progress-fill" style="width:${time.annual * 100}%"></div></div><div class="progress-foot"><span>${(time.annual * 100).toFixed(1)}%</span><span>年度 100%</span></div></div></div>` : '';
    const metricCards = metrics.map(([key, label]) => {
      const actual = progress.actual[key];
      const target = progress.current[key];
      const annualActual = progress.annualActual[key];
      const annualTarget = progress.annualTarget[key];
      const currentAvailable = state.grain !== 'week' && hasNumber(target);
      const annualAvailable = hasNumber(annualTarget);
      const currentPct = currentAvailable && target !== 0 && hasNumber(actual) ? actual / target : null;
      const annualPct = annualAvailable && annualTarget !== 0 && hasNumber(annualActual) ? annualActual / annualTarget : null;
      const bar = (pct, tip) => pct === null ? '<div class="progress-unavailable">暂无目标</div>' : `<div class="progress-bar" data-tip="${safe(tip)}"><div class="progress-fill ${pct >= 1 ? 'over' : pct >= .8 ? '' : 'warn'}" style="width:${Math.min(100, Math.max(0, pct * 100))}%"></div></div>`;
      const currentTip = `${label} · 当前${GRAIN_LABELS[state.grain]}|实际 ${format(actual, key)}|目标 ${format(target, key)}|完成率 ${(currentPct * 100).toFixed(1)}%`;
      const annualTip = `${label} · 年度累计|实际 ${format(annualActual, key)}|目标 ${format(annualTarget, key)}|完成率 ${(annualPct * 100).toFixed(1)}%`;
      const gapText = (gap) => gap === null || !time ? '' : `<div class="progress-gap ${gap >= 0 ? 'ahead' : 'behind'}">${gap >= 0 ? '领先' : '落后'}时间进度 ${Math.abs(gap * 100).toFixed(1)} 个百分点</div>`;
      return `<div class="progress-card"><h3>${label} · 当期</h3><div class="progress-number">${currentPct === null ? '—' : `${(currentPct * 100).toFixed(1)}%`}</div>${bar(currentPct, currentTip)}${gapText(currentPct === null || time.current === null ? null : currentPct - time.current)}<div class="progress-foot"><span>实际 ${format(actual, key)}</span><span>${currentAvailable ? `目标 ${format(target, key)}` : '未提供目标'}</span></div><div style="margin-top:12px"><h3>${label} · 年度累计</h3>${bar(annualPct, annualTip)}${gapText(annualPct === null ? null : annualPct - time.annual)}<div class="progress-foot"><span>实际 ${format(annualActual, key)}</span><span>${annualAvailable ? `目标 ${format(annualTarget, key)}` : '未提供目标'}</span></div></div></div>`;
    }).join('');
    $('#progressGrid').innerHTML = timeCard + metricCards;
    $$('.progress-bar[data-tip]').forEach((bar) => bindHover(bar, () => `<div class="tip-title">完成进度</div>${tooltipRows(bar.dataset.tip.split('|').map((item, index) => index === 0 ? ['指标', item] : [item.split(' ')[0], item.slice(item.indexOf(' ') + 1)]))}`));
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
    const completion = (actual, target) => state.year === '2026' && hasNumber(actual) && hasNumber(target) && target !== 0 ? `<span class="pill ${actual / target >= 1 ? 'old' : actual / target < .8 ? 'new' : ''}">${(actual / target * 100).toFixed(1)}%</span>` : '';
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
      { label: '当期销量完成', progress: true, value: (item) => completion(item.progressActual.qty, item.currentTarget.qty), available: (item) => hasNumber(item.currentTarget.qty) && item.currentTarget.qty !== 0 },
      { label: '当期销售额完成', progress: true, value: (item) => completion(item.progressActual.sales, item.currentTarget.sales), available: (item) => hasNumber(item.currentTarget.sales) && item.currentTarget.sales !== 0 },
      { label: '当期回款完成', progress: true, value: (item) => completion(item.progressActual.returns, item.currentTarget.returns), available: (item) => hasNumber(item.currentTarget.returns) && item.currentTarget.returns !== 0 },
      { label: '年度销量完成', progress: true, value: (item) => completion(item.annualActual.qty, item.annualTarget.qty), available: (item) => hasNumber(item.annualTarget.qty) && item.annualTarget.qty !== 0 },
      { label: '年度销售额完成', progress: true, value: (item) => completion(item.annualActual.sales, item.annualTarget.sales), available: (item) => hasNumber(item.annualTarget.sales) && item.annualTarget.sales !== 0 },
      { label: '年度回款完成', progress: true, value: (item) => completion(item.annualActual.returns, item.annualTarget.returns), available: (item) => hasNumber(item.annualTarget.returns) && item.annualTarget.returns !== 0 },
    ].filter((column) => column.keep || (column.progress ? data.some((item) => column.available(item)) : data.some((item) => hasNumber(item.actual[column.metric]))));
    $('#tableHead').innerHTML = `<tr>${columns.map((column) => `<th>${column.label}</th>`).join('')}</tr>`;
    $('#tableBody').innerHTML = data.length ? data.map((item) => `<tr>${columns.map((column) => `<td class="${column.className ? column.className(item) : ''}">${column.value(item)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty">当前时间范围没有源表记录</td></tr>`;
    $('#rowCount').textContent = `${data.length} ${state.detail === 'sku' ? '个 SKU' : state.detail === 'line' ? '个产品线' : '个新老品分类'} · ${rows.length} 条源表明细`;
    $('#tableTitle').textContent = state.detail === 'sku' ? 'SKU 明细' : state.detail === 'line' ? '产品线明细' : '新老品汇总';
    $('#tableSub').textContent = `当前选择：${periodLabel(state.period)} · ${cutoffLabel()}。普通指标按当前筛选范围展示；完成度只匹配 2026 年硬件目标，实际完成值不含试剂盒，空白目标显示为 —。`;
    const time = timeProgress();
    const timeItem = (label, value, unavailableText = '') => {
      const available = hasNumber(value);
      const percentage = available ? value * 100 : 0;
      const display = available ? `${percentage.toFixed(1)}%` : '—';
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

  function renderAll() {
    hideTooltip();
    fillSelects();
    renderCaption();
    renderKpis();
    renderCategoryOverview();
    renderTrend();
    renderMix();
    renderProgress();
    renderTable();
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

  async function updateRefreshStatus() {
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
        window.location.reload();
      }
    } catch {
      $('#refreshDataBtn').disabled = true;
      $('#refreshStatus').classList.add('error');
      $('#refreshStatus').textContent = '自动更新服务未连接，请通过本地服务打开此页面';
    }
  }

  async function requestDataRefresh() {
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
    $$('#dimensionSeg button').forEach((button) => button.addEventListener('click', () => { $$('#dimensionSeg button').forEach((item) => item.classList.toggle('active', item === button)); state.dimension = button.dataset.value; state.year = availableYears(state.grain)[0] || '2026'; state.period = ''; renderAll(); }));
    $$('#grainSeg button').forEach((button) => button.addEventListener('click', () => { $$('#grainSeg button').forEach((item) => item.classList.toggle('active', item === button)); state.grain = button.dataset.value; state.period = ''; renderAll(); }));
    $$('#detailSeg button').forEach((button) => button.addEventListener('click', () => { state.detail = button.dataset.value; $$('#detailSeg button').forEach((item) => item.classList.toggle('active', item === button)); renderTable(); }));
    $('#yearSelect').addEventListener('change', (event) => { state.year = event.target.value; state.period = ''; renderAll(); });
    $('#periodSelect').addEventListener('change', (event) => { state.period = event.target.value; renderAll(); });
    $('#groupSelect').addEventListener('change', (event) => { state.group = event.target.value; renderAll(); });
    $('#metricSelect').addEventListener('change', (event) => { state.metric = event.target.value; renderAll(); });
    [['searchInput', 'search'], ['lineFilter', 'line'], ['lifeFilter', 'lifecycle'], ['typeFilter', 'type'], ['ownerFilter', 'owner']].forEach(([id, key]) => $('#' + id).addEventListener('input', (event) => { state[key] = event.target.value; renderAll(); }));
    $('#exportBtn').addEventListener('click', exportView);
    $('#refreshDataBtn').addEventListener('click', requestDataRefresh);
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
    $('#resetBtn').addEventListener('click', () => { Object.assign(state, { dimension: 'lx', grain: 'month', year: '2026', period: '2026-09', group: 'line', detail: 'sku', metric: 'sales', search: '', line: '', lifecycle: '', type: '', owner: '' }); $$('#dimensionSeg button').forEach((button) => button.classList.toggle('active', button.dataset.value === 'lx')); $$('#grainSeg button').forEach((button) => button.classList.toggle('active', button.dataset.value === 'month')); $$('#detailSeg button').forEach((button) => button.classList.toggle('active', button.dataset.value === 'sku')); $('#groupSelect').value = 'line'; $('#metricSelect').value = 'sales'; $('#searchInput').value = ''; renderAll(); });
  }

  function exportView() {
    const rows = selectedRows();
    const header = ['SKU', 'ASIN', '产品线', '新老品', '硬件/测试盒', '归属', '销量', '销售额', '净销售额', '总回款', '利润', '广告费', '推广费比', '退款率', '期间'];
    const body = rows.map((row) => [row.sku, row.asin, row.line, row.lifecycle, row.type, row.owner, row.qty, row.sales, row.netSales, row.returns, row.profit, row.adSpend, row.promoRate, row.refundRate, row.period]);
    const csv = [header, ...body].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
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
