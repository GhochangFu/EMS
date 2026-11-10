import { fixedWindow } from "./rate-limit-key";

/**
 * `F4.17` / ADR 0125 decisions 3 and 4 — the counter store.
 *
 * One fixed-window counter per key. The shared path is one atomic Lua script
 * on Redis, so every API process (`api`, `api-replica`) counts against the
 * same number. When Redis is not configured, not connected, slow or failing,
 * the store **fails open to an in-process window** (decision 4): limits then
 * hold per process rather than per fleet, every fallback is counted, and the
 * health body reads `degraded`. A Redis outage never becomes an API outage.
 */

/** `INCR`, a TTL on the first hit, and the remaining TTL — in one round trip. */
export const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/** Stage 1 keys (`rateLimitKey("ip", …)`), dropped first when the memory store overflows. */
const IP_STAGE_PREFIX = "rl:v1:ip:";

/**
 * A store call that takes longer than this falls back to memory. The `EVAL`
 * may still run on Redis after the timeout, so a slow call can count once in
 * Redis and once in memory — a slightly early refusal under Redis latency,
 * accepted (security review, L3).
 */
export const STORE_TIMEOUT_MS = 100;

/** The slice of a node-redis v5 client the store uses. */
export type RedisEvalClient = {
  readonly isReady: boolean;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
};

export type StoreBackend = "redis" | "memory";

export type HitResult = Readonly<{
  count: number;
  /** Milliseconds until this window's counter resets. */
  resetMs: number;
  /** Where this hit was counted. `memory` with Redis configured is a fallback. */
  backend: StoreBackend;
}>;

/** The process-local fixed window: the whole store when Redis is absent, the fallback when it fails. */
export class MemoryWindowStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly maxKeys = 50_000) {}

  hit(key: string, ttlMs: number, now: number): number {
    const current = this.counters.get(key);
    if (current && current.expiresAt > now) {
      current.count += 1;
      return current.count;
    }
    if (this.counters.size >= this.maxKeys) {
      this.prune(now);
      if (this.counters.size >= this.maxKeys) {
        // A flood of distinct subjects — only Stage 1 can produce one (an IPv6
        // /48 holds 65,536 /64s); Stage 2 subjects are bounded by the number
        // of users. Drop the IP counters first, so the flood cannot reset the
        // flooder's own per-identity budget (security review, L1). Clear
        // everything only if that still is not enough.
        this.dropStage(IP_STAGE_PREFIX);
        if (this.counters.size >= this.maxKeys) {
          this.counters.clear();
        }
      }
    }
    this.counters.set(key, { count: 1, expiresAt: now + ttlMs });
    return 1;
  }

  get size(): number {
    return this.counters.size;
  }

  private dropStage(prefix: string): void {
    for (const key of this.counters.keys()) {
      if (key.startsWith(prefix)) {
        this.counters.delete(key);
      }
    }
  }

  private prune(now: number): void {
    for (const [key, value] of this.counters) {
      if (value.expiresAt <= now) {
        this.counters.delete(key);
      }
    }
  }
}

export type RateLimitStoreOptions = {
  redis: RedisEvalClient | null;
  now?: () => number;
  timeoutMs?: number;
  /** Called once per failed or skipped Redis call that fell back to memory. */
  onStoreError?: () => void;
};

export class RateLimitStore {
  private readonly memory = new MemoryWindowStore();
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private lastRedisFailed = false;

  constructor(private readonly options: RateLimitStoreOptions) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? STORE_TIMEOUT_MS;
  }

  /** The store's clock, so the caller's window index and the store's reset agree. */
  clock(): number {
    return this.now();
  }

  /** `redis`, `memory` (no Redis configured) or `degraded` (configured, last call fell back). */
  get state(): "redis" | "memory" | "degraded" {
    if (!this.options.redis) {
      return "memory";
    }
    // Live, not only "the last call failed": `/health` is never counted, so a
    // quiet API must still report a Redis that is down right now.
    return this.lastRedisFailed || !this.options.redis.isReady ? "degraded" : "redis";
  }

  /**
   * Counts one hit on `key` (which already carries its window index) and
   * returns the count in this window. Never throws.
   */
  async hit(key: string, windowMs: number): Promise<HitResult> {
    const now = this.now();
    const { resetMs } = fixedWindow(now, windowMs);
    // The TTL outlives the window by a second, so a counter read at the very
    // end of its window is never expired by a clock that runs a little fast.
    const ttlMs = resetMs + 1_000;
    const redis = this.options.redis;
    if (redis) {
      try {
        if (!redis.isReady) {
          throw new Error("redis not ready");
        }
        const reply = await withTimeout(
          redis.eval(FIXED_WINDOW_SCRIPT, { keys: [key], arguments: [String(ttlMs)] }),
          this.timeoutMs,
        );
        const count = parseCount(reply);
        this.lastRedisFailed = false;
        return { count, resetMs, backend: "redis" };
      } catch {
        // The error is not logged per request — a dead Redis would log once per
        // request. The counter and the health body carry it instead.
        this.lastRedisFailed = true;
        this.options.onStoreError?.();
      }
    }
    return { count: this.memory.hit(key, ttlMs, now), resetMs, backend: "memory" };
  }
}

function parseCount(reply: unknown): number {
  if (Array.isArray(reply) && typeof reply[0] === "number" && Number.isFinite(reply[0])) {
    return reply[0];
  }
  throw new Error("unexpected rate-limit script reply");
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("rate-limit store timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
