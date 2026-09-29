import { list, put } from '@vercel/blob';

const DATA_PATH = 'amazon-production/amazon-data.json';
const STATUS_PATH = 'amazon-production/refresh-status.json';

async function latest(pathname) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('缺少 BLOB_READ_WRITE_TOKEN');
  const result = await list({ prefix: pathname, limit: 20 });
  const exact = result.blobs.filter((blob) => blob.pathname === pathname).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  if (!exact) return null;
  const response = await fetch(exact.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`读取 Blob 失败：HTTP ${response.status}`);
  return response.json();
}

async function write(pathname, value) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('缺少 BLOB_READ_WRITE_TOKEN');
  const blob = await put(pathname, JSON.stringify(value), {
    access: 'public', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 0,
  });
  return blob.url;
}

export const readData = () => latest(DATA_PATH);
export const readStatus = () => latest(STATUS_PATH);
export const writeData = (value) => write(DATA_PATH, value);
export const writeStatus = (value) => write(STATUS_PATH, value);
