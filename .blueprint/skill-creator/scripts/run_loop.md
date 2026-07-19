# skill-creator/scripts/run_loop.py

## 職責契約

**Description 優化主迴圈**：eval → 失敗則 improve → 再 eval，直到 train 全過或達 max_iterations；以 test holdout 選最佳 description，防過擬合。

- **做**：train/test 分層切分、批次 `run_eval`、剝除 test 欄位後呼叫 `improve_description`、維護 history、即時/最終 HTML 報告、可選 results 目錄落盤。
- **不做**：單次 query 的 claude 子程序細節（`run_eval`）、HTML 版面（`generate_report`）、description 的 LLM 改寫本體（`improve_description`，bundle_11）。

## 接口摘要

`split_eval_set(eval_set, holdout, seed=42) → (train, test)`
- 依 `should_trigger` 分層 shuffle；每組至少 1 筆進 test

`run_loop(...) → dict`
- **關鍵參數**：`max_iterations`、`holdout`（0=全 train）、`runs_per_query`、`trigger_threshold`、`model`（improve 用）、`live_report_path?`、`log_dir?`
- **Output 核心欄位**：`best_description`、`best_score`、`best_train_score`、`best_test_score`、`history[]`、`exit_reason`、`iterations_run`
- **選優規則**：有 test → max `test_passed`；否則 max `train_passed`
- **Side Effect**：每輪可覆寫 live HTML（auto_refresh）；improve 時 history 剝除 `test_*` 鍵

CLI：`--eval-set` `--skill-path` `--model` 必填；`--report auto|none|path`；`--results-dir` 寫 `results.json` + `report.html` + `logs/`。

## 依賴拓撲

```
CLI
 │
 ▼
**run_loop**
 ├── run_eval          ──► 觸發評測（本 bundle）
 ├── improve_description ──► Anthropic 改寫 description（bundle_11）
 ├── generate_html      ──► 即時/最終報告（本 bundle generate_report）
 └── parse_skill_md / find_project_root
```

Bundle 內角色：**編排中樞**——串起 `run_eval` 與 `generate_report`；不碰 `aggregate_benchmark` / `generate_review`（那是 workspace 執行結果評審路徑）。
