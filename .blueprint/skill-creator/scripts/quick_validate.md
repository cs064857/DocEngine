# quick_validate.py

## 職責契約

對 skill 目錄做**最小結構驗證**（SKILL.md frontmatter 規格）。**僅負責**：存在性、YAML frontmatter 解析、允許欄位白名單、`name`/`description` 必填與格式約束。**嚴禁**：打包、改檔、評測觸發率、深度語意檢查。通過與否以 `(bool, message)` 回傳，不做自動修復。

## 接口摘要

- `validate_skill(skill_path) -> tuple[bool, str]`
  - **Input**：skill 目錄路徑
  - **檢查序**：
    1. `SKILL.md` 存在
    2. 以 `---` 包圍的 YAML frontmatter
    3. 鍵 ⊆ `{name, description, license, allowed-tools, metadata, compatibility}`
    4. `name` 必填：kebab-case、`[a-z0-9-]+`、無首尾/連續連字、≤64
    5. `description` 必填：字串、禁 `<>`、≤1024
    6. 可選 `compatibility`：字串、≤500
  - **Output**：`(True, "Skill is valid!")` 或 `(False, 錯誤說明)`
- CLI：`python quick_validate.py <skill_directory>` → print message，exit 0/1

## 依賴拓撲

```
package_skill.package_skill
  → **validate_skill**  ← 本模組
       → pathlib / re / yaml.safe_load
```

同 bundle：被 `package_skill` 呼叫為打包閘門；與 `utils.parse_skill_md` 職責分離（本模組=規格驗證，utils=輕量欄位抽取）。`improve_description` 不直接依賴本模組。
