import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
const statusFile = path.join(root, 'refresh-status.json');
const lockFile = path.join(root, '.refresh-data.lock');
const docUrl = 'https://ch480oguy0.feishu.cn/sheets/R4Bks0mjWhnjDbtYmwdcffFsnZd';
const cdpUrl = 'http://127.0.0.1:9222';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chromeProfile = path.join(root, 'chrome-profile-cdp2');
const triggerIndex = process.argv.indexOf('--trigger');
const trigger = triggerIndex >= 0 ? process.argv[triggerIndex + 1] || 'manual' : 'manual';
const sheets = [
  { name: '所有产品对应表', id: '0AyhfQ', minRows: 50, minCols: 13 },
  { name: 'Coupon对应表', id: 'mMzAyH', minRows: 80, minCols: 2 },
  { name: '硬件_2026年目标数据', id: '5IvgIM', minRows: 280, minCols: 30 },
  { name: 'PM_年月数据', id: '1rDHzo', minRows: 900, minCols: 33 },
  { name: 'PM_周度数据', id: 's7I1hc', minRows: 2200, minCols: 30 },
  { name: '领星_月度订单利润', id: '2yzuLZ', minRows: 250, minCols: 70 },
  { name: '领星_周度订单利润', id: '3XByVf', minRows: 2700, minCols: 40 },
];

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeStatus(patch) {
  const previous = readJson(statusFile, {});
  const next = { ...previous, schedule: ['12:00', '18:00'], timezone: 'Asia/Shanghai', ...patch };
  fs.writeFileSync(statusFile, JSON.stringify(next, null, 2));
  return next;
}

async function cdpPages() {
  const response = await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`Chrome debugging endpoint returned ${response.status}`);
  return response.json();
}

async function ensureFeishuBrowser() {
  try {
    await cdpPages();
  } catch {
    if (!fs.existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
    const child = spawn(chromePath, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--noerrdialogs',
      '--remote-debugging-port=9222', `--user-data-dir=${chromeProfile}`, docUrl,
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      try { await cdpPages(); break; } catch { await new Promise((resolve) => setTimeout(resolve, 750)); }
    }
  }
  let pages = await cdpPages();
  if (!pages.some((page) => page.type === 'page' && page.url.includes('/sheets/R4Bks0mjWhnjDbtYmwdcffFsnZd'))) {
    const response = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(docUrl)}`, { method: 'PUT', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Unable to open Feishu workbook (${response.status})`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    pages = await cdpPages();
  }
  if (!pages.some((page) => page.type === 'page' && page.url.includes('/sheets/R4Bks0mjWhnjDbtYmwdcffFsnZd'))) throw new Error('Feishu workbook page could not be opened');
}

function acquireLock() {
  try {
    const handle = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), trigger }));
    fs.closeSync(handle);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const age = Date.now() - fs.statSync(lockFile).mtimeMs;
    if (age < 30 * 60 * 1000) throw new Error('A data refresh is already running');
    fs.rmSync(lockFile, { force: true });
    acquireLock();
  }
}

function parseDashboardData(file) {
  const source = fs.readFileSync(file, 'utf8').trim();
  const match = source.match(/^window\.AMAZON_DATA\s*=\s*([\s\S]+);$/);
  if (!match) throw new Error('Generated dashboard data has an invalid format');
  return JSON.parse(match[1]);
}

function validateSheet(sheet, config, previousRaw) {
  if (!sheet || sheet.name !== config.name) throw new Error(`Wrong sheet loaded for ${config.name}: ${sheet?.name || 'unknown'}`);
  const previousRows = previousRaw?.sheets?.[config.name]?.rows?.length || 0;
  const requiredRows = Math.max(config.minRows, Math.floor(previousRows * 0.9));
  if (!Array.isArray(sheet.rows) || sheet.rows.length < requiredRows) throw new Error(`${config.name} only returned ${sheet.rows?.length || 0} rows; at least ${requiredRows} expected`);
  if (Number(sheet.colCount) < config.minCols) throw new Error(`${config.name} only returned ${sheet.colCount || 0} columns; at least ${config.minCols} expected`);
}

