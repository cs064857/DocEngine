import { NextRequest, NextResponse } from 'next/server';
import { listObjects, putObject, getObject } from '@/lib/r2';
import { generateTaskId } from '@/lib/utils/helpers';
import { buildSkillVersionPrefix } from '@/lib/utils/task-metadata';
import { generateSkill } from '@/lib/processors/skill-generator';
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
  provider?: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  customPrompt?: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
}

/**
 * 非阻塞異步任務處理 (Fire-and-Forget for Docker)
 */
async function processSkillGeneration(payload: SkillJobPayload) {
  const { taskId, date, domain, customPrompt, provider, modelId, apiKey, baseUrl } = payload;
  const r2 = extractSkillTaskR2Overrides(payload);
  const outputPrefix = buildSkillVersionPrefix(date, domain, taskId);
  const abortController = new AbortController();
  const ensureTaskNotAborted = async () => throwIfSkillTaskAborted(taskId, r2);

  console.log(`[Skill Worker] Processing task ${taskId}: ${domain} (${date})`);
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
    const copyPromises = result.fileList.map(async (filename) => {
      try {
        await ensureTaskNotAborted();
        const sourceKey = `cleaned/${date}/${domain}/${filename}`;
        const content = await getObject(sourceKey, r2);
        const destKey = `${outputPrefix}references/${filename}`;
        await putObject(destKey, content, 'text/markdown', r2);
      } catch (err) {
        console.warn(`[Skill Worker] Failed to copy file ${filename}:`, err);
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
  } catch (error: unknown) {
    if (isAbortError(error)) {
      console.log(`[Skill Worker] Task ${taskId} aborted`);
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

    await updateSkillTaskStatus(taskId, {
      status: 'failed',
      error: errMsg,
    }, r2);
  } finally {
    unregisterSkillTaskAbortController(taskId);
  }
}

/**
 * POST /api/generate-skill
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, domain, provider, modelId, apiKey, baseUrl, customPrompt } = body;

    if (!date || !domain) {
      return NextResponse.json({ error: 'Missing required fields: date, domain' }, { status: 400 });
    }

    const r2 = extractSkillTaskR2Overrides(body);
    const prefix = `cleaned/${date}/${domain}/`;
    const objects = await listObjects(prefix, 5, r2);

    if (!objects || objects.length === 0) {
      return NextResponse.json(
        { error: `No cleaned files found at: ${prefix}` },
        { status: 404 }
      );
    }

    const resolvedProvider = provider || config.llm.skillGenerator.provider;
    const resolvedModelId = modelId || config.llm.skillGenerator.modelId;
    const taskId = generateTaskId();
    const now = new Date().toISOString();
    const outputPrefix = buildSkillVersionPrefix(date, domain, taskId);

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
    };

    await putObject(
      `skill-tasks/${taskId}.json`,
      JSON.stringify(taskStatus, null, 2),
      'application/json',
      r2
    );

    const payload: SkillJobPayload = {
      taskId,
      date,
      domain,
      provider,
      modelId,
      apiKey,
      baseUrl,
      customPrompt,
      r2AccountId: body.r2AccountId,
      r2AccessKeyId: body.r2AccessKeyId,
      r2SecretAccessKey: body.r2SecretAccessKey,
      r2BucketName: body.r2BucketName,
    };

    // Fire-and-Forget async 執行
    processSkillGeneration(payload).catch(console.error);

    console.log(`[Generate Skill] Task ${taskId} started asynchronously for ${domain} (${date})`);

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
