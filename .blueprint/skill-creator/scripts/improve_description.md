# improve_description.py

## 職責契約

依 eval 失敗結果，用 Claude（extended thinking）改寫 skill 的 `description`，提升觸發精準度。**僅負責**：組裝改進 prompt、呼叫 Anthropic API、解析 `<new_description>`、超長時二次縮短、可選寫入 transcript log。**嚴禁**：直接改寫磁碟上的 SKILL.md、執行 eval、打包 skill。輸出為 JSON（新 description + 累積 history），供 `run_loop` 等上層迴圈消費。

## 接口摘要

- `improve_description(client, skill_name, skill_content, current_description, eval_results, history, model, test_results=None, log_dir=None, iteration=None) -> str`
  - **Input**：
    - `eval_results`：含 `results[]`（query/should_trigger/pass/triggers/runs）與 `summary`
    - `history`：先前 attempts（description + 分數 + 可選 results）
    - `test_results`：可選，併入 train/test 分數摘要
  - **Side Effect**：可寫 `log_dir/improve_iter_{n}.json`（prompt/thinking/response/final）
  - **約束**：描述宜 100–200 字、硬上限 1024；超限再 call 一次縮短
  - **Output**：改進後 description 字串
- `main()` CLI：
  - **Flags**：`--eval-results`、`--skill-path`、`--history`、`--model`、`--verbose`
  - **Side Effect**：stdout JSON `{description, history}`；stderr 可印 verbose
  - **前置**：`skill_path/SKILL.md` 存在

## 依賴拓撲

```
run_loop / CLI
  → improve_description.main
       → utils.parse_skill_md          （讀 name + 全文 content）
       → improve_description(...)
            → anthropic.Anthropic.messages.create  （thinking enabled）
```

同 bundle：依賴 `utils`；**不**呼叫 `package_skill` / `quick_validate`。與 bundle_10 的 `run_eval`/`run_loop` 形成「評測 → 改進描述 → 再評測」閉環的一環。
