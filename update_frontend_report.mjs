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
    reportProduct: productAlias[r.product] || r.product,
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
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
const pct = (n, d) => d ? Number((n / d).toFixed(8)) : 0;
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
const appealWeeks = new Map();
const reviewWeeks = new Map();
const ownerWeeks = new Map();
const ensure = (map, k, make) => { if (!map.has(k)) map.set(k, make()); return map.get(k); };
for (const r of records) {
  const p = r.reportProduct;
  const pg = ensure(productGroups, key(p), () => ({ product: p, records: [] }));
  pg.records.push(r);
  if (isAppeal(r)) {
    const w = recWeek(r, 'appealDate');
    const g = ensure(appealGroups, key(w, p, r.owner), () => ({ week: w, product: p, owner: r.owner, records: [] }));
    g.records.push(r);
    ensure(appealWeeks, w, () => []).push(r);
    ensure(ownerWeeks, key(w, r.owner), () => ({ week: w, owner: r.owner, records: [] })).records.push(r);
  } else if (isDeleted(r)) {
    // Count source-table deletions even when no appeal date exists; surface them under an explicit unassigned week.
    ensure(ownerWeeks, key('申诉周未填写', r.owner), () => ({ week: '申诉周未填写', owner: r.owner, records: [] })).records.push(r);
  }
  if (isReview(r)) {
    const w = recWeek(r, 'reviewDate');
    const g = ensure(reviewGroups, key(w, p, r.owner), () => ({ week: w, product: p, owner: r.owner, records: [] }));
    g.records.push(r);
    ensure(reviewWeeks, w, () => []).push(r);
  }
}
const weekSort = (a, b) => String(a).localeCompare(String(b));
const groupSort = (a, b) => weekSort(a.week, b.week) || compareText(a.product, b.product) || compareText(a.owner, b.owner);
const rowsFromGroups = (map) => [...map.values()].sort(groupSort);
const table = (header, rows) => [header, ...rows.map((r) => header.map((h) => r[h] ?? null))];

const productWeekHeader = ['周次','产品','负责人','留评差评数','申诉记录数','明确已提交数','申诉删除数','申诉成功率','1星','2星','3星','4星','5星','星级未知','申诉方向总结'];
const productWeekRows = [...new Set([...reviewGroups.keys(), ...appealGroups.keys()])]
  .map((k) => {
    const a = appealGroups.get(k) || { records: [] };
    const v = reviewGroups.get(k) || { records: [] };
    const sample = a.records[0] || v.records[0];
    const stars = starCounts(v.records);
    return { 周次: sample ? (recWeek(sample, isAppeal(a.records[0] || {}) ? 'appealDate' : 'reviewDate') || a.week || v.week) : '', 产品: sample?.reportProduct || a.product || v.product, 负责人: sample?.owner || a.owner || v.owner,
      留评差评数: v.records.length, 申诉记录数: a.records.length, 明确已提交数: a.records.filter(explicitSubmitted).length, 申诉删除数: a.records.filter(isDeleted).length, 申诉成功率: a.records.length ? pct(a.records.filter(isDeleted).length, a.records.length) : null,
      '1星': stars[1], '2星': stars[2], '3星': stars[3], '4星': stars[4], '5星': stars[5], 星级未知: stars.unknown,
      申诉方向总结: summarizeDirections(a.records.map((r) => r.direction)),
    };
  }).sort((a,b)=>weekSort(a.周次,b.周次)||compareText(a.产品,b.产品)||compareText(a.负责人,b.负责人));
data.product_week = table(productWeekHeader, productWeekRows);

const productSummaryHeader = ['产品','负责人','留评差评总数','申诉记录总数','明确已提交总数','已删除总数','申诉成功率','1星','2星','3星','4星','5星','星级未知','申诉方向总结'];
const productSummaryRows = [...productGroups.values()].sort((a,b)=>compareText(a.product,b.product)).map((g) => {
  const appeal = g.records.filter(isAppeal);
  const stars = starCounts(g.records);
  const deleted = g.records.filter(isDeleted).length;
  return { 产品:g.product, 负责人:ownerNames(g.records), 留评差评总数:g.records.filter(isReview).length, 申诉记录总数:appeal.length, 明确已提交总数:appeal.filter(explicitSubmitted).length, 已删除总数:deleted, 申诉成功率:appeal.length ? pct(deleted, appeal.length) : 0,
    '1星':stars[1], '2星':stars[2], '3星':stars[3], '4星':stars[4], '5星':stars[5], 星级未知:stars.unknown, 申诉方向总结:summarizeDirections(appeal.map((r)=>r.direction)) };
});
data.product_summary = table(productSummaryHeader, productSummaryRows);

