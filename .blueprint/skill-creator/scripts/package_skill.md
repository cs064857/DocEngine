# package_skill.py

## 職責契約

將通過驗證的 skill 目錄打包成可分發的 `.skill` 檔（ZIP/DEFLATED）。**僅負責**：路徑檢查、呼叫驗證閘、依排除規則走訪目錄並寫入 zip。**嚴禁**：修改 skill 內容、執行評測、上傳遠端、處理多 skill 批次。驗證失敗即中止，不產出半成品。

## 接口摘要

- `should_exclude(rel_path: Path) -> bool`
  - **Input**：相對 skill 父目錄的路徑
  - **規則**：排除 `__pycache__`/`node_modules`/`*.pyc`/`.DS_Store`；skill 根層 `evals/` 亦排除
- `package_skill(skill_path, output_dir=None) -> Path | None`
  - **Input**：skill 目錄；可選輸出目錄（預設 cwd）
  - **前置**：目錄存在、`SKILL.md` 存在、`validate_skill` 通過
  - **Side Effect**：建立 `{skill_name}.skill`；stdout 列出 Added/Skipped
  - **Output**：成功回傳檔案 Path，失敗 `None`
- `main()`：CLI `<skill-folder> [output-directory]`，exit 0/1

## 依賴拓撲

```
CLI main
  → package_skill
       → quick_validate.validate_skill  （打包前閘門）
       → zipfile + pathlib              （產物寫入）
```

同 bundle：強依賴 `quick_validate`；不依賴 `utils` / `improve_description`。
