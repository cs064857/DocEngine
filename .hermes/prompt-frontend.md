請為 DocEngine 的前端 `app/page.tsx` 加入 Firecrawl 多 KEY 管理 UI。

## 現狀
- `app/page.tsx` 是 3164 行的單體組件
- 目前 `firecrawlKey` 是單一 `useState('')`，在 Settings 頁的 "Scraping Processor" 區塊（約 line 2525-2545）
- 後端已支援多 KEY（`config.ts` 有 `FIRECRAWL_API_KEYS`、`FIRECRAWL_KEY_RATES` 等環境變數）
- 前端發送請求時把 `firecrawlKey` 放在 `engineSettings.firecrawlKey`

## 需求
1. **新增 state**：
   - `firecrawlKeys`: `Array<{ key: string; ratePerMinute: number }>` — 多把 KEY 及其速率
   - 保留原有 `firecrawlKey` state 向下兼容（如果 firecrawlKeys 為空則用 firecrawlKey）

2. **修改 Settings 頁的 "Scraping Processor" 區塊**（約 line 2525-2545）：
   - 保留原有的單 KEY 輸入框作為「預設 KEY」
   - 新增「進階 KEY 管理」可展開區域（用一個 toggle 控制顯示/隱藏）
   - 展開後顯示：
     - KEY 列表：每行一個 KEY，包含 KEY（password 類型輸入框，可切換顯示）、每分鐘速率（number 輸入框）、刪除按鈕
     - 「+ 添加 KEY」按鈕
   - 樣式與現有 UI 風格一致（`bg-[#F8F5EE]`、`border-[#E5D5C5]`、`rounded-xl` 等）

3. **修改 engineSettings payload**（約 line 640、701、760 等）：
   - 當 `firecrawlKeys` 陣列不為空時，將所有 KEY 用逗號拼接為 `firecrawlApiKeys`（新增欄位）
   - 將速率配置拼接為 `firecrawlKeyRates` 格式 `key1:rate1,key2:rate2`
   - 保持原有 `firecrawlKey` 欄位不變（向下兼容）

4. **localStorage 持久化**：
   - `firecrawlKeys` 要存入 localStorage（與現有的 config 持久化邏輯一致，約 line 493-510）

## 注意
- 不要改動其他區塊的程式碼
- 維持現有的 Tailwind CSS 風格
- 輸入框的 KEY 用 `type="password"`，旁邊加一個眼睛圖標切換顯示
- 確保 `npx tsc --noEmit` 通過
