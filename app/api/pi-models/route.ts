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

    // 額外提供一個「通用 OpenAI-compatible（Chat Completions）」渠道
    // 讓使用者可填入自訂 baseUrl + modelId，對接任何 OpenAI 相容端點（LiteLLM / Ollama / 自建 proxy 等）。
    const openAICompatibleProvider: PiProviderInfo = {
      id: 'openai-compatible',
      apis: ['openai-completions'],
      supportsCustomModel: true,
      modelCount: 1,
      models: [
        {
          id: 'custom',
          name: 'Custom (OpenAI-compatible)',
          api: 'openai-completions',
          baseUrl: 'https://api.openai.com/v1',
          reasoning: false,
          input: ['text'],
          contextWindow: 128000,
          maxTokens: 32000,
        },
      ],
    };

    const result: { providers: PiProviderInfo[] } = {
      providers: [
        openAICompatibleProvider,
        ...providers.map((providerId) => {
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
      ],
    };

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('[pi-models] Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
