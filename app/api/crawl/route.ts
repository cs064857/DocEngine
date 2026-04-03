import { NextRequest, NextResponse } from 'next/server';
import { send } from '@vercel/queue';
import { extractUrls } from '@/lib/processors/url-extractor';
import { putTaskStatus } from '@/lib/r2';
import { generateTaskId, formatDate } from '@/lib/utils/helpers';
import { config } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { input, engineSettings } = body;

    if (!input || typeof input !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid input' }, { status: 400 });
    }

    console.log('[API Crawl] Extracting URLs...');
    
    // We can also let the url extractor use overrides, though less critical than processor.
    // For now assuming extractor just uses default config to save time, but we could add it.
    let urls = await extractUrls(input);

    if (urls.length === 0) {
      return NextResponse.json({ error: 'No valid URLs found in input' }, { status: 400 });
    }

    // Apply max limit
    const hardLimit = engineSettings?.maxUrls ? parseInt(engineSettings.maxUrls) : config.project.maxUrlsLimit;
    if (urls.length > hardLimit) {
      console.warn(`[API Crawl] URLs count (${urls.length}) exceeds limit. Truncating to ${hardLimit}.`);
      urls = urls.slice(0, hardLimit);
    }

    const taskId = generateTaskId();
    const date = formatDate();

    console.log(`[API Crawl] Extracted ${urls.length} URLs. Creating task: ${taskId}`);

    // Create tracking metadata
    await putTaskStatus(taskId, {
      taskId,
      status: 'processing',
      total: urls.length,
      completed: 0,
      failed: 0,
      failedUrls: [],
      date,
    });

    // Send jobs to queue topic 'crawl-urls'
    console.log(`[API Crawl] Sending ${urls.length} messages to Queue...`);
    
    const queuePromises = urls.map(url => {
      // payload structure matches what processor expects
      return send('crawl-urls', { 
        taskId, 
        url, 
        date,
        engineSettings
      });
    });
    
    await Promise.all(queuePromises);
    
    console.log(`[API Crawl] Task ${taskId} started successfully.`);

    return NextResponse.json({
      taskId,
      urlCount: urls.length,
      message: 'Task queued successfully',
      urls: urls,
    });

  } catch (error: unknown) {
    console.error('[API Crawl] Internal Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ 
      error: 'Failed to queue task', 
      details: msg 
    }, { status: 500 });
  }
}
