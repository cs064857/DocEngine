# POST /api/skill-download

## 職責契約

將 R2 上已產生的 skill 目錄**打包為 ZIP 並串流回傳**。僅負責讀取與壓縮，不觸發生成或改狀態。

- **做**：date/domain（可選 taskId）驗證、版本化前綴優先／legacy 回退、列出並並行讀取物件、組 `{domain}-skill/` ZIP、回傳 attachment。
- **不做**：Skill 生成、任務狀態讀寫、中止控制、檔案清理。

## 接口摘要

`POST(req: NextRequest) → NextResponse (ZIP | JSON error)`

| 面向 | 形狀 |
|------|------|
| **Input** | `{ date, domain, taskId?, r2AccountId?, r2AccessKeyId?, r2SecretAccessKey?, r2BucketName? }` |
| **Output 200** | `application/zip`，`Content-Disposition: attachment; filename="{domain}-skill.zip"` |
| **Output 400** | 缺 date/domain |
| **Output 404** | 版本化與 legacy 前綴皆無檔 |
| **Output 500** | `{ error }` |
| **Side Effect** | 僅 R2 讀取；單檔讀取失敗則 warn 跳過，不整批失敗 |
| **Constraints** | 有 `taskId` → `buildSkillVersionPrefix`；空結果則 fallback `buildLegacySkillPrefix`；最多 list 500 物件 |

## 依賴拓撲

```
Client → **POST /api/skill-download**
           ├→ buildSkillVersionPrefix | buildLegacySkillPrefix
           ├→ listObjects(prefix) → [empty + versioned] fallback legacy
           ├→ getObject(each key) ──並行──→ JSZip
           └→ NextResponse(zip buffer)
```

同 bundle：產物來自 `generate-skill` 寫入的版本前綴；`skill-status` 的 `outputPrefix` 對應可下載路徑。
