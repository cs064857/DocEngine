# lib/services/llm.ts

## 職責契約

本模組是 **Content Cleaner 路徑的 OpenAI-compatible Chat Completions 薄客戶端**：純 `fetch`、無 SDK，對任意相容端點做單次 completion。

- **做**：組 payload、正規化 endpoint（補 `/chat/completions`）、Bearer 認證、指數退避重試（最多 3 次）、回傳 `choices[0].message.content` 字串。
- **不做**：pi-ai provider/registry、OAuth/auth.json、模型清單、業務 prompt 組裝（cleaner/skill-generator 各自負責）。

## 接口摘要

型別（契約形狀）：
- `LLMConfig`：`{ baseUrl, apiKey, model }`
- `ChatMessage`：`role ∈ system|user|assistant` + `content`
- `ChatOptions`：`responseFormat?`（`text`|`json_object`）、`temperature?`

`chatCompletion(configParams, messages, options?) → Promise<string>`

| 面向 | 說明 |
|------|------|
| **Input** | baseUrl/apiKey/model 必填；messages 為 OpenAI 風格陣列 |
| **Output** | 助理文字內容 |
| **Side Effect** | HTTP POST 外部 LLM；失敗重試 delay 2^n 秒 |
| **Constraints** | `responseFormat=json_object` 時注入 `response_format`；3 次後拋原錯 |

## 依賴拓撲

```
Content Cleaner / test-llm（無 provider）
        │
        ▼
  **chatCompletion** ──► fetch → OpenAI-compatible /chat/completions
```

Bundle 內：與 `pi-llm` **平行、互不 import**——前者給 cleaner 直連；後者給 skill-generator（pi-ai + Codex OAuth）。`test-llm` 依 body 有無 `provider` 二選一。
