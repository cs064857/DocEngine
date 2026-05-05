import FirecrawlApp from '@mendable/firecrawl-js';
import { config } from '../config';
import { FirecrawlKeyManager } from './firecrawl-key-manager';

// Define overrides type
export interface CrawlerOverrides {
  apiKey?: string;
  apiUrl?: string;
}

const firecrawlInstances = new Map<string, FirecrawlApp>();
const firecrawlKeyManagers = new Map<string, FirecrawlKeyManager>();

interface FirecrawlClientContext {
  client: FirecrawlApp;
  apiKey: string;
}

function getKeyManager(keys: string[]): FirecrawlKeyManager {
  const managerSignature = JSON.stringify(keys);
  let manager = firecrawlKeyManagers.get(managerSignature);
  if (!manager) {
    manager = new FirecrawlKeyManager({
      keys,
      keyRates: config.firecrawl.keyRates,
      defaultRatePerMinute: config.firecrawl.defaultRatePerMinute,
      rateLimitCooldownMs: config.firecrawl.rateLimitCooldownSeconds * 1000,
    });
    firecrawlKeyManagers.set(managerSignature, manager);
  }

  return manager;
}

function getManagedKeys(overrides?: CrawlerOverrides): string[] {
  if (overrides?.apiKey) {
    return [overrides.apiKey];
  }

  if (config.firecrawl.apiKeys.length > 0) {
    return config.firecrawl.apiKeys;
  }

  return config.firecrawl.apiKey ? [config.firecrawl.apiKey] : [];
}

function isFirecrawlRateLimitError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (typeof error === 'object') {
    const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; error?: unknown };
    if (candidate.status === 429 || candidate.statusCode === 429 || candidate.code === 429 || candidate.code === '429') {
      return true;
    }

    const message = [candidate.message, candidate.error]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
    if (/\b429\b|rate[_\s-]?limit|too many requests/i.test(message)) {
      return true;
    }
  }

  return /\b429\b|rate[_\s-]?limit|too many requests/i.test(String(error));
}

function reportRateLimitIfNeeded(apiKey: string, error: unknown, overrides?: CrawlerOverrides): void {
  if (!isFirecrawlRateLimitError(error)) {
    return;
  }

  getKeyManager(getManagedKeys(overrides)).reportRateLimit(apiKey);
}

function getFirecrawl(overrides?: CrawlerOverrides): FirecrawlClientContext {
  const keyManager = getKeyManager(getManagedKeys(overrides));
  const currentKey = keyManager.getNextKey();
  const currentUrl = overrides?.apiUrl || config.firecrawl.apiUrl;
  
  const configSignature = `${currentKey}-${currentUrl}`;

  let firecrawlInstance = firecrawlInstances.get(configSignature);
  if (!firecrawlInstance) {
    const crawlerOptions = currentUrl
      ? { apiKey: currentKey, apiUrl: currentUrl }
      : { apiKey: currentKey };
       
    firecrawlInstance = new FirecrawlApp(crawlerOptions);
    firecrawlInstances.set(configSignature, firecrawlInstance);
  }
  return { client: firecrawlInstance, apiKey: currentKey };
}

/**
 * Perform scrape on a single URL using Firecrawl
 */
export async function scrapeUrl(url: string, overrides?: CrawlerOverrides): Promise<string> {
  console.log(`[Crawler] Scraping URL: ${url}`);
  
  const firecrawl = getFirecrawl(overrides);

  // Notice we only scrape for markdown format, as per the Python original
  const scrapeResult = await firecrawl.client.scrapeUrl(url, {
      formats: ['markdown'],
      timeout: 60000, // 增加 timeout 到 60 秒以防 408 錯誤
    })
    .catch((error: unknown) => {
      reportRateLimitIfNeeded(firecrawl.apiKey, error, overrides);
      throw error;
    });

  if (!scrapeResult.success) {
    reportRateLimitIfNeeded(firecrawl.apiKey, scrapeResult.error, overrides);
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

  const scrapeResult = await firecrawl.client.scrapeUrl(url, scrapeParams)
    .catch((error: unknown) => {
      reportRateLimitIfNeeded(firecrawl.apiKey, error, overrides);
      throw error;
    });

  if (!scrapeResult.success) {
    reportRateLimitIfNeeded(firecrawl.apiKey, scrapeResult.error, overrides);
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

  const crawlResponse = await firecrawl.client.asyncCrawlUrl(url, {
      limit,
      scrapeOptions: {
        formats: ['links'], // 我們只需要 links 來放入 queue 中處理
      }
    })
    .catch((error: unknown) => {
      reportRateLimitIfNeeded(firecrawl.apiKey, error, overrides);
      throw error;
    });

  if (!crawlResponse.success) {
    const err = crawlResponse as { error?: string };
    reportRateLimitIfNeeded(firecrawl.apiKey, err.error, overrides);
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
  const statusResponse = await firecrawl.client.checkCrawlStatus(jobId)
    .catch((error: unknown) => {
      reportRateLimitIfNeeded(firecrawl.apiKey, error, overrides);
      throw error;
    });

  if (!statusResponse.success) {
    const err = statusResponse as { error?: string };
    reportRateLimitIfNeeded(firecrawl.apiKey, err.error, overrides);
    throw new Error(`Failed to check crawl status: ${err.error || 'Unknown error'}`);
  }

  return statusResponse;
}
