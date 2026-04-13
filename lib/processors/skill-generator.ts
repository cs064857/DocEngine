/**
 * Skill Generator 處理器
 *
 * 三步 Agent 流程：Summarize → Generate → Refine
 * 從 R2 cleaned 文件生成 Antigravity SKILL.md
 */

import { chatCompletion } from '@/lib/services/llm';
import { listObjects, getObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import {
  SUMMARIZE_DOCS_PROMPT,
  GENERATE_SKILL_PROMPT,
  REFINE_SKILL_PROMPT,
  fillPromptTemplate,
} from '@/lib/prompts/skill-generator';

/** LLM 配置 */
export interface SkillLLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 生成結果 */
export interface SkillGenerationResult {
  skillMd: string;
  fileList: string[];
}

/** 進度回報函式 */
export type ProgressCallback = (phase: string, detail: string) => void;

/**
 * 單一文件內容摘要的最大字元數
 * 超過此值的文件內容會被截斷
 */
const MAX_CHARS_PER_FILE = 3000;

/**
 * 所有文件拼接後的最大總字元數
 * 超過此值啟動智能截斷（僅取前 500 字 + 末 200 字）
 */
const MAX_TOTAL_CHARS = 100_000;

/**
 * listObjects 每次最多取得的物件數量
 */
const LIST_OBJECTS_LIMIT = 500;

/**
 * 從 R2 列出指定前綴下的所有 MD 文件 key
 */
async function listAllMdFiles(
  prefix: string,
  r2?: R2Overrides
): Promise<string[]> {
  const objects = await listObjects(prefix, LIST_OBJECTS_LIMIT, r2);
  return objects
    .map((obj) => obj.Key!)
    .filter((key) => key && key.endsWith('.md'));
}

/**
 * 並行讀取多個 R2 文件，返回 { key, content } 陣列
 */
async function readFiles(
  keys: string[],
  r2?: R2Overrides
): Promise<{ key: string; filename: string; content: string }[]> {
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const content = await getObject(key, r2);
      // 從完整 key 提取檔名
      const parts = key.split('/');
      const filename = parts[parts.length - 1] || key;
      return { key, filename, content };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<{ key: string; filename: string; content: string }> =>
      r.status === 'fulfilled'
    )
    .map((r) => r.value);
}

/**
 * 智能截斷文件內容
 * 若單一文件超過 MAX_CHARS_PER_FILE，保留前段 + 末段
 */
function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = Math.floor(maxChars * 0.2);
  return (
    content.slice(0, headSize) +
    '\n\n... [content truncated] ...\n\n' +
    content.slice(-tailSize)
  );
}

/**
 * 組合文件內容字串（含智能截斷）
 */
function buildDocumentContents(
  files: { filename: string; content: string }[]
): string {
  let totalChars = 0;
  const parts: string[] = [];

  for (const file of files) {
    // 判斷是否需要更積極的截斷
    const maxPerFile =
      totalChars > MAX_TOTAL_CHARS * 0.8
        ? 500 // 接近上限時大幅截斷
        : MAX_CHARS_PER_FILE;

    const truncated = truncateContent(file.content, maxPerFile);
    parts.push(`### ${file.filename}\n\n${truncated}`);
    totalChars += truncated.length;

    // 硬性上限
    if (totalChars > MAX_TOTAL_CHARS) {
      parts.push(
        `\n\n... [${files.length - parts.length} more files omitted due to size limit] ...`
      );
      break;
    }
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 建立文件列表字串
 */
function buildFileList(files: { filename: string }[]): string {
  return files.map((f, i) => `${i + 1}. \`references/${f.filename}\``).join('\n');
}

/**
 * 主函式：三步 Agent 生成 Skill
 */
export async function generateSkill(params: {
  date: string;
  domain: string;
  llmConfig: SkillLLMConfig;
  r2?: R2Overrides;
  customPrompt?: string;
  onProgress?: ProgressCallback;
}): Promise<SkillGenerationResult> {
  const { date, domain, llmConfig, r2, customPrompt, onProgress } = params;

  // === Phase 0: 收集文件 ===
  onProgress?.('collecting', '正在從 R2 讀取 cleaned 文件...');

  const prefix = `cleaned/${date}/${domain}/`;
  const fileKeys = await listAllMdFiles(prefix, r2);

  if (fileKeys.length === 0) {
    throw new Error(`No cleaned MD files found at: ${prefix}`);
  }

  onProgress?.('collecting', `找到 ${fileKeys.length} 個文件，正在讀取內容...`);

  const files = await readFiles(fileKeys, r2);

  if (files.length === 0) {
    throw new Error(`Failed to read any files from: ${prefix}`);
  }

  const fileList = buildFileList(files);
  const documentContents = buildDocumentContents(files);

  // === Phase 1: Summarize ===
  onProgress?.('summarize', `正在分析 ${files.length} 份文檔...`);

  const summarizePrompt = fillPromptTemplate(SUMMARIZE_DOCS_PROMPT, {
    fileList,
    documentContents,
  });

  const summaryResponse = await chatCompletion(
    llmConfig,
    [
      { role: 'system', content: 'You are a technical documentation analyst.' },
      { role: 'user', content: summarizePrompt },
    ],
    { temperature: 0.3 }
  );

  onProgress?.('summarize', '文檔摘要完成');

  // === Phase 2: Generate ===
  onProgress?.('generate', '正在生成 SKILL.md 骨架...');

  // 如果用戶提供自訂 Prompt，將其附加到系統指令中
  const generateSystemPrompt = customPrompt
    ? `You are an expert at creating Antigravity/OpenCode skill documents.\n\nAdditional user instructions:\n${customPrompt}`
    : 'You are an expert at creating Antigravity/OpenCode skill documents.';

  const generatePrompt = fillPromptTemplate(GENERATE_SKILL_PROMPT, {
    summary: summaryResponse,
    fileList,
  });

  const skillDraft = await chatCompletion(
    llmConfig,
    [
      { role: 'system', content: generateSystemPrompt },
      { role: 'user', content: generatePrompt },
    ],
    { temperature: 0.4 }
  );

  onProgress?.('generate', 'SKILL.md 骨架生成完成');

  // === Phase 3: Refine ===
  onProgress?.('refine', '正在校驗與精修...');

  const refinePrompt = fillPromptTemplate(REFINE_SKILL_PROMPT, {
    skillDraft,
    fileList,
  });

  const finalSkillMd = await chatCompletion(
    llmConfig,
    [
      { role: 'system', content: 'You are a quality reviewer for Antigravity skill documents.' },
      { role: 'user', content: refinePrompt },
    ],
    { temperature: 0.2 }
  );

  onProgress?.('refine', '校驗完成，SKILL.md 已就緒');

  return {
    skillMd: finalSkillMd,
    fileList: files.map((f) => f.filename),
  };
}
