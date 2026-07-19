# next-env.d.ts

## 職責契約

此檔為 Next.js 自動產生的 TypeScript 型別 reference，僅宣告 Next 與環境型別引用。**嚴禁**手改或承載業務邏輯；重建專案時可由 `next` 覆寫。

## 接口摘要

- **無 public API**：僅供 tsc / IDE 解析 `/// <reference types="next" />` 等指示。
- **Side Effect**：無執行期副作用。

## 依賴拓撲

```
Next.js CLI / tsc → next-env.d.ts（唯讀型別）
```

不進入應用資料流；與 `next.config`、`app/*` 正交。
