import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSkillVersionPrefix,
  formatStoredDate,
  getTaskDisplayDate,
  mergeStoredTaskEngineSettingsForRetry,
  sanitizeEngineSettingsForStorage,
  summarizeDomains,
} from '../lib/utils/task-metadata';

test('formatStoredDate formats compact YYYYMMDD values', () => {
  assert.equal(formatStoredDate('20260415'), '2026/04/15');
});

test('getTaskDisplayDate prefers createdAt when available', () => {
  assert.match(
    getTaskDisplayDate({ createdAt: '2026-04-15T08:09:10.000Z', date: '20260414' }),
    /2026/
  );
  assert.equal(getTaskDisplayDate({ date: '20260414' }), '2026/04/14');
});

test('summarizeDomains returns a single hostname when task only has one domain', () => {
  assert.deepEqual(
    summarizeDomains([
      'https://docs.firecrawl.dev/api-reference/endpoint/webhook-batch-scrape-started',
      'https://docs.firecrawl.dev/api-reference/endpoint/webhook-crawl-started',
    ]),
    {
      domains: ['docs.firecrawl.dev'],
      domainSummary: 'docs.firecrawl.dev',
    }
  );
});

test('summarizeDomains returns a count summary when task spans multiple domains', () => {
  assert.deepEqual(
    summarizeDomains([
      'https://docs.firecrawl.dev/api-reference',
      'https://example.com/guide',
      'notaurl',
    ]),
    {
      domains: ['docs.firecrawl.dev', 'example.com'],
      domainSummary: '2 domains',
    }
  );
});

test('buildSkillVersionPrefix creates isolated folders per task version', () => {
  assert.equal(
    buildSkillVersionPrefix('20260415', 'docs.firecrawl.dev', 'task-123'),
    'skills/20260415/docs.firecrawl.dev/task-123/'
  );
});

test('sanitizeEngineSettingsForStorage removes secrets but keeps crawl behavior settings', () => {
  assert.deepEqual(
    sanitizeEngineSettingsForStorage({
      firecrawlKey: 'fc-secret',
      llmApiKey: 'llm-secret',
      urlExtractorApiKey: 'extract-secret',
      r2AccountId: 'acc',
      r2AccessKeyId: 'ak',
      r2SecretAccessKey: 'sk',
      r2BucketName: 'bucket',
      llmModel: 'glm-4-flash',
      llmBaseUrl: 'https://example.com',
      cleaningPrompt: 'keep headings',
      enableClean: true,
      maxRetries: 4,
      urlTimeout: 300,
    }),
    {
      llmModel: 'glm-4-flash',
      llmBaseUrl: 'https://example.com',
      cleaningPrompt: 'keep headings',
      enableClean: true,
      maxRetries: 4,
      urlTimeout: 300,
    }
  );
});

test('mergeStoredTaskEngineSettingsForRetry restores original behavior and fills runtime secrets', () => {
  assert.deepEqual(
    mergeStoredTaskEngineSettingsForRetry(
      {
        llmModel: 'glm-4-flash',
        llmBaseUrl: 'https://stored.example.com',
        cleaningPrompt: 'stored prompt',
        enableClean: true,
        maxRetries: 5,
      },
      {
        firecrawlKey: 'fc-runtime',
        llmApiKey: 'llm-runtime',
        r2AccountId: 'acc',
        r2AccessKeyId: 'ak',
        r2SecretAccessKey: 'sk',
        r2BucketName: 'bucket',
        llmModel: 'should-not-override-stored',
      }
    ),
    {
      llmModel: 'glm-4-flash',
      llmBaseUrl: 'https://stored.example.com',
      cleaningPrompt: 'stored prompt',
      enableClean: true,
      maxRetries: 5,
      firecrawlKey: 'fc-runtime',
      llmApiKey: 'llm-runtime',
      r2AccountId: 'acc',
      r2AccessKeyId: 'ak',
      r2SecretAccessKey: 'sk',
      r2BucketName: 'bucket',
    }
  );
});
