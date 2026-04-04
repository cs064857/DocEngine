# Superpowers Brainstorm

## Goal

為 CrawlDocs 前端介面（Files Tab 或 Tracker Board）提供下載功能。讓使用者可以單擊下載單一檔案（Markdown 等）或是將整個目錄（例如一整個 Task 的爬取結果或特定網域層級）打包成 ZIP 壓縮檔一併下載。

## Constraints

- **瀏覽器端資源限制**：若於前端將大量檔案打包為 ZIP（例如透過 JSZip），會消耗大量記憶體與 CPU 效能，因此如果目錄過大可能無法純前端處理。
- **R2 API 架構**：目前 R2 API (`/api/files`) 只能逐一下載單筆檔案內容，並沒有原生提供「打包整個目錄/Prefix 將其做成 ZIP」的 API 端點。
- **依賴管理**：可能需要額外引入 ZIP 套件（如 `jszip` 或 `archiver`）至前端或後端。
- **檔案大小與傳輸**：ZIP 處理可能會因為 Vercel Serverless Function 的 Timeout（通常 10秒或最大 60秒）或 Payload 大小限制（通常 4.5MB 計算）導致中斷。

## Known context

- 目標 R2 儲存桶以 Prefix 作為偽目錄（例如 `raw/2026MMDD/domain.com/path/...`）。
- 前端有 `/api/files?key=...` 取得單一檔案，以及 `/api/files?prefix=...` 取得檔案清單的功能。
- 目前架構是部署在 Vercel 上的 Next.js 14/15 應用程式。

## Risks

- **Lambda Timeout / Memory Limit**：若交由 Next.js 後端 API 打包 ZIP，當檔案總大小超過好幾 MB 甚至上百 MB 時，極可能觸發 Serverless function 的逾時或記憶體溢位。
- **Frontend Memory Leak**：若在前端透過 `jszip` Fetch 幾百個檔案再打包，可能會讓使用者的瀏覽器崩潰卡死（瀏覽器的 Blob/ArrayBuffer 上限）。
- **CORS / 安全性**：確保只允許下載合法目錄內的內容，防止 Path Traversal 攻擊。

## Options (2–4)

**Option A: 純前端 JSZip 打包**

- **做法**：當點選下載資料夾時，前端根據 Prefix 呼叫 `/api/files` 取得該目錄下所有檔案清單。接著透過 JSZip，前端 `Promise.all`（或批次）逐一下載每個檔案內容加到 Zip 中，最後產生一個 Blob 觸發下載。
- **優點**：不消耗後端 Serverless Function 運算資源，也沒有 Backend Timeout（10s）的限制。
- **缺點**：如果一個爬取任務有 1,000 個檔案，前端發起 1,000 個 Request，網路阻塞與記憶體消耗較大，可能導致瀏覽器當機。

**Option B: 後端 Stream ZIP 打包 (Vercel Serverless)**

- **做法**：新增 `/api/download-zip?prefix=...` Endpoint。後端使用 `archiver` 套件，一邊從 R2 Fetch 檔案流，一邊壓縮成 zip 透過 HTTP Stream 寫給前端 (ReadableStream -> NextResponse)。
- **優點**：對前端瀏覽器友善，只需發起一次請求，體驗較好。避免前端發生幾百次 HTTP Requests 造成的連線池耗盡。
- **缺點**：受限於 Vercel Serverless Function Timeout（預設 10秒，Pro 方案 15-60秒）。如果 R2 當中的檔案太大、太多，仍會在處理一半被 Vercel 強制切斷。

**Option C: 佇列異步打包 (Vercel Queue + R2)**

- **做法**：請求打包目錄時，派發一個打包任務到 Vercel Queue。Worker 在背景將所有檔案彙整壓縮為一個 `task-foo.zip` 存回 R2，完成後前端收到通知，給予一個直接下載該 ZIP 的連結。
- **優點**：架構最穩健，完全無避開 Timeout 問題，能應付上萬個檔案與 GB 級容量。
- **缺點**：實作複雜度最高，需設計狀態輪詢與新的 Queue 流程。對即時性有影響（無法隨點隨下載，需等待數十秒甚至更久）。

## Recommendation

考量目前 CrawlDocs 主要是抓取文本（Markdown），通常檔案體積每份只有幾 KB，單個站點幾百頁總合通常也不會超過 10~20 MB。
我們推薦採用 **Option A (前端 JSZip) 與 Option B (後端 Stream) 的混合或擇一**：
首選 **Option A** (搭配 batch size / concurrency control)，因為可以徹底避開 Vercel Timeout 且實作相對輕量；利用類似 `jszip` 加上 `file-saver`，並控制前端併發數在 5-10 之間分批抓取並放入 Zip Blob，這在大部分普通大小的 Crawl 任務中（100-500頁）體驗最佳且不需改動任何現有後端架構。
如果是單筆檔案，前端則直接根據 key 生成 `Blob` 或 `a[download]` 進行觸發即可。

## Acceptance criteria

- 使用者可在 UI 上（例如 Files 列表或 Task Explorer 旁）看見「下載」或「下載全部為 ZIP」等操作按鈕。
- 若目標是單一 `.md` 檔案，點擊按鈕直接觸發瀏覽器下載單一文件（檔名對應設定）。
- 若目標是資料夾（Prefix），點擊後系統會讀取該 Prefix 下的所有檔案，封裝成一個 ZIP 並自動觸發下載。
- 壓縮檔內部需維持合理的目錄結構或直接展開為扁平列表（視實作而定，建議保留內部斜線結構）。
- 打包時 UI 應有 Loading 或進度提示，避免大資料夾使用者以為卡住。
