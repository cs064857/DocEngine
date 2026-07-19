# lib/utils/download

## 職責契約

瀏覽器端**檔案下載編排**：透過 `/api/files` 取 R2 內容，支援單檔與資料夾 ZIP 打包，並回報失敗清單。

- **做**：單檔 blob 下載（`saveAs`）；前綴列表 + 並發（5）拉檔 + JSZip DEFLATE；0B/HTTP/網路失敗記入 `failedKeys` 並可附 `download_errors.txt`；可選 R2 設定走 POST body。
- **不做**：R2 SDK 直連、伺服端路由、任務狀態、UI 元件（僅提供 `onProgress` 回呼）。

## 接口摘要

| 符號 | 輸入 → 輸出 / 副作用 |
|------|----------------------|
| `R2Config` | 可選 `r2AccountId/r2AccessKeyId/r2SecretAccessKey/r2BucketName`（有值 → POST，否則 GET） |
| `downloadSingleFile(key, r2Config?, filename?)` | fetch `/api/files?key=` → blob → `saveAs`；檔名預設 key 末段或 `download.md`；失敗 rethrow |
| `downloadFolderAsZip(prefix, zipName, r2Config?, onProgress?)` | list `limit=1000` → 過濾 0B → 並發取檔入 zip（相對路徑）→ 可選 error log → `saveAs({zipName}.zip)`；回 `{ failedKeys }`；進度 0→90（下載）→100（壓縮） |
| `DownloadZipResult` | `{ failedKeys: { key, reason }[] }` |

約束：空資料夾 throw `No files found`；list 失敗 throw；壓縮 level=5。

## 依賴拓撲

```
UI 下載操作 ──→ downloadSingleFile / downloadFolderAsZip
              │
              ▼
         /api/files ──→ lib/r2（listObjects / getObject）
              │
jszip + file-saver ──→ 本機 ZIP / 觸發瀏覽器存檔
```

同 bundle：依賴 `r2` 的**間接**能力（經 API），不 import `lib/r2`；與 `helpers` 無直接耦合。屬 client-only 工具。
