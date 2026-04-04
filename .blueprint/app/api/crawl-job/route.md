# `app/api/crawl-job/route.ts`

## 職責契約
- 此模組是 **Firecrawl 非同步 crawl job 的 HTTP 封裝入口**：負責啟動外部 crawl 工作，或查詢既有 job 的完成狀態並整理可用連結清單。
- 它只處理 `jobId` 與 Firecrawl 狀態，不負責建立本專案的 `taskId`、不寫入 R2 任務狀態，也不執行內容抓取或清洗流程。
- 它可以把外部 crawl 結果收斂為去重後的連結陣列，但**嚴禁**承擔 URL 實際消費、重試與儲存責任；這些屬於 queue worker 與任務狀態鏈路。

## 接口摘要
### `POST(req)`
- **輸入**：JSON body，至少包含 `url`；可選 `limit` 與 `engineSettings.firecrawlApiKey` / `engineSettings.firecrawlApiUrl`。
- **輸出**：成功時回傳 `{ success: true, jobId }`；輸入不合法回 `400`；Firecrawl 啟動失敗回 `500`。
- **副作用**：呼叫 `startCrawlJob` 於 Firecrawl 建立外部非同步 crawl 工作。
- **約束**：`url` 必須為字串；`limit` 會被轉為整數，缺省時使用 100。

### `GET(req)`
- **輸入**：query string `jobId`；可選 `apiKey` 作為 Firecrawl 覆蓋金鑰。
- **輸出**：`{ success, status, completed, total, links }`；缺少 `jobId` 回 `400`；查詢失敗回 `500`。
- **副作用**：向 Firecrawl 查詢 crawl job 狀態；當 job 完成時，將返回資料中的來源 URL 去重後輸出為 `links`。
- **約束**：此接口只暴露狀態摘要與連結清單，不回傳原始 crawl data。

## 依賴拓撲
- `POST /api/crawl-job` → `lib/services/crawler.startCrawlJob` → Firecrawl `asyncCrawlUrl`
- `GET /api/crawl-job` → `lib/services/crawler.checkCrawlJob` → Firecrawl `checkCrawlStatus` → 去重 `links`
- 與本 bundle 其他檔案的關係：
  - **平行但分離**於 `app/api/queues/process-url/route.ts`：兩者都屬非同步流程，但前者管理 **外部 crawl job**，後者處理 **內部 queue 單筆 URL 任務**。
  - **不寫入** `tasks/{taskId}.json`，因此 `app/api/status/[taskId]/route.ts` 與 `app/api/tasks/route.ts` 不直接讀取它的結果。
  - 更像是「網址發現/候選集生成」支線，而不是本專案任務看板的狀態來源。
