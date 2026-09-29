import { readStatus } from '../_lib/blob-store.js';
import { isRefreshRunning } from '../_lib/production-refresh.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method Not Allowed' });
  try {
    const status = await readStatus() || { running: false, progress: '尚未更新' };
    status.running = Boolean(status.running || isRefreshRunning());
    status.schedule = ['12:00', '18:00'];
    status.timezone = 'Asia/Shanghai';
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json(status);
  } catch (error) {
    return response.status(500).json({ message: error.message });
  }
}
