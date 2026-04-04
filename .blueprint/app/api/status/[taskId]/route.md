# `app/api/status/[taskId]/route.ts`

## 職責契約
- 此模組提供 **單一任務狀態的讀取接口**，把 R2 中的 `tasks/{taskId}.json` 直接投影為對外 API 回應。
- 它支援兩種查詢模式：使用環境預設 R2 憑證的向後相容 GET，以及允許前端臨時覆蓋 R2 認證的 POST。
- 它**不負責**建立任務、更新進度、推導聚合列表，也不修復任何狀態不一致；它只是 read model gateway。

## 接口摘要
### `GET(request, { params })`
- **輸入**：path 參數 `taskId`。
- **輸出**：成功時回傳 `JobTask`；缺少 `taskId` 回 `400`；查無任務回 `404`；其他錯誤回 `500`。
- **副作用**：讀取預設 R2 bucket 中的任務 JSON。
- **約束**：不接受額外查詢條件，固定使用環境變數配置。

### `POST(request, { params })`
- **輸入**：path 參數 `taskId`，以及可選 body：`r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName`。
- **輸出**：與 GET 相同，差異僅在資料來源可被 body 覆蓋。
- **副作用**：依前端提供的覆蓋憑證讀取指定 R2 bucket 中的任務 JSON。
- **約束**：只有任一 R2 認證欄位存在時才會啟用覆蓋模式。

## 依賴拓撲
- `app/api/status/[taskId]` → `lib/r2.getTaskStatus` → `tasks/{taskId}.json`
- 寫入來源主要來自：
  - 任務初始化（`/api/crawl`，bundle 外）建立 `processing` 骨架。
  - `app/api/queues/process-url/route.ts` 持續回寫 `completed`、`failed`、`retryingUrls` 與最終 `status`。
- 與本 bundle 其他檔案的關係：
  - 與 `app/api/tasks/route.ts` 共享同一個 `JobTask` 儲存模型，但本檔案只處理**單筆查詢**。
  - 與 `app/api/crawl-job/route.ts` 沒有直接資料相依；`crawl-job` 查的是 Firecrawl job，這裡查的是本地 R2 任務檔。
