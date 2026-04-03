import { NextRequest, NextResponse } from 'next/server';
import { listObjects, getObject } from '@/lib/r2';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    
    // If a specific key is requested, return file contents
    if (key) {
      const content = await getObject(key);
      return new NextResponse(content, {
        headers: {
          'Content-Type': key.endsWith('.json') ? 'application/json' : 'text/markdown',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // Otherwise, list files based on prefix
    const prefix = searchParams.get('prefix') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');

    const contents = await listObjects(prefix, limit);
    
    const formattedFiles = contents.map(item => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
    }));

    return NextResponse.json({
      files: formattedFiles
    });
    
  } catch (error: unknown) {
    console.error(`[API Files] Error:`, error);
    const msg = error instanceof Error ? error.message : 'Error occurred retrieving files';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
