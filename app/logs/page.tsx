'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = '';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  taskId?: string;
  phase?: string;
  message: string;
  meta?: Record<string, unknown>;
}

interface LogFileGroup {
  date: string;
  files: string[];
}

const R2_CREDS_KEY = 'docengineConfig';

function loadR2Creds(): { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string } | null {
  try {
    const raw = localStorage.getItem(R2_CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.r2AccountId && parsed.r2AccessKeyId && parsed.r2SecretAccessKey && parsed.r2BucketName) {
      return {
        accountId: parsed.r2AccountId,
        accessKeyId: parsed.r2AccessKeyId,
        secretAccessKey: parsed.r2SecretAccessKey,
        bucketName: parsed.r2BucketName,
      };
    }
  } catch { /* ignore */ }
  return null;
}

export default function LogsPage() {
  const [password, setPassword] = useState('');
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState('');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFileGroups, setLogFileGroups] = useState<LogFileGroup[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [filterPhase, setFilterPhase] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [searchText, setSearchText] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState('');
  const [r2Ready, setR2Ready] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check R2 credentials on mount
  useEffect(() => {
    const creds = loadR2Creds();
    if (!creds) {
      setR2Ready(false);
    }
  }, []);

  // Verify password
  const handleLogin = async () => {
    setAuthError('');
    try {
      const creds = loadR2Creds();
      if (!creds) {
        setAuthError('R2 憑證未設定。請先到主頁設定 R2 帳戶資訊。');
        return;
      }
      const res = await fetch(`${API_BASE}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          password,
          r2: creds,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsAuthed(true);
        sessionStorage.setItem('logs_password', password);
      } else {
        setAuthError(data.error || '密碼錯誤');
      }
    } catch (e) {
      setAuthError(`驗證失敗: ${e instanceof Error ? e.message : '未知錯誤'}`);
    }
  };

  // Fetch log file list
  const fetchLogFiles = useCallback(async () => {
    try {
      const creds = loadR2Creds();
      if (!creds) return;
      const res = await fetch(`${API_BASE}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          password,
          r2: creds,
        }),
      });
      const data = await res.json();
      if (data.files) {
        setLogFileGroups(data.files);
        // Auto-select first task file
        if (!selectedTaskId && data.files.length > 0 && data.files[0].files.length > 0) {
          const firstGroup = data.files[0];
          const firstFile = firstGroup.files.find((f: string) => f !== 'global.jsonl') || firstGroup.files[0];
          const taskId = firstFile.replace('.jsonl', '');
          setSelectedTaskId(taskId);
          setSelectedDate(firstGroup.date);
        }
      }
    } catch (e) {
      console.error('Failed to fetch log files:', e);
    }
  }, [password, selectedTaskId]);

  // Fetch logs for selected task
  const fetchLogs = useCallback(async () => {
    if (!selectedTaskId) return;
    try {
      const creds = loadR2Creds();
      if (!creds) return;

      const res = await fetch(`${API_BASE}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'logs',
          password,
          taskId: selectedTaskId,
          date: selectedDate || undefined,
          phase: filterPhase || undefined,
          level: filterLevel || undefined,
          search: searchText || undefined,
          r2: creds,
        }),
      });
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
        setError('');
        // Auto-scroll to bottom
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 50);
      } else if (data.error) {
        setError(data.error);
      }
    } catch (e) {
      setError(`Failed to fetch logs: ${e instanceof Error ? e.message : '未知錯誤'}`);
    }
  }, [selectedTaskId, password, filterPhase, filterLevel, searchText]);

  // Auto-refresh
  useEffect(() => {
    if (!isAuthed) return;
    fetchLogFiles();
    fetchLogs();
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchLogFiles();
        fetchLogs();
      }, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isAuthed, autoRefresh, fetchLogFiles, fetchLogs]);

  // Auto-login from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('logs_password');
    if (saved) {
      setPassword(saved);
      // Try auto-login
      const creds = loadR2Creds();
      if (creds) {
        fetch(`${API_BASE}/api/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify', password: saved, r2: creds }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.success) setIsAuthed(true);
          })
          .catch(() => { /* ignore */ });
      }
    }
  }, []);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return '#ef4444';
      case 'warn': return '#f59e0b';
      case 'info': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  const getPhaseColor = (stage: string) => {
    const colors: Record<string, string> = {
      'skill-pipeline': '#8b5cf6',
      'crawl': '#06b6d4',
      'clean': '#10b981',
      'generate': '#f59e0b',
      'refine': '#ec4899',
      'fetch': '#6366f1',
      'api': '#14b8a6',
      'root': '#64748b',
    };
    return colors[stage] || '#6b7280';
  };

  // R2 未設定提示
  if (!r2Ready) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '40px', maxWidth: 480, textAlign: 'center', border: '1px solid #334155' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: '#f1f5f9' }}>R2 憑證未設定</h2>
          <p style={{ color: '#94a3b8', lineHeight: 1.6, marginBottom: 24 }}>
            請先到主頁設定 Cloudflare R2 帳戶資訊（Account ID、Access Key、Secret Key、Bucket Name），
            然後返回此頁面查看日誌。
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '10px 24px',
              background: '#3b82f6',
              color: '#fff',
              borderRadius: 8,
              fontWeight: 600,
              textDecoration: 'none',
              transition: 'background 0.2s',
            }}
          >
            前往主頁設定
          </a>
        </div>
      </div>
    );
  }

  // Login screen
  if (!isAuthed) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '40px', maxWidth: 400, width: '100%', border: '1px solid #334155' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign: 'center', color: '#f1f5f9' }}>
            🔐 DocEngine Logs
          </h1>
          <p style={{ color: '#94a3b8', textAlign: 'center', marginBottom: 24, fontSize: 14 }}>
            請輸入日誌查看密碼
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Password"
            style={{
              width: '100%',
              padding: '12px 16px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#e2e8f0',
              fontSize: 14,
              marginBottom: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleLogin}
            style={{
              width: '100%',
              padding: '12px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            登入
          </button>
          {authError && (
            <p style={{ color: '#ef4444', marginTop: 12, fontSize: 13, textAlign: 'center' }}>{authError}</p>
          )}
        </div>
      </div>
    );
  }

  // Main logs view
  const uniquePhases = [...new Set(logs.map((l) => l.phase))];
  // Flatten file groups to extract task IDs (filter out global.jsonl)
  const allTaskFiles = logFileGroups.flatMap((g) =>
    g.files.filter((f) => f !== 'global.jsonl').map((f) => ({
      date: g.date,
      taskId: f.replace('.jsonl', ''),
    }))
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>📋 DocEngine Logs</h1>
          <a href="/" style={{ color: '#64748b', fontSize: 13, textDecoration: 'none' }}>← 返回主頁</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Task selector */}
          <select
            value={selectedTaskId}
            onChange={(e) => {
              const taskId = e.target.value;
              setSelectedTaskId(taskId);
              // Find the date for this task
              const match = allTaskFiles.find((t) => t.taskId === taskId);
              if (match) setSelectedDate(match.date);
            }}
            style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13 }}
          >
            <option value="">選擇任務</option>
            {allTaskFiles.map((t) => (
              <option key={`${t.date}-${t.taskId}`} value={t.taskId}>{t.taskId} ({t.date})</option>
            ))}
          </select>
          {/* Stage filter */}
          <select
            value={filterPhase}
            onChange={(e) => setFilterPhase(e.target.value)}
            style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13 }}
          >
            <option value="">全部 Phase</option>
            {uniquePhases.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* Level filter */}
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13 }}
          >
            <option value="">全部 Level</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          {/* Search */}
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="🔍 搜尋日誌..."
            style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, width: 160 }}
          />
          {/* Auto-refresh toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            自動刷新
          </label>
          <button
            onClick={() => { fetchLogFiles(); fetchLogs(); }}
            style={{ padding: '6px 12px', background: '#334155', border: '1px solid #475569', borderRadius: 6, color: '#e2e8f0', fontSize: 13, cursor: 'pointer' }}
          >
            ↻ 刷新
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: '#7f1d1d', padding: '8px 24px', fontSize: 13, color: '#fca5a5' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Logs */}
      <div
        ref={scrollRef}
        style={{
          padding: '16px 24px',
          maxHeight: 'calc(100vh - 60px)',
          overflowY: 'auto',
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: '#64748b', textAlign: 'center', marginTop: 48 }}>
            {selectedTaskId ? '暫無日誌' : '請選擇一個任務查看日誌'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 56px 140px 1fr',
                  gap: 12,
                  padding: '6px 12px',
                  background: log.level === 'error' ? '#1c1017' : log.level === 'warn' ? '#1c1707' : 'transparent',
                  borderRadius: 4,
                  fontSize: 13,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: '#64748b' }}>{log.timestamp}</span>
                <span style={{ color: getLevelColor(log.level), fontWeight: 600 }}>{log.level.toUpperCase()}</span>
                <span style={{ color: getPhaseColor(log.phase || '') }}>[{log.phase || '-'}]</span>
                <span style={{ color: '#e2e8f0', wordBreak: 'break-word' }}>
                  {log.message}
                  {log.meta && (
                    <span style={{ color: '#64748b', marginLeft: 8, fontSize: 12 }}>
                      {JSON.stringify(log.meta)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
