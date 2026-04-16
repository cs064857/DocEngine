import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMaxConcurrency, runWithConcurrency } from '../lib/services/crawl-concurrency';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('normalizeMaxConcurrency falls back to default when input is invalid', () => {
  assert.equal(normalizeMaxConcurrency(undefined), 2);
  assert.equal(normalizeMaxConcurrency(0), 2);
  assert.equal(normalizeMaxConcurrency(-1), 2);
  assert.equal(normalizeMaxConcurrency(Number.NaN), 2);
});

test('normalizeMaxConcurrency floors valid values', () => {
  assert.equal(normalizeMaxConcurrency(1), 1);
  assert.equal(normalizeMaxConcurrency(3.9), 3);
});

test('runWithConcurrency only starts up to the requested number of workers at once', async () => {
  const gates = [deferred(), deferred(), deferred()];
  const started: number[] = [];
  let active = 0;
  let maxActive = 0;

  const runPromise = runWithConcurrency([0, 1, 2], 2, async (item) => {
    started.push(item);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await gates[item].promise;
    active -= 1;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(started, [0, 1]);
  assert.equal(maxActive, 2);

  gates[0].resolve();
  gates[1].resolve();

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(started, [0, 1, 2]);

  gates[2].resolve();
  await runPromise;
});
