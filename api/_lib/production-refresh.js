import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readAllSheets } from './feishu.js';
import { writeData, writeStatus } from './blob-store.js';

const execFileAsync = promisify(execFile);
let running = false;

function parseDashboardData(source) {
  const match = source.match(/^window\.AMAZON_DATA\s*=\s*([\s\S]+);\s*$/);
  if (!match) throw new Error('build-data.mjs 未生成有效的网页数据');
  return JSON.parse(match[1]);
}

function validateDashboardData(data) {
  if (!data || !Array.isArray(data.productMap) || data.productMap.length === 0) {
    throw new Error('生成的数据没有产品资料，已阻止覆盖生产数据');
  }
  const actuals = data.actuals || {};
  const pmMonth = Array.isArray(actuals.pm?.month) ? actuals.pm.month.length : 0;
  const pmWeek = Array.isArray(actuals.pm?.week) ? actuals.pm.week.length : 0;
  const lxMonth = Array.isArray(actuals.lx?.month) ? actuals.lx.month.length : 0;
  const lxWeek = Array.isArray(actuals.lx?.week) ? actuals.lx.week.length : 0;
  if (pmMonth + pmWeek + lxMonth + lxWeek === 0) {
    throw new Error('生成的数据没有任何 PM/领星实际数据，已阻止覆盖生产数据');
  }
  if (!data.generatedAt) data.generatedAt = new Date().toISOString();
  return data;
}

export function isRefreshRunning() { return running; }

export async function runProductionRefresh(trigger = 'manual') {
  if (running) return { accepted: false, message: '数据更新正在进行中' };
  running = true;
  const startedAt = new Date().toISOString();
  await writeStatus({ running: true, trigger, startedAt, progress: '正在连接飞书', lastError: null });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amazon-production-'));
  try {
    const raw = await readAllSheets();
    await writeStatus({ running: true, trigger, startedAt, progress: '正在校验并生成网页数据' });
    const rawFile = path.join(tempDir, 'feishu-raw.json');
    const dataFile = path.join(tempDir, 'amazon-data.js');
    await fs.writeFile(rawFile, JSON.stringify(raw));
    const root = process.cwd();
    await execFileAsync(process.execPath, [path.join(root, 'build-data.mjs'), rawFile, dataFile], { cwd: root, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
    const data = validateDashboardData(parseDashboardData(await fs.readFile(dataFile, 'utf8')));
    await writeData(data);
    const finishedAt = new Date().toISOString();
    const status = { running: false, trigger, startedAt, finishedAt, lastSuccessAt: finishedAt, dataGeneratedAt: data.generatedAt, progress: '更新完成', coverage: data.coverage, lastError: null };
    await writeStatus(status);
    return { accepted: true, status };
  } catch (error) {
    const status = { running: false, trigger, startedAt, finishedAt: new Date().toISOString(), progress: '更新失败', lastError: error.message };
    await writeStatus(status);
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    running = false;
  }
}
