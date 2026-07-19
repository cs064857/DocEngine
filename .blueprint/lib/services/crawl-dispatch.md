# crawl-dispatch

## 職責契約

本模組是**多 URL 爬取任務的調度與單 URL 處理管線**：
1. 將 `CrawlJobPayload[]` 送入 Vercel Queue（`crawl-urls`），不可用時 fallback 為 inline；
2. 對單一 job：scrape → 存 raw R2 → 可選 LLM clean → 存 cleaned R2 → 更新任務計數/狀態。

它**嚴禁**建立 task 初始 metadata、HTTP 路由解析，或直接管理 Firecrawl key 輪詢（經由 `scrapeUrl`）。重試語意透過 `QueueRetryError` + `getCrawlRetryDirective` 表達，供 queue consumer 決定 ack / 延遲重投。狀態更新必須依「先前 status」防重試重複累加 completed/failed。

## 接口摘要

- `dispatchCrawlJobs(jobs, deps?) → Promise<'queue'|'inline'|'mixed'>`
  - **Side Effect**: 入佇列或 inline 處理；queue OIDC/環境錯誤時 partial fallback
  - **可注入 deps**: `canUseBackgroundQueue` / `sendToQueue` / `processJobsInline`（測試用）
- `processCrawlJob(message, metadata) → Promise<void>`
  - **Input**: `CrawlJobPayload`（taskId/url/date/engineSettings）+ `deliveryCount`
  - **Side Effect**: mark processing；scrape；R2 put raw/cleaned；成功/失敗更新 task；未達 maxRetries 則 `logRetryAttempt`；最終一律 throw `QueueRetryError`
  - **Timeout**: `engineSettings.urlTimeout` 秒（預設 300）
- `processCrawlJobsInline(jobs)`：以 `maxConcurrency` 並行，本地迴圈重試至 `maxRetries`
- `getCrawlRetryDirective(error, deliveryCount)` → `{ acknowledge }` 或 `{ afterSeconds }`（指數退避，上限 120s）
- 型別：`CrawlJobPayload`、`QueueRetryError`、`CrawlDispatchMode`

## 依賴拓撲

```
API / queue consumer
        │
        ▼
 dispatchCrawlJobs ──► @vercel/queue (crawl-urls)
        │                  │
        │                  ▼
        └── inline ──► processCrawlJobsInline ──► crawl-concurrency
                              │
                              ▼
                       processCrawlJob
                         ├── crawler.scrapeUrl
                         ├── cleaner.cleanContent（bundle 外）
                         ├── r2.putObject / getTaskStatus / putTaskStatus
                         └── helpers.buildR2Key
```

Bundle 內：協調 `crawler` + `crawl-concurrency`；與 `scrape-task` 平行（多 URL 佇列 vs 單 URL 同步）。
