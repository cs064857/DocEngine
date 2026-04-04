import { NextRequest, NextResponse } from 'next/server';
import { listObjects, getObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';

async function handleFilesRequest(request: NextRequest, body?: any) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const prefix = searchParams.get('prefix') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');

    // Extract R2 overrides if passed in body
    const r2Overrides: R2Overrides | undefined = (
      body?.r2AccountId || body?.r2AccessKeyId || body?.r2SecretAccessKey
    ) ? {
      accountId: body.r2AccountId,
      accessKeyId: body.r2AccessKeyId,
      secretAccessKey: body.r2SecretAccessKey,
      bucketName: body.r2BucketName,
    } : undefined;

    // If a specific key is requested, return file contents
    if (key) {
      const content = await getObject(key, r2Overrides);
      return new NextResponse(content, {
        headers: {
          'Content-Type': key.endsWith('.json') ? 'application/json' : 'text/markdown',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    // Otherwise, list files based on prefix
    const contents = await listObjects(prefix, limit, r2Overrides);
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

export async function GET(request: NextRequest) {
  return handleFilesRequest(request);
}

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return handleFilesRequest(request, body);
}
