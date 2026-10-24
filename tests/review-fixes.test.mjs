import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const objects = (rows) => rows.slice(1).map((row) => Object.fromEntries(rows[0].map((key, i) => [key, row[i]])));
const headers = ['申诉日期', '产品', 'ASIN', '评论链接', '星级', '评论日期', '申诉方向', '申诉状态', '二次申诉状态'];
const sheet = (name, owner, rows) => ({ name, owner, rows: [headers, ...rows].map((values, row) => ({ row, values: values.map((text) => ({ text, value: text })) })) });

function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-fixes-test-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function runPipeline(oldDoc, newDoc) {
  return withTemp((dir) => {
    const env = {
      ...process.env,
      REVIEW_OLD_RAW_PATH: path.join(dir, 'old.json'), REVIEW_NEW_RAW_PATH: path.join(dir, 'new.json'),
      REVIEW_RECORDS_PATH: path.join(dir, 'records.json'), REVIEW_DATA_PATH: path.join(dir, 'data.json'),
      REVIEW_SALES_PATH: path.join(dir, 'sales.json'), REVIEW_CHECKS_PATH: path.join(dir, 'checks.json'), REVIEW_VERIFIED_PATH: path.join(dir, 'verified.json'),
    };
    fs.writeFileSync(env.REVIEW_OLD_RAW_PATH, JSON.stringify(oldDoc));
    fs.writeFileSync(env.REVIEW_NEW_RAW_PATH, JSON.stringify(newDoc));
    execFileSync(process.execPath, [path.join(root, 'rebuild_live_precheck.mjs')], { env });
    execFileSync(process.execPath, [path.join(root, 'update_frontend_report.mjs')], { env });
    return { records: JSON.parse(fs.readFileSync(env.REVIEW_RECORDS_PATH, 'utf8')), data: JSON.parse(fs.readFileSync(env.REVIEW_DATA_PATH, 'utf8')) };
  });
}
function buildFromRecords(records) {
  return withTemp((dir) => {
    const env = { ...process.env, REVIEW_RECORDS_PATH: path.join(dir, 'records.json'), REVIEW_DATA_PATH: path.join(dir, 'data.json'), REVIEW_SALES_PATH: path.join(dir, 'sales.json'), REVIEW_CHECKS_PATH: path.join(dir, 'checks.json'), REVIEW_VERIFIED_PATH: path.join(dir, 'verified.json') };
    fs.writeFileSync(env.REVIEW_RECORDS_PATH, JSON.stringify(records));
    execFileSync(process.execPath, [path.join(root, 'update_frontend_report.mjs')], { env });
    return JSON.parse(fs.readFileSync(env.REVIEW_DATA_PATH, 'utf8'));
  });
}
function assertNoInvalidNumbers(value, where = 'data') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${where} 不应为 ${value}`);
  else if (typeof value === 'string') assert.ok(!/NaN|Infinity/.test(value), `${where} 含有 ${value}`);
  else if (Array.isArray(value)) value.forEach((item, i) => assertNoInvalidNumbers(item, `${where}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => assertNoInvalidNumbers(v, `${where}.${k}`));
}

const link = (n) => `https://www.amazon.com/gp/customer-reviews/R${n}`;
const oldDoc = { sourceKey: 'main-report', sheets: [sheet('723-甲', '甲', [
  ['2026/10/13', '723', 'B0TEST723', link(1), '1', '2026/10/12', '机器人', '已删除', ''],
  ['2026/10/14', '723', 'B0TEST723', link(2), '2', '2026/10/13', '专业差评号', '', ''],
  ['2026/10/14', '', 'B0TESTNONE', link(3), '1', '2026/10/13', '机器人', '已删除', ''],
  ['2026/10/15', '550', 'B0TEST550', link(4), '1', '2026/10/14', '', '已提交', ''],
])] };
const newDoc = { sourceKey: 'secondary-report', sheets: [sheet('申诉记录', '乙', [
  ['2026/10/21', '723', 'B0TEST723', link(2), '2', '2026/10/20', '', '', '已删除'],
])] };

