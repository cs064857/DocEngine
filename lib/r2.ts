import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { config } from './config';

// Define standard types for our tasks mapping to the old Python project
export interface JobTask {
  taskId: string;
  status: 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  failedUrls: { url: string; error: string }[];
  date: string;
}

// Ensure the S3Client behaves nicely even in environments where env variables might be checked later
const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

const BUCKET = config.r2.bucketName;

/**
 * Stores contents as an object in Cloudflare R2
 */
export async function putObject(key: string, content: string | Buffer, contentType = 'text/markdown'): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: content,
    ContentType: contentType,
  });

  await S3.send(command);
}

/**
 * Retrieves the object's body from R2 as string
 */
export async function getObject(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  const response = await S3.send(command);
  const streamString = await response.Body?.transformToString('utf-8');
  if (!streamString) {
    throw new Error(`File ${key} is empty or not found.`);
  }

  return streamString;
}

/**
 * Lists objects in the bucket, optionally constrained by prefix
 */
export async function listObjects(prefix?: string, limit = 50) {
  const command = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
    MaxKeys: limit,
  });

  const response = await S3.send(command);
  return response.Contents || [];
}

/**
 * Specialized helper to update JSON task statuses 
 */
export async function putTaskStatus(taskId: string, statusObj: JobTask): Promise<void> {
  const key = `tasks/${taskId}.json`;
  await putObject(key, JSON.stringify(statusObj, null, 2), 'application/json');
}

/**
 * Specialized helper to get task status
 */
export async function getTaskStatus(taskId: string): Promise<JobTask | null> {
  const key = `tasks/${taskId}.json`;
  try {
    const raw = await getObject(key);
    return JSON.parse(raw) as JobTask;
  } catch (error: unknown) {
    // Return null if not found
    const err = error as Error;
    if (err?.name === 'NoSuchKey' || err?.message?.includes('NoSuchKey')) {
      return null;
    }
    throw error;
  }
}
