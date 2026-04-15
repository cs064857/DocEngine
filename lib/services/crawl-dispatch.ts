import { send } from '@vercel/queue';
import { cleanContent } from '../processors/cleaner';
import { config } from '../config';
import { getTaskStatus, putObject, putTaskStatus } from '../r2';
import type { R2Overrides } from '../r2';
import { buildR2Key } from '../utils/helpers';
import { scrapeUrl } from './crawler';

export interface CrawlJobPayload {
  taskId: string;
  url: string;
  date: string;
  engineSettings?: {
    llmModel?: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
    cleaningPrompt?: string;
    firecrawlKey?: string;
    firecrawlUrl?: string;
    enableClean?: boolean;
    urlExtractorApiKey?: string;
    urlExtractorBaseUrl?: string;
    urlExtractorModel?: string;
    urlExtractorPrompt?: string;
    maxRetries?: number;
    urlTimeout?: number;
    r2AccountId?: string;
    r2AccessKeyId?: string;
    r2SecretAccessKey?: string;
    r2BucketName?: string;
  };
}

export interface CrawlJobMetadata {
  deliveryCount: number;
}

export type CrawlDispatchMode = 'queue' | 'inline' | 'mixed';

export interface DispatchCrawlJobsDeps {
  canUseBackgroundQueue: () => boolean;
  sendToQueue: (topic: string, job: CrawlJobPayload) => Promise<unknown>;
  processJobsInline: (jobs: CrawlJobPayload[]) => Promise<void>;
}

export class QueueRetryError extends Error {
  maxRetries: number;

  constructor(message: string, maxRetries: number) {
    super(message);
    this.maxRetries = maxRetries;
    this.name = 'QueueRetryError';
  }
}

const defaultDispatchDeps: DispatchCrawlJobsDeps = {
  canUseBackgroundQueue,
  sendToQueue: send,
  processJobsInline: processCrawlJobsInline,
};

function canUseBackgroundQueue(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.VERCEL === '1';
}

function isQueueUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return [
    'Failed to get OIDC token',
    'outside of a Vercel Function environment',
    'Unable to find project root directory',
    'vercel env pull',
    'vc link',
  ].some((fragment) => message.includes(fragment));
}

export async function dispatchCrawlJobs(
  jobs: CrawlJobPayload[],
  deps: DispatchCrawlJobsDeps = defaultDispatchDeps
): Promise<CrawlDispatchMode> {
  if (jobs.length === 0) {
    return 'queue';
  }

  if (!deps.canUseBackgroundQueue()) {
    await deps.processJobsInline(jobs);
    return 'inline';
  }

  let queuedCount = 0;

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];

    try {
      await deps.sendToQueue('crawl-urls', job);
      queuedCount += 1;
    } catch (error) {
      if (!isQueueUnavailableError(error)) {
        throw error;
      }

      const pendingJobs = jobs.slice(index);
      console.warn(
        `[Crawl Dispatch] Queue unavailable. Falling back to inline processing for ${pendingJobs.length} URL(s).`
      );
      await deps.processJobsInline(pendingJobs);
      return queuedCount > 0 ? 'mixed' : 'inline';
    }
  }

  return 'queue';
}

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

async function markUrlProcessing(taskId: string, url: string, r2?: R2Overrides) {
  try {
    const taskStatus = await getTaskStatus(taskId, r2);
    if (!taskStatus?.urls) {
      return;
    }

    const entry = taskStatus.urls.find((item) => item.url === url);
    if (entry && (entry.status === 'pending' || entry.status === 'failed')) {
      entry.status = 'processing';
      taskStatus.updatedAt = new Date().toISOString();
      await putTaskStatus(taskId, taskStatus, r2);
    }
  } catch (error) {
    console.error(`[Queue] Failed to mark ${url} as processing`, error);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`URL processing timed out after ${timeoutMs / 1000}s: ${url}`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function processCrawlJob(message: CrawlJobPayload, metadata: CrawlJobMetadata): Promise<void> {
  const { taskId, url, date, engineSettings } = message;
  const r2 = extractR2Overrides(engineSettings);

  await markUrlProcessing(taskId, url, r2);

  console.log(`[Queue] Processing URL: ${url} (Task: ${taskId}, attempt ${metadata.deliveryCount})`);

  const timeoutMs = (engineSettings?.urlTimeout ?? 300) * 1000;

  try {
    await withTimeout((async () => {
      const crawlerConfig = {
        apiKey: engineSettings?.firecrawlKey,
        apiUrl: engineSettings?.firecrawlUrl,
      };

      const rawMarkdown = await scrapeUrl(url, crawlerConfig);

      const rawKey = buildR2Key(url, 'raw', date);
      await putObject(rawKey, rawMarkdown, 'text/markdown', r2);
      console.log(`[Queue] Saved raw markdown to ${rawKey}`);

      let cleanedMarkdown = rawMarkdown;

      if (engineSettings?.enableClean !== false && rawMarkdown.trim().length > 0) {
        const cleanerConfig = {
          model: engineSettings?.llmModel,
          apiKey: engineSettings?.llmApiKey,
          baseUrl: engineSettings?.llmBaseUrl,
          prompt: engineSettings?.cleaningPrompt,
        };
        cleanedMarkdown = await cleanContent(rawMarkdown, cleanerConfig);
      }

      const cleanedKey = buildR2Key(url, 'cleaned', date);
      await putObject(cleanedKey, cleanedMarkdown, 'text/markdown', r2);
      console.log(`[Queue] Saved cleaned markdown to ${cleanedKey}`);

      await updateTaskStatus(taskId, url, true, undefined, r2);

      console.log(`[Queue] Successfully processed URL: ${url}`);
    })(), timeoutMs, url);
  } catch (error: unknown) {
    console.error(`[Queue] Error processing URL: ${url}`, error);

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
}

export async function processCrawlJobsInline(jobs: CrawlJobPayload[]): Promise<void> {
  for (const job of jobs) {
    let deliveryCount = 1;

    while (true) {
      try {
        await processCrawlJob(job, { deliveryCount });
        break;
      } catch (error) {
        if (!(error instanceof QueueRetryError)) {
          throw error;
        }

        if (deliveryCount >= error.maxRetries) {
          break;
        }

        deliveryCount += 1;
      }
    }
  }
}

export function getCrawlRetryDirective(error: unknown, deliveryCount: number) {
  const maxRetries = error instanceof QueueRetryError ? error.maxRetries : config.project.retryAttempts;

  if (deliveryCount > maxRetries) {
    return { acknowledge: true as const };
  }

  const delay = Math.min(120, Math.pow(2, deliveryCount) * 10);
  return { afterSeconds: delay };
}

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

    if (taskStatus.urls) {
      const urlEntry = taskStatus.urls.find((item) => item.url === url);
      if (urlEntry) {
        urlEntry.status = success ? 'success' : 'failed';
        if (!success) {
          urlEntry.error = errorMessage;
        }
      }
    }

    if (taskStatus.retryingUrls) {
      taskStatus.retryingUrls = taskStatus.retryingUrls.filter((item) => item.url !== url);
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

async function logRetryAttempt(taskId: string, url: string, attempts: number, maxRetries: number, errorMsg: string, r2?: R2Overrides) {
  try {
    const taskStatus = await getTaskStatus(taskId, r2);
    if (!taskStatus) {
      return;
    }

    if (!taskStatus.retryingUrls) {
      taskStatus.retryingUrls = [];
    }

    const existingIndex = taskStatus.retryingUrls.findIndex((item) => item.url === url);
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
