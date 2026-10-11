/**
 * `F3.85` PR 6 / ADR 0099 decision 11, drafter choice 2 — the copilot's daily
 * turn limits, read once from the environment when `CopilotModule` builds its
 * providers (the `COPILOT_USAGE_LIMITS` token).
 *
 * A value that is unset, empty, not an integer, not above zero, or above the
 * int4 maximum falls back to the default — never to `0`. A limit of `0` would
 * refuse every turn, and the counter's insert path relies on every limit being at least 1.
 */

export const DEFAULT_COPILOT_USER_DAILY_TURNS = 150;
export const DEFAULT_COPILOT_ORG_DAILY_TURNS = 1500;

/** The DI token `CopilotUsageService` reads its limits from. */
export const COPILOT_USAGE_LIMITS = Symbol("COPILOT_USAGE_LIMITS");

export type CopilotUsageLimits = {
  /** Turns one user may spend per day, across every organization (Amendment 1 A1). */
  readonly userDailyTurns: number;
  /** Turns one organization's users may spend together per day. */
  readonly organizationDailyTurns: number;
};

/**
 * The largest usable limit. The limit binds against the `integer` (int4)
 * `turns` column, so a larger value fails the statement with SQLSTATE 22003
 * on every turn instead of falling back.
 */
const MAX_COPILOT_DAILY_TURNS = 2147483647;

/** `Number`, not `parseInt`: `"150abc"` is not a limit, and it must not read as 150. */
function positiveIntegerOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= MAX_COPILOT_DAILY_TURNS ? value : fallback;
}

/** The two daily turn limits from env; unset, empty, non-integer, <= 0 or above int4 gives the default. */
export function readCopilotUsageLimits(env: NodeJS.ProcessEnv): CopilotUsageLimits {
  return {
    userDailyTurns: positiveIntegerOr(env.COPILOT_USER_DAILY_TURNS, DEFAULT_COPILOT_USER_DAILY_TURNS),
    organizationDailyTurns: positiveIntegerOr(env.COPILOT_ORG_DAILY_TURNS, DEFAULT_COPILOT_ORG_DAILY_TURNS),
  };
}
