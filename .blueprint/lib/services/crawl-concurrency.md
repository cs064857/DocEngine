# crawl-concurrency

## 職責契約

本模組提供**通用有界並行執行器**與 concurrency 正規化。它**不知道** URL、Firecrawl 或任務狀態；**嚴禁**重試策略、錯誤分類或 I/O。僅保證：同時執行的 worker 數 ≤ 正規化後的 concurrency，且每個 item 恰執行一次 worker。

## 接口摘要

- `normalizeMaxConcurrency(value?) → number`
  - 無效（undefined / ≤0 / NaN / 非有限）→ 預設 `2`；有效則 `Math.floor`
- `runWithConcurrency(items, concurrency, worker) → Promise<void>`
  - **Input**: 任意 `T[]`；`worker(item, index) => Promise<void>`
  - **Side Effect**: 僅透過 worker 回呼產生；空陣列立即返回
  - **約束**: 實際 worker 數 = `min(normalize(concurrency), items.length)`

## 依賴拓撲

```
crawl-dispatch.processCrawlJobsInline
        │
        └── runWithConcurrency / normalizeMaxConcurrency
                    │
                    └──（無外部依賴，純控制流）
```

Bundle 內：被 `crawl-dispatch` 的 inline 路徑使用；由 `tests/crawl-concurrency.test.ts` 驗證上限與 floor 行為。
