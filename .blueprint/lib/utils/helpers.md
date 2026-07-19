# lib/utils/helpers

## 職責契約

跨域**純函式小工具**：任務 ID 產生、日期字串、URL→R2 物件 key 的穩定命名。

- **做**：`crypto.randomUUID` 產 taskId；`YYYYMMDD` 日期；將 URL 映射為 `{subdir}/{date}/{domain}/{path}.md`（html→md、空 path→`index`、非法 URL→`unknown_domain/{random}.md`）。
- **不做**：R2 I/O、HTTP、任務狀態、引擎設定、任何副作用（除 random/UUID 熵）。

## 接口摘要

| 符號 | 輸入 → 輸出 / 副作用 |
|------|----------------------|
| `generateTaskId()` | → UUID 字串 |
| `formatDate(date?)` | 預設 `new Date()` → `YYYYMMDD` |
| `buildR2Key(url, subdir, date)` | `subdir`: `'raw' \| 'cleaned'`；→ R2 key；保留 pathname 層級；強制 `.md` 副檔名 |

## 依賴拓撲

```
crawl/scrape 寫檔流程 ──→ buildR2Key ──→ lib/r2.putObject
任務建立 ──────────────→ generateTaskId + formatDate
```

同 bundle：為 `r2` 提供 key 契約，不反向依賴；與 `download`/`advanced-engine-settings-ui` 無關。全站路徑命名的單一真相來源。
