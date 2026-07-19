# GET /api/pi-models

## 職責契約

**pi-ai 內建 Provider/Model 目錄**的唯讀 HTTP 入口：供前端 Skill Generator 下拉選單使用；並注入虛擬 `openai-compatible` 渠道以支援自訂 baseUrl + modelId。

- **做**：`getProviders`/`getModels` 彙整為 `PiProviderInfo[]`；排序；標記 `supportsCustomModel`。
- **不做**：驗證 API Key、發起 completion、讀 auth.json、持久化使用者選項。

## 接口摘要

`GET() → NextResponse`

| 面向 | 形狀 |
|------|------|
| **Output 成功** | `{ providers: PiProviderInfo[] }` |
| **PiProviderInfo** | `id`, `apis[]`, `supportsCustomModel`, `modelCount`, `models: PiModelInfo[]` |
| **PiModelInfo** | `id`, `name`, `api`, `baseUrl`, `reasoning`, `input[]`, `contextWindow`, `maxTokens` |
| **虛擬渠道** | 首位固定 `openai-compatible`：`supportsCustomModel=true`，單一 `custom` model 模板 |
| **supportsCustomModel 規則** | 僅當該 provider 的 apis 恰為 `['openai-completions']` |
| **失敗** | `{ error }` status 500 |

## 依賴拓撲

```
Client 下拉 UI
  → **GET /api/pi-models**
  → @mariozechner/pi-ai（getProviders / getModels）
```

Bundle 內：與 `pi-llm` **共享 registry 語意**但不互相 import——本 route 只列目錄；`pi-llm` 在執行期用同 registry（含 `openai-compatible` 動態 model）做 `complete`。不經 `pi-auth`/`llm`。
