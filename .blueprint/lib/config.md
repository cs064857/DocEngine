# lib/config.ts

## 職責契約 (Responsibility Contract)

本模組是後端/服務層的 **唯一環境變數彙總點（Server Config Facade）**。它只做：從 `process.env` 解析、給預設值、正規化成結構化 `config` 物件。

**負責**：
- Firecrawl：單/多 API Key、API URL、每 key 速率、預設 RPM、冷卻秒數
- LLM 三子系統預設：urlExtractor / contentCleaner / skillGenerator（含 pi auth 路徑）
- R2 預設憑證與 bucket
- 專案級上限：`maxUrlsLimit`、`retryAttempts`

**嚴禁**：
- 發起 HTTP、寫檔、持有連線
- 前端讀取（本檔依賴 `process.env`，僅供 server/lib 使用）
- 業務決策（誰該用哪個 key、何時重試——那是 key-manager / dispatch 的事）

## 接口摘要 (Interface Summary)

`export const config` — 唯讀結構化設定。

| 命名空間 | 關鍵欄位 | 來源 env（概念） | 預設/行為 |
|----------|----------|------------------|-----------|
| `firecrawl` | `apiKey`, `apiKeys[]`, `apiUrl`, `keyRates`, `defaultRatePerMinute`, `rateLimitCooldownSeconds` | `FIRECRAWL_API_KEY(S)`, `FIRECRAWL_API_URL`, `FIRECRAWL_KEY_RATES`, `FIRECRAWL_*_RATE*` | 多 key 去重合併；URL 預設 firecrawl.dev；RPM 預設 10；冷卻 60s |
| `llm.urlExtractor` | baseUrl, apiKey, model | `URL_EXTRACTOR_*` | DeepSeek 相容預設 |
| `llm.contentCleaner` | baseUrl, apiKey, model | `CONTENT_CLEANER_*` | 智譜 GLM 預設 |
| `llm.skillGenerator` | provider, modelId, apiKey, authJsonPath, baseUrl | `SKILL_GENERATOR_*`, `PI_AUTH_JSON_PATH` | openai/gpt-4o；auth 路徑 `./auth.json` |
| `r2` | accountId, accessKeyId, secretAccessKey, bucketName | `R2_*` | bucket 預設 `crawldocs` |
| `project` | maxUrlsLimit, retryAttempts | `MAX_URLS_LIMIT`, `RETRY_ATTEMPTS` | 1000 / 3 |

內部私有解析（不 export）：
- `parseCsvEnv` — CSV → string[]
- `parsePositiveInteger` — 正整數或 fallback
- `parseFirecrawlKeyRates` — `key:rate` CSV → `Record<string, number>`

## 依賴拓撲 (Dependency Topology)

```
process.env
      │
      ▼
lib/config.ts  ← 本模組
      │
      ├──→ lib/services/*（crawler、dispatch、firecrawl-key-manager、llm、pi-llm…）
      ├──→ lib/r2.ts / processors/*
      └──→ app/api/**/route.ts（後端預設值；請求體可覆寫）

前端 app/page.tsx ──不直接依賴──→ config
（前端用 localStorage + 請求 engineSettings/R2 overrides 覆寫後端預設）
```

與本 bundle 關係：與 `next.config` 正交（業務 env vs 框架設定）；為整站 server 側預設值來源，`layout`/`page` 不 import 本檔。
