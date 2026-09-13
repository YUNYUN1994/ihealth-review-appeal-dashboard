import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const statusFile = path.join(root, 'refresh-status.json');
const lockFile = path.join(root, '.refresh-data.lock');
const refreshScript = path.join(root, 'refresh-data.mjs');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
let refreshProcess = null;

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function dashboardGeneratedAt() {
  try {
    const match = fs.readFileSync(path.join(root, 'amazon-data.js'), 'utf8').match(/"generatedAt":"([^"]+)"/);
    return match?.[1] || null;
  } catch { return null; }
}

function nextScheduledAt() {
  const now = new Date();
  for (const hour of [12, 18]) {
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next > now) return next.toISOString();
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);
  return tomorrow.toISOString();
}

function refreshStatus() {
  const status = readJson(statusFile, {});
  const lockActive = fs.existsSync(lockFile) && Date.now() - fs.statSync(lockFile).mtimeMs < 30 * 60 * 1000;
  return {
    schedule: ['12:00', '18:00'], timezone: 'Asia/Shanghai', nextScheduledAt: nextScheduledAt(),
    dataGeneratedAt: status.dataGeneratedAt || dashboardGeneratedAt(), ...status,
    running: Boolean(refreshProcess || lockActive || status.running),
  };
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function startRefresh() {
  if (refreshProcess || (fs.existsSync(lockFile) && Date.now() - fs.statSync(lockFile).mtimeMs < 30 * 60 * 1000)) return false;
  refreshProcess = spawn(process.execPath, [refreshScript, '--trigger', 'manual'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  refreshProcess.stdout.on('data', (chunk) => process.stdout.write(`[refresh] ${chunk}`));
  refreshProcess.stderr.on('data', (chunk) => process.stderr.write(`[refresh] ${chunk}`));
  refreshProcess.on('close', (code) => { console.log(`[refresh] completed with exit code ${code}`); refreshProcess = null; });
  return true;
}

http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/refresh/status' && request.method === 'GET') return sendJson(response, 200, refreshStatus());
  if (url.pathname === '/api/refresh' && request.method === 'POST') {
    if (!startRefresh()) return sendJson(response, 409, { ok: false, message: '数据更新正在进行中', status: refreshStatus() });
    return sendJson(response, 202, { ok: true, message: '已开始抓取飞书数据', status: refreshStatus() });
  }
  if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { ok: false, message: 'not found' });
  const requested = decodeURIComponent(url.pathname);
  const file = path.resolve(root, `.${requested === '/' ? '/amazon-dashboard.html' : requested}`);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end('not found'); return; }
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': path.extname(file) === '.js' ? 'no-store' : 'no-cache' });
  fs.createReadStream(file).pipe(response);
}).listen(8765, '127.0.0.1', () => console.log('Amazon dashboard: http://127.0.0.1:8765/amazon-dashboard.html'));
