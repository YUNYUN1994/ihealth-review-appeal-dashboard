import { readReviewStatus } from '../_lib/review-blob-store.js';
import { isReviewRefreshRunning } from '../_lib/review-refresh.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method Not Allowed' });
  try {
    const status = await readReviewStatus() || { running: false, progress: '尚未更新' };
    status.running = Boolean(status.running || isReviewRefreshRunning());
    status.schedule = '每天 22:00';
    status.timezone = 'Asia/Shanghai';
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json(status);
  } catch (error) {
    return response.status(500).json({ message: error.message });
  }
}
