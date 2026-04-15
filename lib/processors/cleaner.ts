import { chatCompletion } from '../services/llm';
import { config } from '../config';

export interface CleanerOverrides {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  prompt?: string;
}

// 預設清理提示詞（來源：CLEANING_PROMPT.md）
const DEFAULT_CLEANING_PROMPT = `你是一個專業的文件處理助手，專門負責清理和結構化爬取下來的 Markdown 文件。你的目標是將粗糙的網頁內容轉化為高質量的、適合存放於 RAG (Retrieval-Augmented Generation) 知識庫的格式。

請按照以下指南處理輸入的 Markdown 文字：

# 核心目標
1. 保持資訊完整性：不要遺漏任何有價值的內容。
2. 提升可讀性：修復排版錯誤，確保結構清晰。
3. 移除雜訊：刪除無用的網頁元素（導覽列、頁腳、廣告、版權聲明等）。
4. 標準化格式：統一使用標準的 Markdown 語法。

# 具體處理步驟

## 1. 結構化重組
*   為文件添加一個適當的主標題 (H1, \`# \`)，如果原文沒有或不明確。
*   檢查標題層級 (H2, H3, 等等)，確保它們的邏輯順序正確，避免跳躍（例如 H1 直接跳到 H3）。
*   將相關的段落分組到適當的副標題下。

## 2. 內容清理與降噪
*   移除所有導覽列連結、選單、側邊欄項目。
*   移除頁腳內容 (如「版權所有」、「隱私政策」、「聯絡我們」等非核心內容)。
*   移除廣告占位符或明顯的推廣內容。
*   移除多餘的空行、連續的空格或無意義的符號 (如大量的 \`*\` 或 \`-\` 連續出現)。
*   處理殘留的 HTML 標籤，將其轉換為 Markdown 或直接移除。

## 3. 內文格式化
*   **列表**：將混亂的條列式內容整理為清晰的無序列表 (\`-\`) 或有序列表 (\`1.\`)。
*   **程式碼與指令**：將所有的指令、程式碼片段或配置檔內容放入合適的 Markdown 程式碼區塊中 (\`\`\`語言 ... \`\`\`)。
*   **強調**：合理使用**粗體**來標示關鍵名詞或重點，使用\`行內程式碼\`來標示變數、檔案路徑或介面文字。
*   **表格**：如果遇到表格數據，嘗試將其轉換為 Markdown 表格格式。

## 4. 針對 RAG 優化的特殊處理
*   **段落長度**：如果一個段落過長（超過 5 句），嘗試將其拆分為較小的段落，以利於未來的向量切塊 (Chunking)。
*   **指代消解**：如果第一段出現「這個系統」、「本產品」等代名詞，盡量用具體的名稱替換，增加獨立段落的資訊量。

# 輸出要求
*   **只輸出清理後的 Markdown 內容**，不要包含任何如「以下是清理後的內容」、「好的，我已經處理完成」等前言或結語。
*   不要改變原文的語氣與專業名詞。`.trim();

/**
 * 使用 LLM API 清理 Markdown 內容
 * @param rawMarkdown - 原始 Markdown 內容
 * @param overrides - 可選覆蓋配置（含自訂 prompt）
 */
export async function cleanContent(rawMarkdown: string, overrides?: CleanerOverrides): Promise<string> {
  if (!rawMarkdown || rawMarkdown.trim() === '') {
    console.log('[Cleaner] Empty markdown provided, skipping cleanup.');
    return '';
  }

  const modelToUse = overrides?.model || config.llm.contentCleaner.model;
  const urlToUse = overrides?.baseUrl || config.llm.contentCleaner.baseUrl;
  const promptToUse = overrides?.prompt || DEFAULT_CLEANING_PROMPT;

  const customConfig = {
    baseUrl: urlToUse,
    apiKey: overrides?.apiKey || config.llm.contentCleaner.apiKey,
    model: modelToUse
  };

  try {
    const cleaned = await chatCompletion(customConfig, [
      { role: 'system', content: promptToUse },
      { role: 'user', content: rawMarkdown }
    ]);

    // LLM 回傳空白內容時，視為錯誤（可能是模型問題或 prompt 不相容）
    if (!cleaned || cleaned.trim() === '') {
      throw new Error(`LLM returned empty completion (model=${modelToUse}, baseUrl=${urlToUse})`);
    }

    return cleaned;
  } catch (error) {
    console.error('[Cleaner] Error cleaning content:', error);
    throw error; // 不再靜默吞掉錯誤，讓呼叫端決定如何處理
  }
}
