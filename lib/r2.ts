import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { config } from './config';

// 標準任務狀態結構
export interface JobTask {
  taskId: string;
  status: 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  failedUrls: { url: string; error: string }[];
  retryingUrls?: { url: string; attempts: number; maxRetries: number; error: string }[];
  /** 個別 URL 的處理狀態追蹤清單 */
  urls?: { url: string; status: 'pending' | 'processing' | 'success' | 'failed'; error?: string }[];
  date: string;
}

// 前端可覆蓋的 R2 認證配置
export interface R2Overrides {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
}

// 延遲初始化的預設 S3 Client（僅在環境變數存在時使用）
let _defaultClient: S3Client | null = null;

function getDefaultClient(): S3Client {
  if (!_defaultClient) {
    if (!config.r2.accountId || !config.r2.accessKeyId || !config.r2.secretAccessKey) {
      throw new Error(
        'R2 credentials not configured. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in environment variables, or provide them via the frontend UI.'
      );
    }
    _defaultClient = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return _defaultClient;
}

/**
 * 根據覆蓋值取得 S3Client 與 Bucket 名稱。
 * 優先使用前端傳入的覆蓋值，否則退回環境變數預設值。
 */
function resolveR2(overrides?: R2Overrides): { client: S3Client; bucket: string } {
  const hasOverrides = overrides?.accountId || overrides?.accessKeyId || overrides?.secretAccessKey;

  if (hasOverrides) {
    const accountId = overrides!.accountId || config.r2.accountId;
    const accessKeyId = overrides!.accessKeyId || config.r2.accessKeyId;
    const secretAccessKey = overrides!.secretAccessKey || config.r2.secretAccessKey;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Incomplete R2 credentials: accountId, accessKeyId, and secretAccessKey are all required (from overrides or environment).'
      );
    }

    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    return {
      client,
      bucket: overrides!.bucketName || config.r2.bucketName,
    };
  }

  // 退回預設值
  return {
    client: getDefaultClient(),
    bucket: config.r2.bucketName,
  };
}

/**
 * 將內容儲存為 R2 物件
 */
export async function putObject(key: string, content: string | Buffer, contentType = 'text/markdown', r2?: R2Overrides): Promise<void> {
  const { client, bucket } = resolveR2(r2);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: contentType,
  });
  await client.send(command);
}

/**
 * 從 R2 取得物件內容（字串）
 */
export async function getObject(key: string, r2?: R2Overrides): Promise<string> {
  const { client, bucket } = resolveR2(r2);
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  const response = await client.send(command);
  const streamString = await response.Body?.transformToString('utf-8');
  if (!streamString) {
    throw new Error(`File ${key} is empty or not found.`);
  }
  return streamString;
}

/**
 * 列出 Bucket 中的物件
 */
export async function listObjects(prefix?: string, limit = 50, r2?: R2Overrides) {
  const { client, bucket } = resolveR2(r2);
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: limit,
  });
  const response = await client.send(command);
  return response.Contents || [];
}

/**
 * 更新 JSON 格式的任務狀態
 */
export async function putTaskStatus(taskId: string, statusObj: JobTask, r2?: R2Overrides): Promise<void> {
  const key = `tasks/${taskId}.json`;
  await putObject(key, JSON.stringify(statusObj, null, 2), 'application/json', r2);
}

/**
 * 取得任務狀態
 */
export async function getTaskStatus(taskId: string, r2?: R2Overrides): Promise<JobTask | null> {
  const key = `tasks/${taskId}.json`;
  try {
    const raw = await getObject(key, r2);
    return JSON.parse(raw) as JobTask;
  } catch (error: unknown) {
    const err = error as Error;
    if (err?.name === 'NoSuchKey' || err?.message?.includes('NoSuchKey')) {
      return null;
    }
    throw error;
  }
}
