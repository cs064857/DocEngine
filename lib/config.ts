export const config = {
  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY!,
    apiUrl: process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev',
  },
  llm: {
    urlExtractor: {
      baseUrl: process.env.URL_EXTRACTOR_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.URL_EXTRACTOR_API_KEY!,
      model: process.env.URL_EXTRACTOR_MODEL || 'deepseek-chat',
    },
    contentCleaner: {
      baseUrl: process.env.CONTENT_CLEANER_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/',
      apiKey: process.env.CONTENT_CLEANER_API_KEY!,
      model: process.env.CONTENT_CLEANER_MODEL || 'glm-4-flash',
    },
    skillGenerator: {
      provider: process.env.SKILL_GENERATOR_PROVIDER || 'openai',
      modelId: process.env.SKILL_GENERATOR_MODEL_ID || 'gpt-4o',
      apiKey: process.env.SKILL_GENERATOR_API_KEY || '',
      authJsonPath: process.env.PI_AUTH_JSON_PATH || './auth.json',
      // Backward compatibility / Custom URLs
      baseUrl: process.env.SKILL_GENERATOR_BASE_URL || '',
    },
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'crawldocs',
  },
  project: {
    maxUrlsLimit: parseInt(process.env.MAX_URLS_LIMIT || '1000'),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
  },
};
