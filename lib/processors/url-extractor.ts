import { XMLParser } from 'fast-xml-parser';
import { chatCompletion } from '../services/llm';
import { config } from '../config';

/**
 * Given user input, figure out if it's a URL leading to a sitemap, or raw text.
 * Return an array of extracted URLs.
 */
export async function extractUrls(input: string): Promise<string[]> {
  const isUrl = /^(https?:\/\/[^\s]+)/.test(input.trim());

  if (isUrl) {
    const url = input.trim();
    if (url.endsWith('.xml') || url.includes('sitemap')) {
      return extractFromSitemap(url);
    } else {
      // If a single page URL was provided but it's not a sitemap
      return [url];
    }
  }

  // Attempt to extract from text using LLM
  return extractFromText(input);
}

/**
 * Fetch and parse a sitemap.xml to extract all <loc> URLs
 */
async function extractFromSitemap(sitemapUrl: string): Promise<string[]> {
  console.log(`[URL Extractor] Fetching sitemap: ${sitemapUrl}`);
  
  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: HTTP ${response.status}`);
  }

  const xmlData = await response.text();
  
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    textNodeName: 'text',
  });
  
  const jsonObj = parser.parse(xmlData);
  const urls: string[] = [];

  // Handle standard urlset
  if (jsonObj.urlset && jsonObj.urlset.url) {
    const urlEntries = Array.isArray(jsonObj.urlset.url) ? jsonObj.urlset.url : [jsonObj.urlset.url];
    for (const entry of urlEntries) {
      if (entry.loc) {
        urls.push(entry.loc.text || entry.loc);
      }
    }
  }
  // Handle sitemapindex
  else if (jsonObj.sitemapindex && jsonObj.sitemapindex.sitemap) {
    const sitemapEntries = Array.isArray(jsonObj.sitemapindex.sitemap) 
      ? jsonObj.sitemapindex.sitemap 
      : [jsonObj.sitemapindex.sitemap];
      
    // Notice: For a complete solution we might iteratively fetch these child sitemaps,
    // but the python codebase simply extracted them or expected simple sitemaps right away.
    // For recursive fetching, we would add the recursion here.
    for (const entry of sitemapEntries) {
      if (entry.loc) {
        // Here we just extract the sitemap URLs, but a recursive approach would be more robust.
        // If needed, we can implement recursive fetching. For now, matching the generic python extraction style.
        const childUrls = await extractFromSitemap(entry.loc.text || entry.loc);
        urls.push(...childUrls);
      }
    }
  }

  return [...new Set(urls)]; // remove duplicates
}

/**
 * Use LLM to cleanly extract URLs from raw text
 */
async function extractFromText(text: string): Promise<string[]> {
  console.log(`[URL Extractor] Extracting URLs via LLM`);

  const systemPrompt = `You are a helpful assistant that extracts URLs from text.
Output ONLY a valid JSON object containing a "urls" key mapped to an array of strings.
If no valid URLs are found, output {"urls": []}. Do not output any markdown formatting, only pure JSON.`;

  const rawJson = await chatCompletion(config.llm.urlExtractor, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Please extract URLs from the following text:\n\n${text}` }
  ], { responseFormat: 'json_object' });

  try {
    const data = JSON.parse(rawJson);
    return data.urls || [];
  } catch {
    console.error(`[URL Extractor] Failed to parse LLM output: ${rawJson}`);
    return [];
  }
}
