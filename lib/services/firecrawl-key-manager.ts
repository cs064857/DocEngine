export interface FirecrawlKeyManagerOptions {
  keys: string[];
  keyRates?: Record<string, number>;
  defaultRatePerMinute?: number;
  rateLimitCooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number) => void;
}

interface FirecrawlKeyState {
  key: string;
  rateLimitPerMinute: number;
  windowStartedAt: number;
  requestCount: number;
  rateLimitedUntil: number;
}

const MINUTE_MS = 60 * 1000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 10;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const FALLBACK_KEY = 'DUMMY_KEY';

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : fallback;
}

function sleepSync(ms: number): void {
  if (ms <= 0) {
    return;
  }

  const waitBuffer = new SharedArrayBuffer(4);
  const waitArray = new Int32Array(waitBuffer);
  Atomics.wait(waitArray, 0, 0, ms);
}

export class FirecrawlKeyManager {
  private readonly keys: string[];
  private readonly states = new Map<string, FirecrawlKeyState>();
  private readonly defaultRatePerMinute: number;
  private readonly rateLimitCooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => void;
  private nextIndex = 0;

  constructor(options: FirecrawlKeyManagerOptions) {
    this.keys = Array.from(new Set(options.keys.map((key) => key.trim()).filter(Boolean)));
    this.defaultRatePerMinute = normalizePositiveInteger(
      options.defaultRatePerMinute,
      DEFAULT_RATE_LIMIT_PER_MINUTE
    );
    this.rateLimitCooldownMs = normalizePositiveInteger(
      options.rateLimitCooldownMs,
      DEFAULT_RATE_LIMIT_COOLDOWN_MS
    );
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || sleepSync;

    const createdAt = this.now();
    for (const key of this.keys) {
      this.states.set(key, {
        key,
        rateLimitPerMinute: normalizePositiveInteger(options.keyRates?.[key], this.defaultRatePerMinute),
        windowStartedAt: createdAt,
        requestCount: 0,
        rateLimitedUntil: 0,
      });
    }
  }

  getNextKey(): string {
    if (this.keys.length === 0) {
      return FALLBACK_KEY;
    }

    while (true) {
      const selectedKey = this.tryGetAvailableKey();
      if (selectedKey) {
        return selectedKey;
      }

      const waitMs = Math.max(0, this.getShortestWaitMs());
      if (waitMs === 0) {
        continue;
      }
      this.sleep(waitMs);
    }
  }

  reportRateLimit(key: string): void {
    const state = this.states.get(key);
    if (!state) {
      return;
    }

    state.rateLimitedUntil = this.now() + this.rateLimitCooldownMs;
  }

  isKeyAvailable(key: string): boolean {
    const state = this.states.get(key);
    if (!state) {
      return false;
    }

    const now = this.now();
    this.resetWindowIfNeeded(state, now);

    return state.rateLimitedUntil <= now && state.requestCount < state.rateLimitPerMinute;
  }

  private tryGetAvailableKey(): string | null {
    for (let offset = 0; offset < this.keys.length; offset += 1) {
      const index = (this.nextIndex + offset) % this.keys.length;
      const key = this.keys[index];

      if (!this.isKeyAvailable(key)) {
        continue;
      }

      const state = this.states.get(key)!;
      state.requestCount += 1;
      this.nextIndex = (index + 1) % this.keys.length;
      return key;
    }

    return null;
  }

  private getShortestWaitMs(): number {
    const now = this.now();
    let earliestAvailableAt = Number.POSITIVE_INFINITY;

    for (const key of this.keys) {
      const state = this.states.get(key)!;
      this.resetWindowIfNeeded(state, now);
      earliestAvailableAt = Math.min(earliestAvailableAt, this.getNextAvailableAt(state, now));
    }

    return earliestAvailableAt === Number.POSITIVE_INFINITY ? 0 : earliestAvailableAt - now;
  }

  private getNextAvailableAt(state: FirecrawlKeyState, now: number): number {
    let nextAvailableAt = now;

    if (state.rateLimitedUntil > nextAvailableAt) {
      nextAvailableAt = state.rateLimitedUntil;
    }

    if (state.requestCount >= state.rateLimitPerMinute) {
      nextAvailableAt = Math.max(nextAvailableAt, state.windowStartedAt + MINUTE_MS);
    }

    return nextAvailableAt;
  }

  private resetWindowIfNeeded(state: FirecrawlKeyState, now: number): void {
    if (now - state.windowStartedAt < MINUTE_MS) {
      return;
    }

    state.windowStartedAt = now;
    state.requestCount = 0;
  }
}
