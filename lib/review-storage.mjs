import fs from 'node:fs/promises';
import path from 'node:path';

const defaultDir = process.env.APP_DATA_DIR || '/var/lib/ihealth-apps/review-appeals';
const dataFile = path.join(defaultDir, 'data.json');
const statusFile = path.join(defaultDir, 'refresh-status.json');

async function readJson(filename) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeJsonAtomic(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o750 });
  const temp = `${filename}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(value)}\n`, { mode: 0o640 });
  await fs.rename(temp, filename);
}
export const readReviewData = () => readJson(dataFile);
export const readReviewStatus = () => readJson(statusFile);
export const writeReviewData = (value) => writeJsonAtomic(dataFile, value);
export const writeReviewStatus = (value) => writeJsonAtomic(statusFile, value);
export function reviewDataPath() { return dataFile; }
export function reviewStatusPath() { return statusFile; }
