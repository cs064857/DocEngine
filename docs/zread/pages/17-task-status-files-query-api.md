# Task / Status / Files 查詢 API

本頁只聚焦三個「讀面」端點：`/api/status/[taskId]` 讀單筆任務快照、`/api/tasks` 讀最近任務清單、`/api/files` 讀 raw/cleaned 等 R2 物件；它們本身不建立任務，也不直接執行爬取，而是把既有的 task JSON 與檔案物件轉成前端可查詢的 HTTP 介面。 Sources: [route.ts](app/api/status/[taskId]/route.ts#L9-L24), [route.ts](app/api/tasks/route.ts#L22-L54), [route.ts](app/api/files/route.ts#L5-L64), [r2.ts](lib/r2.ts#L123-L157)

## 這三個 API 在任務生命週期中的位置

```mermaid
flowchart LR
  A[/api/crawl 建立 batch task/] --> B[putTaskStatus -> tasks/{taskId}.json]
  C[runSingleScrapeTask] --> B
  D[processCrawlJob / updateTaskStatus] --> B
  D --> E[putObject -> raw/ 與 cleaned/]
  B --> F[/api/status/[taskId]]
  B --> G[/api/tasks]
  E --> H[/api/files]
  F --> I[Monitor Drawer]
  G --> J[Tasks 分頁]
  H --> I
```

這三個查詢 API 都是建立在同一層 R2 持久化之上：`/api/crawl` 與 `runSingleScrapeTask()` 先把 `JobTask` 寫到 `tasks/{taskId}.json`，queue/inline worker 再持續更新完成數、失敗數與逐 URL 狀態，同時把 raw/cleaned markdown 寫到對應 prefix；之後 `/api/status/[taskId]`、`/api/tasks`、`/api/files` 只是把這些既有物件重新讀出。 Sources: [route.ts](app/api/crawl/route.ts#L42-L75), [scrape-task.ts](lib/services/scrape-task.ts#L135-L206), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L165-L205), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L261-L297), [r2.ts](lib/r2.ts#L137-L157)

## 端點責任切分總覽

| API | 查詢維度 | 讀取來源 | 回傳形狀 | 特殊處理 / 證據 |
| --- | --- | --- | --- | --- |
| `/api/status/[taskId]` | 單一 `taskId` | `tasks/{taskId}.json` | 直接回傳單筆 `JobTask` | 找不到回 `404`；GET 用預設 R2，POST 可帶 `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 覆蓋。 [route.ts](app/api/status/[taskId]/route.ts#L9-L24), [route.ts](app/api/status/[taskId]/route.ts#L35-L63), [r2.ts](lib/r2.ts#L145-L157) |
| `/api/tasks` | 最近任務列表 | `tasks/` prefix + 各 task JSON | `{ tasks: JobTask[] }` | 先列最多 1000 個物件、按 `LastModified` 倒序、只取前 20，再逐筆 `getTaskStatus()`。 [route.ts](app/api/tasks/route.ts#L22-L54), [r2.ts](lib/r2.ts#L123-L157) |
| `/api/files` | 單檔或 prefix 清單 | 任意 R2 key / prefix | 單檔文字內容或 `{ files: [{ key, size, lastModified }] }` | `key` 模式回內容，`prefix` 模式回清單；POST 只用來帶 R2 override，真正的 `key/prefix/limit` 還是走 query string。 [route.ts](app/api/files/route.ts#L5-L49), [route.ts](app/api/files/route.ts#L52-L64) |

三條 API 的共同模式是「GET 走環境預設、POST 走同一路由但額外帶 R2 override」；不過真正決定要不要建立 override client 的地方不是 route 本身，而是 `resolveR2()`，所以三條 route 的存取邏輯最終仍收斂到同一個 R2 client 選擇器。 Sources: [route.ts](app/api/status/[taskId]/route.ts#L9-L24), [route.ts](app/api/status/[taskId]/route.ts#L35-L63), [route.ts](app/api/tasks/route.ts#L56-L87), [route.ts](app/api/files/route.ts#L52-L64), [r2.ts](lib/r2.ts#L54-L86)

## `/api/status/[taskId]`：單筆 task snapshot

`/api/status/[taskId]` 是最薄的一層讀面：它只檢查 `taskId` 是否存在，接著直接呼叫 `getTaskStatus(taskId)` 讀 `tasks/{taskId}.json`，找到就把整份 `JobTask` JSON 原樣回傳，找不到則回 `404`。因此它比較像「task snapshot lookup」，而不是會再做聚合、排序或欄位補完的 view API。 Sources: [route.ts](app/api/status/[taskId]/route.ts#L9-L28), [r2.ts](lib/r2.ts#L145-L157), [page.tsx](app/page.tsx#L31-L46)

這也解釋了前端為什麼可以把 `/api/status/[taskId]` 的回應直接塞進 `taskStatus`：`app/page.tsx` 內的 `JobTask` 介面與 `lib/r2.ts` 的 `JobTask` 結構幾乎對齊，所以 status route 不需要做額外 DTO 轉換。 Sources: [page.tsx](app/page.tsx#L31-L46), [page.tsx](app/page.tsx#L472-L500), [r2.ts](lib/r2.ts#L5-L22)

## `/api/tasks`：最近 20 筆任務視圖

`/api/tasks` 不是直接掃 JSON 內容排序，而是先用 `listObjects('tasks/', 1000)` 列出最多 1000 個 task 物件、按 R2 `LastModified` 由新到舊排序、只保留前 20 筆 key，再逐一回頭呼叫 `getTaskStatus()` 讀完整 JSON。換句話說，它是「prefix listing + top-N hydrate」的最近任務視圖，而不是可自由分頁或條件搜尋的查詢器。 Sources: [route.ts](app/api/tasks/route.ts#L22-L54), [r2.ts](lib/r2.ts#L123-L157)

`/api/tasks` 比 `/api/status/[taskId]` 多做的一件事，是補正舊任務的網域摘要：如果 task 已經有 `domainSummary` 與 `domains` 就原樣保留；否則 route 會從 `urls[].url`，或在沒有 tracked urls 時從 `failedUrls[].url` 回推網域，再用 `summarizeDomains()` 產生單域名稱或像 `2 domains` 這種摘要。測試也驗證了 `getTaskDisplayDate()` 會優先顯示 `createdAt`，以及多網域時摘要會落成「N domains」，所以歷史列表上的日期與 domain chip 都是 API/utility 正規化後的結果。 Sources: [route.ts](app/api/tasks/route.ts#L6-L20), [task-metadata.ts](lib/utils/task-metadata.ts#L71-L115), [tests/task-metadata.test.ts](tests/task-metadata.test.ts#L17-L49), [page.tsx](app/page.tsx#L2733-L2768)

## `/api/files`：單檔讀取與 prefix 列舉

`/api/files` 把兩種查詢模式塞在同一個 handler：如果 query string 有 `key`，它就用 `getObject(key)` 直接回檔案內容，且依副檔名把 `.json` 標成 `application/json`、其他檔案標成 `text/markdown`，並附上 1 小時快取；如果沒有 `key`，則會用 `prefix` 與 `limit` 呼叫 `listObjects()`，把結果轉成 `{ key, size, lastModified }` 陣列。 Sources: [route.ts](app/api/files/route.ts#L5-L49), [r2.ts](lib/r2.ts#L106-L132)

這個 route 的預設 `limit` 其實只有 50，但前端監控抽屜在查檔案大小時，和 `downloadFolderAsZip()` 在做 ZIP 前置 listing 時，都會顯式帶 `limit=1000`；而 ZIP 本身也不是後端 route 直接產生，而是前端先用 `/api/files?prefix=...` 取清單，再並行呼叫 `/api/files?key=...` 把內容拉回來後用 `JSZip` 在瀏覽器端打包。 Sources: [route.ts](app/api/files/route.ts#L7-L10), [page.tsx](app/page.tsx#L971-L999), [download.ts](lib/utils/download.ts#L14-L31), [download.ts](lib/utils/download.ts#L48-L138)

## 前端如何把三個查詢 API 接成監控體驗

前端只要有 `taskId`，就會每 3 秒輪詢一次 `/api/status/[taskId]`，並把結果寫入 `taskStatus`；而 `Tasks` 分頁則是 lazy load，只有 `activeTab === 'tasks'` 時才會打 `/api/tasks` 取最近歷史。點擊 `View Monitor` 後，前端只是把該筆 `taskId` 放回全域 state 並打開抽屜，後續明細仍然完全靠 status API 補齊。 Sources: [page.tsx](app/page.tsx#L472-L550), [page.tsx](app/page.tsx#L2710-L2805)

檔案相關 UI 則是在 status snapshot 之外再疊一層 `/api/files`：抽屜開啟且有成功 URL 時，前端會用第一個成功 URL 的 hostname 組出 `raw/{date}/{domain}/` 與 `cleaned/{date}/{domain}/` prefix 來抓 size；畫面上每列顯示的 Raw/Cleaned 大小，則是再用 `buildR2Key(url, 'raw'|'cleaned', date)` 對回 `/api/files` 回傳的 `key`。單檔下載呼叫 `downloadSingleFile()`，整批下載則呼叫 `downloadFolderAsZip()`，後者會以 5 條 worker 並行抓內容，並把 0B 或抓取失敗的 key 記錄進 `download_errors.txt`。 Sources: [page.tsx](app/page.tsx#L971-L1064), [page.tsx](app/page.tsx#L2959-L3044), [helpers.ts](lib/utils/helpers.ts#L21-L44), [download.ts](lib/utils/download.ts#L48-L138)

## 已知限制與踩坑

第一個坑是 R2 override 的切換條件比真正的 backend 驗證寬鬆：前端只要看到 `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 任一欄位非空，就會把 `/api/status`、`/api/tasks`、`/api/files` 改成 POST；但 `resolveR2()` 一旦判定要進 credential override 路徑，就要求 `accountId`、`accessKeyId`、`secretAccessKey` 必須能完整湊齊，因此「只填了一半自訂 R2 表單」可能比完全不填更容易讓查詢失敗。 Sources: [page.tsx](app/page.tsx#L478-L491), [page.tsx](app/page.tsx#L525-L537), [page.tsx](app/page.tsx#L978-L983), [r2.ts](lib/r2.ts#L58-L86)

第二個坑是 task 模型雖然支援多網域，但檔案查詢/下載 UI 其實是單網域視角：`summarizeDomains()` 與測試都證明 task 可以表達單域或多域；然而抽屜的 `fetchFileSizes()` 與 `handleDownloadAll()` 都只取「第一個成功 URL」的 hostname 組 prefix，因此跨網域批次任務的 raw/cleaned 檔案不會在同一次 `/api/files` 查詢或單次 ZIP 下載裡被完整涵蓋。 Sources: [task-metadata.ts](lib/utils/task-metadata.ts#L71-L84), [tests/task-metadata.test.ts](tests/task-metadata.test.ts#L25-L49), [page.tsx](app/page.tsx#L973-L986), [page.tsx](app/page.tsx#L1030-L1046)

第三個坑是歷史排序鍵不是 `createdAt`：`/api/tasks` 在讀完整 JSON 之前就先按 R2 物件的 `LastModified` 排序，因此 Tasks 分頁上的顯示日期雖然用 `getTaskDisplayDate()` 呈現 `createdAt` 或 compact `date`，真正決定誰排前面的仍是物件最後一次被寫回 R2 的時間。對會被 retry、abort 或 worker 持續更新的 task 來說，這兩者不一定相同。 Sources: [route.ts](app/api/tasks/route.ts#L22-L34), [task-metadata.ts](lib/utils/task-metadata.ts#L110-L115), [page.tsx](app/page.tsx#L2750-L2753), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L295-L323)

第四個坑是前端目前不會在 task 終態後自動停掉 status polling：effect 內雖然留了「Task is completely finished, you could stop polling here if desired」的註解，但實作上仍固定維持 `setInterval(fetchStatus, 3000)`，直到 `taskId` 改變或 effect cleanup 才清掉。所以 terminal task 仍可能持續打 `/api/status/[taskId]`。 Sources: [page.tsx](app/page.tsx#L472-L510), [route.ts](app/api/status/[taskId]/route.ts#L19-L24)
