// 由 ihealth-review-appeals-refresh.service（systemd timer 每天 22:00 Asia/Shanghai）调用。
// 通过本机内部端口触发与“刷新数据”按钮完全相同的服务端流程：重新读取飞书数据源配置、
// 调用飞书开放平台 API 读取全部允许的工作表、校验、去重、重新计算并原子写入。
// 复用服务进程内的刷新锁，避免与手动刷新并发；失败时服务端保留上一次成功数据，本脚本以非 0 退出。
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8771);
const BASE = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
const READY_TIMEOUT_MS = Number(process.env.REVIEW_AUTO_REFRESH_READY_MS || 120000);
const REFRESH_TIMEOUT_MS = Number(process.env.REVIEW_AUTO_REFRESH_TIMEOUT_MS || 30 * 60 * 1000);
const POLL_MS = Number(process.env.REVIEW_AUTO_REFRESH_POLL_MS || 3000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(`[review-auto-refresh] ${message}`);

async function getJson(pathname) {
  const response = await fetch(`${BASE}${pathname}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}`);
  return response.json();
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try { return await getJson('/healthz'); } catch (error) { lastError = error; await sleep(POLL_MS); }
  }
  throw new Error(`服务未就绪：${lastError?.message || 'timeout'}`);
}

async function main() {
  const health = await waitForServer();
  if (process.env.APP_SLUG && health.appSlug !== process.env.APP_SLUG) throw new Error(`healthz 身份不符：${health.appSlug}`);
  const requestedAt = Date.now();
  const response = await fetch(`${BASE}/api/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'auto' }), signal: AbortSignal.timeout(15000),
  });
  if (response.status === 409) log('已有刷新任务在运行，等待其完成');
  else if (response.status !== 202) throw new Error(`无法启动刷新：HTTP ${response.status}`);
  else log('已开始自动刷新');
  const deadline = requestedAt + REFRESH_TIMEOUT_MS;
  await sleep(1000);
  while (Date.now() < deadline) {
    const state = await getJson('/api/refresh/status');
    if (state.running) { await sleep(POLL_MS); continue; }
    if (state.lastError) throw new Error(`刷新失败（已保留上次成功数据）：${state.lastError}`);
    const finishedAt = Date.parse(state.finishedAt || '');
    if (!Number.isFinite(finishedAt) || finishedAt < requestedAt - 5000) throw new Error('刷新状态未更新，无法确认本次刷新结果');
    log(`刷新完成：记录 ${state.recordCount ?? '?'} 条，完成于 ${state.finishedAt}`);
    return;
  }
  throw new Error('等待刷新完成超时');
}

main().catch((error) => { console.error(`[review-auto-refresh] ${error.message}`); process.exit(1); });
