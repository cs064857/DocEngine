import { getModel, complete } from '@mariozechner/pi-ai';
import { getCodexApiKey } from '@/lib/oauth/pi-auth';

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
export async function piComplete(params: PiCompleteParams): Promise<{ text: string, usage?: any }> {
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

  // 取得 pi-mono 註冊的 Model 執行實例
  const model = getModel(provider as any, modelId);
  if (!model) {
    throw new Error(`Model ${modelId} not found for provider ${provider}`);
  }

  // 若提供自訂 baseUrl，我們利用 provider 特性將其注入（Pi-mono 的 registerProvider 或修改 API base_url）
  // 注意：大部分情況 pi-mono 已內建完整 mapping。若真要自訂，可直接傳給 options
  const completeOptions: any = {
    apiKey: finalApiKey,
    temperature: temperature ?? 0.7,
    maxTokens: maxTokens,
  };

  if (baseUrl) {
     completeOptions.baseUrl = baseUrl;
  }

  const context = {
    systemPrompt,
    messages: [
      { role: 'user', content: userPrompt, timestamp: Date.now() }
    ] as any
  };

  try {
    const response = await complete(model, context, completeOptions);
    
    // 從回傳中提取文本內容
    let textOut = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        textOut += block.text;
      }
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
