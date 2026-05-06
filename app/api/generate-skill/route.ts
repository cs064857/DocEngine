import { NextRequest, NextResponse } from 'next/server';
import { flushAllLogs, logger } from '@/lib/logger';
import { listObjects, putObject, getObject } from '@/lib/r2';
import { generateTaskId } from '@/lib/utils/helpers';
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

function isSkillSourceFolder(value: unknown): value is SkillSourceFolder {
  if (!value || typeof value !== 'object') return false;
  const folder = value as Partial<SkillSourceFolder>;
  return typeof folder.date === 'string' && folder.date.length > 0
    && typeof folder.domain === 'string' && folder.domain.length > 0;
}

function resolveSkillSourceFolders(body: Record<string, unknown>): SkillSourceFolder[] | null {
  if (Array.isArray(body.folders)) {
    return body.folders.length > 0 && body.folders.every(isSkillSourceFolder) ? body.folders : null;
  }

  if (typeof body.date === 'string' && body.date.length > 0 && typeof body.domain === 'string' && body.domain.length > 0) {
    return [{ date: body.date, domain: body.domain }];
  }

  return null;
}

function getOutputMetadata(folders: SkillSourceFolder[], taskId: string, mergedName?: string): { date: string; domain: string; outputPrefix: string } {
  const isMergedMode = folders.length > 1;
  const date = folders[0].date;
  const domain = isMergedMode ? sanitizeSkillPathName(mergedName) : folders[0].domain;
  const outputPrefix = isMergedMode
    ? buildMergedSkillVersionPrefix(folders.map((folder) => folder.date), taskId, mergedName)
    : buildSkillVersionPrefix(date, domain, taskId);

  return { date, domain, outputPrefix };
}

/**
 * 非阻塞異步任務處理 (Fire-and-Forget for Docker)
 */
async function processSkillGeneration(payload: SkillJobPayload) {
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
    const resolvedProvider = provider || config.llm.skillGenerator.provider;
    const resolvedModelId = modelId || config.llm.skillGenerator.modelId;

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
  } finally {
    await flushAllLogs(r2);
    unregisterSkillTaskAbortController(taskId);
  }
}

/**
 * POST /api/generate-skill
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, modelId, apiKey, baseUrl, customPrompt } = body;
    const mergedName = typeof body.mergedName === 'string' ? body.mergedName : undefined;
    const folders = resolveSkillSourceFolders(body);

    if (!folders) {
      return NextResponse.json({ error: 'Missing required fields: folders, or date and domain' }, { status: 400 });
    }

    const r2 = extractSkillTaskR2Overrides(body);
    for (const folder of folders) {
      const prefix = `cleaned/${folder.date}/${folder.domain}/`;
      const objects = await listObjects(prefix, 5, r2);

      if (!objects || objects.length === 0) {
        return NextResponse.json(
          { error: `No cleaned files found at: ${prefix}` },
          { status: 404 }
        );
      }
    }

    const resolvedProvider = provider || config.llm.skillGenerator.provider;
    const resolvedModelId = modelId || config.llm.skillGenerator.modelId;
    const taskId = generateTaskId();
    const now = new Date().toISOString();
    const { date, domain, outputPrefix } = getOutputMetadata(folders, taskId, mergedName);

    const taskStatus: SkillTaskStatus = {
      taskId,
      status: 'processing',
      phase: 'queued',
      date,
      domain,
      fileCount: 0,
      createdAt: now,
      updatedAt: now,
      outputPrefix,
      provider: resolvedProvider,
      modelId: resolvedModelId,
      baseUrl: baseUrl || undefined,
      customPrompt: customPrompt || undefined,
      mergedName: folders.length > 1 ? sanitizeSkillPathName(mergedName) : undefined,
      folders,
    };

    await putObject(
      `skill-tasks/${taskId}.json`,
      JSON.stringify(taskStatus, null, 2),
      'application/json',
      r2
    );
    logger.info('Task created and queued', {
      taskId,
      phase: 'queued',
      meta: { domain, provider: resolvedProvider, modelId: resolvedModelId },
      r2,
    });
    await flushAllLogs(r2);

    const payload: SkillJobPayload = {
      taskId,
      date,
      domain,
      folders,
      provider,
      modelId,
      apiKey,
      baseUrl,
      customPrompt,
      mergedName,
      r2AccountId: body.r2AccountId,
      r2AccessKeyId: body.r2AccessKeyId,
      r2SecretAccessKey: body.r2SecretAccessKey,
      r2BucketName: body.r2BucketName,
    };

    // Fire-and-Forget async 執行
    processSkillGeneration(payload).catch(console.error);

    console.log(`[Generate Skill] Task ${taskId} started asynchronously for ${domain} (${folders.length} folder${folders.length > 1 ? 's' : ''})`);

    return NextResponse.json({
      taskId,
      message: 'Skill generation task started successfully',
    });
  } catch (error: unknown) {
    console.error('[Generate Skill] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
