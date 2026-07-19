# lib/services/pi-llm.ts

## 職責契約

本模組是 **Skill Generator 路徑的 pi-ai 完成層**：封裝 `@mariozechner/pi-ai` 的 `complete`，處理 provider/model 解析、Codex OAuth 取 key、自訂 baseUrl、以及 pi-ai「錯誤不 throw 只回 stopReason」的正規化。

- **做**：解析 known provider 或 `openai-compatible` 虛擬渠道；缺 apiKey 且 provider=`openai-codex` 時呼叫 `getCodexApiKey`；組 Context/options 並 `complete`；抽出 text blocks + usage。
- **不做**：寫 auth 檔（委派 pi-auth）、列模型給前端（委派 pi-models API）、Content Cleaner 直連（那是 `llm.chatCompletion`）、skill 業務 prompt（processors/prompts）。

## 接口摘要

`PiCompleteParams`：`provider`, `modelId`, `userPrompt` 必填；可選 `systemPrompt`, `apiKey`, `baseUrl`, `temperature`, `maxTokens`, `signal`。

`piComplete(params) → Promise<{ text: string; usage?: AssistantMessage['usage'] }>`

| 分支 | 行為 |
|------|------|
| `provider === 'openai-compatible'` | 動態組 Model（api=`openai-completions`，baseUrl 預設 OpenAI v1） |
| known provider + registry 有 modelId | 直接用 registry model |
| known provider + 無 modelId 且僅單一 api | 以 template clone 自訂 model |
| 否則 | 拋「不支援 / model not found」 |
| `openai-codex` 且無 apiKey | `getCodexApiKey()`；失敗轉使用者可讀錯誤 |
| stopReason=`aborted`/`error`/無 text | 轉 throw（AbortError 或 Error） |

`baseUrl` 覆寫：複製 model 後改 `model.baseUrl`（pi-ai options 不支援 baseUrl）。

## 依賴拓撲

```
skill-generator / test-llm（有 provider）
        │
        ▼
  **piComplete**
        ├── getCodexApiKey ← pi-auth（本 bundle）
        └── @mariozechner/pi-ai（complete / getModels / getProviders）
```

Bundle 內：上層被 `test-llm`（與 production skill 路徑）消費；與 `llm.ts` 正交；模型清單由 `pi-models` 只讀 registry，本檔負責執行期呼叫。
