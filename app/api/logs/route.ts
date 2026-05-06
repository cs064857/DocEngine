import { NextRequest, NextResponse } from 'next/server';

import { listLogFiles, readLogs } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const LOGS_PASSWORD = process.env.LOGS_PASSWORD || '';

function checkPassword(req: NextRequest): boolean {
  if (!LOGS_PASSWORD) return true;

  const headerPwd = req.headers.get('X-Logs-Password') || '';
  const queryPwd = req.nextUrl.searchParams.get('password') || '';
  return headerPwd === LOGS_PASSWORD || queryPwd === LOGS_PASSWORD;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value || '500', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 5000) : 500;
}

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
