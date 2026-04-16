export interface TaskDateLike {
  createdAt?: string | null;
  date?: string | null;
}

export interface CrawlEngineSettings {
  llmModel?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  cleaningPrompt?: string;
  firecrawlKey?: string;
  firecrawlUrl?: string;
  enableClean?: boolean;
  urlExtractorApiKey?: string;
  urlExtractorBaseUrl?: string;
  urlExtractorModel?: string;
  urlExtractorPrompt?: string;
  maxConcurrency?: number;
  maxRetries?: number;
  urlTimeout?: number;
  maxUrls?: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
}

export type StoredTaskEngineSettings = Omit<
  CrawlEngineSettings,
  'firecrawlKey' | 'llmApiKey' | 'urlExtractorApiKey' | 'r2AccountId' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName'
>;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateParts(year: number, month: number, day: number, hours?: number, minutes?: number): string {
  const base = `${year}/${pad2(month)}/${pad2(day)}`;
  if (hours === undefined || minutes === undefined) {
    return base;
  }
  return `${base} ${pad2(hours)}:${pad2(minutes)}`;
}

function parseCompactDate(value: string): { year: number; month: number; day: number } | null {
  if (!/^\d{8}$/.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function summarizeDomains(urls: string[]): { domains: string[]; domainSummary: string } {
  const domains = Array.from(
    new Set(urls.map((url) => extractHostname(url)).filter((domain): domain is string => Boolean(domain)))
  );

  if (domains.length === 0) {
    return { domains: [], domainSummary: '' };
  }
  if (domains.length === 1) {
    return { domains, domainSummary: domains[0] };
  }

  return { domains, domainSummary: `${domains.length} domains` };
}

export function formatStoredDate(value?: string | null, includeTime = false): string {
  if (!value) {
    return '';
  }

  const compact = parseCompactDate(value);
  if (compact) {
    return formatDateParts(compact.year, compact.month, compact.day);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return formatDateParts(
    parsed.getFullYear(),
    parsed.getMonth() + 1,
    parsed.getDate(),
    includeTime ? parsed.getHours() : undefined,
    includeTime ? parsed.getMinutes() : undefined
  );
}

export function getTaskDisplayDate(task: TaskDateLike): string {
  if (task.createdAt) {
    return formatStoredDate(task.createdAt, true);
  }
  return formatStoredDate(task.date);
}

export function buildSkillVersionPrefix(date: string, domain: string, taskId: string): string {
  return `skills/${date}/${domain}/${taskId}/`;
}

export function buildLegacySkillPrefix(date: string, domain: string): string {
  return `skills/${date}/${domain}/`;
}

export function sanitizeEngineSettingsForStorage(
  engineSettings?: CrawlEngineSettings
): StoredTaskEngineSettings | undefined {
  if (!engineSettings) {
    return undefined;
  }

  const sanitized: StoredTaskEngineSettings = {
    llmModel: engineSettings.llmModel,
    llmBaseUrl: engineSettings.llmBaseUrl,
    cleaningPrompt: engineSettings.cleaningPrompt,
    firecrawlUrl: engineSettings.firecrawlUrl,
    enableClean: engineSettings.enableClean,
    urlExtractorBaseUrl: engineSettings.urlExtractorBaseUrl,
    urlExtractorModel: engineSettings.urlExtractorModel,
    urlExtractorPrompt: engineSettings.urlExtractorPrompt,
    maxConcurrency: engineSettings.maxConcurrency,
    maxRetries: engineSettings.maxRetries,
    urlTimeout: engineSettings.urlTimeout,
    maxUrls: engineSettings.maxUrls,
  };

  return Object.fromEntries(
    Object.entries(sanitized).filter(([, value]) => value !== undefined)
  ) as StoredTaskEngineSettings;
}

export function mergeStoredTaskEngineSettingsForRetry(
  stored?: StoredTaskEngineSettings,
  runtime?: CrawlEngineSettings
): CrawlEngineSettings {
  return Object.fromEntries(
    Object.entries({
    ...stored,
    firecrawlKey: runtime?.firecrawlKey,
    llmApiKey: runtime?.llmApiKey,
    urlExtractorApiKey: runtime?.urlExtractorApiKey,
    r2AccountId: runtime?.r2AccountId,
    r2AccessKeyId: runtime?.r2AccessKeyId,
    r2SecretAccessKey: runtime?.r2SecretAccessKey,
    r2BucketName: runtime?.r2BucketName,
    }).filter(([, value]) => value !== undefined)
  ) as CrawlEngineSettings;
}
