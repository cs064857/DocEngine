# next.config.ts

## 職責契約 (Responsibility Contract)

本檔僅負責 Next.js 執行期與建置層的全域行為設定。它**只宣告**框架級選項，**嚴禁**承載業務邏輯、環境變數解析或 API 路由行為。

具體承諾：
- 放寬 Server Actions 請求體上限（4mb），以容納較大的前端提交負載。
- 將 `@mariozechner/pi-ai`、`@vercel/queue` 標為 `serverExternalPackages`，避免被打包進 serverless bundle 造成相容性問題。

**不做**：路由規則、重導向、影像優化、業務 feature flag。

## 接口摘要 (Interface Summary)

`default export nextConfig: NextConfig`

| 設定鍵 | 意圖 | 副作用 |
|--------|------|--------|
| `experimental.serverActions.bodySizeLimit` | 允許最大 4mb body | 影響所有 Server Actions 請求體上限 |
| `serverExternalPackages` | 指定不打包、改由 Node runtime 載入的套件 | 影響 server 端 module resolution 與部署體積 |

無公開函式；由 Next.js 在啟動/建置時讀取。

## 依賴拓撲 (Dependency Topology)

```
Next.js Runtime
    └── next.config.ts  （本模組：框架殼設定）
            ├── 約束 → app/**（含 layout / page / api）
            └── 外部套件白名單 → pi-ai、@vercel/queue
```

與本 bundle 關係：`layout` / `page` 執行於本設定所定義的 Next 殼層之上；`lib/config` 與本檔正交（env 業務設定 vs 框架設定）。
