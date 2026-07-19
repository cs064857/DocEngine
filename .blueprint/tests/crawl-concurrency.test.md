# crawl-concurrency.test

## 職責契約

驗證 `crawl-concurrency` 的契約：**無效 concurrency 回落預設 2**、**有效值 floor**、**runWithConcurrency 同時 in-flight ≤ 請求上限**。不測真實網路；以 deferred gate 模擬慢 worker。

## 接口摘要

- 測試框架：`node:test` + `node:assert/strict`
- 覆蓋案例：
  1. `normalizeMaxConcurrency` 對 undefined/0/-1/NaN → 2
  2. 對 1、3.9 → 1、3
  3. concurrency=2 時三任務僅先啟動兩個，釋放後才啟動第三個

## 依賴拓撲

```
tests/crawl-concurrency.test.ts ──► lib/services/crawl-concurrency
```

Bundle 內：直接鎖定 concurrency 模組；為 `crawl-dispatch` inline 路徑的並行安全網。
