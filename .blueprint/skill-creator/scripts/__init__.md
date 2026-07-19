# skill-creator/scripts/__init__.py

## 職責契約

Python 套件標記檔，使 `skill-creator/scripts` 可被視為 package。**嚴禁**承載業務邏輯、CLI 入口或副作用初始化。

## 接口摘要

- **無 public API**：內容為空（或僅套件標記）。
- **Side Effect**：無。

## 依賴拓撲

```
skill-creator/scripts/*（run_eval / package_skill / utils…）
        ▲
   __init__.py（空 package 標記，無 import 邊）
```
