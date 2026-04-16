# Queue callback 與 dispatch fallback 策略

本頁只討論 batch crawl 任務進入執行階段後的「工作投遞與失敗轉向」：`/api/crawl` 與 `/api/retry` 如何把 `CrawlJobPayload` 送往 `crawl-urls` topic、什麼情況會放棄背景 queue 改走 inline、以及 queue callback 與 inline fallback 最終如何共用同一個 `processCrawlJob()`。單一 URL 抓取細節雖然會被提到，但完整的抓取/清洗內容處理仍屬下一頁的執行工作流範圍。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L59-L98), [retry route.ts](../../../app/api/retry/route.ts#L30-L109), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L78-L114), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L259)

## 核心流程總覽

```mermaid
flowchart TD
  A[/api/crawl 或 /api/retry/] --> B[dispatchCrawlJobs]
  B --> C{可用背景 queue?}
  C -->|否| D[processCrawlJobsInline]
  C -->|是| E[@vercel/queue send('crawl-urls')]
  E --> F{送出途中碰到 queue unavailable?}
  F -->|否| G[/api/queues/process-url callback/]
  F -->|是| H[剩餘 jobs 改走 inline]
  G --> I[processCrawlJob(message, deliveryCount)]
  D --> I
  H --> I
  I --> J[mark processing]
  J --> K[scrapeUrl -> put raw -> clean -> put cleaned]
  K --> L{成功?}
  L -->|是| M[updateTaskStatus success]
  L -->|否| N[log retry or mark failed]
```

這張圖的重點是「delivery mechanism 與 execution logic 分離」：`dispatchCrawlJobs()` 只決定送 queue、直接 inline，或先 queue 後 inline 補跑；真正的 URL 執行永遠收斂到 `processCrawlJob()`，而 queue callback route 本身只是 `handleCallback()` 的薄封裝，唯一額外責任是把錯誤交給 `getCrawlRetryDirective()` 產生下次 delivery 指令。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L78-L114), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L259), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14)

## Dispatch 決策矩陣

| 入口/情境 | 判斷條件 | 實際行為 | 回傳模式 | 證據 |
|---|---|---|---|---|
| `/api/crawl` 建立新 task | URL 清單建立後直接呼叫 `dispatchCrawlJobs()` | 建完 `tasks/{taskId}.json` 後派送每個 URL job | `queue` / `inline` / `mixed` | [crawl route.ts](../../../app/api/crawl/route.ts#L59-L98) |
| `/api/retry` 重跑既有 task | 重設 task 狀態後再次呼叫 `dispatchCrawlJobs()` | 沿用同一套派送策略，不另開第二條 worker 管線 | `queue` / `inline` / `mixed` | [retry route.ts](../../../app/api/retry/route.ts#L44-L109) |
| runtime 不支援背景 queue | `canUseBackgroundQueue()` 只接受 `NODE_ENV === 'development'` 或 `VERCEL === '1'` | 整批 jobs 直接進 `processCrawlJobsInline()` | `inline` | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L56-L64), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L82-L89) |
| queue 送出途中遇到不可用錯誤 | 錯誤訊息命中 OIDC / 非 Vercel Function / project root / `vercel env pull` / `vc link` 片段 | 把尚未送出的剩餘 jobs 轉成 inline 補跑 | `inline` 或 `mixed` | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L66-L76), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L91-L110) |
| queue 全部送出成功 | 每筆 `send('crawl-urls', job)` 都成功 | 後續由 queue consumer callback 接手 | `queue` | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L93-L113), [vercel.json](../../../vercel.json#L6-L17) |

這套 fallback 不是用 error type 或 status code 判斷，而是用 `isQueueUnavailableError()` 對錯誤訊息做片段比對；因此它明確處理的是「當前部署環境不適合 queue」這類基礎設施問題，而不是所有送 queue 失敗都自動吞掉。測試也只驗證了這三種模式：完全不能用 queue 時整批 inline、第一筆送失敗時整批 inline、前面已入列而後面失敗時只補跑剩餘 job 並回傳 `mixed`。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L66-L76), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L91-L110), [crawl-dispatch.test.ts](../../../tests/crawl-dispatch.test.ts#L22-L81)

## Queue callback 與 inline fallback 共用的 URL 狀態機

`processCrawlJob()` 一開始就先從 `engineSettings` 萃取 R2 overrides，接著把該 URL 從 `pending` 或 `failed` 標成 `processing`；之後才以 `urlTimeout`（預設 300 秒）包住實際工作，依序呼叫 `scrapeUrl()`、把 raw markdown 存到 `raw/`、視 `enableClean` 決定是否呼叫 `cleanContent()`，最後把 cleaned markdown 存到 `cleaned/`。也就是說，queue callback 與 inline fallback 共用的不只是重試邏輯，而是完整的單 URL 執行與落檔流程。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L116-L145), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L207)

