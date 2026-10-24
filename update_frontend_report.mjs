import fs from 'node:fs';

const basePath = process.env.REVIEW_DATA_PATH || 'C:/codex/数据计算/差评申诉周报_data.json';
const rawPath = process.env.REVIEW_RECORDS_PATH || 'C:/codex/数据计算/live_records_precheck.json';
const checksPath = process.env.REVIEW_CHECKS_PATH || 'C:/codex/数据计算/amazon_link_checks_live.json';
const salesPath = process.env.REVIEW_SALES_PATH || 'C:/codex/数据计算/sales_raw.json';
const verifiedPath = process.env.REVIEW_VERIFIED_PATH || 'C:/codex/数据计算/live_records_frontend_verified.json';

const data = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : {};
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const checks = fs.existsSync(checksPath) ? JSON.parse(fs.readFileSync(checksPath, 'utf8')) : [];
const salesRaw = fs.existsSync(salesPath) ? JSON.parse(fs.readFileSync(salesPath, 'utf8')) : {};
const checkByLink = new Map(checks.map((x) => [x.url, x]));
const productAlias = { '验孕13支': '验孕13 Pack', '验孕3支': '验孕3支装' };
const records = [...new Map(raw.map((r) => [r.link, r])).values()].map((r) => {
  const check = checkByLink.get(r.link);
  return {
    ...r,
    reportProduct: String(productAlias[String(r.product ?? '').trim()] || r.product || '').trim(),
    frontendState: check?.state || 'not_checked',
    frontendTitle: check?.title || '',
    frontendUrl: check?.finalUrl || '',
    frontendVerifiedDeleted: check?.state === 'deleted_frontend',
    primaryStatusDeleted: /已删除/.test(String(r.status || '')),
    secondAppealStatusDeleted: /已删除/.test(String(r.secondStatus || '')),
    sourceStatusDeleted: /已删除/.test(`${r.status || ''} ${r.secondStatus || ''}`),
  };
});
fs.writeFileSync(verifiedPath, JSON.stringify(records, null, 2), 'utf8');

