import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReviewData, readReviewStatus } from './lib/review-storage.mjs';
import { isReviewRefreshRunning, runReviewRefresh } from './lib/review-refresh.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(ROOT, 'review-appeal-dashboard.html');

function header(event, name) {
  const headers = event?.headers || {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? '';
}

function requestPath(event) {
  return String(event?.path || event?.requestContext?.path || event?.requestContext?.http?.path || event?.rawPath || '/').split('?')[0] || '/';
}

function requestMethod(event) {
  return String(event?.httpMethod || event?.requestContext?.http?.method || 'GET').toUpperCase();
}

function isTimerEvent(event) {
  return event?.Type === 'Timer' || event?.type === 'Timer' || event?.trigger === 'cron' || Boolean(event?.TriggerName && !event?.httpMethod);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cron-Secret',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  };
}

function response(statusCode, body, contentType = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    isBase64Encoded: false,
    statusCode,
    headers: { ...corsHeaders(), 'Content-Type': contentType, 'Cache-Control': 'no-store' },
    body: payload,
  };
}

function json(statusCode, body) { return response(statusCode, body); }

function injectData(template, data) {
  const serialized = JSON.stringify(data || {}).replace(/</g, '\\u003c');
  const start = template.indexOf('const DATA = ');
  const end = template.indexOf('\nfunction esc', start);
  if (start < 0 || end < 0) throw new Error('生产模板缺少 DATA 引导代码');
  return template.slice(0, start) + `const DATA = ${serialized};` + template.slice(end);
}

async function dashboard() {
  const [template, data] = await Promise.all([
    fs.readFile(TEMPLATE_PATH, 'utf8'),
    readReviewData(),
  ]);
  return response(200, injectData(template, data), 'text/html; charset=utf-8');
}

async function status() {
  const stored = await readReviewStatus();
  const value = stored || { running: false, progress: '尚未更新' };
  return json(200, {
    ...value,
    running: Boolean(value.running || isReviewRefreshRunning()),
    schedule: '每天 22:00',
    timezone: 'Asia/Shanghai',
  });
}

function authorizedCron(event) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  const authorization = header(event, 'authorization');
  const supplied = header(event, 'x-cron-secret');
  return authorization === `Bearer ${expected}` || supplied === expected;
}

async function refresh(trigger) {
  try {
    const result = await runReviewRefresh(trigger);
    return json(result.accepted ? 202 : 409, {
      ok: result.accepted,
      message: result.message || (trigger === 'cron' ? '已开始差评周报定时更新' : '已完成差评周报更新'),
      status: result.status,
    });
  } catch (error) {
    console.error('review refresh failed', error);
    return json(500, { ok: false, message: error?.message || '刷新失败' });
  }
}

export async function main(event) {
  if (isTimerEvent(event)) return (await refresh('cron')).body;
  const method = requestMethod(event);
  const pathname = requestPath(event);
  if (method === 'OPTIONS') return response(204, '');
  try {
    if (method === 'GET' && ['/', '/review-appeal', '/review-appeal.html', '/api/review-dashboard'].includes(pathname)) return await dashboard();
    if (method === 'GET' && pathname === '/api/review-refresh/status') return await status();
    if (method === 'POST' && pathname === '/api/review-refresh') return await refresh('manual');
    if (method === 'GET' && pathname === '/api/cron/review-refresh') {
      if (!authorizedCron(event)) return json(401, { message: 'Unauthorized' });
      return await refresh('cron');
    }
    return json(404, { message: 'Not Found' });
  } catch (error) {
    console.error('request failed', error);
    return json(500, { message: error?.message || '服务器错误' });
  }
}