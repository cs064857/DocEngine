import {
  complete,
  getModels,
  getProviders,
  type Api,
  type AssistantMessage,
  type Context,
  type KnownProvider,
  type Model,
  type ProviderStreamOptions,
} from '@mariozechner/pi-ai';
import { getCodexApiKey } from '@/lib/oauth/pi-auth';

function isKnownProvider(value: string): value is KnownProvider {
  return (getProviders() as readonly string[]).includes(value);
}

export interface PiCompleteParams {
  provider: string; // e.g. 'openai', 'openai-codex', 'anthropic', 'openrouter'
  modelId: string;  // e.g. 'gpt-4o', 'gpt-5-mini'
  systemPrompt?: string;
  userPrompt: string;
  apiKey?: string;  // Explicit API key if available
  baseUrl?: string; // Optional custom endpoint
  temperature?: number;
  maxTokens?: number;
}

/**
 * 封裝 pi-mono 的 LLM 呼叫，處理 Token 動態刷新與提供者選擇
 */
export async function piComplete(params: PiCompleteParams): Promise<{ text: string; usage?: AssistantMessage['usage'] }> {
  const { provider, modelId, systemPrompt, userPrompt, temperature, maxTokens, baseUrl } = params;

  let finalApiKey = params.apiKey;

  // 如果是 openai-codex 且未提供 apiKey，嘗試從伺服器端 auth.json 取得 OAuth Token
  if (provider === 'openai-codex' && !finalApiKey) {
    try {
      finalApiKey = await getCodexApiKey();
    } catch (e) {
      console.warn('[pi-llm] 獲取 Codex OAuth Token 失敗，可能需要登入:', e);
      throw new Error('未登入 Codex OAuth 或憑證已失效。請確認 VPS 端已運行登入指令或有正確掛載 auth.json。');
    }
  }

  if (!finalApiKey && provider !== 'openai-codex') {
     console.warn(`[pi-llm] No API Key provided for provider ${provider}. API might fail if env vars aren't set.`);
  }

  let model: Model<Api> | undefined;

  // 通用 OpenAI-compatible（Chat Completions）渠道：允許任意 modelId + 自訂 baseUrl
  if (provider === 'openai-compatible') {
    const resolvedBaseUrl = (baseUrl || 'https://api.openai.com/v1').trim();
    model = {
      id: modelId,
      name: modelId,
      api: 'openai-completions',
      provider: 'openai-compatible',
      baseUrl: resolvedBaseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 32000,
    };
  } else {
    if (!isKnownProvider(provider)) {
      throw new Error(`Provider ${provider} is not supported by pi-ai registry`);
    }

    const providerModels = getModels(provider);
    model = (providerModels as unknown as Model<Api>[]).find((m) => m.id === modelId);

    // 若 modelId 不在 registry 中，且該 provider 只有單一 API 類型，允許建立「自訂 model」作為 fallback。
    if (!model) {
      const apis = Array.from(new Set(providerModels.map((m) => m.api)));
      if (providerModels.length > 0 && apis.length === 1) {
        const template = providerModels[0] as unknown as Model<Api>;
        model = {
          ...template,
          id: modelId,
          name: modelId,
        };
      } else {
        throw new Error(`Model ${modelId} not found for provider ${provider}`);
      }
    }
  }

  // pi-ai 以 model.baseUrl 決定送往哪個端點；options 不支援 baseUrl 覆蓋。
  const modelWithOverrides = baseUrl ? { ...model, baseUrl } : model;

  // 若提供自訂 baseUrl，我們利用 provider 特性將其注入（Pi-mono 的 registerProvider 或修改 API base_url）
  // 注意：大部分情況 pi-mono 已內建完整 mapping。若真要自訂，可直接傳給 options
  const completeOptions: ProviderStreamOptions = {
    apiKey: finalApiKey,
    temperature: temperature ?? 0.7,
    maxTokens: maxTokens,
  };

  const context: Context = {
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
  };

  try {
    const response: AssistantMessage = await complete(modelWithOverrides, context, completeOptions);

    // pi-ai 在串流錯誤時會回傳 stopReason=error 的 AssistantMessage（不會 throw）
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new Error(
        response.errorMessage || `LLM request failed (stopReason=${response.stopReason}, provider=${provider}, model=${modelId})`
      );
    }
    
    // 從回傳中提取文本內容
    let textOut = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        textOut += block.text;
      }
    }

    if (textOut.trim().length === 0) {
      const contentTypes = Array.from(new Set(response.content.map((b) => b.type))).join(',') || 'none';
      throw new Error(
        `LLM returned no text blocks (stopReason=${response.stopReason}, contentTypes=${contentTypes}, provider=${provider}, model=${modelId})`
      );
    }

    return {
      text: textOut,
      usage: response.usage
    };
  } catch (error) {
    console.error('[pi-llm] LLM Complete Error:', error);
    throw error;
  }
}
