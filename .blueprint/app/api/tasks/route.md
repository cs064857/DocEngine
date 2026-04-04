# `app/api/tasks/route.ts`

## 職責契約
- 此模組提供 **最近任務列表查詢接口**，從 R2 的 `tasks/` 前綴掃描任務檔、依最後修改時間排序，回傳最新任務摘要集合。
- 它是任務看板/歷史列表的聚合讀取層，不建立任務、不修改任務進度，也不處理單筆 URL 工作。
- 它的責任是把 object storage 的散佈 JSON 轉成前端可直接消費的最近任務陣列，並把損壞或讀取失敗的個別項目隔離為 `null` 後濾除。

## 接口摘要
### `GET()`
- **輸入**：無 body；固定使用環境預設 R2 配置。
- **輸出**：`{ tasks: JobTask[] }`；失敗時回 `{ error }` 與 `500`。
- **副作用**：列舉 `tasks/` 物件、逐筆讀取最新 20 筆任務 JSON。
- **約束**：先取最多 100 個物件排序，再僅展開前 20 筆詳細資料。

### `POST(request)`
- **輸入**：可選 body：`r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName`。
- **輸出**：與 GET 相同，但允許查詢前端指定的 R2 bucket。
- **副作用**：使用覆蓋後的 R2 來源執行同一套 recent-tasks 掃描流程。
- **約束**：request body 解析失敗時會退回空物件，保持接口可容錯。

## 依賴拓撲
- `app/api/tasks` → `fetchTasks()` → `lib/r2.listObjects('tasks/')` → 依 `LastModified` 排序 → `lib/r2.getTaskStatus` 批次補齊細節
- 任務內容來源主要由 `app/api/queues/process-url/route.ts` 持續更新，因此此模組實際上是 queue worker 寫端的列表化讀模型。
- 與本 bundle 其他檔案的關係：
  - 與 `app/api/status/[taskId]/route.ts` 共用同一份 R2 任務資料，但本檔案提供**多筆最近任務視圖**，後者提供**單筆精查視圖**。
  - 與 `app/api/crawl-job/route.ts` 沒有直接存儲耦合；`crawl-job` 的 Firecrawl job 不會出現在這個列表中，除非外部流程另行轉成 `tasks/` 任務檔。
