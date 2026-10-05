import fs from 'node:fs';

const oldPath = process.env.REVIEW_OLD_RAW_PATH || 'C:/codex/数据计算/old_live_raw.json';
const newPath = process.env.REVIEW_NEW_RAW_PATH || 'C:/codex/数据计算/new_live_raw.json';
const outPath = process.env.REVIEW_RECORDS_PATH || 'C:/codex/数据计算/live_records_precheck.json';
const normalize = (v) => String(v ?? '').trim();
const cellText = (cell) => normalize(cell?.text !== undefined ? cell.text : cell?.value);
const normalizeHeader = (value) => normalize(value).replace(/^\uFEFF/, '').replace(/\s+/g, '');
const headerIndex = (headers, name) => headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(name));
const cellAt = (cells, indexes, name) => cellText(cells[indexes[name]]);
const dateAt = (cells, indexes, name) => parseDate(cells[indexes[name]]);
const excelSerialToIso = (n) => {
  const ms = Math.round((Number(n) - 25569) * 86400000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const parseDate = (cell) => {
  if (!cell) return null;
  const text = cellText(cell);
  if (text) {
    const m = text.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString();
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
  }
  if (typeof cell.value === 'number') return excelSerialToIso(cell.value);
  return null;
};
const rawRows = [];
const addSource = (doc, sourceKey, sourceLabel) => {
  for (const sheet of doc.sheets || []) {
    const owner = normalize(sheet.owner);
    if (!owner) throw new Error(`源 ${sourceKey} 的工作表“${sheet.name}”缺少负责人配置`);
    const headerRow = (sheet.rows || [])[0]?.values || [];
    const headers = headerRow.map((cell) => cellText(cell));
    const indexes = Object.fromEntries(['申诉日期', '产品', 'ASIN', '评论链接', '星级', '评论日期', '申诉方向', '申诉状态', '二次申诉状态'].map((name) => [name, headerIndex(headers, name)]));
    const missing = Object.entries(indexes).filter(([, index]) => index < 0).map(([name]) => name);
    if (missing.length) throw new Error(`源 ${sourceKey} 的工作表“${sheet.name}”缺少必需字段：${missing.join('、')}`);
    for (const rr of (sheet.rows || []).slice(1)) {
      const cells = rr.values || [];
      const link = cellAt(cells, indexes, '评论链接');
      if (!/^https?:\/\/[^\s]*amazon\./i.test(link)) continue;
      rawRows.push({
        link,
        product: cellAt(cells, indexes, '产品'),
        asin: cellAt(cells, indexes, 'ASIN'),
        rating: cellAt(cells, indexes, '星级'),
        appealDate: dateAt(cells, indexes, '申诉日期'),
        reviewDate: dateAt(cells, indexes, '评论日期'),
        direction: cellAt(cells, indexes, '申诉方向'),
        status: cellAt(cells, indexes, '申诉状态'),
        secondStatus: cellAt(cells, indexes, '二次申诉状态'),
        owner,
        source: sourceLabel,
        sourceKey,
        sourceSheet: sheet.name,
      });
    }
  }
};
const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
const newer = JSON.parse(fs.readFileSync(newPath, 'utf8'));
addSource(old, old.sourceKey || 'main-report', '主申诉表');
addSource(newer, newer.sourceKey || 'secondary-report', '补充申诉表');
const mergeText = (left, right) => [...new Set([left, right].map(normalize).filter(Boolean))].join(' / ');
const byLink = new Map();
for (const r of rawRows) {
  const existing = byLink.get(r.link);
  if (!existing) byLink.set(r.link, { ...r, mergedSources: [r.source], mergedSourceKeys: [r.sourceKey] });
  else {
    existing.mergedSources = [...new Set([...(existing.mergedSources || [existing.source]), r.source])];
    existing.mergedSourceKeys = [...new Set([...(existing.mergedSourceKeys || [existing.sourceKey]), r.sourceKey])];
    for (const field of ['appealDate', 'reviewDate', 'direction', 'status', 'secondStatus']) existing[field] = mergeText(existing[field], r[field]);
    existing.mergedSourceSheets = [...new Set([...(existing.mergedSourceSheets || [existing.sourceSheet]), r.sourceSheet])];
  }
}
const records = [...byLink.values()];
fs.writeFileSync(outPath, JSON.stringify(records, null, 2), 'utf8');
const bySource = records.reduce((a, r) => ((a[r.source] = (a[r.source] || 0) + 1), a), {});
console.log(JSON.stringify({ rawCandidates: rawRows.length, uniqueRecords: records.length, duplicateGroups: rawRows.length - records.length, bySource, sheets: [...new Set(records.map(r => r.sourceSheet))] }, null, 2));
