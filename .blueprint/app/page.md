## 職責契約

此模組是 DocEngine 首頁的客戶端控制台，負責承接使用者輸入、切換 `scrape / crawl / map` 三種入口模式、管理設定表單、保存本地配置、觸發後端 API，並把即時抓取結果或非同步任務狀態投影到 UI。它只做前端編排與狀態呈現，不在前端真正執行爬取、清洗、URL 抽取或 R2 寫入邏輯。

## 接口摘要

- `DocEngineFrontend()`
  - **輸入**：無 props。
  - **輸出**：四分頁單頁控制台：`create`、`tasks`、`storage`、`settings`。
  - **副作用**：讀寫 `localStorage.docengineConfig`；根據 `taskId` 啟動輪詢；在 `tasks` 分頁載入歷史任務。
- `JobTask`
  - **資料形狀**：描述任務 `taskId`、`status`、`total/completed/failed`、失敗 URL、重試 URL、日期與 URL 詳情清單。
  - **用途**：統一首頁監控板與歷史任務清單的狀態模型。
- `fetchFileSizes()`（UI 內部命令）
  - **輸入**：`taskStatus` 中的日期與成功 URL。
  - **副作用**：向 `/api/files` 查詢對應 `raw/` 與 `cleaned/` 目錄，更新本地 `fileSizes` 映射。
- `handleDownloadSingle(url, type)` / `handleDownloadAll(type)`（UI 內部命令）
  - **輸入**：目標 URL 與類別 (`raw` | `cleaned`)。
  - **副作用**：觸發瀏覽器下載單一 Markdown 或將整個任務目錄打包成 ZIP 下載。
- `handleCleanSingle(url)`（UI 內部命令）
  - **輸入**：目標 URL 與日期。
  - **副作用**：呼叫 `/api/clean` 針對 R2 中的 raw 檔案執行手動 LLM 清洗，並覆寫 cleaned 版本。
- `handleSubmit(customInput?)`（UI 內部命令）
  - **輸入**：Sitemap、URL 清單或外部傳入的整理後輸入；並攜帶 engine settings、Cleaner、Extractor、R2 覆蓋配置。
  - **副作用**：POST `/api/crawl` 建立批次任務；重置監控狀態。

## 依賴拓撲

`next-env.d.ts`（型別基底）
→ `next.config.ts`（框架執行邊界）
→ `app/layout.tsx`（全站文件殼層）
→ `app/page.tsx`（首頁互動與流程編排）

`app/page.tsx` 對外延伸的流程：

- `scrape` 單頁預覽：`app/page.tsx` → `/api/scrape`
- `map` 網址發掘：`app/page.tsx` → `/api/map`
- `crawl` 探索轉佇列：`app/page.tsx` → `/api/crawl-job` → `handleSubmit()`
- 任務監控/清理/下載：`app/page.tsx` → `/api/status/[taskId]`, `/api/clean`, `/api/files`
