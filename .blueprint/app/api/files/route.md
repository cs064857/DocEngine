# GET|POST /api/files

## 職責契約

R2 物件的唯讀存取閘道。依 query 二選一：指定 `key` 回傳檔案本文，或依 `prefix` 列出物件摘要。

**不做**：寫入/刪除、清洗、folder 聚合語意、任務狀態。

## 接口摘要

共用 `handleFilesRequest(request, body?)`

| 模式 | 觸發 | Output |
|------|------|--------|
| 讀取 | `?key=` | 原文 stream；`.json` → `application/json`，其餘 `text/markdown`；Cache-Control 1h |
| 列表 | `?prefix=&limit=`（預設 limit=50） | `{ files: [{ key, size, lastModified }] }` |

- **GET**：無 body，僅 query
- **POST**：query + body 內 `r2AccountId` 等覆蓋憑證
- **Error**：500 + `{ error }`

## 依賴拓撲

```
Client → **files/route** → getObject | listObjects [r2]
```

同 bundle：可讀 `clean` 寫入的 cleaned；與 `list-cleaned-folders` 互補（本路由通用列表/讀檔，後者專責 cleaned 資料夾聚合）。
