import { XMLParser } from 'fast-xml-parser';
import { chatCompletion } from '../services/llm';
import { config } from '../config';

// URL Extractor 覆蓋配置介面
export interface UrlExtractorOverrides {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  prompt?: string;
}

// 預設 URL 提取提示詞（來源：URL_EXTRACTOR_PROMPT.md）
const DEFAULT_URL_EXTRACTOR_PROMPT = `You are a helpful assistant that extracts URLs from text.
Output ONLY a valid JSON object containing a "urls" key mapped to an array of strings.
If no valid URLs are found, output {"urls": []}. Do not output any markdown formatting, only pure JSON.`.trim();

/**
 * 根據使用者輸入，判斷是 sitemap URL 還是原始文字，回傳提取的 URL 陣列
 * @param input - 使用者輸入
 * @param overrides - 可選 LLM 覆蓋配置（apiKey, baseUrl, model, prompt）
 */
export async function extractUrls(input: string, overrides?: UrlExtractorOverrides): Promise<string[]> {
  const isUrl = /^(https?:\/\/[^\s]+)/.test(input.trim());

  if (isUrl) {
    const url = input.trim();
    if (url.endsWith('.xml') || url.includes('sitemap')) {
      return extractFromSitemap(url);
    } else {
      // 單一頁面 URL，非 sitemap
      return [url];
    }
  }

  // 嘗試透過 LLM 從文字中提取 URL
  return extractFromText(input, overrides);
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
 * 使用 LLM 從原始文字中提取 URL
 * @param text - 原始文字
 * @param overrides - 可選 LLM 覆蓋配置
 */
async function extractFromText(text: string, overrides?: UrlExtractorOverrides): Promise<string[]> {
  console.log(`[URL Extractor] Extracting URLs via LLM`);

  const promptToUse = overrides?.prompt || DEFAULT_URL_EXTRACTOR_PROMPT;

  // 組合 LLM 配置，支援覆蓋
  const llmConfig = {
    baseUrl: overrides?.baseUrl || config.llm.urlExtractor.baseUrl,
    apiKey: overrides?.apiKey || config.llm.urlExtractor.apiKey,
    model: overrides?.model || config.llm.urlExtractor.model,
  };

  const rawJson = await chatCompletion(llmConfig, [
    { role: 'system', content: promptToUse },
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
