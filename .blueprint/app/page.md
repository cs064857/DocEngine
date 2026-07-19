# app/page.tsx

## 職責契約 (Responsibility Contract)

本模組是 DocEngine 的 **單一客戶端前端（Client Shell）**：彙整全部使用者操作面，將設定、任務編排與進度展示集中於一頁五分頁（Tasks / Create / Skill / Storage / Settings）。

**負責**：
- 使用者設定的 localStorage 持久化（`docengineConfig`）
- 爬取三種入口：Scrape / Crawl / Map → 對應後端 API
- 任務輪詢、Drawer 進度、單 URL 重試/中止、R2 下載與單檔清洗
- Skill 產生生命週期：提交、輪詢、中止、歷史、OAuth/API Key 模式
- LLM 連線測試（Cleaner / Extractor / Skill）

**嚴禁**：
- 直接呼叫 Firecrawl / LLM / R2 SDK（一律經由 `/api/*` 或 `lib/services/crawler` 薄封裝）
- 服務端業務決策（限流、key 輪替、佇列派發屬後端）
- 拆成多 route 頁面（刻意 monomorphic SPA-in-page）

## 接口摘要 (Interface Summary)

`export default function DocEngineFrontend()` — 無 props 的 client component。

### 分頁與主要操作（行為契約）

| 操作 | 觸發 API / 服務 | 輸入形狀（概念） | 副作用 |
|------|-----------------|------------------|--------|
| `handleSubmit` | `POST /api/crawl` | `{ input, engineSettings }` | 取得 `taskId`，啟動 3s 輪詢 |
| `handleScrape` | 單 URL → `POST /api/scrape`；多 URL/sitemap → 轉 `handleSubmit` | scrape 參數 + LLM/R2 覆蓋 | 預覽 markdown / 或進佇列 |
| `handleCrawl` | `POST/GET /api/crawl-job` → 完成後 `handleSubmit` | base URL + limit | 探索連結再入隊 |
| `handleMapFetch` | `POST /api/map` | url/search/limit | 將 URL 列表併入 `inputValue` |
| 狀態輪詢 | `GET|POST /api/status/:taskId` | 可選 R2 overrides body | 更新 `taskStatus` |
| 歷史任務 | `GET|POST /api/tasks` | 可選 R2 overrides | 填入 `tasksList` |
| 重試/中止 | `POST /api/retry`、`POST /api/abort` | taskId + urls + engineSettings | 更新重試中集合 |
| 清洗單檔 | `POST /api/clean` | url + date + LLM/R2 | 刷新檔案大小 |
| 下載 | `downloadSingleFile` / `downloadFolderAsZip` | R2 key/prefix + r2Config | 本機下載；空檔標記 failed |
| Skill 提交 | `POST /api/generate-skill` | date/domain/provider/model/auth/R2 | `skillTaskId` + 輪詢 |
| Skill 輪詢/歷史/中止 | `/api/skill-status/:id`、`/api/skill-tasks`、`/api/abort-skill` | R2 overrides | 更新 skill 狀態與歷史 |
| pi 模型表 | `GET /api/pi-models` | 無 | 填入 provider/model 下拉 |
| 設定持久化 | `localStorage.docengineConfig` | 引擎/LLM/R2/Skill 金鑰與參數 | mount 載入、變更寫回 |

### 關鍵狀態域

- **引擎**：sourceType、concurrency/retries/timeout、enableClean、firecrawlKey
- **LLM**：cleaner / urlExtractor 的 key、baseUrl、model、prompt（含預設 RAG 清理提示）
- **R2**：account/access/secret/bucket（可覆寫後端 env）
- **任務**：taskId、taskStatus、drawer、retry/abort 集合
- **Skill**：authMode、provider/model、piProviders、skillTask 生命週期

### 依賴的薄工具（非本檔實作）

- `startCrawlJob` / `checkCrawlJob`（`lib/services/crawler`）— 現況主路徑多直接 `fetch` API
- `buildR2Key`、`download*`、`shouldShowAdvancedEngineSettings*`、`getTaskDisplayDate`、`shouldAutoOpenTaskDrawer`、`isSkillTask*`

## 依賴拓撲 (Dependency Topology)

```
app/layout.tsx
      └── app/page.tsx  ← 本模組（Client Shell / 唯一 UI 編排中心）
              │
              ├── localStorage（docengineConfig）
              │
              ├── 爬取流
              │     POST /api/crawl | scrape | map | crawl-job
              │     POST /api/retry | abort | clean
              │     GET|POST /api/status/:id | /api/tasks | /api/files
              │
              ├── Skill 流
              │     POST /api/generate-skill | abort-skill | skill-status | skill-tasks
              │     GET  /api/pi-models | codex-auth 相關
              │
              └── 共用 lib（本 bundle 外）
                    helpers / download / task-metadata / task-progress-drawer
                    advanced-engine-settings-ui / skill-task-status
                    services/crawler（薄客戶端）
```

與本 bundle 關係：
- 掛在 `layout` 之下，不讀 `lib/config`（後端 env 由 API 使用；前端用 localStorage + 請求體覆蓋）。
- `next.config` 的 body 上限間接支撐本頁大 prompt 提交。
