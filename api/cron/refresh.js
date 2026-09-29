import { runProductionRefresh } from '../_lib/production-refresh.js';

export default async function handler(request, response) {
  const authorization = request.headers.authorization || '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '';
  if (expected && authorization !== expected) return response.status(401).json({ message: 'Unauthorized' });
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method Not Allowed' });
  try {
    const result = await runProductionRefresh('cron');
    return response.status(result.accepted ? 202 : 409).json({ ok: result.accepted, message: result.message || '已开始定时更新', status: result.status });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message });
  }
}
