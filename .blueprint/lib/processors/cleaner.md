# cleaner（LLM Markdown 清洗器）

## 職責契約

將單份 raw Markdown 透過 LLM 轉為 RAG 友善的 cleaned Markdown。僅處理「文字 in → 文字 out」。

**不做**：R2 I/O、HTTP、批次、URL 提取。空輸入直接回 `''` 不呼叫 LLM；LLM 空回傳則拋錯（不靜默吞錯）。

## 接口摘要

`cleanContent(rawMarkdown, overrides?): Promise<string>`

- **Input**：`rawMarkdown`；`CleanerOverrides?` = `{ model, apiKey, baseUrl, prompt }`
- **預設**：`config.llm.contentCleaner.*` + 內建 `DEFAULT_CLEANING_PROMPT`（降噪/結構/RAG 優化，只輸出 MD）
- **Output**：清洗後 Markdown
- **Side Effect**：對外 LLM `chatCompletion`（system=prompt, user=raw）
- **Constraints**：失敗向上拋；禁止回傳空 completion

## 依賴拓撲

```
clean/route → **cleaner.cleanContent** → chatCompletion [llm]
                                      ↖ config.llm.contentCleaner
```

同 bundle：唯一被 `app/api/clean` 直接消費的 processor；與 `url-extractor` 並列為 LLM processor，職責互不重疊。
