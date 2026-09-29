import { readData } from './_lib/blob-store.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method Not Allowed' });
  try {
    const data = await readData();
    if (!data) return response.status(503).json({ message: '生产数据尚未初始化，请先执行一次数据更新' });
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json(data);
  } catch (error) {
    return response.status(500).json({ message: error.message });
  }
}
