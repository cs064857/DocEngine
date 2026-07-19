import { getObject, listObjects, putObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  taskId?: string;
  phase?: string;
  message: string;
  meta?: Record<string, unknown>;
}

export type LoggerR2Overrides = R2Overrides & {
  putObject?: (key: string, content: string | Buffer, contentType?: string, r2?: R2Overrides) => Promise<void>;
  getObject?: (key: string, r2?: R2Overrides) => Promise<string>;
  listObjects?: (prefix?: string, limit?: number, r2?: R2Overrides) => Promise<{ Key?: string }[]>;
};

type LogOptions = {
  taskId?: string;
  phase?: string;
  meta?: Record<string, unknown>;
  r2?: LoggerR2Overrides;
};

const GLOBAL_LOG_BUFFER_KEY = '__global__';
const FLUSH_THRESHOLD = 10;
const FLUSH_INTERVAL_MS = 30_000;

const logBuffers = new Map<string, LogEntry[]>();
const logBufferR2Overrides = new Map<string, LoggerR2Overrides>();
const activeFlushes = new Map<string, Promise<void>>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

function getDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getLogKey(taskId?: string): string {
  const date = getDateStr();
  const filename = taskId ? `${taskId}.jsonl` : 'global.jsonl';
  return `logs/${date}/${filename}`;
}

function ensureFlushTimer(): void {
  if (flushTimer) return;

  flushTimer = setInterval(() => {
    flushAllLogs().catch((error) => {
      console.error('[Logger] Periodic flush failed:', error);
    });
  }, FLUSH_INTERVAL_MS);

  flushTimer.unref?.();
}

function getBufferKey(taskId?: string): string {
  return taskId || GLOBAL_LOG_BUFFER_KEY;
}

function getTaskIdFromBufferKey(key: string): string | undefined {
  return key === GLOBAL_LOG_BUFFER_KEY ? undefined : key;
}

function isMissingObjectError(error: unknown): boolean {
  const err = error as Error | undefined;
  return err?.name === 'NoSuchKey' || !!err?.message?.includes('NoSuchKey');
}

async function r2PutObject(
  key: string,
  content: string,
  contentType: string,
  r2?: LoggerR2Overrides
): Promise<void> {
  const put = r2?.putObject || putObject;
  await put(key, content, contentType, r2);
}

async function r2GetObject(key: string, r2?: LoggerR2Overrides): Promise<string> {
  const get = r2?.getObject || getObject;
  return get(key, r2);
}

async function r2ListObjects(prefix: string, limit: number, r2?: LoggerR2Overrides): Promise<{ Key?: string }[]> {
  const list = r2?.listObjects || listObjects;
  return list(prefix, limit, r2);
}

export function log(level: LogLevel, message: string, opts?: LogOptions): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    taskId: opts?.taskId,
    phase: opts?.phase,
    meta: opts?.meta,
  };

  const key = getBufferKey(opts?.taskId);
  const entries = logBuffers.get(key) || [];
  entries.push(entry);
  logBuffers.set(key, entries);

  if (opts?.r2) {
    logBufferR2Overrides.set(key, opts.r2);
  }

  ensureFlushTimer();

  if (entries.length >= FLUSH_THRESHOLD) {
    flushLogs(key, opts?.r2).catch((error) => {
      console.error(`[Logger] Failed to flush logs for ${key}:`, error);
    });
  }
}

export const logger = {
  info: (msg: string, opts?: LogOptions) => log('info', msg, opts),
  warn: (msg: string, opts?: LogOptions) => log('warn', msg, opts),
  error: (msg: string, opts?: LogOptions) => log('error', msg, opts),
  debug: (msg: string, opts?: LogOptions) => log('debug', msg, opts),
};

async function doFlushLogs(key: string, r2?: LoggerR2Overrides): Promise<void> {
  const buffer = logBuffers.get(key);
  if (!buffer || buffer.length === 0) return;

  const entries = buffer.splice(0, buffer.length);
  const taskId = getTaskIdFromBufferKey(key);
  const r2Key = getLogKey(taskId);
  const resolvedR2 = r2 || logBufferR2Overrides.get(key);

  try {
    let existing = '';
    try {
      existing = await r2GetObject(r2Key, resolvedR2);
    } catch (error) {
      if (!isMissingObjectError(error)) {
        throw error;
      }
    }

    const newLines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    await r2PutObject(r2Key, existing + newLines, 'application/x-ndjson', resolvedR2);

    if ((logBuffers.get(key)?.length || 0) === 0) {
      logBufferR2Overrides.delete(key);
    }
  } catch (error) {
    const current = logBuffers.get(key) || [];
    logBuffers.set(key, [...entries, ...current]);
    console.error(`[Logger] Failed to flush logs for ${key}:`, error);
  }
}

async function flushLogs(key: string, r2?: LoggerR2Overrides): Promise<void> {
  const activeFlush = activeFlushes.get(key);
  if (activeFlush) {
    await activeFlush;
    if ((logBuffers.get(key)?.length || 0) > 0) {
      await flushLogs(key, r2);
    }
    return;
  }

  const flush = doFlushLogs(key, r2).finally(() => {
    activeFlushes.delete(key);
  });
  activeFlushes.set(key, flush);
  await flush;
}

export async function flushAllLogs(r2?: LoggerR2Overrides): Promise<void> {
  const keys = Array.from(logBuffers.keys());
  await Promise.allSettled(keys.map((key) => flushLogs(key, r2 || logBufferR2Overrides.get(key))));
}

export async function readLogs(opts: {
  date?: string;
  taskId?: string;
  r2?: LoggerR2Overrides;
  limit?: number;
}): Promise<LogEntry[]> {
  const { date = getDateStr(), taskId, r2 } = opts;
  const limit = Number.isFinite(opts.limit) && opts.limit && opts.limit > 0 ? opts.limit : 500;
  const key = taskId ? `logs/${date}/${taskId}.jsonl` : `logs/${date}/global.jsonl`;

  try {
    const raw = await r2GetObject(key, r2);
    const lines = raw.split('\n').filter(Boolean);
    const entries: LogEntry[] = [];

    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip malformed lines so one corrupt entry does not hide the full log.
      }
    }

    return entries;
  } catch (error) {
    if (isMissingObjectError(error)) {
      return [];
    }
    throw error;
  }
}

export async function listLogFiles(r2?: LoggerR2Overrides): Promise<{ date: string; files: string[] }[]> {
  const objects = await r2ListObjects('logs/', 1000, r2);
  const grouped = new Map<string, string[]>();

  for (const obj of objects) {
    if (!obj.Key) continue;

    const parts = obj.Key.replace(/^logs\//, '').split('/');
    if (parts.length < 2) continue;

    const date = parts[0];
    const filename = parts.slice(1).join('/');
    if (!date || !filename) continue;

    const files = grouped.get(date) || [];
    files.push(filename);
    grouped.set(date, files);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, files]) => ({ date, files: files.sort((a, b) => a.localeCompare(b)) }));
}

export function __clearLogBuffersForTests(): void {
  logBuffers.clear();
  logBufferR2Overrides.clear();
  activeFlushes.clear();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
