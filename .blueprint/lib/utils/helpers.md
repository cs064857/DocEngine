# lib/utils/helpers.ts

## 職責契約
此模組提供與任務識別、日期分區與 R2 物件鍵命名相關的純函式工具，讓上游流程在進入儲存層之前先產生穩定且可預測的識別值。它只負責值生成與格式正規化；嚴禁直接讀寫 R2、解析環境設定、處理 HTTP 請求或承擔任務狀態持久化。

## 接口摘要
### `generateTaskId()`
- **輸出**：標準 UUID 字串。
- **副作用**：無持久化副作用；僅依賴執行期隨機 UUID 能力。
- **用途**：供建立新任務時產生唯一識別。

### `formatDate(date?)`
- **輸入**：可選 `Date`，預設為目前時間。
- **輸出**：`YYYYMMDD` 字串。
- **副作用**：無。
- **用途**：供物件路徑或任務資料做日期分區。

### `buildR2Key(url, subdir, date)`
- **輸入**：來源 URL、`subdir`（`raw` 或 `cleaned`）、日期字串。
- **輸出**：`subdir/date/domain/path.md` 形式的 R2 key。
- **副作用**：無。
- **約束**：保留 URL 路徑階層；空路徑正規化為 `index`；缺副檔名時補 `.md`；`.html` 轉寫為 `.md`；無法解析 URL 時回退到 `unknown_domain/*.md`。

## 依賴拓撲
`lib/utils/helpers.ts` →
- `app/api/crawl/route.ts`：用 `generateTaskId()` 建立任務 ID，並以 `formatDate()` 標記日期分區。
- `app/api/queues/process-url/route.ts`：用 `buildR2Key()` 為 raw/cleaned 內容生成儲存路徑。
- `app/api/scrape/route.ts`：用 `formatDate()` 與 `buildR2Key()` 生成即時 scrape 產物路徑。

- 在本 bundle 內，它不直接呼叫 `lib/config.ts` 或 `lib/r2.ts`，而是為這兩層之上的流程提供穩定輸入。
- 實際資料寫入由 `lib/r2.ts` 執行；本模組負責確保傳入儲存層的 key 與 ID 具備一致命名規約。
