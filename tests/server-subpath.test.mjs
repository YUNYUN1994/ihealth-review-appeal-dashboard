import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('dashboard, health and APIs work behind the /apps/review-appeals/ prefix', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-server-test-'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({ meta: { recordCount: 1, refreshedAt: '2026-10-24T14:00:00.000Z', overall: { appealCount: 1, appealDeletedCount: 0 } }, product_summary: [['产品'], ['723']] }));
  const sources = path.join(dir, 'sources.json');
  fs.writeFileSync(sources, JSON.stringify({ version: 1, appSlug: 'review-appeals', sources: [{ sourceKey: 'main', spreadsheetToken: 'faketoken000000', sheets: [{ sheetId: 's1', expectedTitle: '测试', owner: '甲' }] }] }));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    env: { ...process.env, APP_SLUG: 'review-appeals', APP_BASE_PATH: '/apps/review-appeals/', HOST: '127.0.0.1', PORT: String(port), APP_DATA_DIR: dataDir, FEISHU_SOURCES_FILE: sources, FEISHU_APP_ID: '', FEISHU_APP_SECRET: '' },
    stdio: 'ignore',
  });
  t.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i += 1) { try { await fetch(`${base}/healthz`); break; } catch { await sleep(100); } }

  // Nginx 去掉 /apps/review-appeals 前缀后转发；首页和任意嵌套路由都应返回已注入数据的页面。
  for (const pathname of ['/', '/product', '/owner/detail']) {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.match(html, /window\.__REVIEW_APP_BASE_PATH__="\/apps\/review-appeals"/);
    assert.match(html, /const DATA = \{"meta"/);
    assert.ok(!/fetch\(\s*['"]\/api\//.test(html), '前端不能直接请求根路径 /api');
    assert.ok(!html.includes('/api/review-dashboard'));
  }
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.appSlug, 'review-appeals');
  assert.equal(health.dataAvailable, true);
  assert.equal(health.recordCount, 1);
  const status = await (await fetch(`${base}/api/refresh/status`)).json();
  assert.equal(status.schedule, 'daily 22:00 Asia/Shanghai');
  assert.equal(status.timezone, 'Asia/Shanghai');
  const data = await fetch(`${base}/api/data`);
  assert.equal(data.status, 200);
  assert.equal((await data.json()).meta.recordCount, 1);
  for (const pathname of ['/.env', '/server.mjs', '/lib/review-feishu.mjs', '/sources.json', '/deploy/x.lock', '/yunyun.pem']) {
    assert.equal((await fetch(base + pathname)).status, 404, `${pathname} 必须不可访问`);
  }
});

test('legacy root redirect pages are removed', () => {
  assert.equal(fs.existsSync(path.join(root, 'index.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'review-appeal', 'index.html')), false);
  const html = fs.readFileSync(path.join(root, 'review-appeal-dashboard.html'), 'utf8');
  assert.ok(html.includes("REVIEW_REFRESH_API+'/api/refresh"));
  assert.ok(!html.includes('统计截止：<strong>2026/10/2'), '更新时间不能写死');
});

test('week filters only offer valid weeks of their own dimension and labels name the week anchor', async () => {
  const html = fs.readFileSync(path.join(root, 'review-appeal-dashboard.html'), 'utf8');
  const pick = (name) => { const line = html.split(/\r?\n/).find((l) => l.startsWith(`function ${name}(`)); assert.ok(line, `missing ${name}`); return line; };
  const { default: vm } = await import('node:vm');
  const ctx = {};
  vm.runInNewContext(`${pick('weekCode')}\n${pick('isValidWeek')}\n${pick('weeksOf')}\nthis.weeksOf=weeksOf;this.isValidWeek=isValidWeek;`, ctx);
  const rows = [{ 周次: '2026-W42 (10/12-10/18)' }, { 周次: '申诉周未填写' }, { 周次: '' }, { 周次: null }, { 周次: '2026-W40 (09/28-10/04)' }, { 周次: '2026-W42 (10/12-10/18)' }];
  assert.deepEqual([...ctx.weeksOf(rows)], ['2026-W40 (09/28-10/04)', '2026-W42 (10/12-10/18)']);
  assert.equal(ctx.isValidWeek('申诉周未填写'), false);
  assert.match(html, /multiSelectHtml\('productWeekFilter','留评周（可多选）',productWeeks,/);
  assert.match(html, /productWeeks=weeksOf\(productWeek\)/);
  for (const label of ['本申诉周申诉数', '本申诉周删除数', '所选留评周申诉数', '所选留评周删除数']) assert.ok(html.includes(label), label);
  assert.ok(!html.includes("'本周申诉数量'") && !html.includes("'本周删除数量'"));
});

function runAutoRefresh(port) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'scripts', 'auto-refresh.mjs')], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_SLUG: 'review-appeals', REVIEW_AUTO_REFRESH_POLL_MS: '50', REVIEW_AUTO_REFRESH_READY_MS: '3000' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}
async function fakeServer(t, { fail }) {
  let polls = 0;
  let trigger = null;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/healthz') return res.end(JSON.stringify({ appSlug: 'review-appeals' }));
    if (req.method === 'POST' && req.url === '/api/refresh') { trigger = JSON.parse(body).trigger; res.statusCode = 202; return res.end('{"ok":true}'); }
    if (req.url.startsWith('/api/refresh/status')) {
      polls += 1;
      if (polls < 3) return res.end(JSON.stringify({ running: true }));
      return res.end(JSON.stringify(fail ? { running: false, lastError: '飞书工作表名称不匹配', finishedAt: new Date().toISOString() } : { running: false, lastError: null, finishedAt: new Date().toISOString(), recordCount: 9 }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { port: server.address().port, getTrigger: () => trigger };
}

test('auto refresh script triggers a full server refresh and waits for success', async (t) => {
  const fake = await fakeServer(t, { fail: false });
  const result = await runAutoRefresh(fake.port);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fake.getTrigger(), 'auto');
  assert.match(result.stdout, /刷新完成：记录 9 条/);
});

test('auto refresh script exits non-zero when the refresh fails', async (t) => {
  const fake = await fakeServer(t, { fail: true });
  const result = await runAutoRefresh(fake.port);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /刷新失败（已保留上次成功数据）/);
});

test('systemd timer runs daily at 22:00 Asia/Shanghai', () => {
  const timer = fs.readFileSync(path.join(root, 'deploy', 'ihealth-review-appeals-refresh.timer'), 'utf8');
  assert.match(timer, /^OnCalendar=\*-\*-\* 22:00:00 Asia\/Shanghai$/m);
  const service = fs.readFileSync(path.join(root, 'deploy', 'ihealth-review-appeals-refresh.service'), 'utf8');
  assert.match(service, /ExecStart=\/usr\/bin\/node \/opt\/ihealth-apps\/review-appeals\/scripts\/auto-refresh\.mjs/);
  assert.ok(!/EnvironmentFile=/.test(service), '定时任务进程不需要加载飞书凭据');
});
