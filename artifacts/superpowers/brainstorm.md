# Superpowers Brainstorm

## Goal
重構及整合 CrawlDocs-web 的任務來源模式介面，將抓取模式精簡統一為三大主要動線：「Scrape」、「Crawl」、「Map」，並改善不同模式之間的工作流銜接與轉換邏輯，提升用戶體驗。

## Constraints
1. 需相容已開發好的 Vercel Queue 與後處理機制（LLM Content Cleaner + Save to R2）。
2. `Scrape` 與 `Crawl` 模式都必須共享能處理單一網址、網址清單（Manual）、或網站地圖 (Sitemap) 的輸入介面。
3. 整合後，`Map` 探索出來的網址結果，必須能在畫面上具備動線移轉，可選擇將結果交由 `Scrape` 或是 `Crawl` 進行操作。
4. 用戶明確指示「Crawl」的定義是「對接 Firecrawl 的 Crawl API 後再進行後續處理 (Vercel Queue → 逐一 Scrape → 存 R2)」。這需要在 API 的運用（獲取列表還是獲取內容）上進行設計轉換，避免不必要的雙重消耗。

## Known context
1. 目前有 `/api/crawl` （處理 Sitemap / Manual 並送進 Queue 等待 /api/queues/process-url 逐一呼叫 Scrape ），還有一個新的快速 `/api/scrape` 用於即時測試。
2. Firecrawl 原生的 `Crawl API` 是非同步運行的自動爬蟲系統，預設會爬取所有子頁面的「內容」；若只要找出 URL 後再跑流程，其概念跟 Map API 有所重疊，但在 Firecrawl v2 架構下，Crawl API 通常也能針對深層網頁探索並利用 polling 去獲得最後結果。
3. 先前的 `Map` 模式（`/api/map`）有在 UI 上回傳單純的網址字串清單。
4. 目前追蹤進度的 Tracker Board 有完整支援 Queue 任務的概念。

## Risks
1. **API 概念與資源浪費**：如果呼叫 Firecrawl `Crawl API` 去爬整個網站，Firecrawl 其實已經幫你爬完內容。如果我們只拿裡面吐出來的 links 清單，然後「再」把它丟入我們的 Vercel Queue 跑我們自己的「逐一 Scrape」，等於針對同一個網站消耗兩次 Firecrawl Credits。這在實作時必須跟技術規格釐清（例如 Crawl 時強制設定 `formats: ["links"]` 以節省時間與花費）。
2. **Scrape 單頁 vs 批次 概念混淆**：今天剛剛完成的「即時 Scrape 模式」是不進 Queue 直接取回畫面的；如果把 Sitemap 也丟進 Scrape 模式，在 UI 上必須整合出「單筆即時預覽」還是「送入大量佇列處理」的差別，否則體驗會斷層。
3. **Map 後端行為狀態複雜化**：從 Map 拿到資料後，前端元件狀態要如何無縫傳遞給新的 Scrape / Crawl form，可能需要共享狀態或是透過事件將大量網址注入。

## Options (2–4)
- **Option A (純粹將所有探索結果導入現存的 Queue)**
  - UI 剩下 `Map`、`Scrape`、`Crawl`。
  - `Scrape`：輸入已知名單 (Sitemap/List/單筆) → （若是多筆就進 Queue，若是單筆可即時）。
  - `Crawl`：輸入單一 URL/Sitemap/List → 呼叫 Firecrawl 的 `/v2/crawl`（設定為只爬 `links`），輪詢結束後，取得探索到的 URL 清單，自動轉發至 Queue 中執行「逐一 Scrape → R2」。
  - `Map`：輸入 URL → 拿到網域下名單，顯示清單給用戶選擇後，按鈕點擊 "Send to Scrape" 或 "Send to Crawl" (其實這兩者在此選項下最終都會進 Queue 跑 Scrape)。
- **Option B (讓 Crawl 保留 Firecrawl 的原生爬取與 Webhook 優勢)**
  - 取代我們的 Vercel Queue，當用戶選 `Crawl` 時，我們直接呼叫 Firecrawl 的 Crawl API 要求它爬內容，並接收它的完整內容然後再處理（雖然可能與用戶「要進 Queue 逐一處理」的要求相左）。
- **Option C (根據明確的用戶動線進行前端重構)**
  - **按鈕：** 分為 `Scrape` 跟 `Crawl`，以及單純的 `Map` 工具。
  - `Scrape` 作為「點對點執行」的代名詞，不管是給 Sitemap 或 網址清單，都不會往外擴張，你給 10 個網址它就爬這 10 個。
  - `Crawl` 作為「散發探索執行」的代名詞，針對你給的起點（或者 Sitemap/網址清單內的每個點），讓它擴展並自己尋找所有子連結再放入我們的 Queue。
  - 在 `Map` 的結果區塊增加一排行動按鈕：「[🗂️ Use in Scrape] (精準抓取這些已知的連結)」 或 「[🕷️ Use in Crawl] (以此列表為起點重新向外發散探索)」。

## Recommendation
選擇 **Option C 架構** 作為前端規劃，以釐清三者目的：
1. **Scrape (已知數量執行)**：承接手動輸入網址與 Sitemap。由於目標明確不發散，送出後若是批量即入 Queue，單筆則直接呈現。
2. **Crawl (未知數量蔓延)**：承接手動輸入網址與 Sitemap，作為 "Entry point"，呼叫 Firecrawl 發出爬蟲任務，並在我們這端寫一個 Worker/Route 定期獲取 Crawl 到哪些 URL，並將這些新發現的 URL 推入 Vercel Queue。
3. **Map (探索與分流)**：純探索。結果出來後，放置兩個切換按鈕，點擊後會直接把文字串轉入 `Scrape` 或 `Crawl` 的文字框並自動切換分頁，實現動線完美連接。

## Acceptance criteria
1. 原先 Create Tab 的四顆按鈕整併或重構成有 `Map`, `Crawl`, `Scrape`。
2. `Scrape` 的表單能適配單個 URL（立刻抓）、多個 URL 或 Sitemap (送入 Queue 跑現有 `/api/crawl` 邏輯)。
3. 實作 `/api/crawl` (Crawl API mode) 或在原來基礎上讓它呼叫 Firecrawl Crawl，收集到網址清單後再放入 Queue。
4. 在發送 `Map` 並拿到網域陣列後，UI 會展示出 URL 清單，且具備 `Send to Scrape` 及 `Send to Crawl` 兩個顯眼操作。
