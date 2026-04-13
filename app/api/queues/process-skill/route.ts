import { handleCallback } from '@vercel/queue';
import { generateSkill } from '@/lib/processors/skill-generator';
import { putObject, getObject } from '@/lib/r2';
import type { R2Overrides } from '@/lib/r2';
import type { SkillJobPayload, SkillTaskStatus } from '@/app/api/generate-skill/route';

// 從 payload 提取 R2 覆蓋配置
function extractR2Overrides(payload: SkillJobPayload): R2Overrides | undefined {
  if (!payload.r2AccountId && !payload.r2AccessKeyId && !payload.r2SecretAccessKey) return undefined;
  return {
    accountId: payload.r2AccountId,
    accessKeyId: payload.r2AccessKeyId,
    secretAccessKey: payload.r2SecretAccessKey,
    bucketName: payload.r2BucketName,
  };
}

/**
 * 更新 Skill Task 狀態到 R2
 */
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
 * 解析 LLM 配置：根據 authMode 決定使用 OAuth Token 或 API Key
 */
function resolveLLMConfig(payload: SkillJobPayload) {
  if (payload.authMode === 'oauth' && payload.accessToken) {
    return {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: payload.accessToken, // OAuth token 作為 Bearer Token
      model: payload.model || 'gpt-4o',
    };
  }

  return {
    baseUrl: payload.baseUrl || 'https://api.openai.com/v1',
    apiKey: payload.apiKey || '',
    model: payload.model || 'gpt-4o',
  };
}

/**
 * Queue Worker：處理 generate-skill topic
 *
 * 1. 調用 generateSkill() 三步 Agent 流程
 * 2. 將 SKILL.md 寫入 R2 skills/{date}/{domain}/
 * 3. 複製 cleaned 文件到 skills/{date}/{domain}/references/
 * 4. 更新任務狀態
 */
export const POST = handleCallback<SkillJobPayload>(
  async (message) => {
    const payload = message;
    const { taskId, date, domain } = payload;
    const r2 = extractR2Overrides(payload);
    const llmConfig = resolveLLMConfig(payload);

    console.log(`[Skill Worker] Processing task ${taskId}: ${domain} (${date})`);

    try {
      // 使用 generateSkill 的 onProgress 回調即時更新狀態
      const result = await generateSkill({
        date,
        domain,
        llmConfig,
        r2,
        customPrompt: payload.customPrompt,
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

      throw error; // re-throw 讓 Queue 進行重試
    }
  },
  {
    retry: (_error, metadata) => {
      // 最多重試 2 次
      if (metadata.deliveryCount > 2) {
        return { acknowledge: true };
      }
      // 指數退避：60s, 120s
      const delay = Math.min(120, 60 * metadata.deliveryCount);
      return { afterSeconds: delay };
    },
  }
);
