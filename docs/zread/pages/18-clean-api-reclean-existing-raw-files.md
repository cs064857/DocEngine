# Clean API：針對既有 raw 檔案重新清洗

## 本頁範圍與讀者定位

本頁聚焦 `POST /api/clean` 如何對「已經存在於 R2 的單一 raw Markdown」重新跑一次 LLM 清洗：caller 必須提供 `url` 與歷史 `date`，後端用這兩者回推出既有 `raw/{date}/{domain}/{path}.md`，清洗後再覆寫同位置的 `cleaned/{date}/{domain}/{path}.md`。這條路徑不會重抓網頁、不會建立新 `taskId`、也不會走 queue worker，而是同步完成「讀 raw → clean → 寫 cleaned → 回傳大小」的 in-place reclean。Sources: [route.ts](app/api/clean/route.ts#L20-L68), [helpers.ts](lib/utils/helpers.ts#L21-L39), [page.tsx](app/page.tsx#L1066-L1088)

## 核心流程

```mermaid
flowchart TD
  UI[Monitor Drawer 成功 URL 的 ✨ Clean 按鈕] --> REQ[POST /api/clean<br/>{ url, date, engineSettings, r2Overrides }]
  REQ --> MAP[extractR2 將前端欄位映射成 R2Overrides]
  MAP --> RAWKEY[buildR2Key url raw date]
  RAWKEY --> RAWGET[getObject rawKey]
  RAWGET --> CHECK{raw 存在且非空?}
  CHECK -->|否| ERR404[404 missing / empty raw]
  CHECK -->|是| CLEAN[cleanContent rawMarkdown]
  CLEAN --> CHAT[chatCompletion<br/>OpenAI-compatible /chat/completions]
  CHAT --> EMPTY{cleaned 非空?}
  EMPTY -->|否或例外| ERR502[502 LLM cleaning failed]
  EMPTY -->|是| CLEANKEY[buildR2Key url cleaned date]
  CLEANKEY --> PUT[putObject cleanedKey]
  PUT --> RES[{ success: true, size }]
  RES --> UIREFRESH[alert 成功並 fetchFileSizes]
  UIREFRESH --> FILES[/api/files 刷新 raw / cleaned 大小]
  PUT --> DOWNSTREAM[/api/list-cleaned-folders 與 /api/generate-skill 可再消費 cleaned 內容]
```

這條流程的關鍵在於 `date` 不是當下重新產生，而是由前端把既有 task 的 `taskStatus.date` 帶回來；因此 `/api/clean` 不是建立新版輸出，而是在原本的日期命名空間中重新寫回對應 cleaned 檔。Sources: [page.tsx](app/page.tsx#L1066-L1077), [route.ts](app/api/clean/route.ts#L22-L24), [route.ts](app/api/clean/route.ts#L30-L34), [route.ts](app/api/clean/route.ts#L61-L68), [helpers.ts](lib/utils/helpers.ts#L21-L39)

## 請求／回應契約

| 面向 | 行為 | 來源 |
|---|---|---|
| HTTP 方法 | 只有 `POST /api/clean`。route 檔沒有其他 method export。 | [route.ts](app/api/clean/route.ts#L20-L73) |
| 最小請求欄位 | 必填 `url`、`date`；缺任一值回 `400 Missing url or date`。 | [route.ts](app/api/clean/route.ts#L22-L28) |
| 清洗設定 | `engineSettings` 內目前只會讀 `llmApiKey`、`llmModelName`、`llmBaseUrl`、`cleaningPrompt`。 | [route.ts](app/api/clean/route.ts#L44-L54), [page.tsx](app/page.tsx#L1071-L1077) |
| R2 覆蓋 | 前端送 `r2Overrides.{r2AccountId,r2AccessKeyId,r2SecretAccessKey,r2BucketName}`，後端再映射成 SDK 的 `accountId/accessKeyId/secretAccessKey/bucketName`。 | [page.tsx](app/page.tsx#L1071-L1077), [route.ts](app/api/clean/route.ts#L9-L18) |
| 成功回應 | 回 `{ success: true, size }`，其中 `size` 是 `cleanedContent.length`。 | [route.ts](app/api/clean/route.ts#L61-L68) |
| 常見錯誤 | raw 不存在或空白回 `404`；LLM 清洗失敗回 `502`；其他例外走 `500`。 | [route.ts](app/api/clean/route.ts#L33-L42), [route.ts](app/api/clean/route.ts#L47-L59), [route.ts](app/api/clean/route.ts#L69-L71) |

這個契約也說明 `/api/clean` 一次只處理一個 `{url, date}`，它不像 `/api/retry` 或 `/api/crawl` 那樣有批次 URL 或 task 狀態重設語意。Sources: [route.ts](app/api/clean/route.ts#L22-L24), [route.ts](app/api/clean/route.ts#L30-L68), [page.tsx](app/page.tsx#L1066-L1088)

## 前端入口：從 Monitor Drawer 對單一成功 URL 重新清洗

內建 UI 會在 Monitor Drawer 的 `success` 列表上顯示 `✨ Clean` 按鈕；點擊後 `handleCleanSingle()` 會把目前頁面的 LLM 設定與 R2 覆蓋設定組成 body，送到 `/api/clean`。如果成功，前端只做兩件事：跳出「LLM 清洗完成」提示，並重新呼叫 `fetchFileSizes()` 刷新該批次 raw/cleaned 檔案大小；如果失敗，則只顯示 alert，不改寫 task 狀態。Sources: [page.tsx](app/page.tsx#L1066-L1088), [page.tsx](app/page.tsx#L2959-L2970), [page.tsx](app/page.tsx#L3019-L3045)

這代表 `/api/clean` 的產品定位比較像「對既有輸出做局部修復」：只有已經成功產出 raw/cleaned 對照資訊的 URL 會出現這個操作，而不是給 pending/failed 項目直接重跑整個抓取流程。Sources: [page.tsx](app/page.tsx#L2959-L2970), [page.tsx](app/page.tsx#L3001-L3045)

## 後端如何找到既有 raw 檔

後端拿到 `url` 與 `date` 後，先用 `buildR2Key(url, 'raw', date)` 產生 `raw/{date}/{domain}/{path}.md` 形式的 key，再用 `getObject()` 從 R2 讀內容。`buildR2Key()` 會保留 URL path 層級、把空 path 轉成 `index`、把 `.html` 改成 `.md`，因此 reclean 針對的是「同一路徑對應的既有 raw 檔」，而不是掃整個資料夾。Sources: [route.ts](app/api/clean/route.ts#L30-L38), [helpers.ts](lib/utils/helpers.ts#L21-L39), [r2.ts](lib/r2.ts#L106-L118)

如果 `getObject()` 拿不到內容，或檔案內容是空字串，路由都會把它視為「無法 re-clean 的既有 raw」，直接回 `404`。這也意味著 clean API 沒有 fallback 到 live scrape、也不會從 cleaned 檔反推 raw；raw 缺失時只能先修復 raw 來源，而不是靠 `/api/clean` 自我補齊。Sources: [route.ts](app/api/clean/route.ts#L33-L42), [r2.ts](lib/r2.ts#L112-L118)

## Cleaner 核心：沿用既有 OpenAI-compatible 清洗器，而非另一套特殊邏輯

`/api/clean` 本身不做文字規則轉換，而是把 raw Markdown 直接交給 `cleanContent()`。`cleanContent()` 會優先使用呼叫端傳入的 `model`、`apiKey`、`baseUrl`、`prompt`，否則退回 `config.llm.contentCleaner` 對應的 `CONTENT_CLEANER_BASE_URL`、`CONTENT_CLEANER_API_KEY`、`CONTENT_CLEANER_MODEL`，而提示詞若未覆蓋則使用內建的預設 cleaning prompt。Sources: [route.ts](app/api/clean/route.ts#L44-L54), [cleaner.ts](lib/processors/cleaner.ts#L11-L48), [cleaner.ts](lib/processors/cleaner.ts#L55-L69), [config.ts](lib/config.ts#L12-L16)

真正的 LLM 呼叫透過 `chatCompletion()` 送往 OpenAI-compatible endpoint；它會自動補上 `/chat/completions` 後綴、最多重試 3 次，並在 HTTP 非 2xx 時把完整狀態碼與 body 包成錯誤。Cleaner 另外把「模型回傳空白字串」也視為失敗，所以 `/api/clean` 只有在拿到非空 cleaned 文字後才會執行 `putObject()`。Sources: [llm.ts](lib/services/llm.ts#L20-L81), [cleaner.ts](lib/processors/cleaner.ts#L71-L87), [route.ts](app/api/clean/route.ts#L47-L63)

## R2 覆蓋與覆寫語意

`extractR2()` 先把前端欄位名 `r2AccountId` / `r2AccessKeyId` / `r2SecretAccessKey` / `r2BucketName` 轉成 `R2Overrides`；接著 `resolveR2()` 會在三種模式間切換：完全不帶覆蓋時走環境預設 client、只覆蓋 bucket 時沿用預設 client 但換 bucket、帶了任何 credential override 時就用覆蓋值與環境值補齊後重建新的 S3Client。Sources: [route.ts](app/api/clean/route.ts#L9-L24), [r2.ts](lib/r2.ts#L24-L30), [r2.ts](lib/r2.ts#L58-L87)

清洗成功後，路由不是建立新版本，而是對同一組 `url + date` 再做一次 `buildR2Key(url, 'cleaned', date)`，然後直接 `putObject()`。所以 clean API 的實際效果是覆寫 `cleaned/{date}/{domain}/{path}.md` 既有物件，讓同一份 raw 以新的模型或提示詞重新生成 cleaned 內容。Sources: [route.ts](app/api/clean/route.ts#L61-L68), [helpers.ts](lib/utils/helpers.ts#L21-L39), [r2.ts](lib/r2.ts#L92-L100)

## 它其實是在重用 crawl / scrape 既有的 cleaning core

`cleanContent()` 不是 `/api/clean` 專用：crawl worker 在抓到 raw Markdown 後，若 `enableClean !== false` 也會呼叫同一個 `cleanContent()` 再寫入 cleaned；單頁 scrape 任務同樣在 `enableClean` 為真時呼叫相同函式，之後才決定是否把 raw/cleaned 存進 R2。換句話說，Clean API 不是另一條平行清洗管線，而是把同一顆 cleaner 核心重新套用到既有 raw 檔。Sources: [crawl-dispatch.ts](lib/services/crawl-dispatch.ts#L182-L202), [scrape-task.ts](lib/services/scrape-task.ts#L175-L195), [cleaner.ts](lib/processors/cleaner.ts#L55-L87)

## 成功後如何回到 UI 與下游流程

前端 `fetchFileSizes()` 會用 `/api/files?prefix=raw/{date}/{domain}/` 與 `/api/files?prefix=cleaned/{date}/{domain}/` 重新抓整個 prefix 的物件大小，再把每個 URL 對應的 raw/cleaned byte 數更新到 Monitor Drawer，因此 re-clean 完成後使用者可以立刻看見 cleaned size 是否變化、是否仍是 `0 B`。Sources: [page.tsx](app/page.tsx#L971-L999), [page.tsx](app/page.tsx#L2959-L2970), [route.ts](app/api/files/route.ts#L22-L43)

重新寫回的 cleaned 檔也會被下游流程直接使用：Skill 分頁的 Refresh 會呼叫 `/api/list-cleaned-folders` 掃描 `cleaned/` prefix 並統計 `fileCount` 與 `emptyFileCount`；若某個 folder 仍有 `0B` cleaned 檔，UI 會明確提示「Consider re-cleaning before generating a skill」。之後 `/api/generate-skill` 會先檢查 `cleaned/{date}/{domain}/` 是否有檔案，再把該 prefix 下選中的 cleaned 檔複製進 skill 輸出的 `references/`。Sources: [page.tsx](app/page.tsx#L2031-L2080), [route.ts](app/api/list-cleaned-folders/route.ts#L10-L18), [route.ts](app/api/list-cleaned-folders/route.ts#L59-L79), [route.ts](app/api/generate-skill/route.ts#L128-L141), [route.ts](app/api/generate-skill/route.ts#L166-L183)

## 關鍵模組／檔案導覽

| 檔案 | 角色 | 本頁重點 | 來源 |
|---|---|---|---|
| `app/api/clean/route.ts` | Clean API 入口 | 驗證 `url/date`、讀 raw、呼叫 cleaner、寫 cleaned、回傳 `size` | [route.ts](app/api/clean/route.ts#L9-L73) |
| `lib/utils/helpers.ts` | R2 key 規則 | 把 `url + date + subdir` 轉成 `raw/` 或 `cleaned/` 路徑 | [helpers.ts](lib/utils/helpers.ts#L21-L39) |
| `lib/processors/cleaner.ts` | 內容清洗核心 | prompt 預設值、override 回退、空回應保護 | [cleaner.ts](lib/processors/cleaner.ts#L11-L87) |
| `lib/services/llm.ts` | OpenAI-compatible client | `/chat/completions` 路徑修正與 3 次重試 | [llm.ts](lib/services/llm.ts#L20-L81) |
| `lib/r2.ts` | R2 存取層 | 覆蓋 credentials 或 bucket，並執行 get/put/list | [r2.ts](lib/r2.ts#L24-L30), [r2.ts](lib/r2.ts#L58-L131) |
| `app/page.tsx` | Monitor Drawer 與 Skill UI | 單筆 `✨ Clean` 入口、成功後刷新 size、Skill 端顯示 empty cleaned warning | [page.tsx](app/page.tsx#L971-L999), [page.tsx](app/page.tsx#L1066-L1088), [page.tsx](app/page.tsx#L2031-L2080), [page.tsx](app/page.tsx#L3019-L3045) |
| `app/api/list-cleaned-folders/route.ts` / `app/api/generate-skill/route.ts` | 下游 cleaned 消費端 | 把 re-clean 後的 cleaned 結果納入 folder 選單與 skill references | [route.ts](app/api/list-cleaned-folders/route.ts#L16-L18), [route.ts](app/api/list-cleaned-folders/route.ts#L74-L79), [route.ts](app/api/generate-skill/route.ts#L128-L141), [route.ts](app/api/generate-skill/route.ts#L176-L183) |

這些檔案合起來形成一條很短但很關鍵的修補鏈：UI 指向單檔 re-clean，R2 負責取回既有 raw，Cleaner/LLM 重新產生 cleaned，而後續 Skill 流程直接吃這份更新後的 cleaned 結果。Sources: [page.tsx](app/page.tsx#L1066-L1088), [route.ts](app/api/clean/route.ts#L30-L68), [cleaner.ts](lib/processors/cleaner.ts#L55-L87), [route.ts](app/api/generate-skill/route.ts#L128-L141)

## 已知邊界與踩坑

第一，這個 API 是同步單檔操作，不會建立或更新 `tasks/{taskId}.json`；前端成功後只是刷新檔案大小，因此如果你期待它像 retry 一樣改變 task 摘要或重跑失敗 URL，這條路徑做不到。Sources: [route.ts](app/api/clean/route.ts#L20-L68), [page.tsx](app/page.tsx#L1066-L1088), [page.tsx](app/page.tsx#L971-L999)

第二，raw 檔缺失、raw 為空、或 LLM 回空結果都會讓流程中止：前兩者回 `404`，後者因 Cleaner 主動丟錯而回 `502`。這使得 `/api/clean` 適合「修補既有 raw 的 cleaned 版本」，不適合當成自動補件機制。Sources: [route.ts](app/api/clean/route.ts#L33-L42), [route.ts](app/api/clean/route.ts#L55-L59), [cleaner.ts](lib/processors/cleaner.ts#L77-L85)

第三，這條路由雖然是同步 API，但 route 檔與 `vercel.json` 都把 `maxDuration` 設成 300 秒，反映作者預期內容清洗可能是長耗時 LLM 請求；同時，若 body 不是合法 JSON，`await req.json()` 會掉到最外層 catch，回的是 generic `500` 而不是細緻的 `400`。Sources: [route.ts](app/api/clean/route.ts#L7-L8), [route.ts](app/api/clean/route.ts#L20-L24), [route.ts](app/api/clean/route.ts#L69-L71), [vercel.json](vercel.json#L2-L5)
