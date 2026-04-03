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
  });

  if (!scrapeResult.success) {
    if (scrapeResult.error) {
      throw new Error(`Scrape failed: ${scrapeResult.error}`);
    }
    throw new Error('Scrape failed with unknown error');
  }

  return scrapeResult.markdown || '';
}
