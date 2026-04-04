# `app/api/queues/process-url/route.ts`

## 職責契約

- 此模組是 **Vercel Queue 的單筆 URL worker 入口**：接收 `taskId + url + engineSettings` 訊息後，串接抓取、清洗、R2 儲存與任務狀態回寫。
- 它的責任邊界是「處理一個 URL」，而不是抽取 URL 清單、建立整體任務、提供查詢接口，或決定前端如何輪詢。
- 它同時承擔失敗重試協定：在非最終失敗時記錄 retrying 狀態並要求 queue 重新投遞；在最終失敗時落地為任務失敗統計。

## 接口摘要

### `POST(message, metadata)`

- **輸入**：`CrawlJobPayload`，核心欄位為 `taskId`、`url`、`date`；`engineSettings` 可覆蓋 Firecrawl、LLM Cleaner、R2、超時與最大重試次數。
- **輸出**：無直接 HTTP 業務回應。
- **副作用**：
  - **標記處理中**：呼叫 `markUrlProcessing` 更新 R2 狀態，避免 pending 卡住。
  - **超時包裝**：使用 `withTimeout` 包裹整體流程，超時則拋出錯誤。
  - **流程執行**：呼叫 `scrapeUrl` 抓取並寫入 R2（raw/cleaned）。
  - **狀態統計**：更新任務總體進度。
- **約束**：
  - `enableClean !== false` 且原始內容非空時執行 LLM 清洗。
  - 超時時間由 `engineSettings.urlTimeout` 決定（預設 300s）。

## 依賴拓撲

- Queue producer（`/api/crawl`，bundle 外）→ **`/api/queues/process-url`** → `lib/services/crawler.scrapeUrl`
- **`/api/queues/process-url`** → `lib/processors/cleaner.cleanContent`（可選）
- **`/api/queues/process-url`** → `lib/utils/helpers.buildR2Key` → `lib/r2.putObject`
- **`/api/queues/process-url`** → `lib/r2.getTaskStatus` / `putTaskStatus` → `tasks/{taskId}.json`
- 與本 bundle 其他檔案的關係：
  - 它是 `app/api/status/[taskId]/route.ts` 與 `app/api/tasks/route.ts` 的**主要寫端**；後兩者讀取的任務進度、失敗清單、重試資訊都來自此模組的回寫結果。
  - 它與 `app/api/crawl-job/route.ts` 同樣屬非同步管線，但兩者不共享狀態模型：本檔案落地到 R2 任務檔，`crawl-job` 則維持 Firecrawl job 狀態。
