import FirecrawlApp from '@mendable/firecrawl-js';
import { config } from '../config';

const crawlerOptions = config.firecrawl.apiUrl
  ? { apiKey: config.firecrawl.apiKey, apiUrl: config.firecrawl.apiUrl }
  : { apiKey: config.firecrawl.apiKey };

const firecrawl = new FirecrawlApp(crawlerOptions);

/**
 * Perform scrape on a single URL using Firecrawl
 */
export async function scrapeUrl(url: string): Promise<string> {
  console.log(`[Crawler] Scraping URL: ${url}`);
  
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
