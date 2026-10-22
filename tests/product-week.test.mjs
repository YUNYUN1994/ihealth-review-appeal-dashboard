import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const records = [
  { link: 'review-1', product: '723', owner: '甲', reviewDate: '2026-10-12', appealDate: '2026-10-13', rating: '1', status: '已删除', direction: '机器人' },
  { link: 'review-2', product: '723', owner: '乙', reviewDate: '2026-10-13', appealDate: '2026-10-14', rating: '2', secondStatus: '已删除', direction: '专业差评号' },
  { link: 'review-3', product: '723', owner: '乙', reviewDate: '2026-10-14', appealDate: '2026-10-15', rating: '3', status: '已提交', direction: '机器人' },
  { link: 'review-4', product: '723', owner: '甲', reviewDate: '2026-10-15', appealDate: '', rating: '', secondStatus: '已删除', direction: '' },
  { link: 'review-5', product: '723', owner: '乙', reviewDate: '2026-10-19', appealDate: '2026-10-20', rating: '1', status: '已提交', direction: '' },
  { link: 'review-6', product: '550', owner: '甲', reviewDate: '2026-10-12', appealDate: '2026-10-13', rating: '1', status: '已拒绝', direction: '' },
];
function build(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-product-test-'));
  try {
    const dataPath = path.join(dir, 'data.json');
    const recordsPath = path.join(dir, 'records.json');
    fs.writeFileSync(recordsPath, JSON.stringify(records));
    execFileSync(process.execPath, [script], { env: { ...process.env, REVIEW_RECORDS_PATH: recordsPath, REVIEW_DATA_PATH: dataPath, REVIEW_CHECKS_PATH: path.join(dir, 'checks.json'), REVIEW_SALES_PATH: path.join(dir, 'sales.json'), REVIEW_VERIFIED_PATH: path.join(dir, 'verified.json') } });
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const data = build(path.join(root, 'update_frontend_report.mjs'));
const objects = rows => rows.slice(1).map(row => Object.fromEntries(rows[0].map((key, i) => [key, row[i]])));
test('product weeks merge owners and recalculate rates and direction shares', () => {
  assert.ok(!data.product_week[0].includes('负责人'));
  const rows = objects(data.product_week);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => `${row.周次}|${row.产品}`)).size, rows.length);
  const row = rows.find(row => row.产品 === '723' && row.周次.startsWith('2026-W42'));
  assert.equal(row.留评差评数, 4);
  assert.equal(row.申诉记录数, 3);
  assert.equal(row.明确已提交数, 3);
  assert.equal(row.申诉删除数, 2);
  assert.equal(row.申诉成功率, 0.66666667);
  assert.equal(row['1星'], 1);
  assert.equal(row['2星'], 1);
  assert.equal(row['3星'], 1);
  assert.equal(row.星级未知, 1);
  assert.match(row.申诉方向总结, /疑似机器\/机器人号 2条（66.7%）/);
  assert.match(row.申诉方向总结, /专业差评号 1条（33.3%）/);
  assert.equal(rows.find(row => row.产品 === '723' && row.周次.startsWith('2026-W43')).申诉方向总结, null);
});
test('owner totals retain second appeal and undated deletions', () => {
  const rows = objects(data.owner_week);
  assert.deepEqual([...new Set(rows.map(row => row.负责人))].sort(), ['乙', '甲'].sort());
  assert.equal(rows.reduce((n, row) => n + row.已删除数量, 0), 3);
  assert.equal(rows.find(row => row.周次 === '申诉周未填写').已删除数量, 1);
  assert.equal(data.meta.frontendVerification.deleted, 3);
});
test('all other dimension tables match the production baseline', { skip: !process.env.REVIEW_BASELINE_SCRIPT }, () => {
  const old = build(process.env.REVIEW_BASELINE_SCRIPT);
  for (const key of Object.keys(old)) {
    if (key === 'product_week') continue;
    if (key === 'meta') { delete old.meta.refreshedAt; delete data.meta.refreshedAt; }
    assert.deepEqual(data[key], old[key], `unexpected change in ${key}`);
  }
});