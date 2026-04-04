## 職責契約
此模組是 CrawlDocs 首頁的客戶端控制台，負責承接使用者輸入、切換 `scrape / crawl / map` 三種入口模式、管理設定表單、保存本地配置、觸發後端 API，並把即時抓取結果或非同步任務狀態投影到 UI。它只做前端編排與狀態呈現，不在前端真正執行爬取、清洗、URL 抽取或 R2 寫入邏輯。

## 接口摘要
- `CrawlDocsFrontend()`
  - **輸入**：無 props。
  - **輸出**：四分頁單頁控制台：`create`、`tasks`、`storage`、`settings`。
  - **副作用**：讀寫 `localStorage.crawldocsConfig`；根據 `taskId` 啟動輪詢；在 `tasks` 分頁載入歷史任務。
- `JobTask`
  - **資料形狀**：描述任務 `taskId`、`status`、`total/completed/failed`、失敗 URL、重試 URL 與時間戳。
  - **用途**：統一首頁監控板與歷史任務清單的狀態模型。
- `DEFAULT_CLEANING_PROMPT` / `DEFAULT_URL_EXTRACTOR_PROMPT`
  - **輸入**：無。
  - **輸出**：作為內容清洗與 URL 抽取的預設提示詞基線。
  - **副作用**：決定未自訂時送往後端的預設策略。
- `handleSubmit(customInput?)`（UI 內部命令）
  - **輸入**：Sitemap、URL 清單或外部傳入的整理後輸入；並攜帶 engine settings、Cleaner、Extractor、R2 覆蓋配置。
  - **副作用**：POST `/api/crawl` 建立批次任務；清空舊錯誤與舊 task 狀態；寫入新的 `taskId` 供後續監控。
- `handleMapFetch()`（UI 內部命令）
  - **輸入**：`mapUrl`、可選 `search`、`limit` 與 `firecrawlKey`。
  - **副作用**：POST `/api/map`；把返回 URL 清單回填到主輸入框，供後續 `scrape` 或 `crawl` 模式重用。
- `handleScrape()`（UI 內部命令）
  - **輸入**：單一 URL / Sitemap / URL 清單，以及 scrape 細部選項、Cleaner 與 R2 配置。
  - **副作用**：單一 URL 時 POST `/api/scrape` 取得即時預覽；多網址或 Sitemap 時委派給 `handleSubmit()` 走批次佇列流程。
- `handleCrawl()`（UI 內部命令）
  - **輸入**：`crawlUrl`、`crawlLimit`、可選 `firecrawlKey`。
  - **副作用**：先 POST `/api/crawl-job` 建立探索任務，再輪詢同端點取得 `links`，最後把探索結果轉交 `handleSubmit()` 進入批次處理。
- `calculateProgress()`
  - **輸入**：當前 `taskStatus`。
  - **輸出**：監控板所需的完成百分比。

## 依賴拓撲
`next-env.d.ts`（型別基底）
→ `next.config.ts`（框架執行邊界）
→ `app/layout.tsx`（全站文件殼層）
→ `app/page.tsx`（首頁互動與流程編排）

`app/page.tsx` 對外延伸的流程：
- `scrape` 單頁預覽：`app/page.tsx` → `/api/scrape`
- `map` 網址發掘：`app/page.tsx` → `/api/map` → 回填 `inputValue`
- `crawl` 探索轉佇列：`app/page.tsx` → `/api/crawl-job` → `handleSubmit()` → `/api/crawl`
- 任務監控：`app/page.tsx` → `/api/status/[taskId]`
- 歷史任務：`app/page.tsx` → `/api/tasks`

在本 bundle 內，`app/page.tsx` 是唯一承載業務交互的首頁入口；`app/layout.tsx` 只提供殼層，`next.config.ts` 提供框架約束，`next-env.d.ts` 提供型別基座。
