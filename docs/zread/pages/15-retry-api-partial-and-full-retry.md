# Retry API：局部重試與整批重跑

## 本頁範圍與讀者定位

本頁只說明既有 crawl 任務的 `POST /api/retry` 如何把失敗 URL 做局部重試，或把同一個 `taskId` 的全部追蹤 URL 整批重跑；它不會建立新任務，而是先讀取 `tasks/{taskId}.json`、改寫同一份任務狀態，再把 URL 重新交給既有派送/執行管線。Sources: [route.ts](app/api/retry/route.ts#L11-L109), [r2.ts](lib/r2.ts#L137-L149)

## 核心流程

```mermaid
flowchart TD
    UI[app/page.tsx Retry 按鈕] --> API[POST /api/retry]
    API --> LOAD[getTaskStatus(taskId)]
    LOAD --> MODE{retryAll?}
    MODE -->|false| PARTIAL[局部重試：移除 failedUrls 對應項\n把目標 URL 狀態改回 pending]
    MODE -->|true| FULL[整批重跑：completed/failed 歸零\nfailedUrls/retryingUrls 清空\n所有 URL 改回 pending]
    PARTIAL --> SAVE[putTaskStatus(taskId)]
    FULL --> SAVE
    SAVE --> DISPATCH[dispatchCrawlJobs]
    DISPATCH -->|queue| QUEUE[/api/queues/process-url]
    DISPATCH -->|inline or mixed| INLINE[processCrawlJobsInline]
    QUEUE --> WORKER[processCrawlJob]
    INLINE --> WORKER
    WORKER --> STORE[scrape -> clean -> 寫入 raw/cleaned]
    WORKER --> RETRYLOG[失敗時記錄 retryingUrls\n或最終寫回 failedUrls]
    STORE --> STATUS[updateTaskStatus]
    RETRYLOG --> STATUS
    STATUS --> POLL[/api/status/[taskId] 與 /api/tasks/]
```

Retry API 自己只負責「重設任務狀態 + 重新派送」；真正的抓取、清洗、R2 寫入、成功/失敗累計與自動重試記錄，仍然落在 `crawl-dispatch` 與 queue callback 那層完成，所以 manual retry 是在重用原本的 crawl 工作流，而不是另一條獨立 pipeline。Sources: [route.ts](app/api/retry/route.ts#L30-L109), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L78-L113), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L165-L327), [route.ts](app/api/queues/process-url/route.ts#L1-L14), [route.ts](app/api/status/[taskId]/route.ts#L5-L67), [route.ts](app/api/tasks/route.ts#L22-L87)

## 兩種重試模式對照

| 模式 | 前端觸發點 | 請求內容 | 任務狀態變化 | 設定來源 |
|---|---|---|---|---|
| 局部重試 | 單筆 failed 列表按鈕、`Retry All Failed` | `{ taskId, urls: [...] }` | 只把指定 URL 從 `failedUrls` / `urls[].status=failed` 拉回 `pending`，並清掉該 URL 的 `retryingUrls` 記錄 | 以既有 `taskStatus.engineSettings` 為底，再疊上這次 UI 傳入的 `engineSettings` |
| 整批重跑 | `Retry Task` | `{ taskId, retryAll: true }` | `completed=0`、`failed=0`、清空 `failedUrls` / `retryingUrls`，所有追蹤 URL 改回 `pending` | `mergeStoredTaskEngineSettingsForRetry()` 把儲存的非敏感設定與這次 runtime secrets / R2 覆蓋重新組回完整設定 |

表中的差異直接來自 `app/page.tsx` 三個 handler 與 `/api/retry` 的兩條分支；另外 `taskStatus.engineSettings` 在任務建立時會先經過 sanitize，把 API key 與 R2 憑證排除，只留下可安全回存的欄位。Sources: [page.tsx](app/page.tsx#L862-L952), [page.tsx](app/page.tsx#L2823-L2840), [route.ts](app/api/retry/route.ts#L36-L99), [task-metadata.ts](lib/utils/task-metadata.ts#L125-L167), [route.ts](app/api/crawl/route.ts#L59-L75)

## 局部重試：只回補既有失敗 URL

內建 UI 的局部重試只有兩個入口：單筆 failed 列表列尾的 Retry 按鈕，以及抽屜標題列的 `Retry All Failed`；兩者都從 `taskStatus.urls` 中挑出 `status === 'failed'` 的 URL 後呼叫 `/api/retry`，因此產品層的預期語義其實是「回補失敗項」，不是任意挑一批 URL 重跑。Sources: [page.tsx](app/page.tsx#L862-L922), [page.tsx](app/page.tsx#L2833-L2840), [page.tsx](app/page.tsx#L3001-L3017)

後端收到局部重試時，不會重置整個 task；它只會逐一移除對應的 `failedUrls` 項目、把 `failed` 計數扣回去、把對應 `urls[]` entry 改成 `pending` 並清除 `error`，最後若 task 原本不是 `processing` 才把整體狀態翻回 `processing`。`completed` 計數在這條路徑不會歸零，代表局部重試是增量修補，而不是重新開始整個批次。Sources: [route.ts](app/api/retry/route.ts#L48-L90)

值得注意的是，局部重試分支直接採用請求裡的 `urls` 作為 `retryUrls`，之後就立刻丟進 `dispatchCrawlJobs`；只有在 `taskStatus.urls` 找得到同 URL 項目時，才會把追蹤狀態改回 `pending`。因此這個 API 的安全前提其實是 caller 只送「該 task 已知且已失敗」的 URL，而內建 UI 也正是這樣做。Sources: [route.ts](app/api/retry/route.ts#L36-L42), [route.ts](app/api/retry/route.ts#L60-L79), [route.ts](app/api/retry/route.ts#L92-L99), [page.tsx](app/page.tsx#L862-L922), [page.tsx](app/page.tsx#L3001-L3017)

## 整批重跑：同一個 taskId 的全量重置

`Retry Task` 按鈕只有在抽屜已載入 `taskStatus.urls`、而且整體 task 已不在 `processing` 狀態時才會顯示；它會把目前 task 追蹤到的所有 URL 收集起來，改送 `{ taskId, retryAll: true }` 給 `/api/retry`，所以它代表的是「同一個 task 全量再跑一次」，不是建立第二個 task。Sources: [page.tsx](app/page.tsx#L924-L952), [page.tsx](app/page.tsx#L2823-L2831)

後端走 `retryAll` 分支時，會把 `completed` 與 `failed` 歸零、清空 `failedUrls` 和 `retryingUrls`，再把 `taskStatus.urls` 的每個 entry 全部改成 `pending` 並移除錯誤訊息，接著用原 task 的 `date` 與同一個 `taskId` 重新派送所有 URL。這表示 full retry 是「重用舊任務殼」，而不是重建 metadata。Sources: [route.ts](app/api/retry/route.ts#L36-L59), [route.ts](app/api/retry/route.ts#L83-L99)

整批重跑在設定合成上比局部重試更明確：任務建立時先用 `sanitizeEngineSettingsForStorage()` 去掉 `firecrawlKey`、`llmApiKey`、URL extractor API key 與 R2 credentials，只把可公開回存的欄位放進 `taskStatus.engineSettings`；等到 `retryAll` 時，再由 `mergeStoredTaskEngineSettingsForRetry()` 把這份已儲存設定與本次 UI 帶來的 secrets / R2 覆蓋合併成真正執行用的 `engineSettings`。Sources: [route.ts](app/api/crawl/route.ts#L59-L75), [task-metadata.ts](lib/utils/task-metadata.ts#L27-L30), [task-metadata.ts](lib/utils/task-metadata.ts#L125-L167), [route.ts](app/api/retry/route.ts#L44-L46)

## 派送、執行與自動重試記錄

`dispatchCrawlJobs()` 先判斷目前 runtime 能不能用 background queue：若不行就直接 inline；若可以則逐筆送到 `@vercel/queue`，但一旦遇到 OIDC / Vercel 環境不可用這類錯誤，就只把尚未送出的剩餘工作回退到 inline，因此回傳模式可能是 `queue`、`inline` 或 `mixed`。測試檔也直接覆蓋了這三種分流結果。Sources: [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L62-L113), [crawl-dispatch.test.ts](tests/crawl-dispatch.test.ts#L22-L81)

真正執行 URL 時，worker 會先把該 URL 標成 `processing`，接著抓取原始 Markdown、視需要做清洗，再把 raw/cleaned 寫回 R2，最後成功就累加 `completed`，失敗就累加 `failed` 並把錯誤附加到 `failedUrls`。若還沒達到 `maxRetries`，它不會立刻寫入 `failedUrls`，而是把 `{ url, attempts, maxRetries, error }` 更新到 `retryingUrls`，讓前端能看見「目前正在自動重試」的狀態。Sources: [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L129-L145), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L165-L223), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L261-L327), [config.ts](lib/config.ts#L32-L35)

Queue callback 本身只是一個薄封裝：`/api/queues/process-url` 把收到的 payload 交給 `processCrawlJob()`，並把失敗後的 retry policy 委派給 `getCrawlRetryDirective()`，其中 delay 會隨 deliveryCount 指數增加但上限 120 秒。Sources: [route.ts](app/api/queues/process-url/route.ts#L1-L14), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L250-L259)

## 前端監控與歷史如何反映 retry

前端不會在 `fetch('/api/retry')` 成功後直接手動改寫 `taskStatus`；它只用本地 `retryingUrls: Set<string>` 暫時鎖住按鈕，真正的畫面更新仍然依賴每 3 秒輪詢一次的 `/api/status/[taskId]`，以及 Tasks 分頁重新讀取 `/api/tasks`。如果 UI 有 R2 覆蓋設定，這兩條查詢 API 都會改走 POST，把 `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 帶給後端。Sources: [page.tsx](app/page.tsx#L167-L178), [page.tsx](app/page.tsx#L472-L550), [route.ts](app/api/status/[taskId]/route.ts#L5-L67), [route.ts](app/api/tasks/route.ts#L22-L87)

監控抽屜會同時顯示三層 retry 訊號：上方摘要卡的 `completed/failed/total`、失敗清單 `failedUrls`、以及 server-side `retryingUrls` 的「Currently Retrying...」區塊；另一方面，單筆 Retry 按鈕自己的 loading spinner 則來自前端本地 `retryingUrls` state。換句話說，畫面上同名的 retrying 概念其實分成「本地請求進行中」與「worker 自動重試中」兩種來源。Sources: [page.tsx](app/page.tsx#L1615-L1645), [page.tsx](app/page.tsx#L167-L170), [page.tsx](app/page.tsx#L3001-L3017)

Tasks 分頁中的歷史卡片來自 `tasks/` prefix 下的既有 JSON 檔，點 `View Monitor` 只是把同一個 `taskId` 重新載入抽屜，而不是複製或另存新的 retry 任務；這也再次說明 Retry API 的語意是「回到原 task 內修補/重跑」。Sources: [r2.ts](lib/r2.ts#L137-L149), [route.ts](app/api/tasks/route.ts#L22-L54), [page.tsx](app/page.tsx#L2723-L2779)

## 關鍵模組 / 檔案導覽

| 檔案 | 角色 | 本頁重點 |
|---|---|---|
| `app/api/retry/route.ts` | Retry API 入口 | 決定局部重試 vs `retryAll`、改寫 task 狀態、重新派送 URL |
| `lib/services/crawl-dispatch.ts` | 派送與 worker 核心 | queue/inline/mixed 分流、自動重試、成功/失敗回寫 |
| `app/api/queues/process-url/route.ts` | Queue callback | 把 queue payload 接到 `processCrawlJob()` |
| `lib/utils/task-metadata.ts` | 任務設定工具 | sanitize 儲存版設定，並在 full retry 時回補 secrets / R2 overrides |
| `app/page.tsx` | Retry UI 與監控 | 單筆 Retry、Retry All Failed、Retry Task、輪詢與 Monitor Drawer |
| `app/api/status/[taskId]/route.ts` / `app/api/tasks/route.ts` | 查詢端點 | 讓 retry 後的同一 task 能被輪詢與歷史列表重新讀取 |

這些檔案共同構成「同一 task 內重設狀態、重新派送、再次回寫、再由前端輪詢顯示」的閉環。Sources: [route.ts](app/api/retry/route.ts#L11-L109), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L78-L327), [route.ts](app/api/queues/process-url/route.ts#L1-L14), [task-metadata.ts](lib/utils/task-metadata.ts#L125-L167), [page.tsx](app/page.tsx#L472-L550), [page.tsx](app/page.tsx#L862-L952)

## 已知邊界與踩坑

Retry API 重新派送 job 時沿用舊 task 的 `date`，而 worker 寫 raw/cleaned 檔案時又用 `buildR2Key(url, subdir, date)` 產生路徑，所以不論局部重試或整批重跑，本質上都會覆寫同一個日期命名空間下的既有輸出，而不是建立一組新的版本化 crawl 結果。Sources: [route.ts](app/api/retry/route.ts#L92-L99), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L182-L202), [helpers.ts](lib/utils/helpers.ts#L21-L39)

另一個要注意的 UI/語意差異是：`Retry Task` 只在 task 離開 `processing` 後才出現，但 `Retry All Failed` 只要求目前有失敗項，因此它可以在同一個批次仍有其他 URL 執行中時先行回補失敗子集；這跟 full retry 必須等待整體批次落定，是兩種不同的操作語意。Sources: [page.tsx](app/page.tsx#L2823-L2840)
