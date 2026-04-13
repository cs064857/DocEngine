/**
 * Skill Generator 處理器
 *
 * 三步 Agent 流程：Summarize → Generate → Refine
 * 從 R2 cleaned 文件生成 Antigravity SKILL.md
 */

import { piComplete } from '@/lib/services/pi-llm';
import { listObjects, getObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import {
  SUMMARIZE_DOCS_PROMPT,
  GENERATE_SKILL_PROMPT,
  REFINE_SKILL_PROMPT,
  fillPromptTemplate,
} from '@/lib/prompts/skill-generator';

/** 生成結果 */
export interface SkillGenerationResult {
  skillMd: string;
  fileList: string[];
}

/** 進度回報函式 */
export type ProgressCallback = (phase: string, detail: string) => void;

/** 單一文件內容摘要的最大字元數 */
const MAX_CHARS_PER_FILE = 3000;
/** 所有文件拼接後的最大總字元數 */
const MAX_TOTAL_CHARS = 100_000;
/** listObjects 每次最多取得的物件數量 */
const LIST_OBJECTS_LIMIT = 500;

async function listAllMdFiles(prefix: string, r2?: R2Overrides): Promise<string[]> {
  const objects = await listObjects(prefix, LIST_OBJECTS_LIMIT, r2);
  return objects.map((obj) => obj.Key!).filter((key) => key && key.endsWith('.md'));
}

async function readFiles(keys: string[], r2?: R2Overrides): Promise<{ key: string; filename: string; content: string }[]> {
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const content = await getObject(key, r2);
      const parts = key.split('/');
      const filename = parts[parts.length - 1] || key;
      return { key, filename, content };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<{ key: string; filename: string; content: string }> => r.status === 'fulfilled')
    .map((r) => r.value);
}

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

function buildDocumentContents(files: { filename: string; content: string }[]): string {
  let totalChars = 0;
  const parts: string[] = [];

  for (const file of files) {
    const maxPerFile = totalChars > MAX_TOTAL_CHARS * 0.8 ? 500 : MAX_CHARS_PER_FILE;
    const truncated = truncateContent(file.content, maxPerFile);
    parts.push(`### ${file.filename}\n\n${truncated}`);
    totalChars += truncated.length;

    if (totalChars > MAX_TOTAL_CHARS) {
      parts.push(`\n\n... [${files.length - parts.length} more files omitted due to size limit] ...`);
      break;
    }
  }

  return parts.join('\n\n---\n\n');
}

function buildFileList(files: { filename: string }[]): string {
  return files.map((f, i) => `${i + 1}. \`references/${f.filename}\``).join('\n');
}

/**
 * 主函式：三步 Agent 生成 Skill (使用 pi-mono)
 */
export async function generateSkill(params: {
  date: string;
  domain: string;
  provider: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  r2?: R2Overrides;
  customPrompt?: string;
  onProgress?: ProgressCallback;
}): Promise<SkillGenerationResult> {
  const { date, domain, provider, modelId, apiKey, baseUrl, r2, customPrompt, onProgress } = params;

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

  const summaryResponse = await piComplete({
    provider,
    modelId,
    apiKey,
    baseUrl,
    systemPrompt: 'You are a technical documentation analyst.',
    userPrompt: summarizePrompt,
    temperature: 0.3,
  });

  onProgress?.('summarize', '文檔摘要完成');

  // === Phase 2: Generate ===
  onProgress?.('generate', '正在生成 SKILL.md 骨架...');
  const generateSystemPrompt = customPrompt
    ? `You are an expert at creating Antigravity/OpenCode skill documents.\n\nAdditional user instructions:\n${customPrompt}`
    : 'You are an expert at creating Antigravity/OpenCode skill documents.';

  const generatePrompt = fillPromptTemplate(GENERATE_SKILL_PROMPT, {
    summary: summaryResponse.text,
    fileList,
  });

  const skillDraft = await piComplete({
    provider,
    modelId,
    apiKey,
    baseUrl,
    systemPrompt: generateSystemPrompt,
    userPrompt: generatePrompt,
    temperature: 0.4,
  });

  onProgress?.('generate', 'SKILL.md 骨架生成完成');

  // === Phase 3: Refine ===
  onProgress?.('refine', '正在校驗與精修...');
  const refinePrompt = fillPromptTemplate(REFINE_SKILL_PROMPT, {
    skillDraft: skillDraft.text,
    fileList,
  });

  const finalSkillMd = await piComplete({
    provider,
    modelId,
    apiKey,
    baseUrl,
    systemPrompt: 'You are a quality reviewer for Antigravity skill documents.',
    userPrompt: refinePrompt,
    temperature: 0.2,
  });

  onProgress?.('refine', '校驗完成，SKILL.md 已就緒');

  let finalMarkdown = finalSkillMd.text;
  // If the model wrapped the output in a markdown block, remove it to prevent nested code blocks.
  if (finalMarkdown.startsWith('```markdown')) {
    finalMarkdown = finalMarkdown.replace(/^```markdown\n/, '').replace(/\n```$/, '');
  } else if (finalMarkdown.startsWith('```')) {
    finalMarkdown = finalMarkdown.replace(/^```\n/, '').replace(/\n```$/, '');
  }

  return {
    skillMd: finalMarkdown,
    fileList: files.map((f) => f.filename),
  };
}
