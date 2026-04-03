import { handleCallback } from '@vercel/queue';
import { scrapeUrl } from '@/lib/services/crawler';
import { cleanContent } from '@/lib/processors/cleaner';
import { putObject, getTaskStatus, putTaskStatus } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import { buildR2Key } from '@/lib/utils/helpers';
import { config } from '@/lib/config';

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
    // R2 儲存覆蓋配置
    r2AccountId?: string;
    r2AccessKeyId?: string;
    r2SecretAccessKey?: string;
    r2BucketName?: string;
  };
}

// 從 engineSettings 提取 R2 覆蓋配置的輔助函式
function extractR2Overrides(engineSettings?: CrawlJobPayload['engineSettings']): R2Overrides | undefined {
  if (!engineSettings?.r2AccountId && !engineSettings?.r2AccessKeyId && !engineSettings?.r2SecretAccessKey) {
    return undefined;
  }
  return {
    accountId: engineSettings.r2AccountId,
    accessKeyId: engineSettings.r2AccessKeyId,
    secretAccessKey: engineSettings.r2SecretAccessKey,
    bucketName: engineSettings.r2BucketName,
  };
}

export const POST = handleCallback<CrawlJobPayload>(
  async (message, metadata) => {
    const { taskId, url, date, engineSettings } = message;
    const r2 = extractR2Overrides(engineSettings);

    console.log(`[Queue] Processing URL: ${url} (Task: ${taskId}, attempt ${metadata.deliveryCount})`);

    try {
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

      // 3. LLM clean (Only runs if enableClean is missing or strictly true)
      if (engineSettings?.enableClean !== false) {
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
      
    } catch (error: unknown) {
      console.error(`[Queue] Error processing URL: ${url}`, error);
      
      const r2 = extractR2Overrides(engineSettings);
      const isFinalAttempt = metadata.deliveryCount >= config.project.retryAttempts;
      
      if (isFinalAttempt) {
         console.log(`[Queue] Max retries reached for ${url}. Marking as failed.`);
         const errorMessage = error instanceof Error ? error.message : 'Unknown error';
         await updateTaskStatus(taskId, url, false, errorMessage, r2);
      }
      
      throw error; 
    }
  },
  {
    retry: (error, metadata) => {
      if (metadata.deliveryCount > config.project.retryAttempts) {
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

    if ((taskStatus.completed + taskStatus.failed) >= taskStatus.total) {
      taskStatus.status = 'completed';
      console.log(`[Queue] Task ${taskId} has completed all URLs`);
    }

    await putTaskStatus(taskId, taskStatus, r2);
  } catch (error) {
    console.error(`[Queue] Failed to update task status for ${url}`, error);
  }
}
