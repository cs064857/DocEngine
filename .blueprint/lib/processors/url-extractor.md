# url-extractor（輸入 → URL 清單）

## 職責契約

把使用者雜湊輸入正規化為去重 URL 陣列。決策樹：全合法 URL 清單 → 直通；單一 sitemap-like URL → 解析 XML；否則 LLM 從文字抽 URL。

**不做**：爬取、清洗、R2、任務建立。sitemap index 會遞迴展開子 sitemap。

## 接口摘要

`extractUrls(input, overrides?): Promise<string[]>`

| 分支 | 條件 | 行為 |
|------|------|------|
| 直通清單 | 每行/逗號分隔皆 `https?://` 且 >1 條 | Set 去重 |
| 單 URL | 非 sitemap | `[url]` |
| Sitemap | 單 URL 且 `.xml` 或含 `sitemap` | fetch XML → 抽 `<loc>`（含 index 遞迴） |
| LLM | 其餘文字 | JSON `{"urls":[]}` |

- **Overrides**：`UrlExtractorOverrides` = `{ apiKey, baseUrl, model, prompt }`；預設 `config.llm.urlExtractor.*`
- **Side Effect**：HTTP fetch sitemap；可選 LLM `chatCompletion`（`responseFormat: json_object`）
- **Failure**：sitemap HTTP 非 2xx 拋錯；LLM JSON 解析失敗回 `[]`

## 依賴拓撲

```
(爬取/啟動流程，bundle 外) → **extractUrls**
    ├─ extractFromSitemap → fetch + fast-xml-parser
    └─ extractFromText → chatCompletion [llm] + config
```

同 bundle：與 `cleaner` 同屬 processors、同依賴 `llm`/`config`，但本檔不進入 clean/files/list-cleaned-folders 路徑；屬清理域前置的 URL 正規化工具。
