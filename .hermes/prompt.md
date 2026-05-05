請為 DocEngine 專案實現以下 4 個功能/修復。讀完所有相關文件後再動手改。

---

## 功能 1：可配置多把 Firecrawl KEY，輪循使用

**現狀**：`lib/config.ts` 只支援單一 `FIRECRAWL_API_KEY`，`lib/services/crawler.ts` 的 `getFirecrawl()` 只用一個 key。

**需求**：
1. 在 `lib/config.ts` 新增環境變數 `FIRECRAWL_API_KEYS`，格式為逗號分隔的多個 key（例如 `key1,key2,key3`），同時保留原有 `FIRECRAWL_API_KEY` 的向下兼容
2. 新建 `lib/services/firecrawl-key-manager.ts`，實現 `FirecrawlKeyManager` 類：
   - `getNextKey(): string` — 輪循（round-robin）取得下一個可用的 key
   - `reportRateLimit(key: string): void` — 標記某 key 被限流，暫時跳過
   - `isKeyAvailable(key: string): boolean` — 檢查 key 是否可用（未被限流或限流冷卻已過）
   - 每個 key 有獨立的 `rateLimitPerMinute`（每分鐘速率上限）
   - 內部維護每個 key 的使用計數和限流狀態
3. 修改 `lib/services/crawler.ts`，將 `getFirecrawl()` 改為使用 `FirecrawlKeyManager` 取得 key

## 功能 2：每把 Firecrawl KEY 可單獨配置分鐘速率

**需求**：
1. 環境變數 `FIRECRAWL_KEY_RATES` 格式為逗號分隔的 `key:rate` 對（例如 `key1:10,key2:20,key3:5`），表示每個 key 每分鐘最多允許的請求數
2. 如果某 key 沒有在 `FIRECRAWL_KEY_RATES` 中配置，使用預設值（從 `FIRECRAWL_DEFAULT_RATE_PER_MINUTE` 環境變數讀取，預設 10）
3. 在 `FirecrawlKeyManager` 中實現速率追蹤：記錄每個 key 在當前分鐘窗口內的請求數，超過上限則暫時跳過該 key

## 功能 3：輪循 Firecrawl KEY，被限流時暫時跳過

**需求**：
1. 當 Firecrawl API 返回 429 狀態碼或 rate limit 相關錯誤時，`FirecrawlKeyManager` 自動標記該 key 為限流狀態
2. 限流的 key 在冷卻期（預設 60 秒，可通過 `FIRECRAWL_RATE_LIMIT_COOLDOWN_SECONDS` 配置）內不會被選中
3. `getNextKey()` 應跳過所有不可用的 key（限流中或速率用盡），如果所有 key 都不可用，等待最短冷卻時間後返回第一個恢復的 key
4. 修改 `scrapeUrl()` 和 `scrapeUrlAdvanced()` 中的錯誤處理，檢測 429/rate limit 錯誤並通知 key manager

## 功能 4：修復 Task Progress 中 success/failed 計數不正確的 Bug

**現狀 Bug 分析**：
在 `lib/services/crawl-dispatch.ts` 的 `updateTaskStatus()` 中：
- 每次處理 URL 失敗時執行 `taskStatus.failed += 1`
- 每次處理 URL 成功時執行 `taskStatus.completed += 1`
- **問題：重試時不會撤銷之前失敗的計數**
- 例如：一個 URL 失敗 2 次後成功 → failed += 2, completed += 1，但實際只有 1 個 URL
- 39 個 URL 各重試幾次 → success + failed 遠超 39

**修復方案**：
1. 在 `updateTaskStatus()` 中，先根據 URL 在 `urls[]` 中的當前狀態調整計數：
   - 如果 URL 之前是 `failed`，現在變為 `success`：`taskStatus.failed -= 1`，`taskStatus.completed += 1`
   - 如果 URL 之前是 `processing`，現在變為 `success`：`taskStatus.completed += 1`
   - 如果 URL 之前是 `processing`，現在變為 `failed`：`taskStatus.failed += 1`
   - 如果 URL 之前是 `failed`，現在再次 `failed`（重試仍失敗）：不重複增加 `failed`
2. 同時修復 `failedUrls[]` 的去重問題：重試後成功時應從 `failedUrls[]` 中移除該 URL
3. 確保完成條件判斷 `(completed + failed) >= total` 仍然正確

---

**重要注意事項**：
- 不要讀取專案目錄外的文件（如 node_modules 內部）
- 修改後確保 `npx tsc --noEmit` 通過型別檢查
- 保持現有 API 介面向下兼容