const appealTotalHeader = ['周次','周申诉总数','明确已提交数','周已删除数','申诉成功率'];
data.appeal_total = table(appealTotalHeader, [...appealWeeks.entries()].sort((a,b)=>weekSort(a[0],b[0])).map(([week,list])=>({周次:week,周申诉总数:list.length,明确已提交数:list.filter(explicitSubmitted).length,周已删除数:list.filter(isDeleted).length,申诉成功率:pct(list.filter(isDeleted).length,list.length)})));
const appealShareHeader = ['周次','产品','负责人','申诉数量','已删除数量','申诉占比','已删除占比'];
data.appeal_share = table(appealShareHeader, rowsFromGroups(appealGroups).map((g)=>{const all=appealWeeks.get(g.week)||[];const deletedAll=all.filter(isDeleted).length;return {周次:g.week,产品:g.product,负责人:g.owner,申诉数量:g.records.length,已删除数量:g.records.filter(isDeleted).length,申诉占比:pct(g.records.length,all.length),已删除占比:pct(g.records.filter(isDeleted).length,deletedAll)};}));

const reviewTotalHeader = ['周次','周新增差评数','周销量','差评率','周已删除数','已删除率'];
data.review_total = table(reviewTotalHeader, [...reviewWeeks.entries()].sort((a,b)=>weekSort(a[0],b[0])).map(([week,list])=>{const sales=salesForWeekRecords(list,week).sales;const deleted=list.filter(isDeleted).length;return {周次:week,周新增差评数:list.length,周销量:sales,差评率:salesRate(list.length,sales),周已删除数:deleted,已删除率:pct(deleted,list.length)};}));
const reviewShareHeader = ['周次','产品','负责人','新增差评数','销量','差评率','已删除数量','产品占比','已删除占比'];
data.review_share = table(reviewShareHeader, rowsFromGroups(reviewGroups).map((g)=>{const all=reviewWeeks.get(g.week)||[];const deletedAll=all.filter(isDeleted).length;const sales=salesForWeekRecords(g.records,g.week).sales;return {周次:g.week,产品:g.product,负责人:g.owner,新增差评数:g.records.length,销量:sales,差评率:salesRate(g.records.length,sales),已删除数量:g.records.filter(isDeleted).length,产品占比:pct(g.records.length,all.length),已删除占比:pct(g.records.filter(isDeleted).length,deletedAll)};}));

const ownerWeekHeader = ['周次','负责人','负责产品','申诉数量','已删除数量','申诉成功率','状态空白数','待跟进数'];
data.owner_week = table(ownerWeekHeader, [...ownerWeeks.values()].sort((a,b)=>(a.week==='申诉周未填写'?1:0)-(b.week==='申诉周未填写'?1:0)||weekSort(a.week,b.week)||compareText(a.owner,b.owner)).map((g)=>{const appeals=g.records.filter(isAppeal),deleted=g.records.filter(isDeleted).length;return {周次:g.week,负责人:g.owner,负责产品:[...new Set(g.records.map((r)=>r.reportProduct))].sort(compareText).join('、'),申诉数量:appeals.length,已删除数量:deleted,申诉成功率:pct(deleted,appeals.length),状态空白数:appeals.filter((r)=>!explicitSubmitted(r)).length,待跟进数:appeals.filter(statusPending).length};}));

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
  ['申诉成功率', '已删除数量 ÷ 申诉记录数量；已删除数量完全按源表申诉状态统计，即使个别记录未填写申诉日期；周度申诉明细无法为无申诉日期记录归属申诉周。'],
  ['申诉方向', '先归纳为方向类别；未填写方向不加入方向分析；同一条记录可命中多个方向，因此各方向占比合计可能超过100%。'],
  ['周次', '按周一至周日的 ISO 周计算。'],
  ['销量与差评率', '销量来自“领星_周度订单利润”表，按 ASIN + ISO 周匹配；当销量缺失时显示“—”，不把未知销量当作 0，也不计算虚假的差评率。'],
];
data.link_notes = [['说明','判定规则'],['已删除（含二次申诉）','源表“申诉状态”或“二次申诉状态”任一字段包含“已删除”。'],['其中二次申诉删除','仅“二次申诉状态”包含“已删除”的记录数量。'],['未删除','两个状态字段均为空、未回复、已拒绝或其他非“已删除”状态。']];
data.meta = { ...(data.meta || {}), recordCount:records.length, productCount:productSummaryRows.length, weekCount:new Set([...appealWeeks.keys(),...reviewWeeks.keys()]).size, refreshedAt:new Date().toISOString(), deletionBasis:'source_table_status', sourceStatusCounts, frontendVerification:{total:records.length,...sourceStatusCounts,deleted:deletedCount,primaryDeleted:primaryDeletedCount,secondAppealDeleted:secondAppealDeletedCount,secondAppealOnlyDeleted:secondAppealOnlyDeletedCount} };
fs.writeFileSync(basePath, JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify({records:records.length,appealRecords:records.filter(isAppeal).length,reviewRecords:records.filter(isReview).length,deleted:deletedCount,primaryDeleted:primaryDeletedCount,secondAppealDeleted:secondAppealDeletedCount,secondAppealOnlyDeleted:secondAppealOnlyDeletedCount,sourceStatuses:sourceStatusCounts,products:productSummaryRows.length,productWeeks:productWeekRows.length,appealWeeks:appealWeeks.size,reviewWeeks:reviewWeeks.size,ownerWeeks:data.owner_week.length-1},null,2));


