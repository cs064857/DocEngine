function parseCsvEnv(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFirecrawlKeyRates(value?: string): Record<string, number> {
  const rates: Record<string, number> = {};

  for (const pair of parseCsvEnv(value)) {
    const separatorIndex = pair.lastIndexOf(':');
    if (separatorIndex <= 0 || separatorIndex === pair.length - 1) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const rate = parsePositiveInteger(pair.slice(separatorIndex + 1).trim(), 0);
    if (key && rate > 0) {
      rates[key] = rate;
    }
  }

  return rates;
}

const firecrawlApiKeys = Array.from(
  new Set([
    ...parseCsvEnv(process.env.FIRECRAWL_API_KEYS),
    ...parseCsvEnv(process.env.FIRECRAWL_API_KEY),
  ])
);

export const config = {
  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY || firecrawlApiKeys[0] || '',
    apiKeys: firecrawlApiKeys,
    apiUrl: process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev',
    keyRates: parseFirecrawlKeyRates(process.env.FIRECRAWL_KEY_RATES),
    defaultRatePerMinute: parsePositiveInteger(process.env.FIRECRAWL_DEFAULT_RATE_PER_MINUTE, 10),
    rateLimitCooldownSeconds: parsePositiveInteger(process.env.FIRECRAWL_RATE_LIMIT_COOLDOWN_SECONDS, 60),
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
