import fs from 'node:fs/promises';
import path from 'node:path';
import { readReviewData } from './_lib/review-blob-store.js';

const root = process.cwd();
const templatePath = path.join(root, 'review-appeal-dashboard.html');

function injectData(template, data) {
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
  const start = template.indexOf('const DATA = ');
  const end = template.indexOf('\nfunction esc', start);
  if (start < 0 || end < 0) throw new Error('生产模板缺少 DATA 引导代码');
  let html = `${template.slice(0, start)}const DATA = ${serialized};${template.slice(end)}`;
  html = html.replace("const REVIEW_REFRESH_API='http://127.0.0.1:8772';", "const REVIEW_REFRESH_API='';");
  html = html.replace("REVIEW_REFRESH_API+'/api/status?t='", "REVIEW_REFRESH_API+'/api/review-refresh/status?t='");
  html = html.replace("REVIEW_REFRESH_API+'/api/refresh'", "REVIEW_REFRESH_API+'/api/review-refresh'");
  html = html.replace('每天22:00抓取飞书、检查新增差评并核验 Amazon 前台', '每天22:00通过飞书开放平台 API 抓取数据并检查新增差评');
  html = html.replace('自动更新：每天22:00', '自动更新：每天22:00 · 飞书 API');
  return html;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).send('Method Not Allowed');
  try {
    const [template, data] = await Promise.all([fs.readFile(templatePath, 'utf8'), readReviewData()]);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).send(data ? injectData(template, data) : template);
  } catch (error) {
    return response.status(500).send(`生产周报加载失败：${error.message}`);
  }
}
