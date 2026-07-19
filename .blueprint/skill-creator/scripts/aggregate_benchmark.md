# skill-creator/scripts/aggregate_benchmark.py

## 職責契約

**Benchmark 彙總器**：掃描評測目錄下各 config（如 with_skill / without_skill）的 `grading.json`，計算 pass_rate / time / tokens 的 mean·stddev·min·max 與 config 間 delta，產出 `benchmark.json` + `benchmark.md`。

- **做**：雙目錄佈局相容（workspace：`eval-N/config/run-N`；legacy：`runs/eval-N/...`）、動態發現 config 名、抽取 expectations/notes/timing。
- **不做**：執行 agent run、打分（grading 由外部產生）、起 viewer、description 優化。

## 接口摘要

`calculate_stats(values) → {mean, stddev, min, max}`（樣本 stddev，n=1 時 0）

`load_run_results(benchmark_dir) → dict[config, list[run]]`
- 每 run：`eval_id, run_number, pass_rate, passed/failed/total, time_seconds, tokens, tool_calls, errors, expectations, notes`
- timing 優先 `grading.timing`，否則 sibling `timing.json`

`aggregate_results(results) → run_summary`
- 每 config 三指標 stats；`delta` = 第一 config mean − 第二 config mean（字串格式）

`generate_benchmark(benchmark_dir, skill_name?, skill_path?) → dict`
- 形狀：`{metadata, runs[], run_summary, notes[]}`；metadata 含 timestamp、evals_run、placeholder 模型名

`generate_markdown(benchmark) → str`：雙 config 對照表

CLI：`benchmark_dir` 必填；`--output` 預設 `<dir>/benchmark.json`；同寫 `.md`。

## 依賴拓撲

```
外部 agent runs 寫入 grading.json
        │
        ▼
  **aggregate_benchmark** ──► benchmark.json / benchmark.md
        │
        └── generate_review --benchmark 可嵌入 Viewer「Benchmark」分頁
```

Bundle 內：獨立 CLI，**不**被 `run_eval`/`run_loop` 呼叫；產出供 `generate_review` 消費。與 description 優化路徑（run_loop 系）平行。
