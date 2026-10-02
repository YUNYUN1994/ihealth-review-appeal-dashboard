import fs from 'node:fs';

const oldPath = process.env.REVIEW_OLD_RAW_PATH || 'C:/codex/数据计算/old_live_raw.json';
const newPath = process.env.REVIEW_NEW_RAW_PATH || 'C:/codex/数据计算/new_live_raw.json';
const outPath = process.env.REVIEW_RECORDS_PATH || 'C:/codex/数据计算/live_records_precheck.json';

const ownerBySheet = {
  '550lt+血氧-丰仪': '丰仪',
  '5811黑+723se-邵靖': '邵靖',
  '723+300cl-李欢': '李欢',
  '5811白色+验孕4款-盼文': '盼文',
};
const normalize = (v) => String(v ?? '').trim();
const cellText = (cell) => normalize(cell?.text !== undefined ? cell.text : cell?.value);
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
const addSource = (doc, source, isOld) => {
  for (const sheet of doc.sheets || []) {
    if (isOld && sheet.name === '产品-负责人') continue;
    if (!isOld && sheet.name !== '申诉记录') continue;
    const owner = isOld ? ownerBySheet[sheet.name] : '晕晕+欧阳';
    if (!owner) continue;
    for (const rr of (sheet.rows || []).slice(1)) {
      const cells = rr.values || [];
      const link = cellText(cells[3]);
      if (!/^https?:\/\/[^\s]*amazon\./i.test(link)) continue;
      const product = cellText(cells[1]);
      rawRows.push({
        link,
        product,
        asin: cellText(cells[2]),
        rating: cellText(cells[4]),
        appealDate: parseDate(cells[0]),
        reviewDate: parseDate(cells[6]),
        direction: cellText(cells[9]),
        status: cellText(cells[12]),
        secondStatus: cellText(cells[16]),
        owner,
        source: isOld ? '原表' : '新增表',
        sourceSheet: sheet.name,
      });
    }
  }
};
const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
const newer = JSON.parse(fs.readFileSync(newPath, 'utf8'));
addSource(old, '原表', true);
addSource(newer, '新增表', false);
const mergeText = (left, right) => {
  const values = [left, right].map(normalize).filter(Boolean);
  return [...new Set(values)].join(' / ');
};
const byLink = new Map();
for (const r of rawRows) {
  const existing = byLink.get(r.link);
  if (!existing) {
    byLink.set(r.link, { ...r, mergedSources: [r.source] });
  } else {
    // 同一评论链接可能同时出现在两份表中。保留首条记录的产品/负责人，
    // 但把日期、方向和申诉状态合并，避免重复记录覆盖“已删除”状态。
    existing.mergedSources = [...new Set([...(existing.mergedSources || [existing.source]), r.source])];
    for (const field of ['appealDate', 'reviewDate', 'direction', 'status', 'secondStatus']) {
      existing[field] = mergeText(existing[field], r[field]);
    }
    existing.mergedSourceSheets = [...new Set([...(existing.mergedSourceSheets || [existing.sourceSheet]), r.sourceSheet])];
  }
}
const records = [...byLink.values()];
fs.writeFileSync(outPath, JSON.stringify(records, null, 2), 'utf8');
const bySource = records.reduce((a, r) => ((a[r.source] = (a[r.source] || 0) + 1), a), {});
console.log(JSON.stringify({oldCandidates: rawRows.filter(r => r.source === '原表').length, newCandidates: rawRows.filter(r => r.source === '新增表').length, rawCandidates: rawRows.length, uniqueRecords: records.length, duplicateGroups: rawRows.length - records.length, bySource, sheets: [...new Set(records.map(r => r.sourceSheet))]}, null, 2));
