# Scraping Processor Concurrency And Task Drawer Design

## Goal

讓 `Scraping Processor` 區塊中的 `maxConcurrency` 成為 batch scrape/crawl 任務的實際處理控制值，並修正 `Task Progress` 抽屜只在每個新 task 開始時自動展開一次；若使用者手動關閉，之後保持關閉，直到使用者自行重開或切換到另一個新 task。

## Current State

### Max Concurrency

- `app/page.tsx` 已有 `maxConcurrency` state，並會寫入 `localStorage`。
- `handleSubmit()`、`handleRetrySingle()`、`handleRetryAllFailed()`、`handleRetryTask()` 目前都沒有把 `maxConcurrency` 送進 `engineSettings`。
- `app/api/crawl/route.ts` 與 `app/api/retry/route.ts` 會把收到的 `engineSettings` 原樣交給 `dispatchCrawlJobs()`。
- `lib/services/crawl-dispatch.ts` 的 `processCrawlJobsInline()` 目前用 `for ... of` 逐筆處理，實際併行度固定為 `1`。
- queue 模式的硬上限來自 `vercel.json` 中 `app/api/queues/process-url/route.ts` 的 `maxConcurrency: 2`。

### Task Progress Drawer

- `page.tsx` 目前有一個 effect：只要 `taskId` 存在且 `taskStatus` 還不存在或為 `processing`，就會 `setDrawerOpen(true)`。
- 因為 polling 每 3 秒會更新一次 `taskStatus`，所以使用者手動關閉抽屜後，只要同一 task 仍在執行，就會被下一輪 effect 再次打開。

## Requirements

1. `maxConcurrency` 必須從 `Scraping Processor` 統一進入 batch 任務設定流。
2. 同一個 batch task 的 `maxConcurrency` 必須在 server-side 生效，而不是只留在前端顯示。
3. queue 模式需要明確區分：
   - Vercel queue consumer 的 `maxConcurrency` 仍是平台級硬上限。
   - task request 帶入的 `maxConcurrency` 是 task-level soft cap。
4. inline fallback 與 mixed fallback 中尚未進 queue 的工作，必須遵守 task-level `maxConcurrency`。
5. `Task Progress` 抽屜每個新 task 只自動打開一次。
6. 同一 task 若被手動關閉，不得因 polling 或狀態更新再次自動打開。
7. 當 `taskId` 切換成新的 task 時，抽屜 auto-open 權限要重新啟用。

## Options Considered

### Option A: Make `maxConcurrency` a real runtime task setting

將 `maxConcurrency` 從前端傳入 `engineSettings`，由 dispatcher 在 server-side 解讀並控制 inline worker pool，同時在 queue dispatch 端加入相同的 task-level 限速語意。

優點：

- 與現有 UI 語意一致。
- 不需要移除既有控制項。
- 可在不改動 Firecrawl wrapper 的前提下讓 batch pipeline 真正受控。

缺點：

- 無法直接改變 Vercel queue consumer 的平台硬上限。

### Option B: Keep runtime behavior unchanged and relabel UI

把 `maxConcurrency` 改成說明文字或靜態設定展示，不再宣稱它能控制任務。

優點：

- 變更最小。

缺點：

- 不符合本次需求。
- 會保留使用者對既有 UI 的落差。

### Option C: Move concurrency control entirely to deployment config

把併行控制完全收斂到 `vercel.json` 或環境變數，移除 per-task runtime 設定。

優點：

- 架構最單純。

缺點：

- 失去 `Scraping Processor` 的 per-task 控制能力。
- 與現有表單設計方向相反。

## Chosen Design

選用 Option A，並以最小改動方式落地。

### 1. `maxConcurrency` flow

- `app/page.tsx` 在建立 batch 任務與 retry 任務時，統一把 `maxConcurrency` 放入 `engineSettings`。
- `app/api/crawl/route.ts` 與 `app/api/retry/route.ts` 不新增額外轉換層，沿用既有 `engineSettings` 傳遞模式。
- `lib/services/crawl-dispatch.ts` 的 `CrawlJobPayload.engineSettings` 補上 `maxConcurrency?: number`。

### 2. Dispatcher semantics

- 新增一個共用 helper，將 `engineSettings.maxConcurrency` 解析成合法正整數。
- 若 request 未提供值，fallback 到目前平台預設 `2`。
- 若值小於 `1`、非數字或空值，回退到預設值。
- 若值大於平台硬上限，server-side 仍只會把它當作 task soft cap；真正 queue 併行不保證超過 consumer 硬上限。

### 3. Inline and mixed execution model

- `processCrawlJobsInline()` 由串行 `for ... of` 改為固定大小 worker pool。
- worker pool 大小使用本次 task 的 `maxConcurrency`。
- `dispatchCrawlJobs()` fallback 到 inline 時，仍維持目前 `queue` / `inline` / `mixed` 回傳語意不變。
- 這代表：
  - `inline` 模式：所有 jobs 使用 task-level concurrency 併行處理。
  - `mixed` 模式：只有尚未進 queue 的剩餘 jobs 使用 task-level concurrency 併行處理。

### 4. Queue mode semantics

- `vercel.json` 內 consumer `maxConcurrency: 2` 保持不動，作為平台硬上限。
- `maxConcurrency` 不再被描述成「直接控制 Vercel queue consumer」，而是「控制 Scraping Processor 對 batch task 的處理上限」。
- 對 queue-only path 來說，task-level `maxConcurrency` 只代表本次任務的宣告性設定與 fallback 行為；平台最終仍受 consumer config 約束。

