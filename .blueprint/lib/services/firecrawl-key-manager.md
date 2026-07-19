# firecrawl-key-manager

## 職責契約

本模組**僅**負責多把 Firecrawl API Key 的輪詢選取、每分鐘額度窗口計數，以及 429 冷卻標記。它**嚴禁**發起任何 HTTP/Firecrawl 呼叫、解析業務 payload，或決定「該 scrape 哪一頁」——那是 `crawler` 的職責。無可用 key 時回傳 `DUMMY_KEY` 作為降級佔位，不拋錯。

## 接口摘要

- `new FirecrawlKeyManager(options)`
  - **Input**: `keys[]`；可選 `keyRates`（per-key 每分鐘上限）、`defaultRatePerMinute`（預設 10）、`rateLimitCooldownMs`（預設 60s）、可注入 `now`/`sleep`（便於測試）
  - **Side Effect**: 去重/trim keys，初始化每 key 的滑動分鐘窗口狀態
- `getNextKey(): string`
  - **Output**: 下一把可用 key；全滿時同步 sleep 至最短可等時間後重試
  - **Side Effect**: 選中 key 的 `requestCount++`，推進 round-robin 指標
- `reportRateLimit(key)`：標記該 key 進入冷卻至 `now + cooldownMs`
- `isKeyAvailable(key)`：窗口重置後檢查冷卻與額度

## 依賴拓撲

```
config.firecrawl.* ──► FirecrawlKeyManager ◄── crawler.getKeyManager / getNextKey / reportRateLimit
                              │
                              └── 純記憶體狀態（無 R2 / 無外部 I/O）
```

Bundle 內：被 `crawler` 以 key 清單簽名快取複用；`crawler` 在 429 時回報冷卻。
