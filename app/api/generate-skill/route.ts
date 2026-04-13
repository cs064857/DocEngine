import { NextRequest, NextResponse } from 'next/server';
import { listObjects, putObject, getObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import { generateTaskId } from '@/lib/utils/helpers';
import { generateSkill } from '@/lib/processors/skill-generator';
import { config } from '@/lib/config';

export interface SkillTaskStatus {
  taskId: string;
  status: 'processing' | 'completed' | 'failed';
  phase: 'queued' | 'collecting' | 'summarize' | 'generate' | 'refine' | 'writing' | 'done';
  date: string;
  domain: string;
  fileCount: number;
  skillPreview?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

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

function extractR2Overrides(payload: Record<string, string | undefined>): R2Overrides | undefined {
  if (!payload.r2AccountId && !payload.r2AccessKeyId && !payload.r2SecretAccessKey) return undefined;
  return {
    accountId: payload.r2AccountId,
    accessKeyId: payload.r2AccessKeyId,
    secretAccessKey: payload.r2SecretAccessKey,
    bucketName: payload.r2BucketName,
  };
}

async function updateSkillTaskStatus(
  taskId: string,
  updates: Partial<SkillTaskStatus>,
  r2?: R2Overrides
) {
  try {
    const raw = await getObject(`skill-tasks/${taskId}.json`, r2);
    const current: SkillTaskStatus = JSON.parse(raw);

    const updated: SkillTaskStatus = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await putObject(
      `skill-tasks/${taskId}.json`,
      JSON.stringify(updated, null, 2),
      'application/json',
      r2
    );
  } catch (error) {
    console.error(`[Skill Worker] Failed to update task status for ${taskId}:`, error);
  }
}

/**
 * 非阻塞異步任務處理 (Fire-and-Forget for Docker)
 */
async function processSkillGeneration(payload: SkillJobPayload) {
  const { taskId, date, domain, customPrompt, provider, modelId, apiKey, baseUrl } = payload;
  const r2 = extractR2Overrides(payload as any);

  console.log(`[Skill Worker] Processing task ${taskId}: ${domain} (${date})`);

  try {
    const result = await generateSkill({
      date,
      domain,
      provider: provider || config.llm.skillGenerator.provider,
      modelId: modelId || config.llm.skillGenerator.modelId,
      apiKey: apiKey,
      baseUrl: baseUrl,
      r2,
      customPrompt,
      onProgress: async (phase, detail) => {
        console.log(`[Skill Worker] Task ${taskId} - ${phase}: ${detail}`);
        await updateSkillTaskStatus(taskId, {
          phase: phase as SkillTaskStatus['phase'],
        }, r2);
      },
    });

    // === 寫入 R2 ===
    await updateSkillTaskStatus(taskId, { phase: 'writing' }, r2);

    const skillPrefix = `skills/${date}/${domain}`;

    // 寫入 SKILL.md
    await putObject(
      `${skillPrefix}/SKILL.md`,
      result.skillMd,
      'text/markdown',
      r2
    );
    console.log(`[Skill Worker] Written SKILL.md to ${skillPrefix}/SKILL.md`);

    // 複製 cleaned 文件到 references/
    const copyPromises = result.fileList.map(async (filename) => {
      try {
        const sourceKey = `cleaned/${date}/${domain}/${filename}`;
        const content = await getObject(sourceKey, r2);
        const destKey = `${skillPrefix}/references/${filename}`;
        await putObject(destKey, content, 'text/markdown', r2);
      } catch (err) {
        console.warn(`[Skill Worker] Failed to copy file ${filename}:`, err);
      }
    });

    await Promise.all(copyPromises);
    console.log(`[Skill Worker] Copied ${result.fileList.length} files to references/`);

    // 更新任務狀態為完成
    await updateSkillTaskStatus(taskId, {
      status: 'completed',
      phase: 'done',
      fileCount: result.fileList.length,
      skillPreview: result.skillMd.slice(0, 2000), // 前 2000 字作為預覽
    }, r2);

    console.log(`[Skill Worker] Task ${taskId} completed successfully`);
  } catch (error: unknown) {
    console.error(`[Skill Worker] Task ${taskId} failed:`, error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';

    await updateSkillTaskStatus(taskId, {
      status: 'failed',
      error: errMsg,
    }, r2);
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

    const r2 = extractR2Overrides(body);
    const prefix = `cleaned/${date}/${domain}/`;
    const objects = await listObjects(prefix, 5, r2);

    if (!objects || objects.length === 0) {
      return NextResponse.json(
        { error: `No cleaned files found at: ${prefix}` },
        { status: 404 }
      );
    }

    const taskId = generateTaskId();
    const now = new Date().toISOString();

    const taskStatus: SkillTaskStatus = {
      taskId,
      status: 'processing',
      phase: 'queued',
      date,
      domain,
      fileCount: 0,
      createdAt: now,
      updatedAt: now,
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
