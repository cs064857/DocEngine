import { handleCallback } from '@vercel/queue';
import { scrapeUrl } from '@/lib/services/crawler';
import { cleanContent } from '@/lib/processors/cleaner';
import { putObject, getTaskStatus, putTaskStatus } from '@/lib/r2';
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
  };
}

export const POST = handleCallback<CrawlJobPayload>(
  async (message, metadata) => {
    const { taskId, url, date, engineSettings } = message;

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
      await putObject(rawKey, rawMarkdown);
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
      await putObject(cleanedKey, cleanedMarkdown);
      console.log(`[Queue] Saved cleaned markdown to ${cleanedKey}`);

      // 5. Update Task Status -> Success
      await updateTaskStatus(taskId, url, true);

      console.log(`[Queue] Successfully processed URL: ${url}`);
      
    } catch (error: unknown) {
      console.error(`[Queue] Error processing URL: ${url}`, error);
      
      // If we've reached max deliveries, we need to record this failure permanently.
      // We know maxDeliveries from vercel.json is typically what we set `config.project.retryAttempts` to + 1 for initial.
      const isFinalAttempt = metadata.deliveryCount >= config.project.retryAttempts;
      
      if (isFinalAttempt) {
         console.log(`[Queue] Max retries reached for ${url}. Marking as failed.`);
         const errorMessage = error instanceof Error ? error.message : 'Unknown error';
         await updateTaskStatus(taskId, url, false, errorMessage);
      }
      
      // Throwing error allows Vercel Queue to attempt retry based on vercel.json configuration.
      throw error; 
    }
  },
  {
    retry: (error, metadata) => {
      // Custom exponential backoff defined locally.
      // E.g., attempts: 1-> 5s, 2 -> 20s, 3 -> 40s
      if (metadata.deliveryCount > config.project.retryAttempts) {
        return { acknowledge: true }; // stop retrying
      }
      const delay = Math.min(120, Math.pow(2, metadata.deliveryCount) * 10);
      return { afterSeconds: delay };
    },
  }
);


/**
 * Helper to update R2 Task metrics safely
 * In a highly concurrent env like Vercel, simultaneous updates to same R2 object might clash,
 * but for a Hobby usecase or isolated tasks, standard overwrite suffices.
 * Using a DB like KV/D1 would be better for high concurrency, but falling back to R2 here.
 */
async function updateTaskStatus(taskId: string, url: string, success: boolean, errorMessage?: string) {
  try {
    const taskStatus = await getTaskStatus(taskId);
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

    // Determine completion status
    if ((taskStatus.completed + taskStatus.failed) >= taskStatus.total) {
      taskStatus.status = 'completed';
      console.log(`[Queue] Task ${taskId} has completed all URLs`);
    }

    await putTaskStatus(taskId, taskStatus);
  } catch (error) {
    console.error(`[Queue] Failed to update task status for ${url}`, error);
  }
}
