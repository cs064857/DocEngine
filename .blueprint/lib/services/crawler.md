# crawler

## 職責契約

本模組是 Firecrawl SDK 的**唯一薄適配層**：單頁 scrape（標準/進階）、啟動 async crawl job、查詢 crawl 狀態。它**僅**回傳 markdown / jobId / status；**嚴禁**寫 R2、更新任務狀態、清理內容或排程佇列——那些屬 `crawl-dispatch` / `scrape-task`。API Key 選擇與 429 冷卻委派給 `FirecrawlKeyManager`；支援 per-call `CrawlerOverrides`（apiKey/apiUrl）覆蓋全域 config。

## 接口摘要

- `scrapeUrl(url, overrides?) → Promise<string>`
  - **Output**: markdown 字串；失敗拋錯
  - **Side Effect**: Firecrawl scrape（formats: markdown, timeout 60s）；429 時 `reportRateLimit`
- `scrapeUrlAdvanced(url, options?, overrides?) → Promise<ScrapeAdvancedResult>`
  - **Input options**: waitFor / timeout / onlyMainContent / mobile / includeTags / excludeTags
  - **Output**: `{ markdown, metadata? }`
- `startCrawlJob(url, limit=100, overrides?) → Promise<string>`
  - **Output**: Firecrawl crawl job `id`；scrapeOptions 僅取 `links`（供後續 queue）
- `checkCrawlJob(jobId, overrides?) → statusResponse`
- 型別：`CrawlerOverrides`、`ScrapeAdvancedOptions`、`ScrapeAdvancedResult`

內部：`FirecrawlApp` 實例以 `key-url` 簽名快取；KeyManager 以 keys JSON 簽名快取。

## 依賴拓撲

```
config.firecrawl ──► crawler ──► @mendable/firecrawl-js
                      │
                      ├── FirecrawlKeyManager（本 bundle）
                      │
                      ├── scrapeUrl ────────► crawl-dispatch.processCrawlJob
                      ├── scrapeUrlAdvanced ► scrape-task.runSingleScrapeTask
                      └── startCrawlJob / checkCrawlJob ►（API 層，bundle 外）
```

Bundle 內：下層消費 key-manager；上層被 dispatch / scrape-task 呼叫。
