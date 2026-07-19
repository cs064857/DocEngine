# POST /api/list-cleaned-folders

## 職責契約

將 R2 `cleaned/` 扁平物件聚合成「日期 × 網域」資料夾視圖，供 UI 挑選已清洗集合。

**不做**：讀檔內容、觸發清洗、通用任意 prefix 列表（那是 `files`）。

## 接口摘要

`POST(req)`

- **Input (JSON, 可空)**：`r2AccountId` / `r2AccessKeyId` / `r2SecretAccessKey` / `r2BucketName`（可選覆蓋）
- **Output**：`{ folders: [{ date, domain, prefix, fileCount, emptyFileCount }] }`，按 date 降序
- **Side Effect**：無寫入；`listObjects('cleaned/', 1000, r2)`
- **解析契約**：key 格式 `cleaned/{date}/{domain}/...`；`Size===0` 計入 `emptyFileCount`

## 依賴拓撲

```
Client → **list-cleaned-folders** → listObjects('cleaned/') [r2]
                                      ↘ parseFolders（本檔內聚）
```

同 bundle：資料來自 `clean` 寫入的 cleaned 物件；需要單檔內容時改走 `files?key=`。
