'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { exchangeCodeForToken, saveAuthState } from '@/lib/oauth/codex';

/**
 * OAuth 回調頁面（內部元件）
 *
 * 使用 useSearchParams() 必須包裹在 <Suspense> 中。
 */
function OAuthCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCallback() {
    try {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      // 處理 OAuth 錯誤回調
      if (error) {
        const desc = searchParams.get('error_description') || error;
        throw new Error(`OAuth error: ${desc}`);
      }

      if (!code) {
        throw new Error('No authorization code received');
      }

      // 驗證 state 防 CSRF
      const savedState = sessionStorage.getItem('codex_oauth_state');
      if (state && savedState && state !== savedState) {
        throw new Error('State mismatch — possible CSRF attack');
      }

      // 取回暫存的 code_verifier
      const codeVerifier = sessionStorage.getItem('codex_code_verifier');
      if (!codeVerifier) {
        throw new Error('Missing code_verifier — session may have expired');
      }

      // 組合 redirect URI（與啟動時一致）
      const redirectUri = `${window.location.origin}/oauth/callback`;

      // 交換 token
      const authState = await exchangeCodeForToken(code, codeVerifier, redirectUri);

      // 持久化到 localStorage
      saveAuthState(authState);

      // 通知父視窗
      if (window.opener) {
        window.opener.postMessage(
          { type: 'CODEX_OAUTH_SUCCESS', auth: authState },
          window.location.origin
        );
      }

      setStatus('success');

      // 短暫延遲後自動關閉
      setTimeout(() => {
        window.close();
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[OAuth Callback]', msg);
      setErrorMsg(msg);
      setStatus('error');

      // 通知父視窗失敗
      if (window.opener) {
        window.opener.postMessage(
          { type: 'CODEX_OAUTH_ERROR', error: msg },
          window.location.origin
        );
      }
    }
  }

  return (
    <div className="text-center p-8 max-w-md">
      {status === 'processing' && (
        <>
          <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-zinc-400">正在完成授權...</p>
        </>
      )}
      {status === 'success' && (
        <>
          <div className="text-3xl mb-4">✅</div>
          <p className="text-green-400 font-medium">授權成功！</p>
          <p className="text-zinc-500 text-sm mt-2">視窗即將自動關閉...</p>
        </>
      )}
      {status === 'error' && (
        <>
          <div className="text-3xl mb-4">❌</div>
          <p className="text-red-400 font-medium">授權失敗</p>
          <p className="text-zinc-500 text-sm mt-2">{errorMsg}</p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm"
          >
            關閉視窗
          </button>
        </>
      )}
    </div>
  );
}

/**
 * OAuth 回調頁面（exported default）
 * 包裹 Suspense 以滿足 Next.js 對 useSearchParams 的要求
 */
export default function OAuthCallbackPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
      <Suspense
        fallback={
          <div className="text-center p-8">
            <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-zinc-400">Loading...</p>
          </div>
        }
      >
        <OAuthCallbackContent />
      </Suspense>
    </div>
  );
}
