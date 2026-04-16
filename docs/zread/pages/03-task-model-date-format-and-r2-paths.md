# 任務資料模型、日期格式與 R2 路徑規則

本頁聚焦三件事：爬取/單頁 scrape 任務共用的 `JobTask` 結構、`date` 與 `createdAt`/`updatedAt` 的格式分工，以及 R2 中 `tasks/`、`raw/`、`cleaned/`、`skill-tasks/`、`skills/` 這些前綴的實際命名規則。若你正在追查任務監控、重試、檔案下載、或 skill 產物落點，這頁就是最短的程式碼入口。  
Sources: [r2.ts](../../../lib/r2.ts#L6-L22), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L9-L25), [helpers.ts](../../../lib/utils/helpers.ts#L11-L44)

## 核心流程總覽

```mermaid
flowchart LR
    A[/api/crawl/] --> B[tasks/{taskId}.json]
    S[/api/scrape/] --> B
    B --> C[dispatch / scrape task lifecycle]
    C --> D[raw/{date}/{domain}/{path}.md]
    C --> E[cleaned/{date}/{domain}/{path}.md]
    E --> F[/api/generate-skill/]
    F --> G[skill-tasks/{taskId}.json]
    F --> H[skills/{date}/{domain}/{taskId}/]
```

Batch crawl 先建立 `tasks/{taskId}.json`，之後由 worker 逐 URL 回寫進度並落 raw/cleaned 檔；單頁 scrape 走同一個 task JSON 形狀，只是總數固定為 1；skill 生成則另外使用 `skill-tasks/{taskId}.json` 追蹤 phase，最後把產物寫進 versioned `skills/{date}/{domain}/{taskId}/` 目錄。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L42-L98), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L205), [scrape-task.ts](../../../lib/services/scrape-task.ts#L155-L239), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L81-L149), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L166-L238)

## 任務資料模型

`JobTask` 是 crawl 與單頁 scrape 共用的任務 JSON 模型，核心欄位包含整體狀態、成功/失敗計數、逐 URL 狀態清單、日期分區、時間戳，以及用於顯示的 `domains`/`domainSummary`；batch crawl 建立任務時還會附帶經過脫敏的 `engineSettings`。  
Sources: [r2.ts](../../../lib/r2.ts#L6-L22), [crawl route.ts](../../../app/api/crawl/route.ts#L59-L75), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L125-L167)

| 欄位 / 區塊 | 作用 | 主要寫入點 |
|---|---|---|
| `taskId` | 任務唯一識別碼，來自 `crypto.randomUUID()` | `/api/crawl`、`runSingleScrapeTask()` |
| `status` | 整體任務狀態，值為 `processing`、`completed`、`failed` | 建立、worker 更新、single scrape 失敗收斂 |
| `total` / `completed` / `failed` | 任務總量與聚合進度 | 建立時計算，worker/retry/abort 持續調整 |
| `failedUrls[]` / `retryingUrls[]` | 失敗清單與重試中清單 | worker 失敗、retry 重設、abort 強制失敗 |
| `urls[]` | 每個 URL 的 `pending` / `processing` / `success` / `failed` 狀態 | 建立時初始化，worker/retry/abort 更新 |
| `date` | `YYYYMMDD` 分區日期 | 建立 task 時寫入 |
| `createdAt` / `updatedAt` | ISO 時間戳 | 建立、每次狀態變更時更新 |
| `domains` / `domainSummary` | 任務涵蓋網域摘要 | 建立時計算，讀取列表時可補齊 |
| `engineSettings` | 只保存非敏感行為設定 | `/api/crawl` 建立 task 時寫入 |

上表對應的不是 UI 臨時狀態，而是 R2 中真正被 `/api/tasks`、`/api/status/[taskId]` 讀回的資料結構；前端 `app/page.tsx` 也以同樣的欄位形狀渲染 task 卡片與 drawer。  
Sources: [helpers.ts](../../../lib/utils/helpers.ts#L4-L16), [r2.ts](../../../lib/r2.ts#L6-L22), [tasks route.ts](../../../app/api/tasks/route.ts#L22-L53), [status route.ts](../../../app/api/status/[taskId]/route.ts#L19-L24), [page.tsx](../../../app/page.tsx#L31-L46), [page.tsx](../../../app/page.tsx#L1571-L1583), [page.tsx](../../../app/page.tsx#L2733-L2779)

Batch crawl 的生命週期是：`/api/crawl` 先把所有 URL 寫成 `pending`，worker 開工前把單筆 URL 改成 `processing`，成功時累加 `completed`，失敗時累加 `failed` 並寫入 `failedUrls[]`；只要 `completed + failed >= total`，整體 `status` 就會收斂成 `completed`。這代表 batch task 的 `completed` 更接近「全部 URL 都到終態」，不等於「零失敗」。  
Sources: [crawl route.ts](../../../app/api/crawl/route.ts#L59-L75), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L129-L140), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L261-L297)

`/api/retry` 會把指定 URL 或整批任務重新改回 `pending`，並同步移除 `failedUrls[]`/`retryingUrls[]` 中對應資料；`/api/abort` 則直接把指定 URL 標成 `failed` 並寫入 `User aborted`。因此 task JSON 是可原地修補的狀態文件，不是 append-only 的事件流。  
Sources: [retry route.ts](../../../app/api/retry/route.ts#L36-L109), [abort route.ts](../../../app/api/abort/route.ts#L35-L65)

單頁 scrape 雖然只處理一個 URL，仍沿用同一個 `JobTask` 模型：先寫入 `processing` 基底任務，再在成功時改為 `completed`、或在例外時改為整體 `failed`。這和 batch crawl 最大的語意差異是：single scrape 的整體失敗會真的把 `status` 設成 `failed`，而不是「`completed` 但 `failed > 0`」。  
Sources: [scrape-task.ts](../../../lib/services/scrape-task.ts#L135-L168), [scrape-task.ts](../../../lib/services/scrape-task.ts#L198-L239), [scrape route.ts](../../../app/api/scrape/route.ts#L20-L37), [scrape-task.test.ts](../../../tests/scrape-task.test.ts#L6-L85), [scrape-task.test.ts](../../../tests/scrape-task.test.ts#L87-L156)

Skill 生成沒有重用 `JobTask`，而是另外定義 `SkillTaskStatus`，重點欄位是 `phase`、`date`、`domain`、`fileCount`、`outputPrefix` 與模型提供者資訊；其列表與單筆查詢都直接掃描或讀取 `skill-tasks/{taskId}.json`。  
Sources: [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L9-L25), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L52-L72), [skill-tasks route.ts](../../../app/api/skill-tasks/route.ts#L7-L33), [skill-status route.ts](../../../app/api/skill-status/[taskId]/route.ts#L20-L33)

## 日期格式規則

這個專案同時維護兩組日期表示：`date` 是資料夾與分區用途的緊湊字串，`createdAt` / `updatedAt` 是生命週期用途的 ISO 時間戳；UI 再把它們格式化成人類可讀的 `YYYY/MM/DD` 或 `YYYY/MM/DD HH:mm`。  
Sources: [helpers.ts](../../../lib/utils/helpers.ts#L11-L16), [crawl route.ts](../../../app/api/crawl/route.ts#L42-L45), [scrape-task.ts](../../../lib/services/scrape-task.ts#L159-L163), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L86-L115)

| 值 | 原始格式 | 產生位置 | 主要用途 |
|---|---|---|---|
| `date` | `YYYYMMDD` | `formatDate()` | R2 資料夾分區、task 群組、cleaned folder 索引、skill 輸出前綴 |
| `createdAt` | ISO 8601 字串 | `new Date().toISOString()` | 任務建立時間、UI 顯示時間 |
| `updatedAt` | ISO 8601 字串 | `new Date().toISOString()` | 任務最近狀態更新時間 |
| `formatStoredDate(value)` | `YYYY/MM/DD` 或 `YYYY/MM/DD HH:mm` | UI helper | Task 卡片與 drawer 的可讀日期 |
| `getTaskDisplayDate(task)` | 優先顯示 `createdAt`，否則 `date` | UI helper | 保持列表與監控面板一致顯示 |

上表的規則有兩個細節值得記住：第一，`formatDate()` 用的是 JavaScript `Date` 的 `getFullYear/getMonth/getDate` 組字串，而不是直接截 ISO；第二，`formatStoredDate()` 會先嘗試解析 8 碼緊湊日期，再退到 `new Date(value)`，若仍無法解析就回傳原值。  
Sources: [helpers.ts](../../../lib/utils/helpers.ts#L11-L16), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L36-L60), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L86-L108)

前端顯示上，`getTaskDisplayDate()` 會優先顯示 `createdAt`，因此 task history 與 monitor drawer 通常看到的是帶時間的建立時刻，而不是純 `date` 分區值；現有測試也明確鎖定了緊湊日期 `20260415 -> 2026/04/15` 與 `createdAt` 優先規則。  
Sources: [task-metadata.ts](../../../lib/utils/task-metadata.ts#L110-L115), [page.tsx](../../../app/page.tsx#L1576-L1579), [page.tsx](../../../app/page.tsx#L2750-L2753), [task-metadata.test.ts](../../../tests/task-metadata.test.ts#L13-L23)

## R2 路徑規則

R2 前綴不是隨機拼字串，而是被多個 API 明確耦合的存取約定：crawl/scrape task 讀寫 `tasks/{taskId}.json`，skill 控制面讀寫 `skill-tasks/{taskId}.json`，內容檔案則以 `raw/`、`cleaned/`、`skills/` 三種前綴分層。  
Sources: [r2.ts](../../../lib/r2.ts#L137-L157), [tasks route.ts](../../../app/api/tasks/route.ts#L22-L53), [skill-tasks route.ts](../../../app/api/skill-tasks/route.ts#L7-L33), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L52-L72), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L208-L213)

| Prefix / 範本 | 寫入者 | 讀取者 / 用途 |
|---|---|---|
| `tasks/{taskId}.json` | `/api/crawl`、`runSingleScrapeTask()`、worker/retry/abort | `/api/tasks`、`/api/status/[taskId]`、前端 monitor |
| `raw/{date}/{domain}/{path}.md` | crawl worker、single scrape（可選） | `/api/files`、`/api/clean`、前端單檔/整批下載 |
| `cleaned/{date}/{domain}/{path}.md` | crawl worker、`/api/clean`、single scrape（可選） | `/api/files`、`/api/list-cleaned-folders`、skill 生成來源 |
| `skill-tasks/{taskId}.json` | `/api/generate-skill`、skill worker | `/api/skill-tasks`、`/api/skill-status/[taskId]` |
| `skills/{date}/{domain}/{taskId}/` | skill worker | `/api/skill-download` 的 versioned 下載來源 |
| `skills/{date}/{domain}/` | 舊版技能輸出 | `/api/skill-download` 的 legacy fallback |

上表對應到三條資料線：task 控制面、內容檔案面、skill 輸出面。只有遵守同一個 prefix 約定，列表 API、下載 API、以及 skill 複製 references 的流程才能互相對得起來。  
Sources: [files route.ts](../../../app/api/files/route.ts#L22-L43), [clean route.ts](../../../app/api/clean/route.ts#L30-L68), [list-cleaned-folders route.ts](../../../app/api/list-cleaned-folders/route.ts#L10-L18), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L116-L149), [skill-download route.ts](../../../app/api/skill-download/route.ts#L36-L52)

`buildR2Key(url, subdir, date)` 是 raw/cleaned 內容鍵的唯一共用 builder：它只取 URL 的 `hostname` 與 `pathname`，保留原有路徑層級、移除首尾斜線、根路徑改成 `index`、缺副檔名時補 `.md`、`.html` 會被正規化成 `.md`，而無法解析的字串會退回 `unknown_domain/{random}.md`。因為它完全不使用 query string 或 hash，所以同網域同 pathname、但 query 不同的 URL 會落到同一把 key。  
Sources: [helpers.ts](../../../lib/utils/helpers.ts#L21-L44)

`/api/list-cleaned-folders` 與 skill 生成都直接依賴 `cleaned/{date}/{domain}/` 這個分區：前者透過 split path 聚合 `{date, domain}` 與 `emptyFileCount`，後者先檢查該 prefix 下是否有檔案，之後再把每個 cleaned 檔複製到 `skills/{date}/{domain}/{taskId}/references/`。  
Sources: [list-cleaned-folders route.ts](../../../app/api/list-cleaned-folders/route.ts#L10-L18), [list-cleaned-folders route.ts](../../../app/api/list-cleaned-folders/route.ts#L19-L52), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L171-L183), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L119-L141)

Skill 下載則先試新版 versioned prefix `skills/{date}/{domain}/{taskId}/`，若找不到才退回舊版 `skills/{date}/{domain}/`；這也解釋了為什麼 `buildSkillVersionPrefix()` 與 `buildLegacySkillPrefix()` 會同時保留在 `task-metadata.ts`。  
Sources: [task-metadata.ts](../../../lib/utils/task-metadata.ts#L117-L123), [skill-download route.ts](../../../app/api/skill-download/route.ts#L36-L52), [task-metadata.test.ts](../../../tests/task-metadata.test.ts#L52-L57)

## 關鍵模組 / 檔案導覽

| 檔案 | 角色 |
|---|---|
| `lib/r2.ts` | 定義 `JobTask`，封裝 R2/S3 client、物件讀寫與 `tasks/{taskId}.json` 規約。 |
| `lib/utils/helpers.ts` | 生成 task ID、`YYYYMMDD` 日期、raw/cleaned R2 key。 |
| `lib/utils/task-metadata.ts` | 網域摘要、日期顯示、engine settings 脫敏/合併、skill prefix builder。 |
| `app/api/crawl/route.ts` | 建立 batch crawl 任務的初始 JSON。 |
| `lib/services/crawl-dispatch.ts` | queue/inline 處理、URL 狀態遷移、raw/cleaned 落檔。 |
| `lib/services/scrape-task.ts` | 單頁 scrape 的 1-URL task 生命週期。 |
| `app/api/tasks/route.ts`、`app/api/status/[taskId]/route.ts` | Task 列表與單筆查詢讀面。 |
| `app/api/list-cleaned-folders/route.ts`、`app/api/generate-skill/route.ts`、`app/api/skill-download/route.ts` | `cleaned/` 探測、skill 任務建立、versioned/legacy 輸出下載。 |

如果要追某個「看起來像資料問題」的 bug，實務上先看 `helpers.ts` 的 key builder，再看 `r2.ts` 的 prefix 約束，最後才往對應 API 或 worker 追狀態轉換，通常最省時間。  
Sources: [r2.ts](../../../lib/r2.ts#L54-L157), [helpers.ts](../../../lib/utils/helpers.ts#L4-L44), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L71-L167), [crawl route.ts](../../../app/api/crawl/route.ts#L42-L98), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L165-L323), [scrape-task.ts](../../../lib/services/scrape-task.ts#L155-L239), [tasks route.ts](../../../app/api/tasks/route.ts#L22-L87), [generate-skill route.ts](../../../app/api/generate-skill/route.ts#L166-L238), [skill-download route.ts](../../../app/api/skill-download/route.ts#L36-L72)

## 常見誤讀與踩坑

第一個常見誤讀是把 batch task 的 `status: completed` 解讀成「完全成功」。實際上 worker 與 abort API 都是在「所有 URL 已到終態」時把整體狀態收斂為 `completed`，因此真正的失敗判斷要同時看 `failed`、`failedUrls[]`、以及 `urls[]` 逐筆狀態。  
Sources: [r2.ts](../../../lib/r2.ts#L6-L22), [crawl-dispatch.ts](../../../lib/services/crawl-dispatch.ts#L269-L297), [abort route.ts](../../../app/api/abort/route.ts#L52-L58)

第二個常見誤讀是以為 task history 依 `createdAt` 排序。實際上 `/api/tasks` 與 `/api/skill-tasks` 都是先掃 prefix，再按 R2 物件的 `LastModified` 由新到舊排序，然後只回傳最新一小段清單；`createdAt` 比較像顯示欄位，而不是列表排序鍵。  
Sources: [tasks route.ts](../../../app/api/tasks/route.ts#L22-L53), [skill-tasks route.ts](../../../app/api/skill-tasks/route.ts#L7-L33)

第三個常見誤讀是以為 task JSON 會把所有執行設定完整存下來。其實 `sanitizeEngineSettingsForStorage()` 會移除 `firecrawlKey`、`llmApiKey`、`urlExtractorApiKey`、`r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName` 等敏感或不該持久化的欄位；`retryAll` 需要重跑時，再把儲存下來的非敏感行為設定與本次請求帶入的 runtime secrets 合併回完整執行參數。  
Sources: [task-metadata.ts](../../../lib/utils/task-metadata.ts#L27-L30), [task-metadata.ts](../../../lib/utils/task-metadata.ts#L125-L167), [crawl route.ts](../../../app/api/crawl/route.ts#L72-L75), [retry route.ts](../../../app/api/retry/route.ts#L44-L47), [task-metadata.test.ts](../../../tests/task-metadata.test.ts#L59-L120)

第四個踩坑點是 R2 覆蓋設定必須成套提供認證：`resolveR2()` 允許只覆蓋 `bucketName` 並沿用預設 client，但如果進入「自訂認證」分支，`accountId`、`accessKeyId`、`secretAccessKey` 缺一不可；相對應的環境變數 key 名稱是 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET_NAME`。  
Sources: [r2.ts](../../../lib/r2.ts#L35-L87), [config.ts](../../../lib/config.ts#L26-L31)
