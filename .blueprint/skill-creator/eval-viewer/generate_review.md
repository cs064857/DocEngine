# skill-creator/eval-viewer/generate_review.py

## 職責契約

**Eval 人工評審 Viewer**：掃描 workspace 內含 `outputs/` 的 run 目錄，將產出檔（文字/圖/PDF/xlsx/binary）嵌入單頁 HTML，並以 stdlib HTTP 伺服器提供瀏覽與 `feedback.json` 自動儲存。

- **做**：遞迴發現 runs、embed 檔案、載入 grading/eval_metadata/前一輪 feedback、可選嵌入 benchmark.json、每次 GET 重掃 workspace。
- **不做**：執行評測、產生 grading、彙總統計（`aggregate_benchmark`）、description 優化報告（`generate_report`）。

## 接口摘要

`find_runs(workspace) → list[run]` / `build_run(root, run_dir) → {id, prompt, eval_id, outputs, grading}`
- prompt 來源：`eval_metadata.json` → `transcript.md` 的 `## Eval Prompt` 區段
- 排除 outputs 中的 `transcript.md` / `user_notes.md` / `metrics.json`

`embed_file(path) → {name, type, content|data_uri|data_b64}`（text / image / pdf / xlsx / binary / error）

`generate_html(runs, skill_name, previous?, benchmark?) → str`
- 讀同目錄 `viewer.html`，替換 `/*__EMBEDDED_DATA__*/` 為 `const EMBEDDED_DATA = {...}`

`ReviewHandler`：`GET /` 動態重產 HTML；`GET|POST /api/feedback` 讀寫 `workspace/feedback.json`（須含 `reviews` 鍵）

CLI：`workspace` 必填；`--port 3117`；`--previous-workspace`；`--benchmark`；`--static path` 只寫 HTML 不起 server。

## 依賴拓撲

```
skill-creator 迭代 workspace
  eval-N / with_skill|without_skill / run-N / outputs + grading.json
        │
        ├── **generate_review** ──► 本機 HTTP / 靜態 HTML + feedback.json
        │         └── 可選讀 aggregate_benchmark 的 benchmark.json
        │
        └── （平行）aggregate_benchmark ──► benchmark.json
```

Bundle 內：消費 **執行結果產物** 與可選 `aggregate_benchmark` 輸出；與 `run_eval`/`run_loop`/`generate_report`（description 觸發優化路徑）**無 import 關係**，同屬 skill-creator 評測生態的「人工審閱」端。