test('duplicate links keep a single parseable date and stay in week dimensions', () => {
  const { records, data } = runPipeline(oldDoc, newDoc);
  const dup = records.find((r) => r.link === link(2));
  assert.equal(dup.reviewDate, '2026-10-13T00:00:00.000Z');
  assert.equal(dup.appealDate, '2026-10-14T00:00:00.000Z');
  assert.deepEqual(dup.dateConflicts.reviewDate, ['2026-10-13T00:00:00.000Z', '2026-10-20T00:00:00.000Z']);
  assert.match(dup.secondStatus, /已删除/);
  const weekRows = objects(data.product_review_week);
  const w42 = weekRows.find((r) => r.产品 === '723' && r.周次.startsWith('2026-W42'));
  assert.equal(w42.当周新增差评, 2, '重复记录仍按第一份源表留评周计入');
  assert.equal(w42.当周删除数, 2, '二次申诉删除计入且不重复');
  assert.equal(data.meta.recordCount, 4);
});

test('legacy "date / date" values are parsed using the first date', () => {
  const data = buildFromRecords([
    { link: 'r1', product: '723', owner: '甲', reviewDate: '2026-10-12T00:00:00.000Z / 2026-10-20T00:00:00.000Z', appealDate: '2026-10-13T00:00:00.000Z / 2026-10-21T00:00:00.000Z', status: '已删除' },
  ]);
  assert.equal(objects(data.product_review_week)[0].周次.slice(0, 8), '2026-W42');
  assert.equal(objects(data.appeal_total)[0].周次.slice(0, 8), '2026-W42');
});

test('records without product are excluded from product dimensions only', () => {
  const { data } = runPipeline(oldDoc, newDoc);
  for (const table of ['product_summary', 'product_review_week', 'appeal_share', 'review_share']) {
    assert.ok(objects(data[table]).every((r) => String(r.产品 ?? '').trim()), `${table} 不应包含空产品`);
  }
  assert.deepEqual(objects(data.product_summary).map((r) => r.产品).sort(), ['550', '723']);
  const w42Appeal = objects(data.appeal_total).find((r) => r.周次.startsWith('2026-W42'));
  assert.equal(w42Appeal.周申诉总数, 4, '周总计仍包含产品名缺失的记录');
  const shares = objects(data.appeal_share).filter((r) => r.周次.startsWith('2026-W42'));
  assert.equal(shares.reduce((n, r) => n + r.申诉占比, 0).toFixed(6), '1.000000', '产品占比按有产品名的记录计算，合计 100%');
  assert.equal(objects(data.owner_week).reduce((n, r) => n + r.申诉数量, 0), 4);
  assert.ok(objects(data.owner_week).every((r) => !String(r.负责产品).split('、').includes('')));
  assert.equal(data.meta.overall.appealCount, 4);
  assert.equal(data.meta.overall.appealDeletedCount, 3);
  assert.equal(data.meta.overall.missingProductRecords, 1);
});

test('zero denominators produce null rates instead of 0, NaN or Infinity', () => {
  const data = buildFromRecords([
    { link: 'r1', product: '550', owner: '甲', reviewDate: '2026-10-12', appealDate: '2026-10-13', status: '已提交' },
    { link: 'r2', product: '723', owner: '甲', reviewDate: '2026-10-12', appealDate: '', status: '' },
  ]);
  const share = objects(data.appeal_share)[0];
  assert.equal(share.已删除占比, null, '该周没有删除时已删除占比分母为 0');
  const review = objects(data.review_share).find((r) => r.产品 === '550');
  assert.equal(review.已删除占比, null);
  const noAppeal = objects(data.product_summary).find((r) => r.产品 === '723');
  assert.equal(noAppeal.累计成功率, null);
  assert.equal(noAppeal.本周差评率, null, '缺少销量时差评率为空');
  const { notes, link_notes: linkNotes, ...tables } = data;
  assertNoInvalidNumbers(tables);
});

test('product summary weekly appeal and deletion counts match the default review week', () => {
  const { data } = runPipeline(oldDoc, newDoc);
  const weekRows = objects(data.product_review_week);
  for (const row of objects(data.product_summary)) {
    const week = weekRows.find((r) => r.产品 === row.产品 && r.周次 === data.meta.defaultWeek);
    assert.equal(row.本周申诉数量, week ? week.当周提交差评数 : 0, `${row.产品} 本周申诉`);
    assert.equal(row.本周删除数量, week ? week.当周删除数 : 0, `${row.产品} 本周删除`);
    assert.ok(row.本周删除数量 <= row.累计删除数量 && row.本周申诉数量 <= row.累计申诉数量);
  }
});
