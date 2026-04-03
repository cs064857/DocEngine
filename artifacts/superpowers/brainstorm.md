## Goal
使用 Firecrawl 的 Map API 開發一個網站路徑映射工具。在現有的 UI 中新增一個選項，讓使用者只需輸入網域或路徑，即可調用 Firecrawl Map 功能提取該網域下的所有網址，並將結果轉換後直接匯入現有的「手動網址列表」(Manual URLs List) 供使用者檢視與後續處理。

## Constraints
- 必須與現有的 CrawlDocs UI 設計風格保持一致，包含表單與提示等。
- 必須串接 Firecrawl 的 `/v2/map` API，並適當處置可能的網路超時或速率限制。
- 從 Map API 獲取的結果必須能夠正確轉換為字串陣列格式並填入現有的 manual textarea 中。
- 在 `page.tsx` 和後端 API 之間需要有適當的過渡（例如新建一個 `/api/map` 路由）。
- 必須遵守 Vercel Function 的超時限制，若 Map 的處理時間過長（特別是大網站），前端需要有相應的載入狀態（Loading State）與錯誤處理。

## Known context
- 目前 `crawldocs-web` 中，處理 URL 的介面位於 `app/page.tsx`，區分為 `sitemap` 和 `manual` 兩種 `sourceType`。
- 後端使用 `@aws-sdk/client-s3` 連接 Cloudflare R2，並使用 `@vercel/queue` 控制爬蟲併發。
- Firecrawl Map API (`https://api.firecrawl.dev/v2/map`) 接受 `url`, `search`, `sitemap`, `ignoreCache`, `limit` 等參數，並回傳 `{ success: true, links: [{ url: "..." }] }`。
- `engineSettings` 支援配置 `firecrawlKey`，這需要於呼叫 Map API 時帶上。
- 在這之前，對於 `sitemap` 原本已經實作了傳統的 XML Sitemap 遞迴解析功能 (`extractFromSitemap`)。

## Risks
- **超時風險**：Firecrawl 進行深度 Map 可能需要一定的時間，導致 Vercel 的預設無伺服器 API 超時（通常 10 ~ 60 秒限時）。
- **請求失敗與錯誤處理**：如果使用者輸入非法或不存在的 URL，或者 Firecrawl 配額耗盡 (402, 429)，需要明確向前端報告錯誤。
- **返回列表過長**：如果網站非常龐大，回傳的 URL 數量極多，直接填入 Textarea 可能會造成渲染效能問題或影響使用者體驗。需要考慮到設定 Map 請求中的 limit 參數。

## Options (2–4)
1. **結合為全新的 Source Type (`firecrawl-map`)，後端自動處理**
   - 描述：在 `page.tsx` 的 Toggle 新增第三個選項 `firecrawl-map`。點選 Initialize Crawl 後，後端 `/api/crawl` 自動呼叫 Firecrawl Map 來轉出 URL 陣列，直接排入 `@vercel/queue`，不需經由 `manual` 介面。
   - 優點：操作步驟少，整合簡單。
   - 缺點：違反了「能直接配合"手動網址列表"做處理」這項需求的涵義（使用者可能想要先過濾網址再進行爬取）。
   
2. **作為 Manual Type 中的輔助生成功能 (Generate List Modal / Button)**
   - 描述：在 Manual URLs List 模式下，旁邊加上一個「Generate from Domain via Firecrawl Map」按鈕。點擊後會呼叫新的 `/api/map`，將取得的 URL 列表直接填充或附加（append）到當前的 Textarea 內容中。
   - 優點：符合「處理成網址列表並配合手動網址處理」的彈性需求，使用者可以手動刪減不必要的網址。
   - 缺點：若 API 回應慢，需要一個專屬的 Loading 狀態組件。

3. **新增 Map Source Type，但在獲取時先「預覽」於 Textarea**
   - 描述：使用新的 Mode Toggle (`map` | `sitemap` | `manual`)。當切換到 `map` 時，顯示一個 URL 輸入框與一個「Fetch Map」按鈕，獲取結果後自動將 Mode 切換到 `manual` 並把清單填入文字框內。
   - 優點：UX 流程清晰，兼具防呆與編輯的功能。
   - 缺點：實作上要處理狀態流（從一個 Mode 切換去填充另一個 Mode 的值）。

## Recommendation
選擇 **Option 3** (新增 Map Source Type，擷取後切換自動填入 manual 模式)。因為使用者的需求明確提到「增加一個......，輸入網域後就能直接處理成"網址列表"，能直接配合"手動網址列表"做處理」。我們可以加入第三個 Source Toggle 選項：「Firecrawl Map」。使用者輸入 URL 後點擊 "Fetch & Review URLs", API `/api/map` 取得結果後，自動把這些 URL 放進 `manual` 的 Textarea 中，並自動將 UI 切換至 Manual 模式，讓用戶得以刪減網址後，再點擊 `Initialize Crawl`。

## Acceptance criteria
1. 介面中具備 "Firecrawl Map" 選項或按鈕，允許使用者輸入目標網域 (URL)。
2. 實作新的 API endpoint（例如 `/api/map`）來正確呼叫 `api.firecrawl.dev/v2/map`，回傳網址清單。
3. 如果未提供全域的 Firecrawl API Key，API 路由需提示錯誤或使用內建的環境變數。
4. 前端在發送 Map 請求時需顯示適當的載入狀態（例如 "Mapping domain..."）。
5. 成功映射回來的 URL 會自動匯入並填滿到 "Manual URLs List" 的輸入框內，並切換狀態到該模式供使用者檢視與編輯。
6. 發生錯誤（網路異常、Firecrawl 配額不足等）時能夠將錯誤訊息渲染在前端。
