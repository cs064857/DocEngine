import { NextRequest, NextResponse } from 'next/server';
import { send } from '@vercel/queue';
import { listObjects, putObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import { generateTaskId } from '@/lib/utils/helpers';

/**
 * Skill 生成任務的 R2 狀態結構
 */
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

/**
 * Queue Payload 結構
 */
export interface SkillJobPayload {
  taskId: string;
  date: string;
  domain: string;
  authMode: 'oauth' | 'apikey';
  accessToken?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  customPrompt?: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
}

// 從前端參數提取 R2 覆蓋配置
function extractR2Overrides(body: Record<string, string | undefined>): R2Overrides | undefined {
  if (!body.r2AccountId && !body.r2AccessKeyId && !body.r2SecretAccessKey) return undefined;
  return {
    accountId: body.r2AccountId,
    accessKeyId: body.r2AccessKeyId,
    secretAccessKey: body.r2SecretAccessKey,
    bucketName: body.r2BucketName,
  };
}

/**
 * POST /api/generate-skill
 *
 * 提交 Skill 生成任務：
 * 1. 驗證參數
 * 2. 確認 cleaned 資料夾存在
 * 3. 建立任務狀態寫入 R2
 * 4. 發送至 Queue
 * 5. 返回 taskId
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, domain, authMode, accessToken, apiKey, baseUrl, model, customPrompt } = body;

    // 驗證必要參數
    if (!date || !domain) {
      return NextResponse.json({ error: 'Missing required fields: date, domain' }, { status: 400 });
    }

    if (authMode === 'oauth' && !accessToken) {
      return NextResponse.json({ error: 'OAuth mode requires accessToken' }, { status: 400 });
    }

    if (authMode === 'apikey' && !apiKey) {
      return NextResponse.json({ error: 'API Key mode requires apiKey' }, { status: 400 });
    }

    const r2 = extractR2Overrides(body);

    // 確認 cleaned 資料夾存在且有檔案
    const prefix = `cleaned/${date}/${domain}/`;
    const objects = await listObjects(prefix, 5, r2);

    if (!objects || objects.length === 0) {
      return NextResponse.json(
        { error: `No cleaned files found at: ${prefix}` },
        { status: 404 }
      );
    }

    // 建立 task 狀態
    const taskId = generateTaskId();
    const now = new Date().toISOString();

    const taskStatus: SkillTaskStatus = {
      taskId,
      status: 'processing',
      phase: 'queued',
      date,
      domain,
      fileCount: 0, // 實際值在 Worker 中更新
      createdAt: now,
      updatedAt: now,
    };

    // 寫入 R2
    await putObject(
      `skill-tasks/${taskId}.json`,
      JSON.stringify(taskStatus, null, 2),
      'application/json',
      r2
    );

    // 建立 Queue Payload
    const payload: SkillJobPayload = {
      taskId,
      date,
      domain,
      authMode: authMode || 'apikey',
      accessToken,
      apiKey,
      baseUrl,
      model,
      customPrompt,
      r2AccountId: body.r2AccountId,
      r2AccessKeyId: body.r2AccessKeyId,
      r2SecretAccessKey: body.r2SecretAccessKey,
      r2BucketName: body.r2BucketName,
    };

    // 發送至 Queue
    await send('generate-skill', payload);

    console.log(`[Generate Skill] Task ${taskId} queued for ${domain} (${date})`);

    return NextResponse.json({
      taskId,
      message: 'Skill generation task queued successfully',
    });
  } catch (error: unknown) {
    console.error('[Generate Skill] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
