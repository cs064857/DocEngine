import { flushAllLogs, logger } from '@/lib/logger';
import { putObject, getObject } from '@/lib/r2';
import { buildMergedSkillVersionPrefix, buildSkillVersionPrefix, sanitizeSkillPathName } from '@/lib/utils/task-metadata';
import { generateSkill } from '@/lib/processors/skill-generator';
import type { SkillSourceFolder } from '@/lib/processors/skill-generator';
import {
  extractSkillTaskR2Overrides,
  isAbortError,
  registerSkillTaskAbortController,
  throwIfSkillTaskAborted,
  unregisterSkillTaskAbortController,
  updateSkillTaskStatus,
} from '@/lib/services/skill-task-control';
import { config } from '@/lib/config';
import { SKILL_TASK_ABORT_MESSAGE, type SkillTaskStatus } from '@/lib/utils/skill-task-status';

export interface SkillJobPayload {
  taskId: string;
  date: string;
  domain: string;
  folders?: SkillSourceFolder[];
  provider?: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  customPrompt?: string;
  mergedName?: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
}

export function isSkillSourceFolder(value: unknown): value is SkillSourceFolder {
  if (!value || typeof value !== 'object') return false;
  const folder = value as Partial<SkillSourceFolder>;
  return typeof folder.date === 'string' && folder.date.length > 0
    && typeof folder.domain === 'string' && folder.domain.length > 0;
}

export function resolveSkillSourceFolders(body: Record<string, unknown>): SkillSourceFolder[] | null {
  if (Array.isArray(body.folders)) {
    return body.folders.length > 0 && body.folders.every(isSkillSourceFolder) ? body.folders : null;
  }

  if (typeof body.date === 'string' && body.date.length > 0 && typeof body.domain === 'string' && body.domain.length > 0) {
    return [{ date: body.date, domain: body.domain }];
  }

  return null;
}

export function getOutputMetadata(folders: SkillSourceFolder[], taskId: string, mergedName?: string): { date: string; domain: string; outputPrefix: string } {
  const isMergedMode = folders.length > 1;
  const date = folders[0].date;
  const domain = isMergedMode ? sanitizeSkillPathName(mergedName) : folders[0].domain;
  const outputPrefix = isMergedMode
    ? buildMergedSkillVersionPrefix(folders.map((folder) => folder.date), taskId, mergedName)
    : buildSkillVersionPrefix(date, domain, taskId);

  return { date, domain, outputPrefix };
}

export function resolveSkillGeneratorModel(provider?: string, modelId?: string): { provider: string; modelId: string } {
  return {
    provider: provider || config.llm.skillGenerator.provider,
    modelId: modelId || config.llm.skillGenerator.modelId,
  };
}

export async function processSkillGeneration(payload: SkillJobPayload) {
  const { taskId, customPrompt, provider, modelId, apiKey, baseUrl, mergedName } = payload;
  const folders = payload.folders && payload.folders.length > 0
    ? payload.folders
    : [{ date: payload.date, domain: payload.domain }];
  const { date, domain, outputPrefix } = getOutputMetadata(folders, taskId, mergedName);
  const r2 = extractSkillTaskR2Overrides(payload);
  const abortController = new AbortController();
  const ensureTaskNotAborted = async () => throwIfSkillTaskAborted(taskId, r2);

  console.log(`[Skill Worker] Processing task ${taskId}: ${domain} (${folders.length} folder${folders.length > 1 ? 's' : ''})`);
  logger.info('Processing skill generation task', {
    taskId,
    phase: 'start',
    meta: { domain, folderCount: folders.length },
    r2,
  });
  registerSkillTaskAbortController(taskId, abortController);

  try {
    await ensureTaskNotAborted();
    const { provider: resolvedProvider, modelId: resolvedModelId } = resolveSkillGeneratorModel(provider, modelId);

    // 預設可用環境變數配置：SKILL_GENERATOR_API_KEY / SKILL_GENERATOR_BASE_URL
    // 但若使用 openai-codex（OAuth），不要用預設 apiKey 覆蓋 OAuth token 流程。
    const resolvedApiKey = apiKey || (resolvedProvider === 'openai-codex'
      ? undefined
      : (config.llm.skillGenerator.apiKey || undefined));
    const resolvedBaseUrl = baseUrl || (config.llm.skillGenerator.baseUrl || undefined);

    const result = await generateSkill({
      date,
      domain,
      folders,
      provider: resolvedProvider,
      modelId: resolvedModelId,
      apiKey: resolvedApiKey,
      baseUrl: resolvedBaseUrl,
      r2,
      customPrompt,
      signal: abortController.signal,
      throwIfAborted: ensureTaskNotAborted,
      onProgress: async (phase, detail) => {
        console.log(`[Skill Worker] Task ${taskId} - ${phase}: ${detail}`);
        logger.info(detail, { taskId, phase, r2 });
        await flushAllLogs(r2);
        await ensureTaskNotAborted();
        await updateSkillTaskStatus(taskId, {
          phase: phase as SkillTaskStatus['phase'],
        }, r2);
      },
    });

    // === 寫入 R2 ===
    await ensureTaskNotAborted();
    await updateSkillTaskStatus(taskId, { phase: 'writing' }, r2);
    await ensureTaskNotAborted();

    // 寫入 SKILL.md
    await putObject(
      `${outputPrefix}SKILL.md`,
      result.skillMd,
      'text/markdown',
      r2
    );
    console.log(`[Skill Worker] Written SKILL.md to ${outputPrefix}SKILL.md`);

    // 複製 cleaned 文件到 references/
    const copyPromises = result.sourceFiles.map(async (file) => {
      try {
        await ensureTaskNotAborted();
        const content = await getObject(file.sourceKey, r2);
        const destKey = `${outputPrefix}references/${file.referencePath}`;
        await putObject(destKey, content, 'text/markdown', r2);
      } catch (err) {
        console.warn(`[Skill Worker] Failed to copy file ${file.referencePath}:`, err);
      }
    });

    await Promise.all(copyPromises);
    console.log(`[Skill Worker] Copied ${result.fileList.length} files to references/`);

    // 更新任務狀態為完成
    await ensureTaskNotAborted();
    await updateSkillTaskStatus(taskId, {
      status: 'completed',
      phase: 'done',
      fileCount: result.fileList.length,
      skillPreview: result.skillMd.slice(0, 2000), // 前 2000 字作為預覽
    }, r2);

    console.log(`[Skill Worker] Task ${taskId} completed successfully`);
    logger.info('Task completed successfully', {
      taskId,
      phase: 'done',
      meta: { fileCount: result.fileList.length },
      r2,
    });
  } catch (error: unknown) {
    if (isAbortError(error)) {
      console.log(`[Skill Worker] Task ${taskId} aborted`);
      logger.info('Task aborted', { taskId, phase: 'aborted', r2 });
      await updateSkillTaskStatus(taskId, {
        status: 'aborted',
        error: SKILL_TASK_ABORT_MESSAGE,
      }, r2).catch((updateError) => {
        console.error(`[Skill Worker] Failed to persist aborted status for ${taskId}:`, updateError);
      });
      return;
    }

    console.error(`[Skill Worker] Task ${taskId} failed:`, error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Task failed', { taskId, phase: 'failed', meta: { error: errMsg }, r2 });

    await updateSkillTaskStatus(taskId, {
      status: 'failed',
      error: errMsg,
    }, r2);
    throw error;
  } finally {
    await flushAllLogs(r2);
    unregisterSkillTaskAbortController(taskId);
  }
}
