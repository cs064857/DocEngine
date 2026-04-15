import { cleanContent } from '../processors/cleaner';
import { putObject, putTaskStatus } from '../r2';
import type { JobTask, R2Overrides } from '../r2';
import { buildR2Key, formatDate, generateTaskId } from '../utils/helpers';
import { summarizeDomains } from '../utils/task-metadata';
import { scrapeUrlAdvanced } from './crawler';
import type { CrawlerOverrides, ScrapeAdvancedOptions } from './crawler';

export interface SingleScrapeTaskInput {
  url: string;
  firecrawlKey?: string;
  waitFor?: string | number;
  timeout?: string | number;
  onlyMainContent?: boolean;
  mobile?: boolean;
  includeTags?: string;
  excludeTags?: string;
  saveToR2?: boolean;
  enableClean?: boolean;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  cleaningPrompt?: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2BucketName?: string;
}

export interface SingleScrapeTaskSuccess {
  success: true;
  taskId: string;
  task: JobTask;
  markdown: string;
  cleanedMarkdown: string | null;
  metadata: Record<string, unknown> | null;
  charCount: number;
  cleanedCharCount: number | null;
  r2: { rawKey: string; cleanedKey: string | null } | null;
}

export interface SingleScrapeTaskFailure {
  success: false;
  taskId: string;
  task: JobTask;
  error: string;
}

export type SingleScrapeTaskResult = SingleScrapeTaskSuccess | SingleScrapeTaskFailure;

export interface SingleScrapeTaskDeps {
  generateTaskId: () => string;
  formatDate: () => string;
  now: () => string;
  scrapeUrlAdvanced: typeof scrapeUrlAdvanced;
  cleanContent: typeof cleanContent;
  putObject: typeof putObject;
  putTaskStatus: typeof putTaskStatus;
}

const defaultDeps: SingleScrapeTaskDeps = {
  generateTaskId,
  formatDate: () => formatDate(),
  now: () => new Date().toISOString(),
  scrapeUrlAdvanced,
  cleanContent,
  putObject,
  putTaskStatus,
};

function parseOptionalNumber(value?: string | number): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalTags(value?: string): string[] | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }

  const tags = value.split(',').map((item) => item.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function buildR2Overrides(input: SingleScrapeTaskInput): R2Overrides | undefined {
  if (!input.r2AccountId && !input.r2AccessKeyId && !input.r2SecretAccessKey && !input.r2BucketName) {
    return undefined;
  }

  return {
    accountId: input.r2AccountId,
    accessKeyId: input.r2AccessKeyId,
    secretAccessKey: input.r2SecretAccessKey,
    bucketName: input.r2BucketName,
  };
}

function buildScrapeOptions(input: SingleScrapeTaskInput): ScrapeAdvancedOptions {
  const options: ScrapeAdvancedOptions = {};

  const waitFor = parseOptionalNumber(input.waitFor);
  if (waitFor !== undefined) {
    options.waitFor = waitFor;
  }

  const timeout = parseOptionalNumber(input.timeout);
  if (timeout !== undefined) {
    options.timeout = timeout;
  }

  if (input.onlyMainContent !== undefined) {
    options.onlyMainContent = input.onlyMainContent;
  }
  if (input.mobile !== undefined) {
    options.mobile = input.mobile;
  }

  const includeTags = parseOptionalTags(input.includeTags);
  if (includeTags) {
    options.includeTags = includeTags;
  }

  const excludeTags = parseOptionalTags(input.excludeTags);
  if (excludeTags) {
    options.excludeTags = excludeTags;
  }

  return options;
}

function buildBaseTask(taskId: string, url: string, date: string, now: string): JobTask {
  const { domains, domainSummary } = summarizeDomains([url]);

  return {
    taskId,
    status: 'processing',
    total: 1,
    completed: 0,
    failed: 0,
    failedUrls: [],
    retryingUrls: [],
    urls: [{ url, status: 'processing' }],
    date,
    createdAt: now,
    updatedAt: now,
    domains,
    domainSummary,
  };
}

export async function runSingleScrapeTask(
  input: SingleScrapeTaskInput,
  deps: SingleScrapeTaskDeps = defaultDeps
): Promise<SingleScrapeTaskResult> {
  const taskId = deps.generateTaskId();
  const date = deps.formatDate();
  const createdAt = deps.now();
  const r2Overrides = buildR2Overrides(input);
  const baseTask = buildBaseTask(taskId, input.url, date, createdAt);
  const crawlerOverrides: CrawlerOverrides = {
    apiKey: input.firecrawlKey || undefined,
  };

  await deps.putTaskStatus(taskId, baseTask, r2Overrides);

  try {
    const result = await deps.scrapeUrlAdvanced(input.url, buildScrapeOptions(input), crawlerOverrides);
    const markdown = result.markdown;
    const metadata = result.metadata ?? null;

    let cleanedMarkdown: string | undefined;
    let r2RawKey: string | undefined;
    let r2CleanedKey: string | undefined;

    if (input.enableClean && markdown.trim().length > 0) {
      cleanedMarkdown = await deps.cleanContent(markdown, {
        model: input.llmModel || undefined,
        apiKey: input.llmApiKey || undefined,
        baseUrl: input.llmBaseUrl || undefined,
        prompt: input.cleaningPrompt || undefined,
      });
    }

    if (input.saveToR2) {
      r2RawKey = buildR2Key(input.url, 'raw', date);
      await deps.putObject(r2RawKey, markdown, 'text/markdown', r2Overrides);

      if (cleanedMarkdown !== undefined) {
        r2CleanedKey = buildR2Key(input.url, 'cleaned', date);
        await deps.putObject(r2CleanedKey, cleanedMarkdown, 'text/markdown', r2Overrides);
      }
    }

    const completedTask: JobTask = {
      ...baseTask,
      status: 'completed',
      completed: 1,
      updatedAt: deps.now(),
      urls: [{ url: input.url, status: 'success' }],
    };

    await deps.putTaskStatus(taskId, completedTask, r2Overrides);

    return {
      success: true,
      taskId,
      task: completedTask,
      markdown,
      cleanedMarkdown: cleanedMarkdown ?? null,
      metadata,
      charCount: markdown.length,
      cleanedCharCount: cleanedMarkdown?.length ?? null,
      r2: input.saveToR2
        ? { rawKey: r2RawKey!, cleanedKey: r2CleanedKey ?? null }
        : null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const failedTask: JobTask = {
      ...baseTask,
      status: 'failed',
      failed: 1,
      failedUrls: [{ url: input.url, error: message }],
      updatedAt: deps.now(),
      urls: [{ url: input.url, status: 'failed', error: message }],
    };

    await deps.putTaskStatus(taskId, failedTask, r2Overrides);

    return {
      success: false,
      taskId,
      task: failedTask,
      error: message,
    };
  }
}
