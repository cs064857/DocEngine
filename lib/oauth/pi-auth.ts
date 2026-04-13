import fs from 'fs';
import path from 'path';
import { getOAuthApiKey } from '@mariozechner/pi-ai/oauth';
import { config } from '@/lib/config';

// 我們假設透過 CLI `npx @mariozechner/pi-ai login openai-codex` 生成的檔案掛載在環境變數配置的路徑
const getAuthFilePath = () => {
  // 對應 Docker 掛載 或 本地開發
  return path.resolve(config.llm.skillGenerator.authJsonPath || './auth.json');
};

/**
 * 從 JSON 檔案讀取憑證
 */
export function getAuthData(): Record<string, any> | null {
  const filePath = getAuthFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[pi-auth] Failed to parse ${filePath}:`, err);
    return null;
  }
}

/**
 * 儲存憑證到 JSON
 */
export function saveAuthData(data: Record<string, any>): void {
  const filePath = getAuthFilePath();
  try {
    // 確保目錄存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[pi-auth] Failed to save ${filePath}:`, err);
  }
}

/**
 * 檢查系統目前是否有有效的 Codex 授權狀態
 */
export function checkCodexAuthStatus(): { loggedIn: boolean; expires?: number } {
  const auth = getAuthData();
  const codexAuth = auth?.['openai-codex'];
  if (!codexAuth) {
    return { loggedIn: false };
  }
  return {
    loggedIn: true,
    expires: codexAuth.expires
  };
}

/**
 * 取得 Codex API Key。
 * 若 token 過期，pi-mono 會嘗試自動 refresh，並回傳 newCredentials。
 * 這個函式負責接住新 credential 並寫回檔案。
 */
export async function getCodexApiKey(): Promise<string> {
  const auth = getAuthData();
  if (!auth) {
    throw new Error('找不到 auth.json。請確保在 VPS 上使用 CLI 登入或正確掛載 Volume。');
  }

  // 取得 API key，這會自動進行 refreshToken 操作（若過期）
  const result = await getOAuthApiKey('openai-codex', auth);
  
  if (!result) {
    throw new Error('無法從 auth.json 解析出 openai-codex 的憑證，或 refresh 失敗');
  }

  // 如果有回傳新的 credential，表示發生了 refresh，我們必須寫回磁碟
  if (result.newCredentials) {
    auth['openai-codex'] = { type: 'oauth', ...result.newCredentials };
    saveAuthData(auth);
    console.log('[pi-auth] Token refreshed and saved successfully.');
  }

  return result.apiKey;
}
