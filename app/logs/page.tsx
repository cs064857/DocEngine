"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { LogEntry, LogLevel } from '@/lib/logger';

type LogFileGroup = { date: string; files: string[] };
type LevelFilter = LogLevel | 'all';

const STORAGE_KEY = 'docengine.logs.password';
const R2_STORAGE_KEY = 'docengine.logs.r2';
const LEVELS: LevelFilter[] = ['all', 'info', 'warn', 'error', 'debug'];

const levelStyles: Record<LogLevel, string> = {
  info: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  warn: 'border-amber-400/50 bg-amber-400/10 text-amber-200',
  error: 'border-rose-400/50 bg-rose-400/10 text-rose-200',
  debug: 'border-violet-400/40 bg-violet-400/10 text-violet-200',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fileToTaskId(file: string): string | undefined {
  if (!file || file === 'global.jsonl') return undefined;
  return file.replace(/\.jsonl$/, '');
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

interface R2Config {
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
}

export default function LogsPage() {
  const [password, setPassword] = useState('');
  const [date, setDate] = useState(today());
  const [selectedFile, setSelectedFile] = useState('global.jsonl');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [files, setFiles] = useState<LogFileGroup[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showR2Config, setShowR2Config] = useState(false);
  const [r2, setR2] = useState<R2Config>({ r2AccountId: '', r2AccessKeyId: '', r2SecretAccessKey: '', r2BucketName: '' });

  // Load saved password
  useEffect(() => {
    setPassword(sessionStorage.getItem(STORAGE_KEY) || '');
  }, []);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, password);
  }, [password]);

  // Load saved R2 config
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(R2_STORAGE_KEY);
      if (saved) setR2(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(R2_STORAGE_KEY, JSON.stringify(r2));
  }, [r2]);

  const hasR2Overrides = Boolean(r2.r2AccountId || r2.r2AccessKeyId || r2.r2SecretAccessKey || r2.r2BucketName);

  const buildBody = useCallback((extra?: Record<string, unknown>) => {
    const body: Record<string, unknown> = { ...extra };
    if (password) body.password = password;
    if (r2.r2AccountId) body.r2AccountId = r2.r2AccountId;
    if (r2.r2AccessKeyId) body.r2AccessKeyId = r2.r2AccessKeyId;
    if (r2.r2SecretAccessKey) body.r2SecretAccessKey = r2.r2SecretAccessKey;
    if (r2.r2BucketName) body.r2BucketName = r2.r2BucketName;
    return body;
  }, [password, r2]);

  const filesForDate = useMemo(() => files.find((group) => group.date === date)?.files || [], [date, files]);

  const loadFiles = useCallback(async () => {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody({ list: true })),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Failed to list log files');
    }

    const nextFiles = Array.isArray(data.files) ? data.files as LogFileGroup[] : [];
    setFiles(nextFiles);

    if (nextFiles.length > 0 && !nextFiles.some((group) => group.date === date)) {
      setDate(nextFiles[0].date);
    }
  }, [date, buildBody]);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const taskId = fileToTaskId(selectedFile);
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody({ date, taskId, limit: 500 })),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load logs');
      }

      setEntries(Array.isArray(data.entries) ? data.entries as LogEntry[] : []);
    } catch (err: unknown) {
      setEntries([]);
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setIsLoading(false);
    }
  }, [date, buildBody, selectedFile]);

  const refreshAll = useCallback(async () => {
    setError('');
    try {
      await loadFiles();
      await loadEntries();
    } catch (err: unknown) {
      setEntries([]);
      setError(err instanceof Error ? err.message : 'Failed to refresh logs');
    }
  }, [loadEntries, loadFiles]);

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, selectedFile]);

  useEffect(() => {
    if (filesForDate.length === 0) {
      setSelectedFile('global.jsonl');
      return;
    }

    if (!filesForDate.includes(selectedFile)) {
      setSelectedFile(filesForDate.includes('global.jsonl') ? 'global.jsonl' : filesForDate[0]);
    }
  }, [filesForDate, selectedFile]);

  useEffect(() => {
    if (!autoRefresh) return;

    const timer = setInterval(() => {
      refreshAll();
    }, 5000);

    return () => clearInterval(timer);
  }, [autoRefresh, refreshAll]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();

    return entries.filter((entry) => {
      if (level !== 'all' && entry.level !== level) return false;
      if (!query) return true;

      const haystack = [
        entry.timestamp,
        entry.level,
        entry.taskId,
        entry.phase,
        entry.message,
        entry.meta ? JSON.stringify(entry.meta) : '',
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [entries, level, search]);

  async function copyEntry(entry: LogEntry, index: number): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex(null), 1200);
  }

  return (
    <main className="min-h-screen bg-[#050507] text-zinc-100">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-amber-500/15 blur-3xl" />
        <div className="absolute right-0 top-32 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/" className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300/80">DocEngine</Link>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Logs Console</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">Read JSONL task logs stored in R2. Configure R2 credentials from the main page or below.</p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 shadow-2xl shadow-black/30">
            <span className={`h-2.5 w-2.5 rounded-full ${error ? 'bg-rose-400' : 'bg-emerald-400'}`} />
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Status</div>
              <div className="text-sm font-medium text-zinc-200">{error || `${filteredEntries.length} visible entries`}</div>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-5 py-6 lg:grid-cols-[360px_1fr]">
          <aside className="h-fit rounded-3xl border border-white/10 bg-zinc-950/80 p-5 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="LOGS_PASSWORD"
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/10"
                />
              </div>

              {/* R2 Config Toggle */}
              <button
                type="button"
                onClick={() => setShowR2Config((v) => !v)}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/20"
              >
                <span>R2 Credentials {hasR2Overrides && <span className="text-emerald-400">●</span>}</span>
                <span className="text-zinc-500">{showR2Config ? '▲' : '▼'}</span>
              </button>

              {showR2Config && (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Account ID</label>
                    <input
                      type="text"
                      value={r2.r2AccountId}
                      onChange={(event) => setR2((prev) => ({ ...prev, r2AccountId: event.target.value }))}
                      placeholder="R2_ACCOUNT_ID"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-amber-300/60"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Access Key ID</label>
                    <input
                      type="text"
                      value={r2.r2AccessKeyId}
                      onChange={(event) => setR2((prev) => ({ ...prev, r2AccessKeyId: event.target.value }))}
                      placeholder="R2_ACCESS_KEY_ID"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-amber-300/60"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Secret Access Key</label>
                    <input
                      type="password"
                      value={r2.r2SecretAccessKey}
                      onChange={(event) => setR2((prev) => ({ ...prev, r2SecretAccessKey: event.target.value }))}
                      placeholder="R2_SECRET_ACCESS_KEY"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-amber-300/60"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Bucket Name</label>
                    <input
                      type="text"
                      value={r2.r2BucketName}
                      onChange={(event) => setR2((prev) => ({ ...prev, r2BucketName: event.target.value }))}
                      placeholder="crawldocs"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none focus:border-amber-300/60"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/10"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Level</label>
                  <select
                    value={level}
                    onChange={(event) => setLevel(event.target.value as LevelFilter)}
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/10"
                  >
                    {LEVELS.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Task File</label>
                <select
                  value={selectedFile}
                  onChange={(event) => setSelectedFile(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/10"
                >
                  {filesForDate.length === 0 ? (
                    <option value="global.jsonl">global.jsonl</option>
                  ) : filesForDate.map((file) => (
                    <option key={file} value={file}>{file}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Search</label>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="message, phase, taskId, metadata"
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/60 focus:ring-2 focus:ring-amber-300/10"
                />
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-white">Auto refresh</div>
                  <div className="text-xs text-zinc-500">Every 5 seconds</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoRefresh((value) => !value)}
                  className={`relative h-7 w-12 rounded-full transition ${autoRefresh ? 'bg-amber-400' : 'bg-zinc-700'}`}
                  aria-pressed={autoRefresh}
                >
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${autoRefresh ? 'left-6' : 'left-1'}`} />
                </button>
              </div>

              <button
                type="button"
                onClick={refreshAll}
                disabled={isLoading}
                className="w-full rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-sm font-bold text-black shadow-lg shadow-amber-500/20 transition hover:from-amber-400 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? 'Loading logs...' : 'Refresh Logs'}
              </button>
            </div>
          </aside>

          <section className="min-h-[640px] rounded-3xl border border-white/10 bg-zinc-950/75 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">{date} / {selectedFile}</div>
                <div className="mt-1 text-xs text-zinc-500">Showing newest 500 entries before filters.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {LEVELS.filter((item): item is LogLevel => item !== 'all').map((item) => (
                  <span key={item} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${levelStyles[item]}`}>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="max-h-[calc(100vh-210px)] space-y-3 overflow-y-auto p-4 custom-scrollbar">
              {filteredEntries.length === 0 ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-black/20 px-6 text-center">
                  <div className="text-lg font-semibold text-white">No log entries found</div>
                  <p className="mt-2 max-w-md text-sm text-zinc-500">Check the password, R2 credentials, date, task file, or filters. New logs are written after the worker flushes its buffer.</p>
                </div>
              ) : filteredEntries.map((entry, index) => (
                <article key={`${entry.timestamp}-${index}`} className="group rounded-2xl border border-white/10 bg-black/35 p-4 transition hover:border-white/20 hover:bg-white/[0.04]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${levelStyles[entry.level]}`}>
                          {entry.level}
                        </span>
                        {entry.phase && <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-300">{entry.phase}</span>}
                        {entry.taskId && <span className="max-w-full truncate rounded-full border border-white/10 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-400">{entry.taskId}</span>}
                      </div>
                      <p className="mt-3 break-words text-sm font-medium leading-6 text-zinc-100">{entry.message}</p>
                      {entry.meta && Object.keys(entry.meta).length > 0 && (
                        <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-xs leading-5 text-zinc-300 custom-scrollbar">
                          {JSON.stringify(entry.meta, null, 2)}
                        </pre>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3 text-xs text-zinc-500 md:flex-col md:items-end">
                      <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
                      <button
                        type="button"
                        onClick={() => copyEntry(entry, index)}
                        className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-amber-300/60 hover:text-amber-200"
                      >
                        {copiedIndex === index ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
