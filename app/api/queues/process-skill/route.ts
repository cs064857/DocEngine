import { handleCallback } from '@vercel/queue';
import { processSkillGeneration } from '@/lib/services/skill-generation-worker';
import type { SkillJobPayload } from '@/lib/services/skill-generation-worker';

export const POST = handleCallback<SkillJobPayload>(
  async (message) => {
    await processSkillGeneration(message);
  },
  {
    retry: (_error, metadata) => {
      // 最多重試 1 次（vercel.json maxDeliveries=2）
      if (metadata.deliveryCount >= 2) {
        return { acknowledge: true };
      }
      return { afterSeconds: 60 };
    },
  }
);
