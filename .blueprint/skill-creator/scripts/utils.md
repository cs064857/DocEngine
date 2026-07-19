# utils.py

## 職責契約

skill-creator scripts 的**共用輕量解析**：從 `SKILL.md` 抽出 `name`、`description` 與全文。**僅負責**：frontmatter 邊界定位與兩欄位字面讀取（含 YAML multiline `>`/`|` 續行）。**嚴禁**：規格驗證、YAML 完整解析、打包、LLM 呼叫。失敗以 `ValueError` 拋出，不吞錯。

## 接口摘要

- `parse_skill_md(skill_path: Path) -> tuple[str, str, str]`
  - **Input**：skill 目錄（內含 `SKILL.md`）
  - **Output**：`(name, description, full_content)`
  - **行為**：
    - 要求首行與結束行為 `---`
    - `name:` 單行取值（去引號）
    - `description:` 支援單行或 multiline 指示符後縮排續行，續行以空白 join
  - **Error**：缺 opening/closing `---` → `ValueError`

## 依賴拓撲

```
improve_description.main
  → **parse_skill_md**  ← 本模組
       → pathlib.Path.read_text

package_skill / quick_validate
  → 不依賴本模組（各自讀 SKILL.md）
```

同 bundle：被 `improve_description` 使用；與 `quick_validate` 互補——validate 管規格合規，utils 管欄位抽取給改進流程。
