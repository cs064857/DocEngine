# POST /api/test-llm

## 職責契約

**LLM 連線探測** HTTP 入口：以固定短 prompt（回覆單字 `OK`）驗證使用者填入的憑證/端點是否可用，並回傳延遲與預覽。

- **做**：參數分流兩條執行路徑、60s 超時 race、回傳 success/latency/preview。
- **不做**：業務清理/skill 產生、持久化設定、OAuth login UI（僅間接經 pi-llm 取 Codex key）。

## 接口摘要

`POST(req) → NextResponse`；`maxDuration = 60`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ apiKey?, baseUrl?, model?, provider?, modelId? }` |
| **分流** | 有 `provider` → **Skill 路徑** `piComplete`；否則 → **Cleaner 路徑** `chatCompletion`（apiKey+baseUrl 必填） |
| **校驗** | 缺 `model` 且缺 `modelId` → 400；cleaner 路徑缺 key/baseUrl → 400 |
| **Output 成功** | `{ success: true, latencyMs, model, preview }`（preview 截 100 字） |
| **Output 失敗** | `{ success: false, error, latencyMs }`（catch 內仍 200 JSON，非硬 5xx） |
| **Side Effect** | 實際打外部 LLM（一次短請求） |

測試 prompt：`Reply with exactly one word: "OK"`；temperature=0；pi 路徑 maxTokens=10。

## 依賴拓撲

```
Client「測試連線」按鈕
  → **POST /api/test-llm**
        ├── provider 有 ──► piComplete (pi-llm) ──► pi-auth? / pi-ai
        └── provider 無 ──► chatCompletion (llm) ──► OpenAI-compatible fetch
```

Bundle 內：**雙路徑匯合點**——同時依賴 `llm` 與 `pi-llm`，驗證兩套 LLM 適配層是否可用；不直接碰 `pi-auth`/`pi-models`。
