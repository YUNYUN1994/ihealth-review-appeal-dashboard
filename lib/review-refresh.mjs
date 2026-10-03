import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readReviewSources } from './review-feishu.mjs';
import { writeReviewData, writeReviewStatus } from './review-storage.mjs';

const execFileAsync = promisify(execFile);
let running = false;
const root = path.dirname(fileURLToPath(import.meta.url));

function statusBase(trigger, startedAt) { return { running: true, trigger, startedAt, progress: '正在连接飞书 API', lastError: null }; }
async function saveStatus(value) {
  try { await writeReviewStatus(value); } catch (error) { console.error('无法写入刷新状态：', error.message); }
}
async function runScript(script, env, label) {
  await saveStatus({ ...env.status, progress: label });
  await execFileAsync(process.execPath, [path.join(root, script)], { cwd: root, env: { ...process.env, ...env.vars }, timeout: 240000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
}
function parseRawRows(doc, isOld) {
  return (doc?.sheets || []).flatMap((sheet) => {
    const owner = sheet.owner || (isOld ? '' : '晕晕+欧阳');
    return (sheet.rows || []).slice(1).map((row) => {
      const cells = row.values || [];
      const text = (i) => String(cells[i]?.text ?? cells[i]?.value ?? '').trim();
      const date = (i) => {
        const value = text(i); if (!value) return null;
        const m = value.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
        if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString();
        const d = new Date(value); return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
      };
      return { link: text(3), product: text(1), asin: text(2), rating: text(4), appealDate: date(0), reviewDate: date(6), direction: text(9), status: text(12), secondStatus: text(16), owner, source: isOld ? '原表' : '新增表', sourceSheet: sheet.name };
    }).filter((record) => /^https?:\/\/[^\s]*amazon\./i.test(record.link));
  });
}

export function isReviewRefreshRunning() { return running; }

export async function runReviewRefresh(trigger = 'manual') {
  if (running) return { accepted: false, message: '数据更新正在进行中' };
  running = true;
  const startedAt = new Date().toISOString();
  const status = statusBase(trigger, startedAt);
  let tempDir = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-appeal-'));
    await saveStatus(status);
    const raw = await readReviewSources();
    const oldPath = path.join(tempDir, 'old_live_raw.json');
    const newPath = path.join(tempDir, 'new_live_raw.json');
    const recordsPath = path.join(tempDir, 'live_records_precheck.json');
    const dataPath = path.join(tempDir, 'review-data.json');
    await fs.writeFile(oldPath, JSON.stringify({ extractedAt: raw.extractedAt, source: raw.sources.old, sheets: raw.old.sheets }));
    await fs.writeFile(newPath, JSON.stringify({ extractedAt: raw.extractedAt, source: raw.sources.new, sheets: raw.newer.sheets }));
    const vars = { REVIEW_OLD_RAW_PATH: oldPath, REVIEW_NEW_RAW_PATH: newPath, REVIEW_RECORDS_PATH: recordsPath, REVIEW_DATA_PATH: dataPath, REVIEW_VERIFIED_PATH: path.join(tempDir, 'verified.json'), REVIEW_CHECKS_PATH: path.join(tempDir, 'missing-checks.json') };
    await runScript('rebuild_live_precheck.mjs', { vars, status }, '正在整理差评记录并检查新增');
    await runScript('update_frontend_report.mjs', { vars, status }, '正在生成统计数据');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    if (!data || !data.meta || !Number.isFinite(data.meta.recordCount)) throw new Error('生成的数据快照无效');
    await writeReviewData(data);
    const finishedAt = new Date().toISOString();
    const finalStatus = { running: false, trigger, startedAt, finishedAt, lastSuccessAt: finishedAt, dataGeneratedAt: data.meta.refreshedAt, progress: '更新完成', recordCount: data.meta.recordCount, deletedCount: data.meta.frontendVerification?.deleted ?? 0, lastError: null };
    await saveStatus(finalStatus);
    return { accepted: true, status: finalStatus };
  } catch (error) {
    const finalStatus = { running: false, trigger, startedAt, finishedAt: new Date().toISOString(), progress: '更新失败', lastError: error.message };
    await saveStatus(finalStatus);
    throw error;
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    running = false;
  }
}