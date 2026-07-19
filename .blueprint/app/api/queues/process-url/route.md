# POST /api/queues/process-url

## 職責契約

Vercel Queue **回呼端點**：消費單筆 `CrawlJobPayload`，執行實際 crawl 處理與重試策略。

- **做**：以 `@vercel/queue` `handleCallback` 綁定 worker；呼叫 `processCrawlJob`；依 `getCrawlRetryDirective` 決定是否再投遞。
- **不做**：建立任務、抽出 URL、對外 REST 契約設計、使用者主動 abort 狀態改寫（分屬 crawl / retry / abort）。

## 接口摘要

`POST = handleCallback<CrawlJobPayload>(handler, { retry })`

| 面向 | 形狀 |
|------|------|
| **Input (message)** | `CrawlJobPayload`：`{ taskId, url, date, engineSettings? }` |
| **Input (metadata)** | 至少使用 `deliveryCount` |
| **Side Effect** | `processCrawlJob` 更新 R2 任務進度、執行 scrape/crawl、可能寫檔 |
| **Retry** | `getCrawlRetryDirective(error, deliveryCount)` 回傳佇列重試指示 |
| **Constraints** | 僅供 Queue 基礎設施呼叫，非前端直連業務 API |

## 依賴拓撲

```
dispatchCrawlJobs (mode=queue)
  → Vercel Queue
    → **POST /api/queues/process-url**
         ├→ processCrawlJob(message, { deliveryCount })
         └→ getCrawlRetryDirective (on failure)
```

同 bundle：`crawl` / `retry` 是生產者；本路由是消費者。`abort` 只改 R2 狀態，不取消已在途的 queue message（語意為標記失敗）。