| 狀態轉移點 | 實作行為 | 寫回位置 | 證據 |
|---|---|---|---|
| 開始處理 | `markUrlProcessing()` 把單筆 URL 改成 `processing` | `tasks/{taskId}.json` 的 `urls[]` | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L129-L145) |
| 成功完成 | `completed += 1`、URL entry 改成 `success`、移除 `retryingUrls` | `tasks/{taskId}.json` | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L261-L297) |
| 非最終失敗 | 記錄 `retryingUrls[{ url, attempts, maxRetries, error }]` | `tasks/{taskId}.json` | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L211-L223), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L303-L327), [r2.ts](../../../lib/r2.ts#L6-L22) |
| 最終失敗 | `failed += 1`、寫入 `failedUrls[]`、URL entry 改成 `failed` | `tasks/{taskId}.json` | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L211-L223), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L261-L297), [r2.ts](../../../lib/r2.ts#L6-L22) |
| 全部 URL 結束 | 當 `completed + failed >= total` 時把整體 task 標成 `completed` | `tasks/{taskId}.json` | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L290-L297), [r2.ts](../../../lib/r2.ts#L6-L22) |

這裡最容易忽略的是：對 crawl task 而言，整體任務的 terminal 狀態是「所有 URL 都結束」而不是「至少有一筆成功」。因為 `updateTaskStatus()` 只在總數湊滿時寫 `status = 'completed'`，並沒有在這條 worker 流程中把整體 task 設成 `failed`；失敗資訊是落在 `failed` 計數、`failedUrls[]` 與個別 URL entry 上。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L269-L297), [r2.ts](../../../lib/r2.ts#L6-L22)

## Retry 策略：queue callback、inline fallback、手動 retry 的差異

worker 內部的重試上限先看每筆 job 的 `engineSettings.maxRetries`，沒有時才退回 `RETRY_ATTEMPTS`；當本次 `deliveryCount` 尚未達最終上限時，`processCrawlJob()` 只會把錯誤寫進 `retryingUrls[]` 並丟出 `QueueRetryError`，真正的下次 delivery 決策交給 queue callback 的 `retry()` hook。這代表 retry 資訊會先落到 R2，再決定平台層是否再次 delivery。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L208-L223), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L5-L13), [config.ts](../../../lib/config.ts#L32-L35)

`getCrawlRetryDirective()` 的 backoff 是 `min(120, 2^deliveryCount * 10)`，所以第 1、2、3 次 delivery 失敗時，回傳的 delay 依序會是 20、40、80 秒；相對地，inline fallback 並不等待這個 delay，而是在同一個 process 內用 `while (true)` 立即重跑到成功或達到 `QueueRetryError.maxRetries` 為止。換句話說，inline fallback 重用了相同的「最多重試幾次」語意，但沒有重用 queue 的時間拉開機制。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L227-L259), [config.ts](../../../lib/config.ts#L32-L35)

`/api/retry` 則是人工觸發的第三種入口：它先把指定 URL（或整批 `retryAll`）重設回 `pending`、清掉對應的 `failedUrls` / `retryingUrls`，必要時把整體 task 改回 `processing`，再以 `dispatchCrawlJobs()` 重新派送。若是 `retryAll`，它會用 `mergeStoredTaskEngineSettingsForRetry()` 保留先前儲存的非敏感設定，再只從本次 request 補回 API keys 與 R2 認證；局部 retry 則以 runtime 覆蓋目前 task 的儲存設定。  
Sources: [retry route.ts](../../../app/api/retry/route.ts#L30-L109), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L151-L167)

## 關鍵模組／檔案導覽

| 檔案 | 在本頁的角色 | 證據 |
|---|---|---|
| `app/api/crawl/route.ts` | 建立新 batch task，並把每個 URL 交給 `dispatchCrawlJobs()` | [crawl route.ts](../../../app/api/crawl/route.ts#L59-L98) |
| `app/api/retry/route.ts` | 重新整理既有 task 狀態後，重用同一套派送策略 | [retry route.ts](../../../app/api/retry/route.ts#L30-L109) |
| `lib/services/crawl-dispatch.ts` | 定義 queue/inline/mixed 決策、單 URL 執行、重試指令與 task 狀態更新 | [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L38-L327) |
| `app/api/queues/process-url/route.ts` | Vercel Queue callback 入口，把 message 與 `deliveryCount` 轉交 worker | [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14) |
| `vercel.json` | 把 callback route 綁到 `crawl-urls` topic，並配置 `maxDeliveries`、`retryAfterSeconds`、`maxConcurrency` | [vercel.json](../../../vercel.json#L6-L17) |
| `tests/crawl-dispatch.test.ts` | 保護 inline / mixed fallback 的回歸行為 | [crawl-dispatch.test.ts](../../../tests/crawl-dispatch.test.ts#L22-L81) |

如果你要 trace 某個 URL 為什麼沒有真的走 queue，最短閱讀路徑通常是：先看 `dispatchCrawlJobs()` 怎麼決定 `inline` / `mixed`，再看 queue callback route 是否只做轉交，最後回到 `processCrawlJob()` 看這筆 URL 是否是在共用執行邏輯內卡住或進入 retry。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L78-L114), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L1-L14), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L327)

## 已證實的策略邊界與踩坑

第一個邊界是 queue 與 inline 並不是兩套獨立 worker：inline fallback 只是直接呼叫 `processCrawlJobsInline()`，而它內部仍以 `processCrawlJob()` + `QueueRetryError` 執行每筆 URL。因此如果你在 task JSON 裡看到 `retryingUrls[]` 或 URL 從 `pending -> processing -> failed` 的狀態轉移，不能單靠狀態本身反推它一定是 queue callback 或一定是 inline。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L248), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L303-L327), [r2.ts](../../../lib/r2.ts#L6-L22)

第二個邊界是目前 queue retry 判斷存在一個可直接從程式碼看出的 `+1` 差：`processCrawlJob()` 在 `deliveryCount >= maxRetries` 時就把 URL 記成最終失敗，但 `getCrawlRetryDirective()` 只有在 `deliveryCount > maxRetries` 才 `acknowledge`。再加上 queue consumer 設定的 `maxDeliveries` 是 4，而預設 `RETRY_ATTEMPTS` 是 3，所以在預設值下，`deliveryCount === 3` 時 route 仍會回傳下一次 retry 指令，而不是立即 acknowledge；是否真的發生第 4 次 delivery，還要交由 Vercel Queue 平台依該回應與 trigger 設定執行。  
Sources: [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L211-L223), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L250-L259), [config.ts](../../../lib/config.ts#L32-L35), [vercel.json](../../../vercel.json#L6-L15)

第三個邊界是目前測試只保護 dispatch 層的 fallback 模式，尚未直接覆蓋 queue callback route 本身的 `retry()` hook、`getCrawlRetryDirective()` 的 backoff 數值、或前述 `deliveryCount === maxRetries` 與 `maxDeliveries` 之間的交界行為。因此這一頁能明確證實的是「現行程式碼如何判斷與回傳」，而不是平台在所有邊界情境下的最終 delivery 實測結果。  
Sources: [crawl-dispatch.test.ts](../../../tests/crawl-dispatch.test.ts#L22-L81), [queues process-url route.ts](../../../app/api/queues/process-url/route.ts#L5-L13), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L250-L259), [vercel.json](../../../vercel.json#L6-L17)
