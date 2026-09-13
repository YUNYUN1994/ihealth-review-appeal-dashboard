import fs from 'node:fs';
import path from 'node:path';

const CDP_URL = 'http://127.0.0.1:9222';
const DOC_URL = 'https://ch480oguy0.feishu.cn/sheets/R4Bks0mjWhnjDbtYmwdcffFsnZd';
const sheetId = process.argv[2] || '3XByVf';
const expectedName = process.argv[3] || '领星_周度订单利润';
const outputFile = path.resolve(process.argv[4] || `feishu-${sheetId}.json`);
const formulaColumns = { '1rDHzo': [24, 29, 30, 31, 32], s7I1hc: [25, 27, 28, 29], '2yzuLZ': [66, 68, 69], '3XByVf': [36, 37, 38, 39], '5IvgIM': [24, 26, 27, 28, 29] };
const pages = await (await fetch(`${CDP_URL}/json`)).json();
const page = pages.find((item) => item.type === 'page' && item.url.includes('/sheets/R4Bks0mjWhnjDbtYmwdcffFsnZd'));
if (!page) throw new Error('Feishu workbook page is not open in Chrome');
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let requestId = 0;
socket.onmessage = (event) => { const message = JSON.parse(event.data); const resolve = pending.get(message.id); if (resolve) { pending.delete(message.id); resolve(message); } };
await new Promise((resolve) => { socket.onopen = resolve; });
function call(method, params = {}) { return new Promise((resolve) => { const id = ++requestId; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || 'Browser evaluation failed');
  return response.result?.result?.value;
}
await call('Page.navigate', { url: `${DOC_URL}?sheet=${sheetId}` });
const deadline = Date.now() + 120000;
let loaded = false;
while (Date.now() < deadline) {
  const status = await evaluate(`(() => { if (!window.spread) return null; const sheet = window.spread.getSheetFromId(${JSON.stringify(sheetId)}); if (!sheet) return null; let nonEmpty = 0; for (let row = 0; row < Math.min(30, sheet._dataModel.rowCount); row++) for (let col = 0; col < Math.min(40, sheet._dataModel.colCount); col++) if (sheet.getText(row, col) !== '') nonEmpty++; let lastRow = sheet._dataModel.rowCount - 1; while (lastRow > 0) { let hasContent = false; for (let col = 0; col < Math.min(40, sheet._dataModel.colCount); col++) if (sheet.getText(lastRow, col) !== '') { hasContent = true; break; } if (hasContent) break; lastRow--; } const formulaReady = ${JSON.stringify(formulaColumns[sheetId] || [])}.every((col) => [1, Math.floor(lastRow / 2), lastRow].some((row) => sheet.getText(row, col) !== '')); return { name: sheet._name, nonEmpty, tailNonEmpty: lastRow > 0, lastRow, formulaReady }; })()`);
  if (status?.name === expectedName && status.nonEmpty > 0 && status.tailNonEmpty && status.formulaReady) { loaded = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (!loaded) {
  socket.close();
  throw new Error(`Timed out waiting for complete sheet data: ${expectedName}`);
}
const json = await evaluate(`(() => { const sheet = window.spread.getSheetFromId(${JSON.stringify(sheetId)}); const rows = []; for (let row = 0; row < sheet._dataModel.rowCount; row++) { const values = []; let hasContent = false; for (let col = 0; col < sheet._dataModel.colCount; col++) { const value = sheet.getValue(row, col); const text = sheet.getText(row, col); if ((value !== null && value !== undefined && value !== '') || text !== '') hasContent = true; values.push({ value, text }); } if (hasContent) rows.push({ row, values }); } return JSON.stringify({ id: sheet._id_, name: sheet._name, rowCount: sheet._dataModel.rowCount, colCount: sheet._dataModel.colCount, rows }); })()`);
fs.writeFileSync(outputFile, json);
console.log(JSON.stringify({ sheetId, expectedName, rows: JSON.parse(json).rows.length }));
socket.close();
