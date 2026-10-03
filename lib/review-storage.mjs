import COSPackage from 'cos-nodejs-sdk-v5';

const COS = COSPackage?.default || COSPackage;
const DATA_KEY = 'review-appeal/data.json';
const STATUS_KEY = 'review-appeal/refresh-status.json';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`腾讯云运行环境缺少 ${name}`);
  return value;
}

function cosClient() {
  const secretId = process.env.TENCENT_SECRET_ID || process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.TENCENT_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY;
  const securityToken = process.env.TENCENT_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN;
  if (!secretId || !secretKey) {
    throw new Error('缺少腾讯云 COS 凭证：请绑定 SCF CAM 运行角色，或配置 TENCENT_SECRET_ID/TENCENT_SECRET_KEY');
  }
  return new COS({ SecretId: secretId, SecretKey: secretKey, SecurityToken: securityToken || undefined });
}

function baseParams(key) {
  return { Bucket: required('TENCENT_COS_BUCKET'), Region: process.env.TENCENT_COS_REGION || required('TENCENT_REGION'), Key: key };
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    cosClient()[method](params, (error, data) => error ? reject(error) : resolve(data));
  });
}

export async function readObject(key) {
  try {
    const result = await request('getObject', baseParams(key));
    const body = result?.Body;
    if (!body) return null;
    return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || 0);
    const code = String(error?.code || '');
    if (status === 404 || code === 'NoSuchKey' || code === 'NoSuchResource') return null;
    throw error;
  }
}

export async function writeObject(key, value) {
  return request('putObject', {
    ...baseParams(key),
    Body: Buffer.from(JSON.stringify(value), 'utf8'),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-store, no-cache, max-age=0',
  });
}

export const readReviewData = () => readObject(DATA_KEY);
export const readReviewStatus = () => readObject(STATUS_KEY);
export const writeReviewData = (value) => writeObject(DATA_KEY, value);
export const writeReviewStatus = (value) => writeObject(STATUS_KEY, value);