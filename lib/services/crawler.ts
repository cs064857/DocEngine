import FirecrawlApp from '@mendable/firecrawl-js';
import { config } from '../config';

// Define overrides type
export interface CrawlerOverrides {
  apiKey?: string;
  apiUrl?: string;
}

let firecrawlInstance: FirecrawlApp | null = null;
let lastUsedConfigStr: string = '';

function getFirecrawl(overrides?: CrawlerOverrides): FirecrawlApp {
  const currentKey = overrides?.apiKey || config.firecrawl.apiKey || 'DUMMY_KEY';
  const currentUrl = overrides?.apiUrl || config.firecrawl.apiUrl;
  
  const configSignature = `${currentKey}-${currentUrl}`;

  // Re-initialize if config signature changed or instance null
  if (!firecrawlInstance || lastUsedConfigStr !== configSignature) {
    const crawlerOptions = currentUrl
      ? { apiKey: currentKey, apiUrl: currentUrl }
      : { apiKey: currentKey };
      
    firecrawlInstance = new FirecrawlApp(crawlerOptions);
    lastUsedConfigStr = configSignature;
  }
  return firecrawlInstance;
}

/**
 * Perform scrape on a single URL using Firecrawl
 */
export async function scrapeUrl(url: string, overrides?: CrawlerOverrides): Promise<string> {
  console.log(`[Crawler] Scraping URL: ${url}`);
  
  const firecrawl = getFirecrawl(overrides);

  // Notice we only scrape for markdown format, as per the Python original
  const scrapeResult = await firecrawl.scrapeUrl(url, {
    formats: ['markdown'],
    timeout: 60000, // 增加 timeout 到 60 秒以防 408 錯誤
  });

  if (!scrapeResult.success) {
    if (scrapeResult.error) {
      throw new Error(`Scrape failed: ${scrapeResult.error}`);
    }
    throw new Error('Scrape failed with unknown error');
  }

  return scrapeResult.markdown || '';
}

// Firecrawl Scrape 進階參數介面
export interface ScrapeAdvancedOptions {
  waitFor?: number;
  timeout?: number;
  onlyMainContent?: boolean;
  mobile?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
}

// Scrape 進階結果
export interface ScrapeAdvancedResult {
  markdown: string;
  metadata?: Record<string, unknown>;
}

/**
 * 使用完整 Firecrawl Scrape API 參數進行進階單頁抓取
 */
export async function scrapeUrlAdvanced(
  url: string,
  options?: ScrapeAdvancedOptions,
  overrides?: CrawlerOverrides
): Promise<ScrapeAdvancedResult> {
  console.log(`[Crawler] Advanced scraping URL: ${url}`, options);

  const firecrawl = getFirecrawl(overrides);

  // 組裝 Firecrawl scrapeUrl 參數
  const scrapeParams: Record<string, unknown> = {
    formats: ['markdown'],
  };

  if (options?.waitFor !== undefined) scrapeParams.waitFor = options.waitFor;
  if (options?.timeout !== undefined) scrapeParams.timeout = options.timeout;
  if (options?.onlyMainContent !== undefined) scrapeParams.onlyMainContent = options.onlyMainContent;
  if (options?.mobile !== undefined) scrapeParams.mobile = options.mobile;
  if (options?.includeTags && options.includeTags.length > 0) scrapeParams.includeTags = options.includeTags;
  if (options?.excludeTags && options.excludeTags.length > 0) scrapeParams.excludeTags = options.excludeTags;

  const scrapeResult = await firecrawl.scrapeUrl(url, scrapeParams);

  if (!scrapeResult.success) {
    if (scrapeResult.error) {
      throw new Error(`Scrape failed: ${scrapeResult.error}`);
    }
    throw new Error('Scrape failed with unknown error');
  }

  return {
    markdown: scrapeResult.markdown || '',
    metadata: scrapeResult.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Start a Crawl job using Firecrawl
 */
export async function startCrawlJob(url: string, limit: number = 100, overrides?: CrawlerOverrides): Promise<string> {
  console.log(`[Crawler] Starting Crawl Job for: ${url} with limit ${limit}`);
  
  const firecrawl = getFirecrawl(overrides);

  const crawlResponse = await firecrawl.asyncCrawlUrl(url, {
    limit,
    scrapeOptions: {
      formats: ['links'], // 我們只需要 links 來放入 queue 中處理
    }
  });

  if (!crawlResponse.success) {
    const err = crawlResponse as { error?: string };
    throw new Error(`Crawl job start failed: ${err.error || 'Unknown error'}`);
  }

  const res = crawlResponse as { id?: string };
  if (!res.id) {
    throw new Error('Crawl job started but no ID was returned');
  }

  return res.id;
}

/**
 * Check the status of a Crawl job
 */
export async function checkCrawlJob(jobId: string, overrides?: CrawlerOverrides) {
  const firecrawl = getFirecrawl(overrides);
  const statusResponse = await firecrawl.checkCrawlStatus(jobId);

  if (!statusResponse.success) {
    const err = statusResponse as { error?: string };
    throw new Error(`Failed to check crawl status: ${err.error || 'Unknown error'}`);
  }

  return statusResponse;
}