### 5. Drawer auto-open state

- 在 `page.tsx` 新增一個只服務前端 UI 的記憶狀態，用來記錄「目前這個 `taskId` 是否已經 auto-open 過」。
- 當 `taskId` 改變時，重設這個狀態。
- auto-open effect 改成僅在以下條件同時成立時觸發：
  - `taskId` 存在。
  - 目前 task 尚未 auto-open 過。
  - `taskStatus` 尚未拿到或仍為 `processing`。
- 第一次 auto-open 後立即標記為已處理。
- 關閉抽屜的動作不會重設這個標記。

### 6. Retry behavior

- `handleRetrySingle()`、`handleRetryAllFailed()`、`handleRetryTask()` 都要把 `maxConcurrency` 帶入 retry 的 `engineSettings`。
- `app/api/retry/route.ts` 維持既有 `mergeStoredTaskEngineSettingsForRetry()` 策略，讓 runtime secret 與 stored behavior settings 合併時保留 `maxConcurrency`。

## File-Level Changes

### `app/page.tsx`

- 將 `maxConcurrency` 併入 batch submit/retry 的 `engineSettings`。
- 新增 current-task auto-open guard state。
- 調整 drawer auto-open effect，只對每個新 task 生效一次。
- 視情況調整 `Scraping Processor` 說明文字，使其與新語意一致。

### `lib/services/crawl-dispatch.ts`

- 擴充 `engineSettings` 型別加入 `maxConcurrency`。
- 新增 concurrency normalization helper。
- 將 `processCrawlJobsInline()` 改為固定大小 worker pool。
- 保持 queue fallback 與 retry 行為不變。

### `app/api/crawl/route.ts`

- 不需要新增新流程，只需讓來自 UI 的 `engineSettings.maxConcurrency` 繼續穿透。

### `app/api/retry/route.ts`

- 不需要新增新流程，只需確保 retry engine settings 會保留 `maxConcurrency`。

### `tests/crawl-dispatch.test.ts`

- 補測 inline path 是否仍正確回傳 `inline` / `mixed`。
- 補測 worker pool 在 `maxConcurrency > 1` 時不再串行。
- 補測不合法 `maxConcurrency` 會回退預設值。

## Data Flow

1. 使用者在 `Scraping Processor` 調整 `maxConcurrency`。
2. 前端在 batch submit 或 retry 時把該值放入 `engineSettings`。
3. API route 把 `engineSettings` 附到 `CrawlJobPayload`。
4. Dispatcher 解析 task-level `maxConcurrency`。
5. 若走 queue：
   - 已入 queue 的任務仍受平台 consumer 硬上限控制。
   - 若後續 fallback 到 inline，剩餘工作使用 task-level concurrency worker pool。
6. 若直接 inline：
   - 所有 jobs 由 task-level concurrency worker pool 執行。
7. `Task Progress` 對新 `taskId` auto-open 一次；之後僅由使用者手動控制開關。

## Error Handling

- `maxConcurrency` normalization 必須對 `undefined`、空字串、非數字、`0`、負數做防禦式回退。
- 不因單個 job 失敗中斷整個 inline worker pool；沿用既有 `processCrawlJob()` / `QueueRetryError` 行為。
- 不改動既有 queue unavailable fallback 規則。
- 不改動既有 retry backoff 與 task status 聚合邏輯。

## Testing Strategy

### Automated

1. `tests/crawl-dispatch.test.ts`
   - 驗證 queue 不可用時仍 fallback 到 inline。
   - 驗證 mixed mode 仍只補跑未成功入 queue 的 jobs。
   - 驗證 inline worker pool 會依 `maxConcurrency` 啟動多個工作，而不是完全串行。
   - 驗證不合法 `maxConcurrency` 會回退預設值。

2. Frontend behavior coverage
   - 若現有專案沒有 page-level 測試框架，則抽出最小判斷邏輯為純函式並以 `node:test` 驗證。
   - 驗證同一 task 只 auto-open 一次。
   - 驗證 taskId 改變後會重新允許 auto-open。

### Manual verification

1. 在 Create 頁建立一個新的 batch task，確認抽屜自動打開一次。
2. 手動關閉抽屜，等待數輪 polling，確認不會自動再開。
3. 點右下角 `Task Progress` 浮動按鈕，確認可手動重開。
4. 啟動另一個新 task，確認新 task 仍會自動打開抽屜。
5. 分別以 `maxConcurrency=1` 與 `maxConcurrency>1` 執行 inline/fallback 任務，確認 server-side 行為與預期一致。

## Non-Goals

- 不改 Firecrawl `scrapeUrl()` / `scrapeUrlAdvanced()` 的單請求語意。
- 不將 Vercel queue consumer `maxConcurrency` 改成 per-task 動態配置。
- 不重寫現有 task polling 模型。
- 不處理與本次需求無關的 retry `deliveryCount` 邊界問題。

## Risks

1. 使用者可能把 `maxConcurrency` 理解為可突破平台 queue 上限，因此 UI 說明需要同步修正。
2. inline worker pool 若實作不當，可能影響既有 retry 與 fallback 測試，需要以回歸測試保護。
3. Drawer auto-open 若狀態歸零時機錯誤，可能導致新 task 不再自動打開；因此必須綁定在 `taskId` 切換上，而不是 `drawerOpen` 切換上。
