# GET /api/codex-auth

## 職責契約

**Codex OAuth 登入狀態查詢**的唯讀 HTTP 入口：回傳伺服器端 `auth.json` 是否含有效 `openai-codex` 憑證。

- **做**：呼叫 `checkCodexAuthStatus()` 並 JSON 回傳。
- **不做**：觸發 login/refresh、回傳 token 本體、寫檔、LLM 呼叫。

## 接口摘要

`GET() → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | 無 body / 無 query |
| **Output 成功** | `{ loggedIn: boolean; expires?: number }` |
| **Output 失敗** | `{ error }` status 500 |
| **Side Effect** | 僅讀 auth 檔（經 pi-auth） |

## 依賴拓撲

```
Client（前端登入指示 UI）
  → **GET /api/codex-auth**
  → checkCodexAuthStatus (pi-auth)
  → auth.json
```

Bundle 內：最薄 API，只依賴 `pi-auth`；與 `pi-models`/`test-llm` 無直接耦合。實際取 key 發生在 `pi-llm` → `getCodexApiKey`，不經本 route。
