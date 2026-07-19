# crawl-dispatch.test

## 職責契約

驗證 `dispatchCrawlJobs` 的**調度模式選擇**：runtime 不支援 queue → 全 inline；queue 認證失敗 → fallback inline；部分已入佇後失敗 → mixed 且僅 pending 走 inline。透過注入 deps，**不**真連 Vercel Queue 或 Firecrawl。

## 接口摘要

- 測試框架：`node:test` + `node:assert/strict`
- 固定 fixture：兩個 `CrawlJobPayload`（同 taskId 不同 URL）
- 覆蓋案例：
  1. `canUseBackgroundQueue=false` → mode `inline`，無 send
  2. send 拋 OIDC 類錯誤 → mode `inline`，全部 inline
  3. 第二個 job 才失敗 → mode `mixed`，僅 `/b` inline

## 依賴拓撲

```
tests/crawl-dispatch.test.ts ──► dispatchCrawlJobs（deps 注入）
                                        │
                                        └── 不觸及 processCrawlJob / crawler / R2
```

Bundle 內：只測 dispatch 分支；處理管線與重試由實作與其他路徑承擔。
