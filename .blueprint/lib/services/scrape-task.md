# scrape-task

## 職責契約

本模組封裝**單 URL 同步 scrape 任務生命週期**：產生 taskId → 寫入 processing 狀態 → 進階 scrape → 可選 clean / 可選存 R2 → 寫入 completed 或 failed。它**不**走 Vercel Queue、**不**做多 URL 並行或重試退避——那些屬 `crawl-dispatch`。成功/失敗皆回傳結構化 result（不向外 throw 業務失敗），並保證 R2 任務狀態與結果一致。

## 接口摘要

- `runSingleScrapeTask(input, deps?) → Promise<SingleScrapeTaskResult>`
  - **Input 關鍵欄位**: `url`；Firecrawl 進階參數（waitFor/timeout/onlyMainContent/mobile/includeTags/excludeTags，字串數字可解析）；`saveToR2`；`enableClean` + LLM 覆寫；R2 覆寫；`firecrawlKey`
  - **Success**: `{ success:true, taskId, task, markdown, cleanedMarkdown, metadata, charCount, cleanedCharCount, r2 }`
  - **Failure**: `{ success:false, taskId, task, error }`（仍已寫 failed task 至 R2）
  - **Side Effect**: 至少兩次 `putTaskStatus`（processing → terminal）；條件式 `putObject` raw/cleaned
- 可注入 `SingleScrapeTaskDeps`（generateTaskId/formatDate/now/scrapeUrlAdvanced/cleanContent/putObject/putTaskStatus）供單元測試

## 依賴拓撲

```
scrape API（bundle 外）
        │
        ▼
 runSingleScrapeTask
   ├── crawler.scrapeUrlAdvanced（本 bundle）
   ├── cleaner.cleanContent（bundle 外，enableClean 時）
   ├── r2.putObject / putTaskStatus
   ├── helpers.generateTaskId / formatDate / buildR2Key
   └── task-metadata.summarizeDomains
```

Bundle 內：與 `crawl-dispatch` 共享 `crawler`，但任務模型為 total=1 的同步路徑；由 `tests/scrape-task.test.ts` 鎖定狀態機。
