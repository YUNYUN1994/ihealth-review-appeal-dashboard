import { get, put } from '@vercel/blob';

const DATA_PATH = 'amazon-production/amazon-data.json';
const STATUS_PATH = 'amazon-production/refresh-status.json';

async function latest(pathname) {
  // Private Blob must be read through the SDK. The SDK uses the project's
  // short-lived Vercel OIDC credentials when available, or
  // BLOB_READ_WRITE_TOKEN when a static token is configured.
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200) return null;
  const body = await new Response(result.stream).text();
  return JSON.parse(body);
}

async function write(pathname, value) {
  const blob = await put(pathname, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  return blob.url;
}

export const readData = () => latest(DATA_PATH);
export const readStatus = () => latest(STATUS_PATH);
export const writeData = (value) => write(DATA_PATH, value);
export const writeStatus = (value) => write(STATUS_PATH, value);