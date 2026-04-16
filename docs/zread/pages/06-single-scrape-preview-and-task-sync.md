# 單頁 Scrape 的即時預覽與任務同步

本頁聚焦 Create 分頁裡 `sourceType = 'scrape'` 且輸入為單一 URL 時的實際程式流程：前端如何分流到 `/api/scrape`、後端如何先建立標準 `JobTask` 再執行 scrape，以及這筆單頁結果如何同步到目前監控狀態與 Tasks 歷史。Sources: [page.tsx](app/page.tsx#L92-L95), [page.tsx](app/page.tsx#L566-L756), [app/api/scrape/route.ts](app/api/scrape/route.ts#L8-L45)

## 一張圖看懂單頁 Scrape 的同步鏈

```mermaid
flowchart TD
  A[Create / Scrape mode] --> B[handleScrape]
  B --> C{inputValue 是單一 URL?}
  C -- 否: 多行 / 逗號 / .xml --> D[handleSubmit]
  D --> E[/api/crawl]

  C -- 是 --> F[/api/scrape]
  F --> G[runSingleScrapeTask]
  G --> H[putTaskStatus processing]
  H --> I[scrapeUrlAdvanced]
  I --> J{enableClean?}
  J -- yes --> K[cleanContent]
  J -- no --> L[skip clean]
  K --> M{saveToR2?}
  L --> M
  M -- yes --> N[putObject raw / cleaned]
  M -- no --> O[skip R2 write]
  N --> P[putTaskStatus completed or failed]
  O --> P
  P --> Q[response: taskId task markdown]
  Q --> R[setScrapeResult]
  Q --> S[conditional setTaskId / setTaskStatus]
  S --> T[/api/status task polling]
  P --> U[/api/tasks 讀 tasks/ 歷史]
```

這條鏈的關鍵不是「先拿內容、後補 task」，而是相反：`runSingleScrapeTask()` 一開始就把單頁工作寫成 `processing` 的 `JobTask`，之後才進行 scrape、清理、R2 寫入與最終狀態更新，所以單頁 Scrape 從資料模型角度本來就是標準 task，只是前端同時還保留了 `scrapeResult` 這條即時內容通道。Sources: [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L135-L168), [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L170-L240), [lib/r2.ts](lib/r2.ts#L6-L22), [lib/r2.ts](lib/r2.ts#L137-L149)

## 前端入口：`Scrape Now` 不一定真的走單頁預覽

Create 頁預設開在 `activeTab = 'create'` 與 `sourceType = 'scrape'`，Scrape 模式的主輸入欄位是共用的 `inputValue` textarea，按鈕則直接綁到 `handleScrape()`。Sources: [page.tsx](app/page.tsx#L92-L95), [page.tsx](app/page.tsx#L1120-L1167), [page.tsx](app/page.tsx#L1267-L1297)

`handleScrape()` 先檢查輸入是否包含換行、逗號，或是否以 `.xml` 結尾；只要命中其中一種情況，就不走 `/api/scrape`，而是直接呼叫 `handleSubmit()` 轉進 `/api/crawl` 的批次路徑，因此這個按鈕其實是「智慧分流入口」，不是保證單頁模式。Sources: [page.tsx](app/page.tsx#L566-L624), [page.tsx](app/page.tsx#L675-L690)

只有在輸入被判定為單一 URL 時，前端才會 POST `/api/scrape`，而且送出的 payload 不是批次 task 的 `maxUrls`/`maxRetries` 組合，而是單頁專用的 `waitFor`、`timeout`、`onlyMainContent`、`mobile`、`includeTags`、`excludeTags`，外加 `saveToR2`、`enableClean`、LLM 連線資訊與 R2 覆蓋欄位名稱。Sources: [page.tsx](app/page.tsx#L698-L721), [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L89-L132)

## 後端任務服務：先建 task，再做 scrape / clean / save

`/api/scrape` route 本身很薄：它只做 `url` 參數驗證，然後把整個 body 交給 `runSingleScrapeTask()`；若 service 回傳失敗，route 仍會把 `taskId` 與 `task` 一起放進 500 回應，讓前端即使失敗也能同步到任務層。Sources: [app/api/scrape/route.ts](app/api/scrape/route.ts#L8-L45)

`runSingleScrapeTask()` 會先產生 `taskId`、`date`、`createdAt`，再以 `total = 1`、`completed = 0`、`failed = 0`、`urls = [{ url, status: 'processing' }]` 建出基底 task，並用 `summarizeDomains()` 補上 `domains` / `domainSummary`；這筆資料接著透過 `putTaskStatus()` 寫入 `tasks/{taskId}.json`。Sources: [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L135-L168), [lib/utils/task-metadata.ts](lib/utils/task-metadata.ts#L71-L84), [lib/r2.ts](lib/r2.ts#L137-L149)

成功路徑中，service 先呼叫 `scrapeUrlAdvanced()` 取得 `markdown` 與 `metadata`，再依 `enableClean` 決定是否跑 `cleanContent()`；若 `saveToR2` 為真，則用 `buildR2Key()` 生成 `raw/{date}/{domain}/...` 與 `cleaned/{date}/{domain}/...` 路徑寫入 R2，最後把 task 更新成 `completed` 並回傳 `markdown`、`cleanedMarkdown`、字數統計與 `r2.rawKey` / `r2.cleanedKey`。Sources: [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L170-L220), [lib/utils/helpers.ts](lib/utils/helpers.ts#L21-L43), [lib/r2.ts](lib/r2.ts#L92-L100)

失敗路徑不會中斷 task 模型：service 會把同一筆 task 更新成 `status = 'failed'`、`failed = 1`、`failedUrls` 與 `urls[].error`，再把失敗版 task 與錯誤字串回傳；測試也明確驗證了成功時會寫兩次狀態（`processing` → `completed`），失敗時也會寫兩次狀態（`processing` → `failed`）。Sources: [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L221-L240), [tests/scrape-task.test.ts](tests/scrape-task.test.ts#L6-L85), [tests/scrape-task.test.ts](tests/scrape-task.test.ts#L87-L156)

## 同步到畫面：preview、tracker 與 history 是三條不同節奏

| 同步面向 | 前端觸發點 | 後端 / 儲存依據 | 畫面結果 |
|---|---|---|---|
| 即時內容結果 | [`handleScrape()` 解析 `/api/scrape` 回應後呼叫 `setScrapeResult()`](app/page.tsx#L724-L746) | [`runSingleScrapeTask()` 回傳 `markdown`、`cleanedMarkdown`、`metadata`、字數與 `r2` keys](lib/services/scrape-task.ts#L208-L220) | [`scrapeResult` 面板可切換 Raw/Cleaned、顯示字數、HTTP status 與 R2 keys](app/page.tsx#L1463-L1549) |
| 當前 task 監控 | [`handleScrape()` 在回應內含 `taskId` / `task` 時條件式設定 `taskStatus` 與 `taskId`](app/page.tsx#L726-L737)；之後每 3 秒輪詢 [`/api/status/[taskId]`](app/api/status/[taskId]/route.ts#L31-L63) | [`getTaskStatus()` 讀取 `tasks/{taskId}.json`](lib/r2.ts#L145-L156) | [`calculateProgress()` 與 Tracker Board / Drawer 使用同一份 `taskStatus`](app/page.tsx#L472-L517), [page.tsx](app/page.tsx#L829-L832), [page.tsx](app/page.tsx#L1555-L1595), [page.tsx](app/page.tsx#L2791-L2822) |
| 歷史任務清單 | [`activeTab === 'tasks'` 時才載入 `tasksList`](app/page.tsx#L519-L550) | [`/api/tasks` 先列 `tasks/`，按 `LastModified` 倒序取前 20，再逐筆 `getTaskStatus()`，並用 `normalizeTask()` 補 domain 摘要](app/api/tasks/route.ts#L6-L54), [app/api/tasks/route.ts](app/api/tasks/route.ts#L56-L87) | [Tasks 分頁列出狀態、domain chip、日期、進度與 `View Monitor`](app/page.tsx#L2710-L2780) |

這代表目前沒有單一「全域即時同步匯流排」：單頁內容靠 `/api/scrape` 同步回傳、目前任務靠 `taskId` + `/api/status/[taskId]` 輪詢、歷史清單則是使用者切到 Tasks 分頁時重新 pull `tasks/` 前綴。Sources: [page.tsx](app/page.tsx#L472-L550), [app/api/tasks/route.ts](app/api/tasks/route.ts#L22-L54), [app/api/status/[taskId]/route.ts](app/api/status/[taskId]/route.ts#L31-L63)

畫面真正的優先序是 `sourceType === 'scrape' && !taskId` 才顯示預覽面板；一旦 `taskId` 已存在，主區塊就改顯示 Tracker Board。由於 `handleScrape()` 在成功或失敗時都可能把回傳的 `taskId` / `task` 綁進 state，因此 `scrapeResult` 雖然已寫入，主畫面仍可能立即切到 tracker，而不是停留在 preview。Sources: [page.tsx](app/page.tsx#L726-L746), [page.tsx](app/page.tsx#L1461-L1555)

Drawer 的自動打開條件也偏向「監控進行中任務」：只有 `taskId` 已設定且 `taskStatus` 尚未存在或狀態為 `processing` 時，effect 才會 `setDrawerOpen(true)`；因此對已經完成的單頁 scrape，較常見的入口是 Tracker Board 本身或右下角的浮動 `Task Progress` 按鈕，而不是自動展開的 Drawer。Sources: [page.tsx](app/page.tsx#L512-L517), [page.tsx](app/page.tsx#L2790-L2805), [page.tsx](app/page.tsx#L2808-L2822)

如果使用者在 UI 中填了 R2 覆蓋欄位名稱（`r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName`），前端查詢 task 狀態與 task 歷史時會改用 POST 把這些欄位送到 `/api/status/[taskId]` 與 `/api/tasks`；後端再用 `resolveR2()` 優先採用覆蓋值，否則退回環境變數預設。Sources: [page.tsx](app/page.tsx#L476-L491), [page.tsx](app/page.tsx#L521-L537), [app/api/status/[taskId]/route.ts](app/api/status/[taskId]/route.ts#L35-L63), [app/api/tasks/route.ts](app/api/tasks/route.ts#L67-L81), [lib/r2.ts](lib/r2.ts#L54-L86)

## 關鍵模組／檔案導覽

| 檔案 | 在本頁的角色 |
|---|---|
| [`app/page.tsx#L675-L756`](app/page.tsx#L675-L756) | `handleScrape()` 的單頁 / 批次分流、`/api/scrape` 呼叫與回應同步。 |
| [`app/page.tsx#L472-L550`](app/page.tsx#L472-L550) | `taskId` 狀態輪詢、Drawer 自動打開規則與 Tasks 分頁載入時機。 |
| [`app/page.tsx#L1461-L1555`](app/page.tsx#L1461-L1555) | 預覽面板與 Tracker Board 的實際 render gate。 |
| [`app/api/scrape/route.ts#L8-L45`](app/api/scrape/route.ts#L8-L45) | 單頁 scrape API 入口，負責驗證輸入並委派給 service。 |
| [`lib/services/scrape-task.ts#L155-L240`](lib/services/scrape-task.ts#L155-L240) | 單頁 task 的建立、scrape、清理、R2 寫入與成功/失敗更新。 |
| [`lib/r2.ts#L137-L156`](lib/r2.ts#L137-L156) | `tasks/{taskId}.json` 的寫入與讀取，是同步與歷史的共用落點。 |
| [`app/api/status/[taskId]/route.ts#L31-L63`](app/api/status/[taskId]/route.ts#L31-L63) | 目前任務監控查詢端點，支援 R2 覆蓋認證。 |
| [`app/api/tasks/route.ts#L22-L87`](app/api/tasks/route.ts#L22-L87) | 歷史任務列表端點，從 `tasks/` prefix 回讀最近 20 筆。 |
| [`tests/scrape-task.test.ts#L6-L156`](tests/scrape-task.test.ts#L6-L156) | 驗證單頁 scrape task 服務的成功與失敗生命週期。 |

如果你要追這頁的核心真相，建議先看 `app/page.tsx` 的 `handleScrape()` 與 render gate，再看 `scrape-task.ts` 如何把單頁結果固化成 `tasks/{taskId}.json`，最後用 `status` / `tasks` 兩個 API 收斂目前監控與歷史列表。Sources: [app/page.tsx](app/page.tsx#L472-L550), [app/page.tsx](app/page.tsx#L675-L756), [app/page.tsx](app/page.tsx#L1461-L1555), [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L155-L240), [app/api/tasks/route.ts](app/api/tasks/route.ts#L22-L87), [app/api/status/[taskId]/route.ts](app/api/status/[taskId]/route.ts#L31-L63)

## 常見誤解／目前邊界

- **「Scrape Now 成功後，主畫面一定停留在 preview。」** 目前 render 條件其實是 `sourceType === 'scrape' && !taskId`；而 `handleScrape()` 在拿到 `taskId` / `task` 後就可能把主區塊切去 tracker。Sources: [page.tsx](app/page.tsx#L726-L746), [page.tsx](app/page.tsx#L1461-L1555)
- **「單頁 scrape 只有成功時才會留下 task。」** 失敗路徑同樣會把 task 更新成 `failed` 並回傳 `taskId` / `task`，所以錯誤也會落進標準任務模型。Sources: [app/api/scrape/route.ts](app/api/scrape/route.ts#L24-L33), [lib/services/scrape-task.ts](lib/services/scrape-task.ts#L221-L240), [tests/scrape-task.test.ts](tests/scrape-task.test.ts#L87-L156)
- **「Tasks 分頁會在單頁 scrape 完成後自動 live refresh。」** 目前可見的刷新觸發條件是切到 `activeTab === 'tasks'` 或 R2 覆蓋欄位變更；它是 pull-based 載入，不是由單頁 scrape 完成事件主動推送。Sources: [page.tsx](app/page.tsx#L519-L550)
- **「查 task 一定只能依賴環境變數裡的 R2 設定。」** `status` 與 `tasks` 兩個 API 都支援前端 POST 覆蓋欄位名稱，`resolveR2()` 也會優先使用這些覆蓋值。Sources: [app/api/status/[taskId]/route.ts](app/api/status/[taskId]/route.ts#L35-L63), [app/api/tasks/route.ts](app/api/tasks/route.ts#L67-L81), [lib/r2.ts](lib/r2.ts#L54-L86)
