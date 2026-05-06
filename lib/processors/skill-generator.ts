/**
 * Skill Generator 處理器
 *
 * 三步 Agent 流程：Summarize → Generate → Refine
 * 從 R2 cleaned 文件生成 Antigravity SKILL.md
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

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
  sourceFiles: { sourceKey: string; referencePath: string }[];
}

export interface SkillSourceFolder {
  date: string;
  domain: string;
}

/** 進度回報函式 */
export type ProgressCallback = (phase: string, detail: string) => void | Promise<void>;

/** 單一文件內容摘要的最大字元數 */
const MAX_CHARS_PER_FILE = 3000;
/** 所有文件拼接後的最大總字元數 */
const MAX_TOTAL_CHARS = 100_000;
/** listObjects 每次最多取得的物件數量 */
const LIST_OBJECTS_LIMIT = 500;

const SKILL_CREATOR_SKILL_PATH = path.join(process.cwd(), 'skill-creator', 'SKILL.md');
const SKILL_CREATOR_SNIPPET_MAX_CHARS = 12_000;

async function loadSkillCreatorGuidance(): Promise<string | null> {
  try {
    const full = await readFile(SKILL_CREATOR_SKILL_PATH, 'utf-8');

    const start = full.indexOf('### Write the SKILL.md');
    const end = full.indexOf('## Running and evaluating test cases');

    let snippet = full;
    if (start >= 0) {
      snippet = full.slice(start, end > start ? end : undefined);
    }

    snippet = snippet.trim();
    if (snippet.length > SKILL_CREATOR_SNIPPET_MAX_CHARS) {
      snippet = snippet.slice(0, SKILL_CREATOR_SNIPPET_MAX_CHARS).trimEnd() + '\n\n... [skill-creator guidance truncated] ...\n';
    }

    return snippet;
  } catch {
    return null;
  }
}

function normalizeSkillMarkdown(markdown: string): string {
  let out = (markdown ?? '').trimStart();

  // 移除整體包在 Markdown code fence 的情況，避免巢狀 code block。
  if (out.startsWith('```markdown')) {
    out = out.replace(/^```markdown\n/, '').replace(/\n```\s*$/, '');
  } else if (out.startsWith('```')) {
    out = out.replace(/^```\n/, '').replace(/\n```\s*$/, '');
  }

  out = out.trim();

  // 若模型在 frontmatter 前多輸出一段前言，嘗試切到第一個 frontmatter。
  if (!out.startsWith('---')) {
    const idx = out.indexOf('---');
    if (idx >= 0) out = out.slice(idx).trimStart();
  }

  return out;
}

async function listAllMdFiles(prefix: string, r2?: R2Overrides): Promise<string[]> {
  const objects = await listObjects(prefix, LIST_OBJECTS_LIMIT, r2);
  return objects.map((obj) => obj.Key!).filter((key) => key && key.endsWith('.md'));
}

function toRelativePath(key: string, prefix: string): string {
  const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  return rel.replace(/^\/+/, '');
}

function buildCleanedPrefix(folder: SkillSourceFolder): string {
  return `cleaned/${folder.date}/${folder.domain}/`;
}

async function collectFileReferences(
  sourceFolders: SkillSourceFolder[],
  isMergedMode: boolean,
  r2?: R2Overrides
): Promise<{ sourceKey: string; relativePath: string }[]> {
  const references: { sourceKey: string; relativePath: string }[] = [];
  const seenSourceKeys = new Set<string>();
  const seenReferencePaths = new Set<string>();

  for (const folder of sourceFolders) {
    const prefix = buildCleanedPrefix(folder);
    const fileKeys = await listAllMdFiles(prefix, r2);

    for (const key of fileKeys) {
      if (seenSourceKeys.has(key)) continue;
      seenSourceKeys.add(key);

      const relativePath = toRelativePath(key, prefix);
      if (!relativePath) continue;

      const baseReferencePath = isMergedMode ? `${folder.domain}/${relativePath}` : relativePath;
      let referencePath = baseReferencePath;
      if (seenReferencePaths.has(referencePath)) {
        referencePath = isMergedMode ? `${folder.date}/${baseReferencePath}` : `${folder.date}/${folder.domain}/${relativePath}`;
      }

      let collisionIndex = 2;
      while (seenReferencePaths.has(referencePath)) {
        referencePath = isMergedMode
          ? `${folder.date}/${folder.domain}-${collisionIndex}/${relativePath}`
          : `${folder.date}/${folder.domain}-${collisionIndex}/${relativePath}`;
        collisionIndex += 1;
      }

      seenReferencePaths.add(referencePath);
      references.push({ sourceKey: key, relativePath: referencePath });
    }
  }

  return references;
}

