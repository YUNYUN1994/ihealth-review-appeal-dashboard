import { get, put } from '@vercel/blob';

const DATA_PATH = 'review-appeal/data.json';
const STATUS_PATH = 'review-appeal/refresh-status.json';

async function latest(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || !result.stream || result.statusCode !== 200) return null;
  return JSON.parse(await new Response(result.stream).text());
}
async function write(pathname, value) {
  return put(pathname, JSON.stringify(value), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true,
    contentType: 'application/json', cacheControlMaxAge: 0,
  });
}
export const readReviewData = () => latest(DATA_PATH);
export const readReviewStatus = () => latest(STATUS_PATH);
export const writeReviewData = (value) => write(DATA_PATH, value);
export const writeReviewStatus = (value) => write(STATUS_PATH, value);
