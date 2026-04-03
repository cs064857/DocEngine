import FirecrawlApp from '@mendable/firecrawl-js';
import { config } from '../config';

let firecrawlInstance: FirecrawlApp | null = null;

function getFirecrawl(): FirecrawlApp {
  if (!firecrawlInstance) {
    const crawlerOptions = config.firecrawl.apiUrl
      ? { apiKey: config.firecrawl.apiKey || 'DUMMY_KEY', apiUrl: config.firecrawl.apiUrl }
      : { apiKey: config.firecrawl.apiKey || 'DUMMY_KEY' };
    firecrawlInstance = new FirecrawlApp(crawlerOptions);
  }
  return firecrawlInstance;
}

/**
 * Perform scrape on a single URL using Firecrawl
 */
export async function scrapeUrl(url: string): Promise<string> {
  console.log(`[Crawler] Scraping URL: ${url}`);
  
  const firecrawl = getFirecrawl();

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
