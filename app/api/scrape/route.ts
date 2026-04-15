import { NextRequest, NextResponse } from 'next/server';
import { runSingleScrapeTask } from '@/lib/services/scrape-task';

/**
 * POST /api/scrape
 * 即時單頁 Firecrawl Scrape — 支援進階參數、LLM 清理、存入 R2
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid url parameter' },
        { status: 400 }
      );
    }

    console.log(`[API Scrape] Scraping URL: ${url}`);

    const result = await runSingleScrapeTask(body);

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Scrape failed',
          details: result.error,
          taskId: result.taskId,
          task: result.task,
        },
        { status: 500 }
      );
    }

    console.log(`[API Scrape] Successfully scraped: ${url}`);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[API Scrape] Internal Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Scrape failed', details: msg },
      { status: 500 }
    );
  }
}
