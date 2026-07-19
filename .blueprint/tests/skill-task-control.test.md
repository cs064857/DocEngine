# skill-task-control.test

## 職責契約

鎖定 **skill-task-control** 的進程內 abort 與 R2 override 抽取契約（node:test + assert/strict）。

- **負責**：驗證 register→abort→signal.aborted；未知 task 回 false；abort 錯誤辨識；override 全缺/非 string 過濾。
- **不負責**：R2 真實 I/O、LLM、完整任務生命週期整合測。

## 接口摘要

測試案例（意圖層）：

| 案例 | 斷言意圖 |
|------|----------|
| abort 已註冊 controller | 回 true 且 `signal.aborted` |
| abort 未知 task | 回 false |
| `isAbortError` | `SkillTaskAbortedError` 與 `AbortError` 為 true，一般 Error 為 false |
| `extractSkillTaskR2Overrides` 空 body | undefined |
| 僅 string 欄位 | 非 string 變 undefined，string 保留 |

## 依賴拓撲

```
tests/skill-task-control.test
        │  直接 import
        ▼
  lib/services/skill-task-control
        └── 間接：skill-task-status（錯誤訊息）、r2 型別
```

與 **skill-task-status.test** 互補：本檔測控制/abort 行為，彼檔測狀態純函式。
