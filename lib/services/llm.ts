export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  responseFormat?: 'text' | 'json_object';
  temperature?: number;
}

/**
 * Standard implementation for fetching from an OpenAI-compatible API without huge SDK overheads
 */
export async function chatCompletion(
  configParams: { baseUrl: string; apiKey: string; model: string },
  messages: Record<string, unknown>[],
  options?: { responseFormat?: string; temperature?: number }
): Promise<string> {
  // exponential backoff retry loop
  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const payload: Record<string, unknown> = {
        model: configParams.model,
        messages: messages,
      };

      if (options?.responseFormat === 'json_object') {
        payload.response_format = { type: 'json_object' };
      }
      
      if (options?.temperature !== undefined) {
        payload.temperature = options.temperature;
      }

      // Important: OpenAI compatible endpoints might optionally require the `/chat/completions` suffix
      // Users usually specify base url up until the exact path, or without it. Let's make sure it handles both smoothly.
      let endpoint = configParams.baseUrl;
      if (!endpoint.endsWith('/chat/completions')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
      }

      console.log(`[LLM] Requesting completion from ${endpoint} (Model: ${configParams.model})`);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${configParams.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      attempt++;
      console.warn(`[LLM] Attempt ${attempt} failed:`, error);
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
      // Wait before retry: 1s, 2s, 4s...
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('LLM call failed after retries');
}
