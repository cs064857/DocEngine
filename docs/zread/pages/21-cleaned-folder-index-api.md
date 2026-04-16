# cleaned 資料夾索引 API

## 本頁範圍與讀者定位

本頁聚焦 `POST /api/list-cleaned-folders`：它不是用來讀單一 cleaned 檔案內容，也不是直接啟動 skill 生成，而是先把 R2 `cleaned/` 底下的物件彙整成「`date + domain` 的資料夾索引」，提供 Skill Generator 分頁做資料夾選擇；選到目標資料夾後，前端才會把同一組 `date`、`domain` 送進 `/api/generate-skill`。 Sources: [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L54-L85), [page.tsx](app/page.tsx#L2031-L2145), [generate-skill route](app/api/generate-skill/route.ts#L166-L238)

## 一張圖看懂 cleaned 索引 API 的位置

```mermaid
flowchart TD
  A[Skill Generator 分頁
  點擊 Refresh] --> B[/api/list-cleaned-folders POST]
  B --> C[listObjects('cleaned/', 1000)]
  C --> D[parseFolders
  依 date/domain 分組
  統計 fileCount 與 emptyFileCount]
  D --> E[availableFolders + 下拉選單]
  E --> F[選中 date|domain]
  F --> G[/api/generate-skill POST]
  G --> H[listObjects('cleaned/{date}/{domain}/', 5)]
```

這條資料流的關鍵是：`/api/list-cleaned-folders` 只做「資料夾級索引」，真正的 skill 任務建立仍在 `/api/generate-skill`；前端也只有在使用者手動按下 Refresh 時才會呼叫這個索引 API。 Sources: [page.tsx](app/page.tsx#L2031-L2056), [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L74-L79), [generate-skill route](app/api/generate-skill/route.ts#L175-L184)

## API 契約摘要

| 項目 | 實際行為 |
| --- | --- |
| Method / Path | `POST /api/list-cleaned-folders` |
| Request body | 可帶 `r2AccountId`、`r2AccessKeyId`、`r2SecretAccessKey`、`r2BucketName`；若 body 解析失敗會退回 `{}` |
| Storage call | `listObjects('cleaned/', 1000, r2)` |
| Success payload | `{ folders: [{ date, domain, prefix, fileCount, emptyFileCount }] }` |
| Error payload | `{ error: string }`，HTTP 500 |

這個契約反映了它的用途是「列索引而不是讀內容」：route 先把 request body 轉成可選的 `R2Overrides`，再一次列出 `cleaned/` 底下最多 1000 個物件，最後才在記憶體內分組成 folders 陣列回傳。 Sources: [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L16-L18), [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L59-L85), [r2.ts](lib/r2.ts#L24-L30), [r2.ts](lib/r2.ts#L123-L131)

## 核心行為

route 對 request body 的要求其實很寬鬆：`req.json()` 失敗時會直接落回空物件，而只有在四個 R2 覆蓋欄位任一存在時才組出 `R2Overrides`；進到底層 `resolveR2()` 後，若只有 `bucketName` 覆蓋，會沿用環境中的預設 client，若有認證覆蓋則要求 `accountId`、`accessKeyId`、`secretAccessKey` 完整齊備，對應的預設設定鍵名來自 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET_NAME`。 Sources: [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L59-L76), [r2.ts](lib/r2.ts#L35-L39), [r2.ts](lib/r2.ts#L54-L87), [config.ts](lib/config.ts#L26-L31)

`parseFolders()` 才是這個 API 的核心：它逐一檢查 `listObjects()` 回來的物件鍵，只有 `parts.length >= 4` 且第一段是 `cleaned` 才納入，然後用 `date/domain` 當分組鍵，累加 `fileCount`，並在 `Size === 0` 時累加 `emptyFileCount`；最後回傳 `prefix: cleaned/{date}/{domain}/`，並且只按日期字串由新到舊排序。 Sources: [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L16-L18), [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L19-L25), [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L27-L52)

前端消費方式也很直接：Skill Generator 先把 folders 存進 `availableFolders` state，Refresh 按鈕把四個 R2 覆蓋欄位原樣 POST 到 `/api/list-cleaned-folders`，回來後用 `date|domain` 當 `<select>` value；當使用者按下 `Generate Skill`，前端再把 `selectedFolder` split 成 `date` 與 `domain`，連同同一組 R2 覆蓋設定送進 `submitSkillGeneration()` 與 `/api/generate-skill`。 Sources: [page.tsx](app/page.tsx#L194-L210), [page.tsx](app/page.tsx#L2031-L2084), [page.tsx](app/page.tsx#L2107-L2145), [page.tsx](app/page.tsx#L284-L333)

## 關鍵模組 / 檔案導覽

| 檔案 | 角色 | 本頁關心的重點 |
| --- | --- | --- |
| `app/api/list-cleaned-folders/route.ts` | cleaned 索引 route | 分組規則、0B 檔案統計、回傳 payload 都在這裡定義。 |
| `lib/r2.ts` | R2 存取層 | `listObjects()` 的 `MaxKeys` 上限與 R2 覆蓋解析在這裡。 |
| `app/page.tsx` | 唯一前端消費者 | Refresh、下拉選單、0B 警告、送往 `/api/generate-skill` 全都集中在 Skill Generator 區塊。 |
| `app/api/generate-skill/route.ts` | 下游建立 skill 任務 | 使用被選中的 `date/domain` 組出 `cleaned/{date}/{domain}/` prefix，驗證資料夾是否非空。 |
| `lib/processors/skill-generator.ts` | 真正讀 cleaned 檔案的生成器 | 後續實際只保留 `.md` 物件作為 skill 生成輸入。 |
| `lib/utils/helpers.ts` | cleaned key 規則來源 | 正常清洗流程會把 cleaned 檔寫成 `cleaned/{date}/{domain}/{path}.md`。 |

把這些檔案串起來看，`/api/list-cleaned-folders` 是 Skill 生成管線前面的「資料夾目錄服務」：它決定使用者看見哪些 cleaned 批次，而不是決定每一個檔案如何被讀進 LLM。 Sources: [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L54-L85), [r2.ts](lib/r2.ts#L54-L87), [r2.ts](lib/r2.ts#L123-L131), [page.tsx](app/page.tsx#L2031-L2145), [generate-skill route](app/api/generate-skill/route.ts#L175-L184), [skill-generator.ts](lib/processors/skill-generator.ts#L84-L106), [helpers.ts](lib/utils/helpers.ts#L21-L44)

## 容易踩坑的地方

第一個坑是這個列表不會自動載入，而且前端 Refresh 邏輯沒有檢查 `res.ok`：它只是在成功 parse JSON 後做 `if (data.folders) setAvailableFolders(data.folders)`，真正會進 `catch` 的是網路或執行期例外，所以後端若回 500 `{ error }`，畫面不一定會把錯誤顯示出來，還可能保留舊的 folders 狀態。 Sources: [page.tsx](app/page.tsx#L2033-L2050), [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L80-L83)

第二個坑是列表完整性受 `listObjects('cleaned/', 1000)` 限制：`listObjects()` 只把 `limit` 映射到 `ListObjectsV2Command.MaxKeys`，沒有處理 continuation token 或多頁追取，所以一旦 `cleaned/` 底下實際物件超過 1000，缺漏的不只是單一檔案，還會連帶影響 `date/domain` 資料夾是否出現在索引中，以及 `fileCount` / `emptyFileCount` 的統計。 Sources: [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L74-L77), [r2.ts](lib/r2.ts#L123-L131)

第三個坑是「folder 級計數」不等於「實際 skill 生成輸入數」：索引 API 只要 key 位於 `cleaned/{date}/{domain}/...` 就會計數，並沒有在分組階段檢查副檔名；但真正的 skill 生成器在 `listAllMdFiles()` 中會再過濾一次，只保留 `.md` 物件。好消息是，正常 cleaned 寫入路徑會由 `buildR2Key()` 與 Clean API 轉成 `.md`，因此這個差異主要會在手動上傳或非標準寫入時浮現。 Sources: [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L23-L25), [list-cleaned-folders route](app/api/list-cleaned-folders/route.ts#L41-L50), [skill-generator.ts](lib/processors/skill-generator.ts#L84-L87), [helpers.ts](lib/utils/helpers.ts#L21-L44), [clean route](app/api/clean/route.ts#L61-L68)

第四個坑是 `emptyFileCount` 目前只是索引層與 UI 層的警告訊號，不是後端硬性阻擋條件：前端會在下拉選單與提示框標出 0B 檔案數，但 `/api/generate-skill` 真正驗證的只有 prefix 底下是否至少列到一些物件，並不會因為其中存在 0B 檔案而拒絕建立任務。 Sources: [page.tsx](app/page.tsx#L2063-L2079), [generate-skill route](app/api/generate-skill/route.ts#L175-L184)
