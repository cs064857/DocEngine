import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/services/llm';
import { piComplete } from '@/lib/services/pi-llm';

export const maxDuration = 60;

/**
 * POST /api/test-llm
 * 
 * 簡單呼叫 LLM 確認連線是否正常。
 * 支援兩種路徑：
 * - Content Cleaner 路徑（chatCompletion）：傳 apiKey + baseUrl + model
 * - Skill Generator 路徑（piComplete）：傳 provider + modelId + apiKey + baseUrl
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const { apiKey, baseUrl, model, provider, modelId } = body;

    // 基本參數驗證
    if (!model && !modelId) {
      return NextResponse.json(
        { success: false, error: 'Missing model or modelId parameter' },
        { status: 400 }
      );
    }

    const testPrompt = 'Reply with exactly one word: "OK"';
    let responseText = '';

    // 60 秒 timeout
    const timeoutMs = 60000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM test timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    );

    if (provider) {
      // === Skill Generator 路徑：使用 piComplete ===
      const result = await Promise.race([
        piComplete({
          provider,
          modelId: modelId || model,
          userPrompt: testPrompt,
          systemPrompt: 'You are a test assistant. Follow instructions exactly.',
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined,
          temperature: 0,
          maxTokens: 10,
        }),
        timeoutPromise,
      ]);
      responseText = result.text;
    } else {
      // === Content Cleaner 路徑：使用 chatCompletion ===
      if (!apiKey) {
        return NextResponse.json(
          { success: false, error: 'Missing apiKey parameter' },
          { status: 400 }
        );
      }

      if (!baseUrl) {
        return NextResponse.json(
          { success: false, error: 'Missing baseUrl parameter' },
          { status: 400 }
        );
      }

      const result = await Promise.race([
        chatCompletion(
          { baseUrl, apiKey, model },
          [
            { role: 'system', content: 'You are a test assistant. Follow instructions exactly.' },
            { role: 'user', content: testPrompt },
          ],
          { temperature: 0 }
        ),
        timeoutPromise,
      ]);
      responseText = result;
    }

    const latencyMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      latencyMs,
      model: modelId || model,
      preview: responseText.slice(0, 100),
    });
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Test LLM] Error:', errMsg);

    return NextResponse.json({
      success: false,
      error: errMsg,
      latencyMs,
    });
  }
}
