import { NextRequest, NextResponse } from 'next/server';
import { scrapeUrlAdvanced } from '@/lib/services/crawler';
import type { ScrapeAdvancedOptions, CrawlerOverrides } from '@/lib/services/crawler';
import { cleanContent } from '@/lib/processors/cleaner';
import { putObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import { buildR2Key, formatDate } from '@/lib/utils/helpers';

/**
 * POST /api/scrape
 * 即時單頁 Firecrawl Scrape — 支援進階參數、LLM 清理、存入 R2
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      url,
      firecrawlKey,
      // 進階 Scrape 參數
      waitFor,
      timeout,
      onlyMainContent,
      mobile,
      includeTags,
      excludeTags,
      // 後處理選項
      saveToR2,
      enableClean,
      // LLM Cleaner 覆蓋配置
      llmApiKey,
      llmBaseUrl,
      llmModel,
      cleaningPrompt,
      // R2 覆蓋配置
      r2AccountId,
      r2AccessKeyId,
      r2SecretAccessKey,
      r2BucketName,
    } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid url parameter' },
        { status: 400 }
      );
    }

    console.log(`[API Scrape] Scraping URL: ${url}`);

    // 組裝 Firecrawl 覆蓋配置
    const crawlerOverrides: CrawlerOverrides = {
      apiKey: firecrawlKey || undefined,
    };

    // 組裝進階 Scrape 選項
    const scrapeOptions: ScrapeAdvancedOptions = {};
    if (waitFor !== undefined && waitFor !== '') scrapeOptions.waitFor = parseInt(waitFor, 10);
    if (timeout !== undefined && timeout !== '') scrapeOptions.timeout = parseInt(timeout, 10);
    if (onlyMainContent !== undefined) scrapeOptions.onlyMainContent = onlyMainContent;
    if (mobile !== undefined) scrapeOptions.mobile = mobile;
    if (includeTags && typeof includeTags === 'string' && includeTags.trim()) {
      scrapeOptions.includeTags = includeTags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
    if (excludeTags && typeof excludeTags === 'string' && excludeTags.trim()) {
      scrapeOptions.excludeTags = excludeTags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }

    // 執行 Firecrawl Scrape
    const result = await scrapeUrlAdvanced(url, scrapeOptions, crawlerOverrides);
    let { markdown } = result;
    const { metadata } = result;

    let cleanedMarkdown: string | undefined;
    let r2RawKey: string | undefined;
    let r2CleanedKey: string | undefined;

    // 組裝 R2 覆蓋配置
    const r2Overrides: R2Overrides | undefined = (r2AccountId || r2AccessKeyId || r2SecretAccessKey)
      ? {
          accountId: r2AccountId,
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey,
          bucketName: r2BucketName,
        }
      : undefined;

    // LLM Content Cleaner（可選）
    if (enableClean && markdown.trim().length > 0) {
      console.log(`[API Scrape] Running LLM Content Cleaner...`);
      const cleanerConfig = {
        model: llmModel || undefined,
        apiKey: llmApiKey || undefined,
        baseUrl: llmBaseUrl || undefined,
        prompt: cleaningPrompt || undefined,
      };
      cleanedMarkdown = await cleanContent(markdown, cleanerConfig);
    }

    // Save to R2（可選）
    if (saveToR2) {
      const date = formatDate();
      console.log(`[API Scrape] Saving to R2...`);

      // 儲存 raw
      r2RawKey = buildR2Key(url, 'raw', date);
      await putObject(r2RawKey, markdown, 'text/markdown', r2Overrides);
      console.log(`[API Scrape] Saved raw to ${r2RawKey}`);

      // 若有 cleaned 版本，也儲存
      if (cleanedMarkdown !== undefined) {
        r2CleanedKey = buildR2Key(url, 'cleaned', date);
        await putObject(r2CleanedKey, cleanedMarkdown, 'text/markdown', r2Overrides);
        console.log(`[API Scrape] Saved cleaned to ${r2CleanedKey}`);
      }
    }

    console.log(`[API Scrape] Successfully scraped: ${url}`);

    return NextResponse.json({
      success: true,
      markdown,
      cleanedMarkdown: cleanedMarkdown ?? null,
      metadata: metadata ?? null,
      charCount: markdown.length,
      cleanedCharCount: cleanedMarkdown?.length ?? null,
      r2: saveToR2
        ? { rawKey: r2RawKey, cleanedKey: r2CleanedKey ?? null }
        : null,
    });
  } catch (error: unknown) {
    console.error('[API Scrape] Internal Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Scrape failed', details: msg },
      { status: 500 }
    );
  }
}
