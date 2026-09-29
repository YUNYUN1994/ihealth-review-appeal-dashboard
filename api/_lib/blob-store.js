import { get, put } from '@vercel/blob';

const DATA_PATH = 'amazon-production/amazon-data.json';
const STATUS_PATH = 'amazon-production/refresh-status.json';

async function latest(pathname) {
  // Private Blob must be read through the SDK. The SDK uses the project's
  // short-lived Vercel OIDC credentials when available, or
  // BLOB_READ_WRITE_TOKEN when a static token is configured.
  // Bypass the SDK cache here. The data endpoint is called immediately after
  // a successful refresh, so serving a cached/missing snapshot can make the
  // UI appear empty even though the write has completed.
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || !result.stream || result.statusCode !== 200) return null;
  const body = await new Response(result.stream).text();
  return JSON.parse(body);
}

async function write(pathname, value) {
  const blob = await put(pathname, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  return blob.url;
}

export const readData = () => latest(DATA_PATH);
export const readStatus = () => latest(STATUS_PATH);
export const writeData = (value) => write(DATA_PATH, value);
export const writeStatus = (value) => write(STATUS_PATH, value);
