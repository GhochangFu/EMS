import { z } from "zod";

/**
 * `F4.17` / ADR 0125 decisions 5, 7, 8 and 19 — the limiter's configuration,
 * read once from the environment at boot. A value that is set but malformed
 * fails boot rather than silently falling back to a default: a mistyped limit
 * would otherwise run the demo at a number nobody chose.
 *
 * Every limit is per 60-second fixed window (decision 3).
 */

export const RATE_LIMIT_WINDOW_MS = 60_000;

export const RATE_LIMIT_MODES = ["off", "shadow", "enforce"] as const;
export type RateLimitMode = (typeof RATE_LIMIT_MODES)[number];

/** Decision 5 — the three Stage 2 classes a guarded route falls into. */
export const RATE_LIMIT_CLASSES = ["read", "write", "heavy"] as const;
export type RateLimitClass = (typeof RATE_LIMIT_CLASSES)[number];

/** The Stage 1 buckets, keyed on the client IP. */
export const IP_BUCKETS = ["ip", "login", "ws"] as const;
export type IpBucket = (typeof IP_BUCKETS)[number];

export type RateLimitConfig = Readonly<{
  mode: RateLimitMode;
  /** Decision 8 — `app.set('trust proxy', n)`; 0 trusts no forwarded header. */
  trustProxyHops: number;
  /** Stage 2, per identity, per window. */
  classLimits: Readonly<Record<RateLimitClass, number>>;
  /** Stage 1, per client IP, per window. */
  ipLimits: Readonly<Record<IpBucket, number>>;
}>;

/** Decision 5's starting numbers — provisional until the shadow week (decision 7). */
export const DEFAULT_RATE_LIMITS = {
  read: 600,
  write: 120,
  heavy: 12,
  ip: 1200,
  login: 10,
  ws: 30,
} as const;

const positiveInt = z
  .string()
  .trim()
  .regex(/^\d+$/, "must be a whole number")
  .transform(Number)
  .refine((n) => n >= 1 && n <= 1_000_000, "must be between 1 and 1000000");

const hops = z
  .string()
  .trim()
  .regex(/^\d+$/, "must be a whole number")
  .transform(Number)
  .refine((n) => n <= 10, "must be between 0 and 10");

type Env = Record<string, string | undefined>;

function read<T>(env: Env, name: string, schema: z.ZodType<T, z.ZodTypeDef, string>, fallback: T): T {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // The value is configuration, not a secret, so naming it is safe and is
    // what lets an operator fix the typo.
    throw new Error(
      `${name}=${JSON.stringify(raw)} is invalid: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

/** Parses the limiter configuration. Throws on a set-but-malformed value. */
export function readRateLimitConfig(env: Env): RateLimitConfig {
  const mode = read(env, "RATE_LIMIT_MODE", z.enum(RATE_LIMIT_MODES), "shadow");
  return {
    mode,
    trustProxyHops: read(env, "API_TRUST_PROXY_HOPS", hops, 0),
    classLimits: {
      read: read(env, "RATE_LIMIT_READ_PER_MIN", positiveInt, DEFAULT_RATE_LIMITS.read),
      write: read(env, "RATE_LIMIT_WRITE_PER_MIN", positiveInt, DEFAULT_RATE_LIMITS.write),
      heavy: read(env, "RATE_LIMIT_HEAVY_PER_MIN", positiveInt, DEFAULT_RATE_LIMITS.heavy),
    },
    ipLimits: {
      ip: read(env, "RATE_LIMIT_IP_PER_MIN", positiveInt, DEFAULT_RATE_LIMITS.ip),
      login: read(env, "RATE_LIMIT_LOGIN_PER_MIN", positiveInt, DEFAULT_RATE_LIMITS.login),
      ws: read(env, "RATE_LIMIT_WS_HANDSHAKE_PER_MIN", positiveInt, DEFAULT_RATE_LIMITS.ws),
    },
  };
}
