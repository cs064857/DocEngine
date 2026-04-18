import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAdvancedEngineSettingsHint,
  shouldShowAdvancedEngineSettings,
} from '../lib/utils/advanced-engine-settings-ui';

test('shouldShowAdvancedEngineSettings returns true for all source types', () => {
  assert.equal(shouldShowAdvancedEngineSettings('scrape'), true);
  assert.equal(shouldShowAdvancedEngineSettings('crawl'), true);
  assert.equal(shouldShowAdvancedEngineSettings('map'), true);
});

test('getAdvancedEngineSettingsHint returns batch-only hint in scrape mode', () => {
  const hint = getAdvancedEngineSettingsHint('scrape');
  assert.equal(typeof hint, 'string');
  assert.match(hint, /Batch/i);
});

test('getAdvancedEngineSettingsHint returns null for non-scrape modes', () => {
  assert.equal(getAdvancedEngineSettingsHint('crawl'), null);
  assert.equal(getAdvancedEngineSettingsHint('map'), null);
});
