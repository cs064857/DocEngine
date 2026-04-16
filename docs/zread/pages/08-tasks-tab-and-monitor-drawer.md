# Tasks 分頁與監控抽屜

本頁只追蹤前端主控台中兩個共用監控介面：`Tasks` 分頁負責把 `tasks/` 前綴下的歷史任務列成清單，而右側 `Task Progress` 抽屜則負責針對目前 `taskId` 顯示即時狀態、逐 URL 操作與檔案下載；它不重新解釋任務如何建立，而是聚焦「歷史如何被讀出」與「監控如何被重新接手」。 Sources: [page.tsx](app/page.tsx#L92-L95), [page.tsx](app/page.tsx#L161-L179), [page.tsx](app/page.tsx#L519-L550), [page.tsx](app/page.tsx#L2710-L3071)

## 核心互動流程

```mermaid
flowchart LR
  A[切到 Tasks 分頁] --> B[loadTasks effect]
  B --> C[/api/tasks GET 或 POST]
  C --> D[列出 tasks/*.json 並回傳前 20 筆]
  D --> E[Tasks 卡片清單]
  E -->|View Monitor| F[setTaskId + setDrawerOpen]
  F --> G[/api/status/{taskId} 每 3 秒輪詢]
  G --> H[taskStatus]
  H --> I[Task Progress 抽屜]
  I --> J[/api/retry]
  I --> K[/api/abort]
  I --> L[/api/files]
  I --> M[/api/clean]
```

這個流程的關鍵不是「Tasks 分頁自己維護一份選中任務」，而是整個畫面都共用 `taskId` 當單一事實來源：歷史列表只是在點擊 `View Monitor` 時把某筆 `taskId` 放回全域 state，真正的明細仍然靠 `/api/status/[taskId]` 輪詢補齊，所以從 Create 頁切過來的當前任務與從歷史列表重新打開的舊任務，最後都落在同一個抽屜元件上。 Sources: [page.tsx](app/page.tsx#L472-L517), [page.tsx](app/page.tsx#L2710-L2780), [page.tsx](app/page.tsx#L2808-L3071), [route.ts](app/api/status/[taskId]/route.ts#L9-L24), [route.ts](app/api/status/[taskId]/route.ts#L35-L63)

## Tasks 分頁如何形成歷史清單

`Tasks` 分頁是 lazy load，不是首頁預載：`activeTab` 預設是 `create`，只有當 `activeTab === 'tasks'` 時才執行 `loadTasks()`；前端若偵測到任一 R2 覆蓋欄位非空，就改用 `POST /api/tasks` 把 `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 一起送出，否則才退回 `GET /api/tasks`。 Sources: [page.tsx](app/page.tsx#L92-L95), [page.tsx](app/page.tsx#L519-L550)

後端 `/api/tasks` 不做複雜查詢，而是直接列出 `tasks/` 前綴下最多 1000 個物件、按 `LastModified` 由新到舊排序、只取前 20 筆，再逐一用 `getTaskStatus()` 回讀完整 JSON；如果舊任務缺少 `domainSummary`，route 還會用 `summarizeDomains()` 依 `urls` 或 `failedUrls` 補出 `domains` 與 `domainSummary`，所以歷史清單顯示的 domain 標籤是 API 正規化後的結果，不完全依賴當初寫入格式。 Sources: [route.ts](app/api/tasks/route.ts#L6-L20), [route.ts](app/api/tasks/route.ts#L22-L54), [r2.ts](lib/r2.ts#L145-L157), [task-metadata.ts](lib/utils/task-metadata.ts#L71-L84)

這份歷史來源本身不區分「批次 crawl」或「單頁 scrape」：`/api/crawl` 會直接把批次任務寫進 `tasks/${taskId}.json`，而 `/api/scrape` 也委派 `runSingleScrapeTask()` 先建立單頁 task、再更新為 `completed` 或 `failed`，所以 Tasks 分頁其實是在看同一個 task 儲存層，而不是只看某一種建立模式。 Sources: [route.ts](app/api/crawl/route.ts#L59-L75), [route.ts](app/api/scrape/route.ts#L20-L37), [scrape-task.ts](lib/services/scrape-task.ts#L155-L240), [r2.ts](lib/r2.ts#L137-L149)

畫面上每張 task 卡片顯示的日期與進度也不是前端臨時湊的：卡片先用 `getTaskDisplayDate()`，優先取 `createdAt`、沒有才回退到 compact `date`，進度條則一律以 `(completed + failed) / total` 計算百分比；因此 Tasks 分頁其實是把 `JobTask` 原始欄位直接映射成 UI，而不是維護第二份 view model。 Sources: [page.tsx](app/page.tsx#L31-L46), [page.tsx](app/page.tsx#L2733-L2768), [task-metadata.ts](lib/utils/task-metadata.ts#L86-L115), [r2.ts](lib/r2.ts#L5-L22)

## 監控抽屜如何接手目前任務

監控抽屜由 `taskId`、`taskStatus`、`drawerOpen` 三個 state 驅動：只要 `taskId` 存在，前端就建立一個每 3 秒呼叫一次的 `/api/status/[taskId]` 輪詢；若此時還拿不到 snapshot，或 snapshot 仍是 `processing`，另一個 effect 會自動把抽屜打開。程式裡雖然有「完成後可停止輪詢」的註解，但目前沒有真的停止 interval，所以 terminal task 仍會持續查詢直到 `taskId` 改變或 effect cleanup。 Sources: [page.tsx](app/page.tsx#L472-L517), [route.ts](app/api/status/[taskId]/route.ts#L9-L24), [route.ts](app/api/status/[taskId]/route.ts#L35-L63)

抽屜不是只從 Tasks 分頁開啟：Create 分頁下半部的 Queue Tracker 也是讀同一份 `taskId/taskStatus`，而當抽屜被關閉但 `taskId` 尚存時，右下角還會出現浮動 `Task Progress` 按鈕重新打開它；換句話說，Tasks 分頁只是重新選取監控目標的入口，真正的監控 UI 是全頁共用的 overlay。 Sources: [page.tsx](app/page.tsx#L1461-L1651), [page.tsx](app/page.tsx#L2771-L2805), [page.tsx](app/page.tsx#L2808-L3071)

## 關鍵模組／操作對照表

| 功能 | 前端入口 | 後端/工具 | 實際效果 | 證據 |
| --- | --- | --- | --- | --- |
| 歷史任務載入 | `activeTab === 'tasks'` 時的 `loadTasks()` | `/api/tasks` | 依 `tasks/` 物件清單回讀完整 task，輸出前 20 筆歷史 | [page.tsx](app/page.tsx#L519-L550), [route.ts](app/api/tasks/route.ts#L22-L54) |
| 開啟監控 | `View Monitor` | 共用 `taskId` + `/api/status/[taskId]` | 選中某筆歷史任務後立即打開抽屜，後續狀態靠 polling 補齊 | [page.tsx](app/page.tsx#L2771-L2778), [page.tsx](app/page.tsx#L472-L517) |
| Retry Task | `handleRetryTask()` | `/api/retry` | 全量 URL 重設為 `pending`、整體 task 回到 `processing`，再重新 dispatch | [page.tsx](app/page.tsx#L924-L952), [route.ts](app/api/retry/route.ts#L36-L109) |
| Retry All Failed / Retry Single | `handleRetryAllFailed()` / `handleRetrySingle()` | `/api/retry` | 只把指定失敗 URL 改回 `pending`，保留其他已成功項目 | [page.tsx](app/page.tsx#L862-L922), [route.ts](app/api/retry/route.ts#L60-L109) |
| Abort Single | `handleAbortSingle()` | `/api/abort` | 把 `pending/processing` URL 改成 `failed` 並寫入 `User aborted` | [page.tsx](app/page.tsx#L834-L859), [route.ts](app/api/abort/route.ts#L35-L65) |
| 檔案大小 / 單檔下載 / ZIP 下載 | `fetchFileSizes()`、`handleDownloadSingle()`、`handleDownloadAll()` | `/api/files` + `download.ts` | 列 prefix、抓 key、單檔下載或打包 ZIP，0B/失敗檔會被記錄 | [page.tsx](app/page.tsx#L971-L1064), [route.ts](app/api/files/route.ts#L5-L64), [download.ts](lib/utils/download.ts#L14-L138) |
| 單筆重新清洗 | `handleCleanSingle()` | `/api/clean` | 重新讀 raw 檔、跑 LLM clean、覆寫 cleaned 檔後刷新 size | [page.tsx](app/page.tsx#L1066-L1088), [route.ts](app/api/clean/route.ts#L20-L68) |

## 抽屜內看到的資料，實際上從哪裡來

抽屜 header 與統計列只是在重排 `JobTask`：上方 badge 直接映射 `taskStatus.status`，主進度條仍用 `(completed + failed) / total`，下方的 success / failed / pending 三組統計則對應 `completed`、`failed` 和剩餘數；URL 清單逐列讀 `taskStatus.urls`，依 `pending / processing / success / failed` 切換圖示、錯誤訊息與按鈕顯示條件。 Sources: [page.tsx](app/page.tsx#L829-L832), [page.tsx](app/page.tsx#L2818-L3057), [r2.ts](lib/r2.ts#L5-L22)

成功 URL 的 Raw/Cleaned 容量不是 task JSON 內建欄位，而是抽屜開啟後才額外向 `/api/files` 查回來；前端用 `buildR2Key(url, 'raw'|'cleaned', date)` 當索引，把大小寫進 `fileSizes`，因此抽屜上看到的 `N/A`、`x KB` 或 `⚠ 0 B` 都是 UI 另一次查檔結果，不是後端 status route 直接回傳的任務欄位。 Sources: [page.tsx](app/page.tsx#L971-L1011), [page.tsx](app/page.tsx#L2959-L2973), [helpers.ts](lib/utils/helpers.ts#L21-L44), [route.ts](app/api/files/route.ts#L33-L43)

ZIP 與單檔下載失敗時，前端不只是跳 alert，還會把對應 key 經過 `markKeysAsFailed()` 映射回 `taskStatus.urls`，把該列標成 `failed` 方便後續點 `Retry`；而 `downloadFolderAsZip()` 也會把 0 Bytes 或下載失敗的鍵寫進 `download_errors.txt` 一起放入 ZIP。這代表抽屜裡部分 `failed` 狀態可能來自下載/檔案檢查，而不是爬取本身失敗。 Sources: [page.tsx](app/page.tsx#L954-L969), [page.tsx](app/page.tsx#L1013-L1064), [download.ts](lib/utils/download.ts#L45-L138)

## 設計限制與踩坑

Tasks 分頁本身沒有常駐 polling：它只在切進 `tasks` 分頁或 R2 覆蓋欄位變動時重新抓一次歷史，之後就只更新當前 `taskStatus`，不會自動刷新 `tasksList`。所以你若停留在 Tasks 分頁看著某筆任務進行中，卡片列表本身不一定會即時反映最新進度，真正即時的是抽屜。 Sources: [page.tsx](app/page.tsx#L519-L550), [page.tsx](app/page.tsx#L2715-L2784)

R2 override 的切換邏輯偏寬鬆：前端只要任一覆蓋欄位非空，就會對 `/api/tasks`、`/api/status`、`/api/files` 改送 POST；但 `resolveR2()` 一旦進入 credential override 路徑，就要求 `accountId`、`accessKeyId`、`secretAccessKey` 必須完整，因此使用者如果只填了一半自訂 R2 表單，反而可能讓原本可用的 env fallback 查詢失敗。 Sources: [page.tsx](app/page.tsx#L478-L491), [page.tsx](app/page.tsx#L525-L537), [page.tsx](app/page.tsx#L979-L983), [r2.ts](lib/r2.ts#L58-L86)

雖然 task 模型支援多 domain（`domains` 與 `domainSummary` 可表示單域或多域），但抽屜裡的檔案大小刷新與 ZIP 下載都只取「第一個成功 URL」的 hostname 來組 prefix，所以在跨網域批次任務裡，檔案操作其實是單 domain 視角，不會一次掃完整個 task 的所有 domain 目錄。 Sources: [task-metadata.ts](lib/utils/task-metadata.ts#L71-L84), [page.tsx](app/page.tsx#L973-L986), [page.tsx](app/page.tsx#L1030-L1046)

Retry 流程刻意不把 secrets 落地到 task JSON：建立 task 時會先用 `sanitizeEngineSettingsForStorage()` 移除 `firecrawlKey`、`llmApiKey`、`urlExtractorApiKey` 與 R2 認證欄位；等到 `retryAll` 時，再用 `mergeStoredTaskEngineSettingsForRetry()` 把目前前端提供的 runtime secrets 與既有的非敏感設定重新合併。這表示歷史任務可被安全保存，但從抽屜重試時，仍依賴你此刻畫面上的有效 API / R2 設定。 Sources: [route.ts](app/api/crawl/route.ts#L59-L75), [task-metadata.ts](lib/utils/task-metadata.ts#L125-L167), [route.ts](app/api/retry/route.ts#L44-L47)