async function readFiles(fileReferences: { sourceKey: string; relativePath: string }[], r2?: R2Overrides): Promise<{ sourceKey: string; relativePath: string; content: string }[]> {
  const results = await Promise.allSettled(
    fileReferences.map(async (file) => {
      const content = await getObject(file.sourceKey, r2);
      return { ...file, content };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<{ sourceKey: string; relativePath: string; content: string }> => r.status === 'fulfilled')
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

function buildDocumentContents(files: { relativePath: string; content: string }[]): string {
  let totalChars = 0;
  const parts: string[] = [];

  for (const file of files) {
    const maxPerFile = totalChars > MAX_TOTAL_CHARS * 0.8 ? 500 : MAX_CHARS_PER_FILE;
    const truncated = truncateContent(file.content, maxPerFile);
    parts.push(`### ${file.relativePath}\n\n${truncated}`);
    totalChars += truncated.length;

    if (totalChars > MAX_TOTAL_CHARS) {
      parts.push(`\n\n... [${files.length - parts.length} more files omitted due to size limit] ...`);
      break;
    }
  }

  return parts.join('\n\n---\n\n');
}

function buildFileList(files: { relativePath: string }[]): string {
  return files.map((f, i) => `${i + 1}. \`references/${f.relativePath}\``).join('\n');
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
  folders?: SkillSourceFolder[];
  customPrompt?: string;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  throwIfAborted?: () => Promise<void>;
}): Promise<SkillGenerationResult> {
  const { date, domain, provider, modelId, apiKey, baseUrl, r2, folders, customPrompt, onProgress, signal, throwIfAborted } = params;

  await throwIfAborted?.();

  // === Phase 0: 收集文件 ===
  await onProgress?.('collecting', '正在從 R2 讀取 cleaned 文件...');
  const sourceFolders = folders && folders.length > 0 ? folders : [{ date, domain }];
  const isMergedMode = sourceFolders.length > 1;
  const fileReferences = await collectFileReferences(sourceFolders, isMergedMode, r2);

  if (fileReferences.length === 0) {
    const sourceLabel = isMergedMode
      ? sourceFolders.map((folder) => buildCleanedPrefix(folder)).join(', ')
      : buildCleanedPrefix(sourceFolders[0]);
    throw new Error(`No cleaned MD files found at: ${sourceLabel}`);
  }

  await onProgress?.('collecting', `找到 ${fileReferences.length} 個文件，正在讀取內容...`);
  const files = await readFiles(fileReferences, r2);

  if (files.length === 0) {
    throw new Error(`Failed to read any files from selected cleaned folders`);
  }

  await throwIfAborted?.();

  const fileList = buildFileList(files);
  const documentContents = buildDocumentContents(files);

  // 預設安裝本地 skill-creator（作為生成指引）
  const skillCreatorGuidance = await loadSkillCreatorGuidance();

  // === Phase 1: Summarize ===
  await onProgress?.('summarize', `正在分析 ${files.length} 份文檔...`);
  const summarizePrompt = fillPromptTemplate(SUMMARIZE_DOCS_PROMPT, {
    fileList,
    documentContents,
  });

  const summaryResponse = await piComplete({
    provider,
    modelId,
    apiKey,
    baseUrl,
    signal,
    systemPrompt: 'You are a technical documentation analyst.',
    userPrompt: summarizePrompt,
    temperature: 0.3,
  });

  await throwIfAborted?.();
  await onProgress?.('summarize', '文檔摘要完成');

  // === Phase 2: Generate ===
  await onProgress?.('generate', '正在生成 SKILL.md 骨架...');

  const generateSystemPrompt = [
    'You are an expert at creating Antigravity/OpenCode skill documents.',
    skillCreatorGuidance
      ? `\n\nYou have a preinstalled skill called "skill-creator". Follow these guidelines when writing SKILL.md:\n\n${skillCreatorGuidance}`
      : '',
    customPrompt ? `\n\nAdditional user instructions:\n${customPrompt}` : '',
  ].join('');

  const generatePrompt = fillPromptTemplate(GENERATE_SKILL_PROMPT, {
    summary: summaryResponse.text,
    fileList,
  });

  const skillDraft = await piComplete({
    provider,
    modelId,
    apiKey,
    baseUrl,
    signal,
    systemPrompt: generateSystemPrompt,
    userPrompt: generatePrompt,
    temperature: 0.4,
  });

  await throwIfAborted?.();
  await onProgress?.('generate', 'SKILL.md 骨架生成完成');

  // === Phase 3: Refine ===
  await onProgress?.('refine', '正在校驗與精修...');
  const refinePrompt = fillPromptTemplate(REFINE_SKILL_PROMPT, {
    skillDraft: skillDraft.text,
    fileList,
  });

  const refineSystemPrompt = [
    'You are a quality reviewer for Antigravity skill documents.',
    skillCreatorGuidance
      ? `\n\n(Installed skill: skill-creator) Use the same skill-creator guidelines to catch missing sections, missing reference mentions, and formatting issues.`
      : '',
  ].join('');

  const finalSkillMd = await piComplete({
    provider,
    modelId,
    apiKey,
    baseUrl,
    signal,
    systemPrompt: refineSystemPrompt,
    userPrompt: refinePrompt,
    temperature: 0.2,
  });

  await throwIfAborted?.();
  const finalMarkdown = normalizeSkillMarkdown(finalSkillMd.text);
  if (!finalMarkdown || finalMarkdown.trim().length === 0) {
    throw new Error('LLM returned empty SKILL.md');
  }
  if (!finalMarkdown.trimStart().startsWith('---')) {
    throw new Error('Invalid SKILL.md: missing YAML frontmatter. Output must start with `---`.');
  }

  await onProgress?.('refine', '校驗完成，SKILL.md 已就緒');

  return {
    skillMd: finalMarkdown,
    fileList: files.map((f) => f.relativePath),
    sourceFiles: files.map((f) => ({
      sourceKey: f.sourceKey,
      referencePath: f.relativePath,
    })),
  };
}
