import { NextResponse } from 'next/server';
import { getModels, getProviders } from '@mariozechner/pi-ai';

type PiModelInfo = {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
};

type PiProviderInfo = {
  id: string;
  apis: string[];
  supportsCustomModel: boolean;
  modelCount: number;
  models: PiModelInfo[];
};

/**
 * GET /api/pi-models
 *
 * 回傳 @mariozechner/pi-ai 內建註冊的 Provider 與 Model 清單，供前端下拉選單使用。
 */
export async function GET() {
  try {
    const providers = getProviders().slice().sort();

    const result: { providers: PiProviderInfo[] } = {
      providers: providers.map((providerId) => {
        const modelsRaw = getModels(providerId);
        const apis = Array.from(new Set(modelsRaw.map((m) => m.api))).sort();

        const models: PiModelInfo[] = modelsRaw
          .map((m) => ({
            id: m.id,
            name: m.name,
            api: m.api,
            baseUrl: m.baseUrl,
            reasoning: m.reasoning,
            input: m.input,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
          }))
          .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

        return {
          id: providerId,
          apis,
          // 目前僅對 OpenAI-compatible 的 Chat Completions 通道開放自訂 modelId 輸入
          supportsCustomModel: apis.length === 1 && apis[0] === 'openai-completions',
          modelCount: models.length,
          models,
        };
      }),
    };

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[pi-models] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
