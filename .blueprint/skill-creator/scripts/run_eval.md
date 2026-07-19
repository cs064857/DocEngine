# skill-creator/scripts/run_eval.py

## 職責契約

**Skill description 觸發評測引擎**：以 eval set 查詢並行呼叫 `claude -p`，判定該 description 是否會讓 Claude 觸發（讀取）目標 skill，輸出 JSON 結果。

- **做**：寫入臨時 `.claude/commands/{skill}-skill-{uuid}.md`、stream-json 早期偵測 Skill/Read tool_use、多 run 聚合 trigger_rate、threshold 判定 pass/fail。
- **不做**：description 改寫、train/test 分割、HTML 報告、benchmark 彙總（分別屬 `run_loop` / `generate_report` / `aggregate_benchmark`）。

## 接口摘要

`run_single_query(query, skill_name, skill_description, timeout, project_root, model?) → bool`
- **Output**：是否觸發（stream 早期命中 clean_name 即 True；非 Skill/Read 的 tool_use 即 False）
- **Side Effect**：建/刪 command 檔；spawn `claude -p`（剝除 `CLAUDECODE` 以允許巢狀）

`run_eval(eval_set, skill_name, description, num_workers, timeout, project_root, runs_per_query=1, trigger_threshold=0.5, model?) → dict`
- **Input eval_set**：`[{query, should_trigger}, ...]`
- **Output**：`{skill_name, description, results[{query, should_trigger, trigger_rate, triggers, runs, pass}], summary{total,passed,failed}}`
- **Constraints**：`should_trigger=True` 時 rate≥threshold 才 pass；否則 rate&lt;threshold 才 pass

CLI：`--eval-set` `--skill-path` 必填；可覆寫 `--description`；stdout 印 JSON。

## 依賴拓撲

```
CLI / **run_loop**
      │
      ▼
  **run_eval** ──► parse_skill_md (utils, bundle_11)
      │
      ├── ProcessPoolExecutor × run_single_query
      │         └── claude -p stream-json（早期 Skill/Read 偵測）
      └── find_project_root（向上找 .claude/）
```

Bundle 內：被 `run_loop` 直接 import 呼叫；產出的 results 形狀是 `generate_report` 表格單元的資料源。
