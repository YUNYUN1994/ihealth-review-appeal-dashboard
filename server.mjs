import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReviewData, readReviewStatus } from './lib/review-storage.mjs';
import { isReviewRefreshRunning, runReviewRefresh } from './lib/review-refresh.mjs';
import { readConfiguredSourceSummary } from './lib/review-feishu.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8771);
const HOST = process.env.HOST || '127.0.0.1';
const APP_SLUG = process.env.APP_SLUG || 'review-appeals';
const BASE_PATH = process.env.APP_BASE_PATH || `/apps/${APP_SLUG}/`;
const TEMPLATE_PATH = path.join(ROOT, 'review-appeal-dashboard.html');
let templatePromise;
function json(status, body) { return { status, type: 'application/json; charset=utf-8', body: JSON.stringify(body) }; }
function html(status, body) { return { status, type: 'text/html; charset=utf-8', body }; }
function injectTemplate(template, data) {
  const serialized = JSON.stringify(data || {}).replace(/</g, '\\u003c');
  const marker = 'const DATA = ';
  const start = template.indexOf(marker);
  const end = template.indexOf(';', start);
  if (start < 0 || end < 0) throw new Error('生产模板缺少 DATA 引导代码');
  const withData = template.slice(0, start) + `${marker}${serialized}` + template.slice(end + 1);
  const configScript = `<script>window.__REVIEW_APP_BASE_PATH__=${JSON.stringify(BASE_PATH.replace(/\/$/, ''))};</script>`;
  return withData.replace('</head>', `${configScript}</head>`);
}
async function dashboard() {
  const [template, data] = await Promise.all([templatePromise || (templatePromise = fs.readFile(TEMPLATE_PATH, 'utf8')), readReviewData()]);
  if (!data) return html(503, '<!doctype html><meta charset="utf-8"><title>差评申诉周报</title><h1>数据尚未生成</h1><p>请点击刷新数据，重新读取飞书源表。</p>');
  return html(200, injectTemplate(template, data));
}
async function health() {
  const [data, source] = await Promise.all([readReviewData(), readConfiguredSourceSummary()]);
  return json(200, { ok: true, appSlug: APP_SLUG, sourceConfigVersion: source.version, dataAvailable: Boolean(data), recordCount: data?.meta?.recordCount ?? 0, refreshedAt: data?.meta?.refreshedAt || null });
}
async function status() {
  const stored = await readReviewStatus();
  const value = stored || { running: false, progress: '尚未更新', lastError: null };
  return json(200, { ...value, running: Boolean(value.running || isReviewRefreshRunning()), schedule: 'manual-only', timezone: 'Asia/Shanghai' });
}
function beginRefresh() {
  const promise = runReviewRefresh('manual');
  promise.catch((error) => console.error('review refresh failed:', error.message));
  return promise;
}
async function route(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (req.method === 'GET' && pathname === '/healthz') return health();
  if (req.method === 'GET' && pathname === '/api/data') {
    const data = await readReviewData();
    return data ? json(200, data) : json(503, { ok: false, message: '暂无成功数据，请先刷新' });
  }
  if (req.method === 'GET' && pathname === '/api/refresh/status') return status();
  if (req.method === 'POST' && pathname === '/api/refresh') {
    if (isReviewRefreshRunning()) return json(409, { ok: false, message: '数据更新正在进行中' });
    beginRefresh();
    return json(202, { ok: true, message: '已开始重新抓取飞书数据', status: { running: true } });
  }
  if (req.method === 'GET' && (pathname === '/' || !pathname.startsWith('/api/'))) {
    if (pathname.includes('/.') || /\.(?:env|json|mjs|js|map|yml|yaml|pem|lock)$/i.test(pathname)) return json(404, { ok: false, message: 'Not Found' });
    return dashboard();
  }
  return json(404, { ok: false, message: 'Not Found' });
}
const server = http.createServer(async (req, res) => {
  try {
    const result = await route(req);
    res.writeHead(result.status, { 'Content-Type': result.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(result.body);
  } catch (error) {
    console.error('request failed:', error.message);
    const result = json(500, { ok: false, message: error.message || '服务器错误' });
    res.writeHead(result.status, { 'Content-Type': result.type, 'Cache-Control': 'no-store' });
    res.end(result.body);
  }
});
server.listen(PORT, HOST, () => console.log(`${APP_SLUG} listening on ${HOST}:${PORT}`));
