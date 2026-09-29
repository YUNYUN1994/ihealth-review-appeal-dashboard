import { runProductionRefresh } from '../_lib/production-refresh.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'Method Not Allowed' });
  try {
    const result = await runProductionRefresh('manual');
    return response.status(result.accepted ? 202 : 409).json({ ok: result.accepted, message: result.message || '已完成生产数据更新', status: result.status });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message });
  }
}
