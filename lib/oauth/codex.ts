/**
 * Codex OAuth 2.0 客戶端模組
 *
 * 實現 OpenAI Codex 的 Authorization Code + PKCE 流程。
 * 複用 Codex 官方 Client ID，走 auth.openai.com 授權端點。
 * 全部在前端完成（popup window → redirect → token 交換）。
 */

// Codex 官方 Client ID（與 Codex CLI / Roo Code / term-llm 共用）
export const CODEX_CLIENT_ID = 'app_EMoaYAhJynBYh7WpqFActFGM';

// OpenAI OAuth 端點
export const CODEX_AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize';
export const CODEX_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';

// 預設請求的 scope
export const CODEX_SCOPES = 'openid profile email';

/**
 * OAuth Token 狀態
 */
export interface CodexAuthState {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp (ms)
  tokenType: string;
}

/**
 * 產生 PKCE 所需的 code_verifier 與 code_challenge
 * 使用 Web Crypto API（瀏覽器環境）
 */
export async function generatePKCE(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  // 產生 43-128 字元的隨機 code_verifier
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = base64URLEncode(array);

  // 計算 SHA-256 code_challenge
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = base64URLEncode(new Uint8Array(digest));

  return { codeVerifier, codeChallenge };
}

/**
 * 將 Uint8Array 轉為 URL-safe Base64 字串
 */
function base64URLEncode(buffer: Uint8Array): string {
  let str = '';
  for (let i = 0; i < buffer.length; i++) {
    str += String.fromCharCode(buffer[i]);
  }
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 產生隨機 state 參數（防 CSRF）
 */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

/**
 * 啟動 OAuth 授權流程
 * 開啟 popup window 導向 OpenAI 授權頁面
 */
export async function startOAuthFlow(redirectUri: string): Promise<{
  popup: Window | null;
  state: string;
  codeVerifier: string;
}> {
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = generateState();

  // 將 codeVerifier 暫存（popup 回調時需要）
  sessionStorage.setItem('codex_code_verifier', codeVerifier);
  sessionStorage.setItem('codex_oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: CODEX_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${CODEX_AUTH_ENDPOINT}?${params.toString()}`;

  // 開啟 popup window（居中顯示）
  const width = 500;
  const height = 700;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const popup = window.open(
    authUrl,
    'codex-oauth',
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`
  );

  return { popup, state, codeVerifier };
}

/**
 * 用 authorization code 交換 access token
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<CodexAuthState> {
  const response = await fetch(CODEX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type || 'Bearer',
  };
}

/**
 * 刷新 access token
 */
export async function refreshAccessToken(
  currentRefreshToken: string
): Promise<CodexAuthState> {
  const response = await fetch(CODEX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CODEX_CLIENT_ID,
      refresh_token: currentRefreshToken,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || currentRefreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    tokenType: data.token_type || 'Bearer',
  };
}

/**
 * 檢查 token 是否即將過期（5 分鐘內）
 */
export function isTokenExpiringSoon(auth: CodexAuthState): boolean {
  return Date.now() >= auth.expiresAt - 5 * 60 * 1000;
}

/**
 * 將 auth 狀態持久化到 localStorage
 */
export function saveAuthState(auth: CodexAuthState): void {
  localStorage.setItem('codex_auth', JSON.stringify(auth));
}

/**
 * 從 localStorage 載入 auth 狀態
 */
export function loadAuthState(): CodexAuthState | null {
  const raw = localStorage.getItem('codex_auth');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CodexAuthState;
  } catch {
    return null;
  }
}

/**
 * 清除 auth 狀態（登出）
 */
export function clearAuthState(): void {
  localStorage.removeItem('codex_auth');
  sessionStorage.removeItem('codex_code_verifier');
  sessionStorage.removeItem('codex_oauth_state');
}
