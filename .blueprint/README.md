# `.blueprint` 全域索引地圖

此索引供 AI Agents 快速回答：**如果要找某個功能，應先去哪個 Bundle / 目錄。**
目前 `crawldocs-web` 的 blueprint 可分成 **App Shell、同步抓取 API、非同步任務編排、儲存/執行期支援、內容處理服務鏈** 五個區塊。

## 快速定位

| 想找的功能 / 領域 | 建議先看 Bundle | 主要目錄 / 檔案 |
|---|---|---|
| Next.js 啟動、根 layout、首頁殼層、框架設定 | `nextjs-app-shell` | `next-env.d.ts`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx` |
| crawl / map / scrape 的同步 HTTP 入口 | `crawl-ingestion-api` | `app/api/crawl`, `app/api/map`, `app/api/scrape` |
| 建立 crawl job、處理 queue、查詢 task/status | `task-queue-orchestration-api` | `app/api/crawl-job`, `app/api/queues/process-url`, `app/api/status/[taskId]`, `app/api/tasks` |
| 檔案 API、設定載入、R2 儲存與 key/path helper | `storage-config-runtime-support` | `app/api/files`, `lib/config.ts`, `lib/r2.ts`, `lib/utils/helpers.ts` |
| 爬蟲流程、內容清洗、URL 抽取、LLM 後處理 | `crawl-processing-services` | `lib/processors`, `lib/services/crawler.ts`, `lib/services/llm.ts` |

## Bundle 總覽

| Bundle ID | 分層 | 摘要 | 檔案數 |
|---|---|---|---:|
| `nextjs-app-shell` | App Shell | Next.js 應用外殼與全域入口設定，涵蓋框架型別宣告、建置設定與根頁面結構。 | 4 |
| `crawl-ingestion-api` | API 入口 | 面向抓取、爬行與網址映射的 API 入口 | 3 |
| `task-queue-orchestration-api` | 任務編排 | 非同步任務建立、佇列處理與狀態查詢相關 API | 4 |
| `storage-config-runtime-support` | 執行期/儲存支援 | 檔案存取 API 與執行期基礎設施支援，涵蓋設定載入、R2 儲存適配與共用命名/路徑輔助。 | 4 |
| `crawl-processing-services` | 處理服務鏈 | 爬蟲服務、LLM 處理與內容清洗/網址抽取流程核心 | 4 |

## 1. App Shell 與全域入口

### `nextjs-app-shell`

- **核心職責**：承接 Next.js app 層級的框架設定、型別宣告與根頁面結構。
- **先看這裡的情境**：首頁殼層、`layout.tsx`、建置設定、App Router 根節點。
- **主要檔案**：
  - `next-env.d.ts`
  - `next.config.ts`
  - `app/layout.tsx`
  - `app/page.tsx`

## 2. 對外 HTTP 入口

### `crawl-ingestion-api`

- **核心職責**：提供 crawl / map / scrape 三條同步型請求入口。
- **先看這裡的情境**：新增 crawl 參數、調整 map 流程入口、擴充 scrape API。
- **主要檔案**：
  - `app/api/crawl/route.ts`
  - `app/api/map/route.ts`
  - `app/api/scrape/route.ts`

### `task-queue-orchestration-api`

- **核心職責**：處理背景任務的建立、佇列分發與狀態查詢。
- **先看這裡的情境**：crawl job 建立、queue worker 入口、task/status 查詢與任務列表。
- **主要檔案**：
  - `app/api/crawl-job/route.ts`
  - `app/api/queues/process-url/route.ts`
  - `app/api/status/[taskId]/route.ts`
  - `app/api/tasks/route.ts`

## 3. 執行期設定、儲存與共用支援

### `storage-config-runtime-support`

- **核心職責**：提供檔案存取入口、執行期設定載入、R2 儲存適配，以及共用命名/路徑 helper。
- **先看這裡的情境**：檔案讀取 API、環境變數與預設值、R2 bucket/client、taskId 或 key/path 命名規則。
- **主要檔案**：
  - `app/api/files/route.ts`
  - `lib/config.ts`
  - `lib/r2.ts`
  - `lib/utils/helpers.ts`

## 4. 內容處理與服務鏈核心

### `crawl-processing-services`

- **核心職責**：承接實際抓取、內容清洗、URL 抽取與 LLM 處理。
- **先看這裡的情境**：爬蟲策略、Markdown/HTML 清洗、連結抽取、LLM 後處理流程。
- **主要檔案**：
  - `lib/processors/cleaner.ts`
  - `lib/processors/url-extractor.ts`
  - `lib/services/crawler.ts`
  - `lib/services/llm.ts`

## 讀圖規則

- `app/api/**`：通常是**對外 HTTP 入口**，先定義請求/回應與協調流程。
- `lib/services/**`：通常是**實際業務流程與外部整合**。
- `lib/processors/**`：通常是**內容轉換、清洗、抽取**。
- `lib/config.ts` / `lib/r2.ts` / `lib/utils/**`：通常是**執行期與基礎設施支援層**。

## 多 Bundle 追蹤建議

- 需求從首頁或 UI 事件開始：先看 `nextjs-app-shell`，再追到對應 API bundle。
- 需求從 HTTP 入口開始：先看 `crawl-ingestion-api` 或 `task-queue-orchestration-api`，再往 `crawl-processing-services` 或 `storage-config-runtime-support` 追。
- 需求同時涉及檔案讀取與內容生成：通常會跨 `storage-config-runtime-support` + `crawl-processing-services`。
