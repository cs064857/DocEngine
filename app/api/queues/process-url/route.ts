import { handleCallback } from '@vercel/queue';
import { scrapeUrl } from '@/lib/services/crawler';
import { cleanContent } from '@/lib/processors/cleaner';
import { putObject, getTaskStatus, putTaskStatus } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import { buildR2Key } from '@/lib/utils/helpers';
import { config } from '@/lib/config';

class QueueRetryError extends Error {
  maxRetries: number;
  constructor(message: string, maxRetries: number) {
    super(message);
    this.maxRetries = maxRetries;
    this.name = 'QueueRetryError';
  }
}

// Shape of the payload sent from /api/crawl
export interface CrawlJobPayload {
  taskId: string;
  url: string;
  date: string;
  engineSettings?: {
    // Content Cleaner 配置
    llmModel?: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
    cleaningPrompt?: string;
    // Firecrawl 配置
    firecrawlKey?: string;
    firecrawlUrl?: string;
    // 處理旗標
    enableClean?: boolean;
    // URL Extractor 配置（僅在 /api/crawl 階段使用，queue 不需要）
    urlExtractorApiKey?: string;
    urlExtractorBaseUrl?: string;
    urlExtractorModel?: string;
    urlExtractorPrompt?: string;
    // 專案限額與重試配置
    maxRetries?: number;
    // 單一 URL 超時（秒），預設 300
    urlTimeout?: number;
    // R2 儲存覆蓋配置
    r2AccountId?: string;
    r2AccessKeyId?: string;
    r2SecretAccessKey?: string;
    r2BucketName?: string;
  };
}

// 從 engineSettings 提取 R2 覆蓋配置的輔助函式
function extractR2Overrides(engineSettings?: CrawlJobPayload['engineSettings']): R2Overrides | undefined {
  if (!engineSettings?.r2AccountId && !engineSettings?.r2AccessKeyId && !engineSettings?.r2SecretAccessKey && !engineSettings?.r2BucketName) {
    return undefined;
  }
  return {
    accountId: engineSettings.r2AccountId,
    accessKeyId: engineSettings.r2AccessKeyId,
    secretAccessKey: engineSettings.r2SecretAccessKey,
    bucketName: engineSettings.r2BucketName,
  };
}

/**
 * 標記 URL 為 processing 狀態（解決 pending 卡住問題）
 */
async function markUrlProcessing(taskId: string, url: string, r2?: R2Overrides) {
  try {
    const taskStatus = await getTaskStatus(taskId, r2);
    if (!taskStatus?.urls) return;
    const entry = taskStatus.urls.find(u => u.url === url);
    if (entry && (entry.status === 'pending' || entry.status === 'failed')) {
      entry.status = 'processing';
      taskStatus.updatedAt = new Date().toISOString();
      await putTaskStatus(taskId, taskStatus, r2);
    }
  } catch (e) {
    console.error(`[Queue] Failed to mark ${url} as processing`, e);
  }
}

