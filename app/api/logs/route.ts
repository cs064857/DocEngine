import { NextRequest, NextResponse } from 'next/server';

import type { R2Overrides } from '@/lib/r2';
import { listLogFiles, readLogs } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const LOGS_PASSWORD = process.env.LOGS_PASSWORD || '';

function checkPassword(pwd?: string): boolean {
  if (!LOGS_PASSWORD) return true;
  return pwd === LOGS_PASSWORD;
}

function extractR2Overrides(body: Record<string, unknown>): R2Overrides | undefined {
  // Support nested r2: { accountId, accessKeyId, secretAccessKey, bucketName }
  if (body.r2 && typeof body.r2 === 'object' && body.r2 !== null) {
    const r2 = body.r2 as Record<string, string>;
    return {
      accountId: r2.accountId || undefined,
      accessKeyId: r2.accessKeyId || undefined,
      secretAccessKey: r2.secretAccessKey || undefined,
      bucketName: r2.bucketName || undefined,
    };
  }
  // Support flat keys (legacy)
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

/**
 * POST /api/logs
 *
 * Body actions:
 *   - { action: "verify", password } → check password
 *   - { action: "list", password, r2? } → returns available log files
 *   - { action: "logs", password, taskId, stage?, level?, search?, limit?, r2? } → returns log entries
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : 'logs';
  const password = typeof body.password === 'string' ? body.password : undefined;

  // Verify action — just check password, no R2 needed
  if (action === 'verify') {
    if (!checkPassword(password)) {
      return NextResponse.json({ success: false, error: '密碼錯誤' });
    }
    return NextResponse.json({ success: true });
  }

  // All other actions require password
  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const r2 = extractR2Overrides(body);

  // List action — return available log files grouped by task
  if (action === 'list') {
    try {
      const files = await listLogFiles(r2);
      return NextResponse.json({ files });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Logs action — return log entries
  const date = typeof body.date === 'string' ? body.date : undefined;
  const taskId = typeof body.taskId === 'string' ? body.taskId : undefined;
  const phase = typeof body.phase === 'string' ? body.phase : undefined;
  const level = typeof body.level === 'string' ? body.level : undefined;
  const search = typeof body.search === 'string' ? body.search : undefined;
  const limit = Number.isFinite(Number(body.limit)) ? Math.min(Number(body.limit), 5000) : 500;

  try {
    const entries = await readLogs({ date, taskId, limit, r2 });

    // Apply client-side filters
    let filtered = entries;
    if (phase) filtered = filtered.filter((e) => e.phase === phase);
    if (level) filtered = filtered.filter((e) => e.level === level);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((e) =>
        e.message.toLowerCase().includes(q) ||
        (e.phase || '').toLowerCase().includes(q) ||
        (e.meta ? JSON.stringify(e.meta).toLowerCase().includes(q) : false)
      );
    }

    return NextResponse.json({ logs: filtered, count: filtered.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/logs — legacy fallback (requires R2 env vars)
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const password = params.get('password') || '';

  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const action = params.get('action') || 'logs';

  if (action === 'verify') {
    return NextResponse.json({ success: true });
  }

  if (action === 'list') {
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
  const limit = Number.parseInt(params.get('limit') || '500', 10);

  try {
    const entries = await readLogs({ date, taskId, limit });
    return NextResponse.json({ logs: entries, count: entries.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
