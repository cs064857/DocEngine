# lib/oauth/pi-auth.ts

## 職責契約

本模組是 **Codex OAuth 憑證的伺服器端唯一讀寫層**：從 `config.llm.skillGenerator.authJsonPath`（預設 `./auth.json`）讀寫 pi-ai CLI 產生的憑證 JSON，並在 token 過期時接住 `getOAuthApiKey` 回傳的 `newCredentials` 寫回磁碟。

- **做**：解析 auth 檔路徑、讀/寫 JSON、查 Codex 登入狀態、取得/刷新 Codex API Key。
- **不做**：發起 LLM 呼叫、處理多 provider 選型、暴露完整 auth 內容給前端、執行 CLI login 流程本身。

## 接口摘要

| 符號 | 形狀 | 副作用 / 約束 |
|------|------|----------------|
| `getAuthData()` | `→ Record<string, any> \| null` | 讀 `auth.json`；不存在或 parse 失敗回 `null` |
| `saveAuthData(data)` | `void` | 寫檔；必要時 `mkdir -p` 父目錄 |
| `checkCodexAuthStatus()` | `→ { loggedIn: boolean; expires?: number }` | 僅檢 `auth['openai-codex']` 是否存在 |
| `getCodexApiKey()` | `→ Promise<string>` | 動態 import `@mariozechner/pi-ai/oauth`；有 `newCredentials` 時寫回檔案 |

路徑解析：絕對路徑直用；相對路徑以 `process.cwd()` 拼接（`turbopackIgnore` 避免整庫被 trace）。

## 依賴拓撲

```
config.llm.skillGenerator.authJsonPath
        │
        ▼
  **pi-auth** ──► fs (auth.json) + @mariozechner/pi-ai/oauth
        │
        ├── checkCodexAuthStatus ──► GET /api/codex-auth（本 bundle）
        └── getCodexApiKey ────────► pi-llm.piComplete（provider=openai-codex 且無 apiKey）
```

Bundle 內：下層被 `pi-llm` 與 `codex-auth` 消費；不依賴 `llm.ts`（OpenAI-compatible 直連路徑）。
