import { NextRequest, NextResponse } from 'next/server';

import type { R2Overrides } from '@/lib/r2';
import { listLogFiles, readLogs } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const LOGS_PASSWORD = process.env.LOGS_PASSWORD || '';

function checkPassword(req: NextRequest, bodyPwd?: string): boolean {
  if (!LOGS_PASSWORD) return true;

  const headerPwd = req.headers.get('X-Logs-Password') || '';
  const queryPwd = req.nextUrl.searchParams.get('password') || '';
  return headerPwd === LOGS_PASSWORD || queryPwd === LOGS_PASSWORD || bodyPwd === LOGS_PASSWORD;
}

function extractR2Overrides(body: Record<string, unknown>): R2Overrides | undefined {
  if (body.r2AccountId || body.r2AccessKeyId || body.r2SecretAccessKey || body.r2BucketName) {
    return {
      accountId: typeof body.r2AccountId === 'string' ? body.r2AccountId : undefined,
      accessKeyId: typeof body.r2AccessKeyId === 'string' ? body.r2AccessKeyId : undefined,
      secretAccessKey: typeof body.r2SecretAccessKey === 'string' ? body.r2SecretAccessKey : undefined,
      bucketName: typeof body.r2BucketName === 'string' ? body.r2BucketName : undefined,
    };
  }
  return undefined;
}

function parseLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 5000) : 500;
}

/**
 * POST /api/logs
 *
 * Body:
 *   - password?: string (if LOGS_PASSWORD env is set)
 *   - list?: true → returns available log files
 *   - date?: string (YYYY-MM-DD, default: today)
 *   - taskId?: string (filter by task)
 *   - limit?: number (max entries, default 500)
 *   - r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName → R2 overrides
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  if (!checkPassword(req, typeof body.password === 'string' ? body.password : undefined)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const r2 = extractR2Overrides(body);

  if (body.list === true) {
    try {
      const files = await listLogFiles(r2);
      return NextResponse.json({ files });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const date = typeof body.date === 'string' ? body.date : undefined;
  const taskId = typeof body.taskId === 'string' ? body.taskId : undefined;
  const limit = parseLimit(body.limit as string | number | undefined);

  try {
    const entries = await readLogs({ date, taskId, limit, r2 });
    return NextResponse.json({ entries, count: entries.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/logs — legacy fallback (requires R2 env vars to be set)
 */
export async function GET(req: NextRequest) {
  if (!checkPassword(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;

  if (params.get('list') === 'true') {
    try {
      const files = await listLogFiles();
      return NextResponse.json({ files });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const date = params.get('date') || undefined;
  const taskId = params.get('taskId') || undefined;
  const limit = parseLimit(params.get('limit'));

  try {
    const entries = await readLogs({ date, taskId, limit });
    return NextResponse.json({ entries, count: entries.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