const parseDate = (value) => {
  if (!value) return null;
  // 兼容旧版去重把多个日期拼成“日期1 / 日期2”的记录：取第一个可解析的日期（第一份源表优先）。
  for (const part of String(value).split(' / ')) {
    const d = new Date(part.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};
const pad = (n) => String(n).padStart(2, '0');
const mondayOf = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
};
const isoWeek = (date) => {
  const monday = mondayOf(date);
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const firstMonday = mondayOf(new Date(Date.UTC(year, 0, 4)));
  const week = Math.floor((monday - firstMonday) / 604800000) + 1;
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return `${year}-W${pad(week)} (${pad(monday.getUTCMonth() + 1)}/${pad(monday.getUTCDate())}-${pad(sunday.getUTCMonth() + 1)}/${pad(sunday.getUTCDate())})`;
};
const recWeek = (r, field) => {
  const date = parseDate(r[field]);
  return date ? isoWeek(date) : '';
};
const isAppeal = (r) => Boolean(parseDate(r.appealDate));
const isReview = (r) => Boolean(parseDate(r.reviewDate));
// 删除口径完全按飞书源表：申诉状态或二次申诉状态任一字段包含“已删除”即计入。
// Amazon 前台核验仅作辅助信息，不参与删除统计。
const isPrimaryDeleted = (r) => r.primaryStatusDeleted === true || /已删除/.test(String(r.status || ''));
const isSecondAppealDeleted = (r) => r.secondAppealStatusDeleted === true || /已删除/.test(String(r.secondStatus || ''));
const isDeleted = (r) => isPrimaryDeleted(r) || isSecondAppealDeleted(r);
// 累计口径的“申诉记录”：有申诉日期，或源表状态已删除（已删除必然经过申诉，只是缺少申诉日期）。
// 这样累计删除 ⊆ 累计申诉，成功率不会超过 100%；按申诉周统计的周明细仍只使用有申诉日期的记录。
const isAppealRecord = (r) => isAppeal(r) || isDeleted(r);
// 分母为 0 时返回 null，由前端显示“-”，不能输出 0%、NaN 或 Infinity。
const pct = (n, d) => Number(d) > 0 && Number.isFinite(Number(n)) ? Number((n / d).toFixed(8)) : null;
const key = (...parts) => parts.map((x) => String(x ?? '')).join('\u0001');
const clean = (v) => String(v ?? '').trim();
const compareText = (a, b) => String(a).localeCompare(String(b), 'zh-CN');
const cellText = (cell) => clean(cell?.text !== undefined ? cell.text : cell?.value);
const normalizeHeader = (value) => clean(value).replace(/^\uFEFF/, '').replace(/\s+/g, '');
const numberValue = (value) => {
  const text = clean(value).replace(/,/g, '');
  if (!text) return null;
  const normalized = text.replace(/^\((.*)\)$/, '-$1');
  const number = Number(normalized.replace(/%$/, ''));
  return Number.isFinite(number) ? number : null;
};
const salesWeekKey = (year, week) => {
  const y = String(year ?? '').match(/\d{4}/)?.[0];
  const w = String(week ?? '').match(/W(?:eek)?\s*(\d{1,2})/i)?.[1];
  return y && w ? `${y}-W${pad(Number(w))}` : '';
};
const salesIndex = new Map();
const salesRowsSeen = [];
for (const source of Object.values(salesRaw || {})) {
  for (const sheet of source?.sheets || []) {
    const header = (sheet.rows || [])[0]?.values || [];
    const headers = header.map(cellText);
    const indexes = Object.fromEntries(['年份', '周数', 'ASIN', '销量'].map((name) => [name, headers.findIndex((h) => normalizeHeader(h) === normalizeHeader(name))]));
    if (Object.values(indexes).some((i) => i < 0)) throw new Error(`销量工作表“${sheet.name || '未命名'}”缺少必需字段：年份、周数、ASIN、销量`);
    for (const row of (sheet.rows || []).slice(1)) {
      const values = row.values || [];
      const asin = clean(cellText(values[indexes.ASIN])).toUpperCase();
      const week = salesWeekKey(cellText(values[indexes['年份']]), cellText(values[indexes['周数']]));
      const units = numberValue(cellText(values[indexes['销量']]));
      if (!asin && !week && units === null) continue;
      if (!asin || !week || units === null) { salesRowsSeen.push({ invalid: true }); continue; }
      const k = `${asin}\u0001${week}`;
      salesIndex.set(k, (salesIndex.get(k) || 0) + units);
      salesRowsSeen.push({ asin, week, units });
    }
  }
}
if (Object.keys(salesRaw || {}).length && !salesRowsSeen.length) throw new Error('销量工作表未读取到可解析的销量数据');
const salesForRecords = (list) => {
  const asins = [...new Set(list.map((r) => clean(r.asin).toUpperCase()).filter(Boolean))];
  if (!asins.length) return { sales: null, asins: [], missingAsins: [] };
  const week = list.map((r) => recWeek(r, 'reviewDate')).find(Boolean) || '';
  const missingAsins = asins.filter((asin) => !salesIndex.has(`${asin}\u0001${week}`));
  const sales = missingAsins.length ? null : asins.reduce((total, asin) => total + (salesIndex.get(`${asin}\u0001${week}`) || 0), 0);
  return { sales, asins, missingAsins, week };
};
const salesForWeekRecords = (list, week) => {
  const asins = [...new Set(list.map((r) => clean(r.asin).toUpperCase()).filter(Boolean))];
  if (!asins.length) return { sales: null, asins: [], missingAsins: [] };
  const iso = String(week || '').slice(0, 8);
  const missingAsins = asins.filter((asin) => !salesIndex.has(`${asin}\u0001${iso}`));
  const sales = missingAsins.length ? null : asins.reduce((total, asin) => total + (salesIndex.get(`${asin}\u0001${iso}`) || 0), 0);
  return { sales, asins, missingAsins, week: iso };
};
const salesRate = (reviews, sales) => Number.isFinite(Number(sales)) && Number(sales) > 0 ? pct(reviews, sales) : null;

// 将源表中的方向归并成可读的分析类别，避免直接堆叠原始文案。
const directionRules = [
  ['留评过快/异常时点', /留评太快|留评过快|留论过快|异常时点|同天|当天|隔天|次日|收到货|买10天|用了几周/i],
  ['疑似机器/机器人号', /机器|机械|机器人|测评号|bot|robot/i],
  ['专业差评号', /专业差评|专业评论|专业买家|差评买家/i],
  ['评论早于配送', /评论早于配送|早于配送/i],
  ['关联购买/协同异常', /同时|另外.*下单|另外.*差评|买了|买.*并|购买|关联|协同|还买|同一天.*差评/i],
  ['内容/类目攻击', /攻击|类目|内容错误|评论内容.*错误/i],
  ['评论/主页异常', /主页|评论内容和评论者|非verified|非Verified/i],
  ['垃圾信息/刷屏', /垃圾|刷屏|spam/i],
  ['退款/售后异常', /退款|退货|售后/i],
  ['未见明显异常', /没什么异常|无明显异常|真人评论|正常/i],
];
const classifyDirections = (text) => {
  const s = clean(text);
  if (!s) return [];
  const hits = directionRules.filter(([, re]) => re.test(s)).map(([label]) => label);
  return hits.length ? [...new Set(hits)] : ['其他申诉方向'];
};
const summarizeDirections = (list) => {
  const counts = new Map();
  let denominator = 0;
  for (const text of list) {
    const cats = classifyDirections(text);
    if (!cats.length) continue;
    denominator += 1;
    for (const cat of cats) counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  if (!denominator || !counts.size) return null;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .map(([name, count]) => `${name} ${count}条（${(count / denominator * 100).toFixed(1)}%）`)
    .join('；');
};
const topDirection = (list) => {
  const counts = new Map();
  let denominator = 0;
  for (const text of list) {
    const cats = classifyDirections(text);
    if (!cats.length) continue;
    denominator += 1;
    for (const cat of cats) counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  if (!denominator || !counts.size) return null;
  const [name, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0];
  return `${name} ${count}条（${(count / denominator * 100).toFixed(1)}%）`;
};
const starCounts = (list) => {
  const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 };
  for (const r of list) {
    const rating = clean(r.rating);
    if (/^[1-5]$/.test(rating)) out[rating] += 1;
    else out.unknown += 1;
  }
  return out;
};
const ownerNames = (list) => [...new Set(list.map((r) => clean(r.owner)).filter(Boolean))].sort(compareText).join('、');
const explicitSubmitted = (r) => Boolean(clean(`${r.status || ''} ${r.secondStatus || ''}`));
const statusPending = (r) => /待提交|待跟进/.test(`${r.status || ''} ${r.secondStatus || ''}`);

const allProducts = [...new Set(records.map((r) => r.reportProduct).filter(Boolean))].sort(compareText);
const appealGroups = new Map();
const reviewGroups = new Map();
const productGroups = new Map();
const productAppealGroups = new Map();
const productReviewGroups = new Map();
const appealWeeks = new Map();
const reviewWeeks = new Map();
const ownerWeeks = new Map();
const ensure = (map, k, make) => { if (!map.has(k)) map.set(k, make()); return map.get(k); };
// 产品名缺失的记录不进入任何产品维度分组（产品汇总、产品周、申诉/留评周 × 产品占比），
// 但仍计入不依赖产品的周总计和负责人统计。
const appealProductWeeks = new Map();
const reviewProductWeeks = new Map();
for (const r of records) {
  const p = r.reportProduct;
  const hasProduct = Boolean(p);
  if (hasProduct) ensure(productGroups, key(p), () => ({ product: p, records: [] })).records.push(r);
  if (isAppeal(r)) {
    const w = recWeek(r, 'appealDate');
    if (hasProduct) {
      ensure(productAppealGroups, key(w, p), () => ({ week: w, product: p, records: [] })).records.push(r);
      ensure(appealGroups, key(w, p, r.owner), () => ({ week: w, product: p, owner: r.owner, records: [] })).records.push(r);
      ensure(appealProductWeeks, w, () => []).push(r);
    }
    ensure(appealWeeks, w, () => []).push(r);
    ensure(ownerWeeks, key(w, r.owner), () => ({ week: w, owner: r.owner, records: [] })).records.push(r);
  } else if (isDeleted(r)) {
    // Count source-table deletions even when no appeal date exists; surface them under an explicit unassigned week.
    ensure(ownerWeeks, key('申诉周未填写', r.owner), () => ({ week: '申诉周未填写', owner: r.owner, records: [] })).records.push(r);
  }
  if (isReview(r)) {
    const w = recWeek(r, 'reviewDate');
    if (hasProduct) {
      ensure(productReviewGroups, key(w, p), () => ({ week: w, product: p, records: [] })).records.push(r);
      ensure(reviewGroups, key(w, p, r.owner), () => ({ week: w, product: p, owner: r.owner, records: [] })).records.push(r);
      ensure(reviewProductWeeks, w, () => []).push(r);
    }
    ensure(reviewWeeks, w, () => []).push(r);
  }
}
const weekSort = (a, b) => String(a).localeCompare(String(b));
const groupSort = (a, b) => weekSort(a.week, b.week) || compareText(a.product, b.product) || compareText(a.owner, b.owner);
const rowsFromGroups = (map) => [...map.values()].sort(groupSort);
const table = (header, rows) => [header, ...rows.map((r) => header.map((h) => r[h] ?? null))];

const currentWeekBoundary = mondayOf(new Date());
currentWeekBoundary.setUTCDate(currentWeekBoundary.getUTCDate() - 7);
const currentFullWeek = isoWeek(currentWeekBoundary);
const weekCode = (label) => String(label || '').slice(0, 8);
const activityWeeks = [...new Set([...appealWeeks.keys(), ...reviewWeeks.keys()].filter(Boolean))].sort((a, b) => weekCode(a).localeCompare(weekCode(b)));
const defaultWeek = activityWeeks.filter((week) => weekCode(week) <= weekCode(currentFullWeek)).at(-1) || activityWeeks.at(-1) || currentFullWeek;

// 产品维度固定以留评周为时间锚点；申诉周只用于申诉时间维度。
const productReviewWeekHeader = ['周次','产品','当周销量','当周新增差评','当周提交差评数','当周删除数','删除成功率','申诉类型一览','成功比例最高的申诉类型'];
const productReviewWeekRows = [...productReviewGroups.values()].sort(groupSort).map((g) => {
  const appeals = g.records.filter(isAppeal);
  const deleted = appeals.filter(isDeleted).length;
  const sales = salesForWeekRecords(g.records, g.week).sales;
  return { 周次:g.week, 产品:g.product, 当周销量:sales, 当周新增差评:g.records.length, 当周提交差评数:appeals.length, 当周删除数:deleted,
    删除成功率:appeals.length ? pct(deleted, appeals.length) : null, 申诉类型一览:summarizeDirections(appeals.map((r) => r.direction)), 成功比例最高的申诉类型:topDirection(appeals.map((r) => r.direction)) };
});
data.product_review_week = table(productReviewWeekHeader, productReviewWeekRows);
// 保留旧键，避免旧缓存或旧客户端读取时出现空数据；新页面只使用 product_review_week。
data.product_week = data.product_review_week;

// “所选留评周”字段与产品周明细一致，以留评周为锚点（数据快照中为默认完整周）：
// 所选留评周申诉数/删除数 = 该留评周新增差评中已申诉/已删除的记录。
// 累计删除数量按源表状态统计产品下全部已删除记录，包括缺少申诉日期的记录（它们只是不进入申诉周明细）。
const productSummaryHeader = ['产品','所选留评周申诉数','累计申诉数量','所选留评周删除数','累计删除数量','累计成功率','申诉类型一览','成功比例最高的申诉类型','本周新增差评','本周销量','本周差评率'];
const productSummaryRows = [...productGroups.values()].sort((a,b)=>compareText(a.product,b.product)).map((g) => {
  const appeal = g.records.filter(isAppealRecord);
  const deleted = appeal.filter(isDeleted).length;
  const current = productReviewGroups.get(key(defaultWeek, g.product))?.records || [];
  const currentAppeals = current.filter(isAppeal);
  const currentSales = current.length ? salesForWeekRecords(current, defaultWeek).sales : null;
  return { 产品:g.product, 所选留评周申诉数:currentAppeals.length, 累计申诉数量:appeal.length, 所选留评周删除数:currentAppeals.filter(isDeleted).length, 累计删除数量:deleted, 累计成功率:appeal.length ? pct(deleted, appeal.length) : null,
    申诉类型一览:summarizeDirections(appeal.map((r)=>r.direction)), 成功比例最高的申诉类型:topDirection(appeal.map((r)=>r.direction)),
    本周新增差评:current.length, 本周销量:currentSales, 本周差评率:salesRate(current.length, currentSales) };
});
data.product_summary = table(productSummaryHeader, productSummaryRows);

const appealTotalHeader = ['周次','周申诉总数','明确已提交数','周已删除数','申诉成功率'];
data.appeal_total = table(appealTotalHeader, [...appealWeeks.entries()].sort((a,b)=>weekSort(a[0],b[0])).map(([week,list])=>({周次:week,周申诉总数:list.length,明确已提交数:list.filter(explicitSubmitted).length,周已删除数:list.filter(isDeleted).length,申诉成功率:pct(list.filter(isDeleted).length,list.length)})));
const appealShareHeader = ['周次','产品','申诉数量','已删除数量','申诉占比','已删除占比'];
data.appeal_share = table(appealShareHeader, rowsFromGroups(productAppealGroups).map((g)=>{const all=appealProductWeeks.get(g.week)||[];const deletedAll=all.filter(isDeleted).length;return {周次:g.week,产品:g.product,申诉数量:g.records.length,已删除数量:g.records.filter(isDeleted).length,申诉占比:pct(g.records.length,all.length),已删除占比:pct(g.records.filter(isDeleted).length,deletedAll)};}));

const reviewTotalHeader = ['周次','周新增差评数','周销量','差评率','周已删除数','已删除率'];
data.review_total = table(reviewTotalHeader, [...reviewWeeks.entries()].sort((a,b)=>weekSort(a[0],b[0])).map(([week,list])=>{const sales=salesForWeekRecords(list,week).sales;const deleted=list.filter(isDeleted).length;return {周次:week,周新增差评数:list.length,周销量:sales,差评率:salesRate(list.length,sales),周已删除数:deleted,已删除率:pct(deleted,list.length)};}));
const reviewShareHeader = ['周次','产品','新增差评数','销量','差评率','已删除数量','产品占比','已删除占比'];
data.review_share = table(reviewShareHeader, rowsFromGroups(productReviewGroups).map((g)=>{const all=reviewProductWeeks.get(g.week)||[];const deletedAll=all.filter(isDeleted).length;const sales=salesForWeekRecords(g.records,g.week).sales;return {周次:g.week,产品:g.product,新增差评数:g.records.length,销量:sales,差评率:salesRate(g.records.length,sales),已删除数量:g.records.filter(isDeleted).length,产品占比:pct(g.records.length,all.length),已删除占比:pct(g.records.filter(isDeleted).length,deletedAll)};}));

const ownerWeekHeader = ['周次','负责人','负责产品','申诉数量','已删除数量','申诉成功率','状态空白数','待跟进数'];
data.owner_week = table(ownerWeekHeader, [...ownerWeeks.values()].sort((a,b)=>(a.week==='申诉周未填写'?1:0)-(b.week==='申诉周未填写'?1:0)||weekSort(a.week,b.week)||compareText(a.owner,b.owner)).map((g)=>{const appeals=g.records.filter(isAppealRecord),deleted=appeals.filter(isDeleted).length;return {周次:g.week,负责人:g.owner,负责产品:[...new Set(g.records.map((r)=>r.reportProduct).filter(Boolean))].sort(compareText).join('、'),申诉数量:appeals.length,已删除数量:deleted,申诉成功率:appeals.length?pct(deleted,appeals.length):null,状态空白数:appeals.filter((r)=>!explicitSubmitted(r)).length,待跟进数:appeals.filter(statusPending).length};}));

data.meta = { ...(data.meta || {}), sales: { rows: salesRowsSeen.length, parsedRows: salesRowsSeen.filter((r) => !r.invalid).length, invalidRows: salesRowsSeen.filter((r) => r.invalid).length, indexKeys: salesIndex.size } };
const deletedCount = records.filter(isDeleted).length;
const primaryDeletedCount = records.filter(isPrimaryDeleted).length;
const secondAppealDeletedCount = records.filter(isSecondAppealDeleted).length;
const secondAppealOnlyDeletedCount = records.filter((r) => isSecondAppealDeleted(r) && !isPrimaryDeleted(r)).length;
const sourceStatusCounts = records.reduce((a, r) => { const s = clean(`${r.status || ''} ${r.secondStatus || ''}`) || '状态空白'; a[s] = (a[s] || 0) + 1; return a; }, {});
data.notes = [
  ['项目', '口径说明'],
  ['数据范围', '第一份源表 + 第二份飞书申诉记录表；第二份表负责人统一记为“晕晕+欧阳”。'],
  ['模板页', '名称为“产品-负责人”的模板页不读取、不计入统计。'],
  ['去重规则', '按评论链接去重；重复记录优先保留第一份源表的产品、负责人等信息，并合并来源记录。'],
  ['删除判定', '按飞书源表“申诉状态”和“二次申诉状态”判定：任一字段包含“已删除”即计入已删除；空白或其他状态不计入。Amazon 前台核验结果仅作辅助参考。'],
  ['申诉成功率', '已删除数量 ÷ 申诉记录数量。累计口径的申诉记录 = 有申诉日期的记录 + 源表已删除但未填写申诉日期的记录（已删除必然经过申诉），因此成功率不会超过 100%，且总览、产品和负责人的累计申诉数与累计删除数保持一致；按申诉周统计的周明细只使用有申诉日期的记录，负责人维度将无申诉日期的已删除记录列在“申诉周未填写”。'],
  ['申诉方向', '先归纳为方向类别；未填写方向不加入方向分析；同一条记录可命中多个方向，因此各方向占比合计可能超过100%。'],
  ['周次', '按周一至周日的 ISO 周计算。重复记录的日期以第一份源表为准，缺失时才用后续来源补齐。'],
  ['产品维度', '产品名缺失的记录不进入产品维度及“周次 × 产品”占比（已删除记录会单独列出排除原因），但仍计入周总计和负责人统计。产品累计删除数量包含缺少申诉日期的已删除记录，这类记录只是不进入按申诉周统计的周明细。'],
  ['“本周”口径', '总览的“本申诉周申诉数/删除数/成功率”以申诉周（默认完整周）为锚点；产品维度的“所选留评周申诉数/删除数/新增差评/销量/差评率”以所选留评周为锚点（未选择时为默认完整周）。两者锚点不同，数值可以不同。'],
  ['销量与差评率', '销量来自“领星_周度订单利润”表，按 ASIN + ISO 周匹配；当销量缺失时显示“—”，不把未知销量当作 0，也不计算虚假的差评率。'],
  ['比例分母为 0', '任何比例的分母为 0 时显示“-”，不显示 0%、NaN 或 Infinity。'],
  ['自动更新', '每天 22:00（Asia/Shanghai）自动重新调用飞书开放平台 API 读取全部允许的数据源并重新计算；失败时保留上一次成功数据。'],
];
data.link_notes = [['说明','判定规则'],['已删除（含二次申诉）','源表“申诉状态”或“二次申诉状态”任一字段包含“已删除”。'],['其中二次申诉删除','仅“二次申诉状态”包含“已删除”的记录数量。'],['未删除','两个状态字段均为空、未回复、已拒绝或其他非“已删除”状态。']];
data.meta = { ...(data.meta || {}), recordCount:records.length, productCount:productSummaryRows.length, weekCount:new Set([...appealWeeks.keys(),...reviewWeeks.keys()]).size, refreshedAt:new Date().toISOString(), deletionBasis:'source_table_status', sourceStatusCounts, frontendVerification:{total:records.length,...sourceStatusCounts,deleted:deletedCount,primaryDeleted:primaryDeletedCount,secondAppealDeleted:secondAppealDeletedCount,secondAppealOnlyDeleted:secondAppealOnlyDeletedCount} };
const appealRecords = records.filter(isAppealRecord);
const deletedWithoutAppealDate = records.filter((r) => isDeleted(r) && !isAppeal(r));
// 产品名为空的已删除记录不硬分配产品，只在此列出排除原因，供页面提示和核对。
const deletedExcludedFromProduct = records.filter((r) => isDeleted(r) && !r.reportProduct).map((r) => ({
  reason: '产品名为空，未计入产品维度', owner: r.owner || '', sourceSheet: r.sourceSheet || '', appealDate: r.appealDate || '', reviewDate: r.reviewDate || '',
}));
data.meta.overall = {
  appealCount: appealRecords.length,
  appealDeletedCount: appealRecords.filter(isDeleted).length,
  deletedCount,
  deletedWithoutAppealDate: deletedWithoutAppealDate.length,
  productDeletedCount: productSummaryRows.reduce((n, r) => n + r.累计删除数量, 0),
  deletedExcludedFromProduct,
  missingProductRecords: records.filter((r) => !r.reportProduct).length,
};
data.meta.defaultWeek = defaultWeek;
data.meta.currentFullWeek = currentFullWeek;
fs.writeFileSync(basePath, JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify({records:records.length,appealRecords:records.filter(isAppeal).length,reviewRecords:records.filter(isReview).length,deleted:deletedCount,primaryDeleted:primaryDeletedCount,secondAppealDeleted:secondAppealDeletedCount,secondAppealOnlyDeleted:secondAppealOnlyDeletedCount,sourceStatuses:sourceStatusCounts,products:productSummaryRows.length,productWeeks:productReviewWeekRows.length,appealWeeks:appealWeeks.size,reviewWeeks:reviewWeeks.size,ownerWeeks:data.owner_week.length-1},null,2));


