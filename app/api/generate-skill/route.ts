import { send } from '@vercel/queue';
import { NextRequest, NextResponse } from 'next/server';
import { flushAllLogs, logger } from '@/lib/logger';
import { listObjects, putObject } from '@/lib/r2';
import { generateTaskId } from '@/lib/utils/helpers';
import { extractSkillTaskR2Overrides } from '@/lib/services/skill-task-control';
import type { SkillTaskStatus } from '@/lib/utils/skill-task-status';
import {
  getOutputMetadata,
  resolveSkillGeneratorModel,
  resolveSkillSourceFolders,
  type SkillJobPayload,
} from '@/lib/services/skill-generation-worker';

export type { SkillJobPayload } from '@/lib/services/skill-generation-worker';

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

    const { provider: resolvedProvider, modelId: resolvedModelId } = resolveSkillGeneratorModel(provider, modelId);
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
      mergedName: folders.length > 1 ? domain : undefined,
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

    // 送入 Vercel Queue，確保 Serverless 環境下可靠執行
    await send('generate-skill', payload);

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
