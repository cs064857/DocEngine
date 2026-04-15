import { handleCallback } from '@vercel/queue';
import { getCrawlRetryDirective, processCrawlJob } from '@/lib/services/crawl-dispatch';
import type { CrawlJobPayload } from '@/lib/services/crawl-dispatch';

export const POST = handleCallback<CrawlJobPayload>(
  async (message, metadata) => {
    await processCrawlJob(message, { deliveryCount: metadata.deliveryCount });
  },
  {
    retry: (error, metadata) => {
      return getCrawlRetryDirective(error, metadata.deliveryCount);
    },
  }
);
