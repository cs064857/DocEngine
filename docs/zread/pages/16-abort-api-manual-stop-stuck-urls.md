# Abort API：人工終止卡住 URL

## 本頁範圍與讀者定位

本頁只說明既有 crawl 任務的 `POST /api/abort` 如何把「目前仍停在 `pending` 或 `processing`」的 URL 人工改標為失敗，讓監控畫面從卡住狀態往前收斂；它不建立新任務，也不是另一條 queue/worker pipeline，而是直接讀寫同一份 `tasks/{taskId}.json` 任務快照。 Sources: [abort route.ts](app/api/abort/route.ts#L10-L69), [r2.ts](lib/r2.ts#L137-L157)

## 核心流程

```mermaid
flowchart TD
    UI[Task Progress 抽屜 Abort 按鈕] --> HANDLER[handleAbortSingle(url)]
    HANDLER --> API[POST /api/abort]
    API --> LOAD[getTaskStatus(taskId)]
    LOAD --> CHECK{逐一檢查 urls[]}
    CHECK -->|pending / processing| FAIL[entry.status = failed\nentry.error = User aborted\nfailed++\nfailedUrls.push]
    CHECK -->|其他狀態或找不到| SKIP[不改動]
    FAIL --> DONE{completed + failed >= total?}
    SKIP --> DONE
    DONE --> SAVE[putTaskStatus(taskId)]
    SAVE --> POLL[/api/status/[taskId] 輪詢更新]
    SAVE --> TASKS[/api/tasks 下次重新載入可見]
```

這條路徑的本質是「前端送出單 URL abort 請求，後端回讀 task JSON、就地改寫狀態、再由查詢 API 把新快照反映回 UI」；目前內建畫面沒有 optimistic update，所以使用者看到的最終結果仍依賴 `/api/status/[taskId]` 的輪詢與 Tasks 分頁的重新載入。 Sources: [page.tsx](app/page.tsx#L834-L859), [abort route.ts](app/api/abort/route.ts#L29-L65), [status route.ts](app/api/status/[taskId]/route.ts#L31-L63), [tasks route.ts](app/api/tasks/route.ts#L67-L81), [page.tsx](app/page.tsx#L472-L550)

## API 契約與狀態改寫規則

後端契約很精簡：request body 必須帶 `taskId` 與非空的 `urls[]`，否則直接回 `400`；若指定 `taskId` 查不到 task JSON，則回 `404`。雖然 body 還接受 `engineSettings`，但這條 route 實際只抽取 `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 四個 R2 覆蓋欄位，用來決定要去哪個 bucket 讀寫任務狀態。 Sources: [abort route.ts](app/api/abort/route.ts#L12-L33), [r2.ts](lib/r2.ts#L58-L87)

API 本身支援批次 abort，因為它會逐一迭代 `urls[]`；但目前內建 UI 的 `handleAbortSingle()` 每次只送 `{ taskId, urls: [url] }`，而且按鈕只出現在 `pending` / `processing` 的列尾，所以產品層暴露的是「單筆人工止損」，不是批次終止工具。 Sources: [abort route.ts](app/api/abort/route.ts#L35-L48), [page.tsx](app/page.tsx#L834-L859), [page.tsx](app/page.tsx#L2983-L3000)

真正的狀態改寫規則只有一條：若 `taskStatus.urls` 裡找得到該 URL，且目前狀態是 `pending` 或 `processing`，route 就把該 entry 改成 `failed`、把 `error` 固定寫成 `User aborted`、整體 `failed` 計數加一，並把同一筆 `{ url, error }` 追加到 `failedUrls[]`；若 URL 不存在，或已經是 `success/failed`，就不會被計入 `abortedCount`。 Sources: [abort route.ts](app/api/abort/route.ts#L35-L48), [r2.ts](lib/r2.ts#L5-L22)

Abort 之後的整體完成判定與 worker 共用同一套聚合語義：只要 `completed + failed >= total`，task 就會被標成 `completed`；前端進度條也正是用 `(completed + failed) / total` 算百分比，所以人工 abort 會立刻把任務往「已處理完」方向推進，而不是停留在 `processing`。 Sources: [abort route.ts](app/api/abort/route.ts#L52-L65), [page.tsx](app/page.tsx#L829-L832), [r2.ts](lib/r2.ts#L5-L22)

## 前端如何觸發與看到結果

監控抽屜的 URL 列表只有在項目狀態為 `pending` 或 `processing` 時才渲染 Abort 按鈕；點擊後前端先把該 URL 放進本地 `abortingUrls` 集合，用來 disable 按鈕並顯示 spinner，避免重複點擊。這個本地集合只是 UI loading state，不是後端任務狀態的一部分。 Sources: [page.tsx](app/page.tsx#L161-L170), [page.tsx](app/page.tsx#L835-L859), [page.tsx](app/page.tsx#L2975-L3000)

`handleAbortSingle()` 本身不會直接改 `taskStatus`，也沒有檢查 `fetch('/api/abort')` 的 `res.ok`；因此 400/404/500 這類 HTTP 錯誤不會自動進入 `catch`，畫面上通常只會看到 spinner 結束，真正是否成功仍要等下一輪 `/api/status/[taskId]` 讀回來。若你人在 Tasks 分頁，歷史清單也不會常駐 polling，而是只有切進該分頁或 R2 覆蓋欄位改變時才重新抓一次 `/api/tasks`。 Sources: [page.tsx](app/page.tsx#L844-L855), [abort route.ts](app/api/abort/route.ts#L15-L17), [abort route.ts](app/api/abort/route.ts#L29-L33), [abort route.ts](app/api/abort/route.ts#L66-L69), [page.tsx](app/page.tsx#L472-L550), [status route.ts](app/api/status/[taskId]/route.ts#L31-L63), [tasks route.ts](app/api/tasks/route.ts#L67-L81)

換句話說，Abort 的可見結果分成兩層：當前監控抽屜依賴 `POST /api/status/[taskId]` 或 `GET /api/status/[taskId]` 每 3 秒回讀同一個 task，而歷史任務卡片則只有在 `/api/tasks` 被重新觸發時才看到更新。這也說明 Abort API 是改「既有 task snapshot」，不是建立另一筆補丁事件。 Sources: [page.tsx](app/page.tsx#L472-L550), [status route.ts](app/api/status/[taskId]/route.ts#L5-L67), [tasks route.ts](app/api/tasks/route.ts#L22-L87), [r2.ts](lib/r2.ts#L137-L157)

## 與 worker 的關係：狀態修補，不是真正取消

從目前程式結構看，`/api/abort` 沒有把任何 abort flag、cancellation token 或 queue control 訊號傳給執行層；`processCrawlJob()` 仍會照原本流程把 URL 標成 `processing`、呼叫 `scrapeUrl()`、視需要 `cleanContent()`、寫入 raw/cleaned 檔，再用 `updateTaskStatus()` 回寫成功或失敗。因此 Abort API 更像控制平面的人工狀態修補，而不是對已在跑的抓取請求做真正中斷。 Sources: [abort route.ts](app/api/abort/route.ts#L29-L65), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L129-L145), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L165-L225)

這也帶來一個明確的競態風險：如果某 URL 已經進入 `processCrawlJob()`，途中又被 `/api/abort` 人工標成 failed，Abort 會先把 `failed += 1` 並寫入 `failedUrls[]`；但若 worker 之後成功，`updateTaskStatus()` 的 success 分支只會再做 `completed += 1`、把 `urls[]` entry 改成 `success`，不會回頭扣掉先前的 `failed` 或清理 `failedUrls[]`。也就是說，人工 abort 與執行中 worker 之間目前沒有協調機制，最終可能出現聚合計數與單筆 URL 狀態不完全一致的 snapshot。 Sources: [abort route.ts](app/api/abort/route.ts#L35-L58), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L261-L297)

## 關鍵模組 / 檔案導覽

| 檔案 | 角色 | 本頁重點 |
|---|---|---|
| `app/api/abort/route.ts` | Abort API 入口 | 驗證 `taskId` / `urls[]`、抽取 R2 覆蓋、修改 `urls[]` 與 `failedUrls[]`、寫回 task JSON |
| `app/page.tsx` | Abort UI 與監控 | 只對 `pending/processing` 顯示按鈕，送單 URL abort，靠 polling 讀回結果 |
| `app/api/status/[taskId]/route.ts` | 即時查詢端點 | 讓抽屜每 3 秒拉回 abort 後的最新 task snapshot |
| `app/api/tasks/route.ts` | 歷史任務列表 | 從 `tasks/` prefix 回讀歷史 task，供 Tasks 分頁重新接手監控 |
| `lib/services/crawl-dispatch.ts` | URL worker 核心 | 顯示執行層沒有 abort 檢查，並揭露人工 abort 與 worker 成功回寫的競態 |
| `lib/r2.ts` | 任務模型與持久化 | 定義 `JobTask`、`urls[]`、`failedUrls[]`，並把任務寫在 `tasks/{taskId}.json` |

這六個檔案合起來，就是「UI 發出人工終止 → route 改 task snapshot → status/tasks 查詢端點再把結果讀回來」的完整閉環；其中真正容易誤會的地方，是 Abort 與 worker 其實沒有共享取消語義。 Sources: [abort route.ts](app/api/abort/route.ts#L10-L69), [page.tsx](app/page.tsx#L472-L550), [page.tsx](app/page.tsx#L834-L859), [status route.ts](app/api/status/[taskId]/route.ts#L5-L67), [tasks route.ts](app/api/tasks/route.ts#L22-L87), [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L129-L297), [r2.ts](lib/r2.ts#L5-L22), [r2.ts](lib/r2.ts#L137-L157)

## 已知邊界與踩坑

第一個邊界是「後端批次、前端單筆」的落差：API 回應雖然會回 `message: "{abortedCount} URL(s) aborted"`，但 `aborted` 欄位直接回傳原始輸入的 `urls`，不是實際有被改動的子集合；若 caller 送入已經 `success/failed` 的 URL，message 與 `aborted` 陣列的語義就可能不同。內建 UI 目前因為只在 `pending/processing` 列上送單一 URL，所以避開了這個歧義。 Sources: [abort route.ts](app/api/abort/route.ts#L35-L48), [abort route.ts](app/api/abort/route.ts#L60-L65), [page.tsx](app/page.tsx#L2983-L3000)

第二個邊界是 R2 覆蓋設定：`/api/abort` 只把 `engineSettings` 當成 R2 覆蓋來源，而 `resolveR2()` 一旦判定你有提供任一 credential override，就要求 `accountId`、`accessKeyId`、`secretAccessKey` 三者完整；因此如果使用者在 UI 上只填了一部分自訂 R2 欄位，Abort 的讀取或寫回就可能在 R2 層直接失敗。 Sources: [abort route.ts](app/api/abort/route.ts#L19-L30), [page.tsx](app/page.tsx#L839-L849), [r2.ts](lib/r2.ts#L58-L87)

第三個邊界是監控來源：當前 task 的真實狀態應以 `/api/status/[taskId]` 輪詢結果為準，不應只看按鈕 spinner 或 Tasks 卡片。因為 Abort handler 不做 optimistic update、Tasks 分頁也不做常駐 polling，所以「按下按鈕了」不等於「所有視圖都已同步到 abort 後的 task 狀態」。 Sources: [page.tsx](app/page.tsx#L472-L550), [page.tsx](app/page.tsx#L844-L855), [status route.ts](app/api/status/[taskId]/route.ts#L31-L63), [tasks route.ts](app/api/tasks/route.ts#L22-L87)
