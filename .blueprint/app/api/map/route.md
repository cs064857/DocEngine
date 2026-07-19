# POST /api/map

## 職責契約

同步代理 Firecrawl **Map API**，回傳目標站點可發現的 URL 清單（探索／預覽用）。

- **做**：組裝 Map payload、Bearer 呼叫 `/v2/map`、正規化 `links` 為 `string[]`、轉譯 402/429 等人話錯誤。
- **不做**：建立本系統 task、分發 scrape、持久化 R2、啟動 Firecrawl Crawl Job（分屬 crawl / scrape / crawl-job）。

## 接口摘要

`POST(req: NextRequest) → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ url: string, search?, limit?, includeSubdomains?, firecrawlKey? }` |
| **Defaults** | `limit=5000`、`includeSubdomains=true`、`ignoreQueryParameters=true` |
| **Auth** | `firecrawlKey` 優先，否則 `config.firecrawl.apiKey`；皆無 → 400 |
| **Output 200** | `{ success: true, urls: string[], count }` |
| **Output 錯誤** | 轉傳 Firecrawl HTTP status；402→額度、429→限流 |
| **Side Effect** | 僅外部 HTTP；無本機/R2 狀態變更 |

## 依賴拓撲

```
Client → **POST /api/map** → fetch(config.firecrawl.apiUrl/v2/map) → Firecrawl
```

同 bundle：輸出 URL 列表常作為前端輸入，再餵給 `POST /api/crawl`；與 `crawl-job` 並列為「URL 發現」兩種策略（同步 Map vs 非同步 Crawl Job）。
