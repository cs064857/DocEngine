import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';

/**
 * POST /api/map
 * 透過 Firecrawl Map API 取得目標網域下的所有 URL
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, search, limit, includeSubdomains, firecrawlKey } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid url parameter' },
        { status: 400 }
      );
    }

    // 取得 API Key：優先使用前端傳入值，否則使用環境變數
    const apiKey = firecrawlKey || config.firecrawl.apiKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Firecrawl API Key is required. Set it in environment or provide via UI.' },
        { status: 400 }
      );
    }

    const mapApiUrl = `${config.firecrawl.apiUrl}/v2/map`;

    // 組裝 Firecrawl Map 請求 payload
    const payload: Record<string, unknown> = {
      url,
      limit: limit ? parseInt(limit, 10) : 5000,
      includeSubdomains: includeSubdomains ?? true,
      ignoreQueryParameters: true,
    };
    if (search) {
      payload.search = search;
    }

    console.log(`[API Map] Calling Firecrawl Map for: ${url}`);

    const response = await fetch(mapApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // 處理 Firecrawl 錯誤碼
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Firecrawl Map API error (HTTP ${response.status})`;

      if (response.status === 402) {
        errorMessage = 'Firecrawl API quota exceeded. Please check your plan or billing.';
      } else if (response.status === 429) {
        errorMessage = 'Firecrawl API rate limit reached. Please wait and try again.';
      } else {
        try {
          const errJson = JSON.parse(errorText);
          errorMessage = errJson.error || errJson.message || errorMessage;
        } catch {
          // 保持預設錯誤訊息
        }
      }

      console.error(`[API Map] Firecrawl error: ${response.status} - ${errorText}`);
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const data = await response.json();

    if (!data.success) {
      return NextResponse.json(
        { error: 'Firecrawl Map returned unsuccessful response' },
        { status: 500 }
      );
    }

    // 從 links 陣列中提取 URL 字串
    const urls: string[] = (data.links || []).map(
      (link: { url?: string } | string) =>
        typeof link === 'string' ? link : link.url
    ).filter(Boolean);

    console.log(`[API Map] Successfully mapped ${urls.length} URLs from: ${url}`);

    return NextResponse.json({
      success: true,
      urls,
      count: urls.length,
    });
  } catch (error: unknown) {
    console.error('[API Map] Internal Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to map URLs', details: msg },
      { status: 500 }
    );
  }
}
