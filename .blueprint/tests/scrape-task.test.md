# scrape-task.test

## 職責契約

驗證 `runSingleScrapeTask` 的**任務狀態機與副作用邊界**：成功時 processing→completed 兩次 putTaskStatus；失敗時 processing→failed 並帶 error；`enableClean=false` / `saveToR2=false` 時不得呼叫 cleanContent / putObject。

## 接口摘要

- 測試框架：`node:test` + `node:assert/strict`
- 透過完整 `SingleScrapeTaskDeps` mock 隔離外部 I/O
- 覆蓋案例：
  1. 成功 scrape：result 欄位、domain 摘要、charCount、r2=null
  2. scrape 拋錯：success=false、failedUrls/error 對齊

## 依賴拓撲

```
tests/scrape-task.test.ts ──► runSingleScrapeTask
                                    │
                                    └── 全 deps mock（不進 crawler 實作 / R2）
```

Bundle 內：鎖定 scrape-task 與 crawler 的契約邊界（mock scrapeUrlAdvanced），與 dispatch 測試互補。
