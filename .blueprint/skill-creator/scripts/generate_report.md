# skill-creator/scripts/generate_report.py

## 職責契約

**Description 優化結果 HTML 渲染器**：把 `run_loop` 的 JSON history 轉成單頁對照表（每 iteration 一列、每 query 一欄 ✓/✗），區分 train / test 欄位與 should_trigger 極性。

- **做**：解析 history 建 query 欄、聚合 triggers/runs 分數色階、標 best 列、可選 meta refresh 供 live 觀看。
- **不做**：執行評測、改寫 description、讀 workspace 磁碟 runs、起 HTTP server。

## 接口摘要

`generate_html(data, auto_refresh=False, skill_name="") → str`
- **Input data 形狀**（`run_loop` 輸出）：
  - `history[]`：`iteration, description, train_results|results, test_results?, train_passed/total, test_passed/total`
  - 摘要：`original_description, best_description, best_score, iterations_run, train_size, test_size, holdout`
  - 單 result：`{query, should_trigger, pass, triggers, runs}`
- **Output**：完整 HTML 字串（內嵌 CSS；Google Fonts）
- **Side Effect**：無（純函式）
- **Constraints**：`auto_refresh=True` 注入 5s meta refresh；best 列依 test 存在與否選 max test/train

CLI：`input` JSON 路徑或 `-`（stdin）；`-o` 寫檔否則 stdout。

## 依賴拓撲

```
run_loop（每輪 live + 結束 final）
    │  import generate_html
    ▼
**generate_report**  ──► 純 HTML 字串
    │
    └── CLI 也可獨立吃 results.json
```

Bundle 內：僅服務 **description 優化迴圈** 的可視化；與 `generate_review`（workspace run 評審）及 `aggregate_benchmark`（grading 統計）平行、互不 import。