/**
 * 以超時包裝非同步操作
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`URL processing timed out after ${timeoutMs / 1000}s: ${url}`));
    }, timeoutMs);

    promise
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

export const POST = handleCallback<CrawlJobPayload>(
  async (message, metadata) => {
    const { taskId, url, date, engineSettings } = message;
    const r2 = extractR2Overrides(engineSettings);

    // 標記 URL 為 processing 狀態
    await markUrlProcessing(taskId, url, r2);

    console.log(`[Queue] Processing URL: ${url} (Task: ${taskId}, attempt ${metadata.deliveryCount})`);

    // 計算超時（預設 300 秒）
    const timeoutMs = (engineSettings?.urlTimeout ?? 300) * 1000;

    try {
      // 將整個處理流程包裝在超時內
      await withTimeout((async () => {
        // 1. Firecrawl scrape
        const crawlerConfig = {
          apiKey: engineSettings?.firecrawlKey,
          apiUrl: engineSettings?.firecrawlUrl,
        };

        const rawMarkdown = await scrapeUrl(url, crawlerConfig);

        // 2. Save raw -> R2
        const rawKey = buildR2Key(url, 'raw', date);
        await putObject(rawKey, rawMarkdown, 'text/markdown', r2);
        console.log(`[Queue] Saved raw markdown to ${rawKey}`);

        let cleanedMarkdown = rawMarkdown;

        // 3. LLM clean (Only runs if enableClean is missing or strictly true, and rawMarkdown is not empty)
        if (engineSettings?.enableClean !== false && rawMarkdown.trim().length > 0) {
          const cleanerConfig = {
            model: engineSettings?.llmModel,
            apiKey: engineSettings?.llmApiKey,
            baseUrl: engineSettings?.llmBaseUrl,
            prompt: engineSettings?.cleaningPrompt,
          };
          cleanedMarkdown = await cleanContent(rawMarkdown, cleanerConfig);
        }

        // 4. Save cleaned -> R2
        const cleanedKey = buildR2Key(url, 'cleaned', date);
        await putObject(cleanedKey, cleanedMarkdown, 'text/markdown', r2);
        console.log(`[Queue] Saved cleaned markdown to ${cleanedKey}`);

        // 5. Update Task Status -> Success
        await updateTaskStatus(taskId, url, true, undefined, r2);

        console.log(`[Queue] Successfully processed URL: ${url}`);
      })(), timeoutMs, url);

    } catch (error: unknown) {
      console.error(`[Queue] Error processing URL: ${url}`, error);

      const r2 = extractR2Overrides(engineSettings);
      const userMaxRetries = engineSettings?.maxRetries ?? config.project.retryAttempts;
      const isFinalAttempt = metadata.deliveryCount >= userMaxRetries;

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (isFinalAttempt) {
        console.log(`[Queue] Max retries reached for ${url}. Marking as failed.`);
        await updateTaskStatus(taskId, url, false, errorMessage, r2);
      } else {
        console.log(`[Queue] Attempt ${metadata.deliveryCount}/${userMaxRetries} failed for ${url}. Logging retry to R2.`);
        await logRetryAttempt(taskId, url, metadata.deliveryCount, userMaxRetries, errorMessage, r2);
      }

      throw new QueueRetryError(errorMessage, userMaxRetries);
    }
  },
  {
    retry: (error, metadata) => {
      const maxRetries = error instanceof QueueRetryError ? error.maxRetries : config.project.retryAttempts;
      if (metadata.deliveryCount > maxRetries) {
        return { acknowledge: true };
      }
      const delay = Math.min(120, Math.pow(2, metadata.deliveryCount) * 10);
      return { afterSeconds: delay };
    },
  }
);


/**
 * 更新 R2 中的任務狀態（支援 R2 覆蓋配置）
 */
async function updateTaskStatus(taskId: string, url: string, success: boolean, errorMessage?: string, r2?: R2Overrides) {
  try {
    const taskStatus = await getTaskStatus(taskId, r2);
    if (!taskStatus) {
      console.warn(`[Queue] Task ${taskId} not found in R2 for status update`);
      return;
    }

    if (success) {
      taskStatus.completed += 1;
    } else {
      taskStatus.failed += 1;
      taskStatus.failedUrls.push({ url, error: errorMessage || 'Unknown' });
    }

    // 更新個別 URL 的追蹤狀態
    if (taskStatus.urls) {
      const urlEntry = taskStatus.urls.find(u => u.url === url);
      if (urlEntry) {
        urlEntry.status = success ? 'success' : 'failed';
        if (!success) urlEntry.error = errorMessage;
      }
    }

    if (taskStatus.retryingUrls) {
      taskStatus.retryingUrls = taskStatus.retryingUrls.filter(r => r.url !== url);
    }

    if ((taskStatus.completed + taskStatus.failed) >= taskStatus.total) {
      taskStatus.status = 'completed';
      console.log(`[Queue] Task ${taskId} has completed all URLs`);
    }

    taskStatus.updatedAt = new Date().toISOString();

    await putTaskStatus(taskId, taskStatus, r2);
  } catch (error) {
    console.error(`[Queue] Failed to update task status for ${url}`, error);
  }
}

/**
 * 寫入重試狀態到 R2
 */
async function logRetryAttempt(taskId: string, url: string, attempts: number, maxRetries: number, errorMsg: string, r2?: R2Overrides) {
  try {
    const taskStatus = await getTaskStatus(taskId, r2);
    if (!taskStatus) return;

    if (!taskStatus.retryingUrls) {
      taskStatus.retryingUrls = [];
    }

    const existingIndex = taskStatus.retryingUrls.findIndex(r => r.url === url);
    if (existingIndex >= 0) {
      taskStatus.retryingUrls[existingIndex] = { url, attempts, maxRetries, error: errorMsg };
    } else {
      taskStatus.retryingUrls.push({ url, attempts, maxRetries, error: errorMsg });
    }

    taskStatus.updatedAt = new Date().toISOString();

    await putTaskStatus(taskId, taskStatus, r2);
  } catch (error) {
    console.error(`[Queue] Failed to log retry attempt for ${url}`, error);
  }
}
