const DEFAULT_MAX_CONCURRENCY = 2;

export function normalizeMaxConcurrency(value?: number): number {
  if (!Number.isFinite(value) || !value || value < 1) {
    return DEFAULT_MAX_CONCURRENCY;
  }

  return Math.floor(value);
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const workerCount = Math.min(normalizeMaxConcurrency(concurrency), items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;

      if (currentIndex >= items.length) {
        return;
      }

      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}