function validateDashboardData(data, previousData) {
  const checks = [
    ['PM month', data.audit?.actuals?.pm?.month?.rows, previousData.audit?.actuals?.pm?.month?.rows],
    ['PM week', data.audit?.actuals?.pm?.week?.rows, previousData.audit?.actuals?.pm?.week?.rows],
    ['Lingxing month', data.audit?.actuals?.lx?.month?.rows, previousData.audit?.actuals?.lx?.month?.rows],
    ['Lingxing week', data.audit?.actuals?.lx?.week?.rows, previousData.audit?.actuals?.lx?.week?.rows],
    ['2026 targets', data.audit?.targets?.rows, previousData.audit?.targets?.rows],
  ];
  for (const [label, count, previous] of checks) {
    if (!Number.isFinite(count) || count <= 0) throw new Error(`${label} produced no usable records`);
    if (Number.isFinite(previous) && count < Math.floor(previous * 0.9)) throw new Error(`${label} record count dropped from ${previous} to ${count}`);
  }
  if (!data.coverage?.pm?.month?.cutoff || !data.coverage?.lx?.month?.cutoff) throw new Error('Monthly cutoff dates are missing');
}

async function run() {
  acquireLock();
  const startedAt = new Date().toISOString();
  writeStatus({ running: true, trigger, startedAt, lastAttemptAt: startedAt, lastError: null, progress: '正在连接飞书' });
  const tempDir = fs.mkdtempSync(path.join(root, '.refresh-'));
  try {
    await ensureFeishuBrowser();
    const previousRaw = readJson(path.join(root, 'feishu-raw.json'), {});
    const output = { source: docUrl, extractedAt: new Date().toISOString(), sheets: {} };
    for (let index = 0; index < sheets.length; index++) {
      const config = sheets[index];
      writeStatus({ running: true, trigger, startedAt, progress: `正在抓取 ${config.name}`, currentSheet: index + 1, totalSheets: sheets.length });
      const outputFile = path.join(tempDir, `feishu-${config.id}.json`);
      try {
        await execFileAsync(process.execPath, [path.join(root, 'extract-one.mjs'), config.id, config.name, outputFile], { cwd: root, timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 });
      } catch (error) {
        throw new Error(`${config.name} 抓取失败：${String(error.stderr || error.message).trim()}`);
      }
      const sheet = readJson(outputFile, null);
      validateSheet(sheet, config, previousRaw);
      output.sheets[config.name] = sheet;
    }

    output.extractedAt = new Date().toISOString();
    const rawFile = path.join(tempDir, 'feishu-raw.json');
    const dataFile = path.join(tempDir, 'amazon-data.js');
    fs.writeFileSync(rawFile, JSON.stringify(output));
    writeStatus({ running: true, trigger, startedAt, progress: '正在校验并生成网页数据', currentSheet: sheets.length, totalSheets: sheets.length });
    await execFileAsync(process.execPath, [path.join(root, 'build-data.mjs'), rawFile, dataFile], { cwd: root, timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const nextData = parseDashboardData(dataFile);
    const previousData = parseDashboardData(path.join(root, 'amazon-data.js'));
    validateDashboardData(nextData, previousData);

    fs.copyFileSync(rawFile, path.join(root, 'feishu-raw.json'));
    for (const config of sheets) fs.copyFileSync(path.join(tempDir, `feishu-${config.id}.json`), path.join(root, `feishu-${config.id}.json`));
    fs.copyFileSync(dataFile, path.join(root, 'amazon-data.js'));
    const finishedAt = new Date().toISOString();
    writeStatus({ running: false, trigger, startedAt, finishedAt, lastSuccessAt: finishedAt, dataGeneratedAt: nextData.generatedAt, lastError: null, progress: '更新完成', currentSheet: sheets.length, totalSheets: sheets.length, coverage: nextData.coverage, audit: nextData.audit });
    console.log(JSON.stringify({ ok: true, trigger, startedAt, finishedAt, coverage: nextData.coverage, audit: nextData.audit }));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(lockFile, { force: true });
  }
}

try {
  await run();
} catch (error) {
  const finishedAt = new Date().toISOString();
  writeStatus({ running: false, trigger, finishedAt, lastError: error.message, progress: '更新失败' });
  fs.rmSync(lockFile, { force: true });
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
