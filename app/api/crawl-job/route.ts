import { NextRequest, NextResponse } from 'next/server';
import { startCrawlJob, checkCrawlJob } from '@/lib/services/crawler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, limit, engineSettings } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid url' }, { status: 400 });
    }

    const maxLimit = limit ? parseInt(limit, 10) : 100;

    const firecrawlOverrides = {
      apiKey: engineSettings?.firecrawlApiKey || undefined,
      apiUrl: engineSettings?.firecrawlApiUrl || undefined,
    };

    console.log(`[API Crawl Job] Starting job for URL: ${url}`);
    
    const jobId = await startCrawlJob(url, maxLimit, firecrawlOverrides);

    return NextResponse.json({ success: true, jobId });
  } catch (error: any) {
    console.error('[API Crawl Job POST Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to start crawl job' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
    }

    // Since we don't pass engineSettings via GET easily, Firecrawl service will use env keys
    // if not provided. Or we could pass API key in headers, but for now we rely on env vars.
    // If the user provided a custom key during POST, the crawler.ts will try to use the last config, 
    // but honestly for a unified polling it's safest to just rely on env or pass it securely.
    // For now we'll just check status.
    
    const statusResult = await checkCrawlJob(jobId);

    // If completed, we extract the links
    let links: string[] = [];
    if (statusResult.status === 'completed' && statusResult.data) {
      // deduplicate links found
      const urlsFound = statusResult.data
        .map((item: any) => item.metadata?.sourceURL || item.url)
        .filter(Boolean);
        
      links = Array.from(new Set(urlsFound));
    }

    return NextResponse.json({
      success: true,
      status: statusResult.status,
      completed: statusResult.completed,
      total: statusResult.total,
      links
    });
  } catch (error: any) {
    console.error('[API Crawl Job GET Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to check crawl job status' },
      { status: 500 }
    );
  }
}
