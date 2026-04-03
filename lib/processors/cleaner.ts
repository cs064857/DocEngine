import { chatCompletion } from '../services/llm';
import { config } from '../config';

export interface CleanerOverrides {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

const systemPrompt = `
You are a highly skilled documentation crawler and processor.
Your task is to review markdown content extracted from websites...
`.trim();

/**
 * Clean markdown content using the configured LLM API.
 */
export async function cleanContent(rawMarkdown: string, overrides?: CleanerOverrides): Promise<string> {
  const modelToUse = overrides?.model || config.llm.contentCleaner.model;
  const urlToUse = overrides?.baseUrl || config.llm.contentCleaner.baseUrl;
  
  // Note: Inside chatCompletion, we also need to pass the custom apiKey/baseUrl if present.
  // Instead of modifying chatCompletion just yet, let's create a custom config object.
  const customConfig = {
    baseUrl: urlToUse,
    apiKey: overrides?.apiKey || config.llm.contentCleaner.apiKey,
    model: modelToUse
  };

  try {
    const cleaned = await chatCompletion(customConfig, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: rawMarkdown }
    ]);
    return cleaned;
  } catch (error) {
    console.error('[Cleaner] Error cleaning content:', error);
    return '';
  }
}
