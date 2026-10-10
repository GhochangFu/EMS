import "reflect-metadata";

import { expect, vi } from "vitest";

import { TENANT_DRIZZLE } from "../database/database.tokens";
import {
  COPILOT_USAGE_LIMITS,
  type CopilotUsageLimits,
  DEFAULT_COPILOT_ORG_DAILY_TURNS,
  DEFAULT_COPILOT_USER_DAILY_TURNS,
  readCopilotUsageLimits,
} from "./copilot-config";
import {
  consumeTurnWith,
  type CopilotUsageStore,
  type CopilotUsageTx,
  CopilotUsageService,
  nextMidnightIn,
  usageDayIn,
  type UsageIdentity,
} from "./copilot-usage.service";
import { CopilotModule } from "./copilot.module";

/**
 * `F3.85` PR 6 / ADR 0099 decision 11, Amendment 1 A1 and A2 — the daily turn
 * counters against a fake store. Vitest entry point: the sibling `.test.ts`
 * (ADR 0014).
 *
 * The fake transaction works on a copy of the counters and keeps the copy only
 * when the callback resolves; a throw discards it. So a refusal that returned
 * from the callback instead of throwing would commit the user increment, and
 * the "user counter unchanged after an organization refusal" spec goes red.
 */

const HOME_K = "00000000-0000-4000-8000-0000000000a1"; // Asia/Kolkata
const ORG_U = "00000000-0000-4000-8000-0000000000b2"; // UTC
const ORG_K2 = "00000000-0000-4000-8000-0000000000c3"; // Asia/Kolkata
const ORG_BAD = "00000000-0000-4000-8000-0000000000d4"; // a stored name no runtime knows

const ZONES: Record<string, string> = {
  [HOME_K]: "Asia/Kolkata",
  [ORG_U]: "UTC",
  [ORG_K2]: "Asia/Kolkata",
  [ORG_BAD]: "Mars/Olympus_Mons",
};

const LIMITS: CopilotUsageLimits = { userDailyTurns: 150, organizationDailyTurns: 1500 };

const scopedAdmin: UsageIdentity = { id: "user-scoped", organizationId: HOME_K };
const globalAdmin: UsageIdentity = { id: "user-global", organizationId: null };

type FakeStore = CopilotUsageStore & {
  readonly user: Map<string, number>;
  readonly org: Map<string, number>;
  readonly transactions: { userId: string; organizationId: string | null }[];
};

function fakeStore(): FakeStore {
  const user = new Map<string, number>();
  const org = new Map<string, number>();
  const transactions: FakeStore["transactions"] = [];
  const bump = (counters: Map<string, number>, key: string, limit: number): boolean => {
    const turns = counters.get(key) ?? 0;
    if (turns >= limit) return false;
    counters.set(key, turns + 1);
    return true;
  };
  return {
    user,
    org,
    transactions,
    async transaction<T>(userId: string, organizationId: string | null, fn: (tx: CopilotUsageTx) => Promise<T>) {
      transactions.push({ userId, organizationId });
      const userCopy = new Map(user);
      const orgCopy = new Map(org);
      const tx: CopilotUsageTx = {
        timezonesOf: async (ids) => new Map(ids.filter((id) => id in ZONES).map((id) => [id, ZONES[id] as string])),
        incrementUser: async (id, day, limit) => bump(userCopy, `${id}|${day}`, limit),
        incrementOrganization: async (id, day, limit) => bump(orgCopy, `${id}|${day}`, limit),
      };
      const result = await fn(tx);
      user.clear();
      userCopy.forEach((v, k) => user.set(k, v));
      org.clear();
      orgCopy.forEach((v, k) => org.set(k, v));
      return result;
    },
  };
}

async function spend(store: FakeStore, identity: UsageIdentity, organizationId: string | null, now: Date, n: number) {
  for (let i = 0; i < n; i += 1) {
    expect(await consumeTurnWith(store, LIMITS, identity, organizationId, now), `turn ${i + 1}`).toEqual({ ok: true });
  }
}

/** 150 turns pass, the 151st is refused with the next midnight of the home zone (Asia/Kolkata), as an instant. */
export async function turn150AllowedAnd151Refused(): Promise<void> {
  const store = fakeStore();
  const now = new Date("2030-03-10T10:00:00.000Z"); // 15:30 IST on 10 March
  await spend(store, scopedAdmin, null, now, 150);
  expect(await consumeTurnWith(store, LIMITS, scopedAdmin, null, now)).toEqual({
    ok: false,
    scope: "user",
    resetsAt: "2030-03-10T18:30:00.000Z",
  });
  expect(store.user.get("user-scoped|2030-03-10")).toBe(150);
}

/** Amendment 1 A1: the user limit is per user per day across organizations, never per (user, organization). */
export async function oneUserTwoOrganizationsShareTheUserLimit(): Promise<void> {
  const store = fakeStore();
  const now = new Date("2030-03-10T10:00:00.000Z");
  await spend(store, scopedAdmin, HOME_K, now, 100);
  await spend(store, scopedAdmin, ORG_K2, now, 50);
  expect(await consumeTurnWith(store, LIMITS, scopedAdmin, ORG_K2, now)).toMatchObject({ ok: false, scope: "user" });
  expect(store.org.get(`${HOME_K}|2030-03-10`)).toBe(100);
  expect(store.org.get(`${ORG_K2}|2030-03-10`)).toBe(50);
}

/** A cross-organization turn (no bound organization) counts for the user and for no organization. */
export async function crossOrganizationTurnTouchesTheUserCounterOnly(): Promise<void> {
  const store = fakeStore();
  const now = new Date("2030-03-10T10:00:00.000Z");
  expect(await consumeTurnWith(store, LIMITS, globalAdmin, null, now)).toEqual({ ok: true });
  expect(store.user.get("user-global|2030-03-10")).toBe(1);
  expect(store.org.size).toBe(0);
  expect(store.transactions).toEqual([{ userId: "user-global", organizationId: null }]);
}

/** The organization refuses: scope "organization", reset at that organization's midnight, the user increment rolled back. */
export async function organizationRefusalRollsBackTheUserIncrement(): Promise<void> {
  const store = fakeStore();
  const limits: CopilotUsageLimits = { userDailyTurns: 150, organizationDailyTurns: 3 };
  const now = new Date("2030-03-10T10:00:00.000Z");
  const other: UsageIdentity = { id: "user-other", organizationId: HOME_K };
  for (let i = 0; i < 3; i += 1) {
    expect(await consumeTurnWith(store, limits, other, HOME_K, now)).toEqual({ ok: true });
  }
  expect(await consumeTurnWith(store, limits, scopedAdmin, HOME_K, now)).toEqual({
    ok: false,
    scope: "organization",
    resetsAt: "2030-03-10T18:30:00.000Z",
  });
  expect(store.user.has("user-scoped|2030-03-10"), "the refused turn counts nowhere").toBe(false);
  expect(store.org.get(`${HOME_K}|2030-03-10`)).toBe(3);
  // Positive control: the same user, bound elsewhere, counts.
  expect(await consumeTurnWith(store, limits, scopedAdmin, ORG_U, now)).toEqual({ ok: true });
  expect(store.user.get("user-scoped|2030-03-10")).toBe(1);
}

/** A2: either side of 00:00 IST (18:30Z) the organization's day differs; the UTC day does not. */
export async function aNonUtcMidnightSplitsTheOrganizationDay(): Promise<void> {
  const store = fakeStore();
  await consumeTurnWith(store, LIMITS, globalAdmin, HOME_K, new Date("2030-03-10T18:29:00.000Z"));
  await consumeTurnWith(store, LIMITS, globalAdmin, HOME_K, new Date("2030-03-10T18:31:00.000Z"));
  expect(store.org.get(`${HOME_K}|2030-03-10`)).toBe(1);
  expect(store.org.get(`${HOME_K}|2030-03-11`)).toBe(1);
  expect(store.user.get("user-global|2030-03-10"), "the global admin counts in UTC").toBe(2);
}

/** One turn: home Asia/Kolkata (user day 11 March) bound to a UTC organization (org day 10 March). */
export async function userDayAndOrganizationDayDifferInOneTurn(): Promise<void> {
  const store = fakeStore();
  const now = new Date("2030-03-10T20:00:00.000Z"); // 01:30 IST on 11 March
  expect(await consumeTurnWith(store, LIMITS, scopedAdmin, ORG_U, now)).toEqual({ ok: true });
  expect([...store.user.keys()]).toEqual(["user-scoped|2030-03-11"]);
  expect([...store.org.keys()]).toEqual([`${ORG_U}|2030-03-10`]);
}

/** The global admin (UTC) bound to an Asia/Kolkata organization; each refusal names its own zone's midnight. */
export async function globalAdminCountsInUtcAgainstABoundKolkataOrganization(): Promise<void> {
  const store = fakeStore();
  const now = new Date("2030-03-10T20:00:00.000Z");
  expect(await consumeTurnWith(store, LIMITS, globalAdmin, HOME_K, now)).toEqual({ ok: true });
  expect([...store.user.keys()]).toEqual(["user-global|2030-03-10"]);
  expect([...store.org.keys()]).toEqual([`${HOME_K}|2030-03-11`]);

  const tight: CopilotUsageLimits = { userDailyTurns: 1, organizationDailyTurns: 1 };
  expect(await consumeTurnWith(store, tight, globalAdmin, HOME_K, now)).toEqual({
    ok: false,
    scope: "user",
    resetsAt: "2030-03-11T00:00:00.000Z",
  });
  const fresh: UsageIdentity = { id: "user-fresh", organizationId: null };
  expect(await consumeTurnWith(store, tight, fresh, HOME_K, now)).toEqual({
    ok: false,
    scope: "organization",
    resetsAt: "2030-03-11T18:30:00.000Z",
  });
}

/** A stored zone the runtime does not know falls back to UTC (the column has no CHECK); the turn is still counted. */
export async function anUnknownStoredZoneCountsInUtc(): Promise<void> {
  const store = fakeStore();
  const now = new Date("2030-03-10T20:00:00.000Z");
  const stray: UsageIdentity = { id: "user-stray", organizationId: ORG_BAD };
  expect(await consumeTurnWith(store, LIMITS, stray, ORG_BAD, now)).toEqual({ ok: true });
  expect([...store.user.keys()]).toEqual(["user-stray|2030-03-10"]);
  expect([...store.org.keys()]).toEqual([`${ORG_BAD}|2030-03-10`]);
}

export function dayKeysAndMidnights(): void {
  expect(usageDayIn(new Date("2030-03-10T18:29:59.999Z"), "Asia/Kolkata")).toBe("2030-03-10");
  expect(usageDayIn(new Date("2030-03-10T18:30:00.000Z"), "Asia/Kolkata")).toBe("2030-03-11");
  expect(usageDayIn(new Date("2030-12-31T23:59:59.999Z"), "UTC")).toBe("2030-12-31");
  expect(nextMidnightIn(new Date("2030-12-31T23:59:59.999Z"), "UTC").toISOString()).toBe("2031-01-01T00:00:00.000Z");
  expect(nextMidnightIn(new Date("2030-03-10T18:31:00.000Z"), "Asia/Kolkata").toISOString()).toBe(
    "2030-03-11T18:30:00.000Z",
  );
  // A DST zone: London is UTC+1 on 1 July, so its next midnight is 23:00Z.
  expect(nextMidnightIn(new Date("2030-07-01T12:00:00.000Z"), "Europe/London").toISOString()).toBe(
    "2030-07-01T23:00:00.000Z",
  );
}

export function limitsFallBackToTheDefaultNeverZero(): void {
  const defaults = { userDailyTurns: DEFAULT_COPILOT_USER_DAILY_TURNS, organizationDailyTurns: DEFAULT_COPILOT_ORG_DAILY_TURNS };
  expect(defaults).toEqual({ userDailyTurns: 150, organizationDailyTurns: 1500 });
  expect(readCopilotUsageLimits({})).toEqual(defaults);
  for (const bad of ["", "  ", "NaN", "abc", "0", "-5", "2.5", "150abc", "Infinity", "2147483648", "3000000000"]) {
    expect(
      readCopilotUsageLimits({ COPILOT_USER_DAILY_TURNS: bad, COPILOT_ORG_DAILY_TURNS: bad }),
      JSON.stringify(bad),
    ).toEqual(defaults);
  }
  // int4 ceiling: the limit binds against an integer column, so 2^31 - 1 is the largest usable value.
  expect(
    readCopilotUsageLimits({ COPILOT_USER_DAILY_TURNS: "2147483647", COPILOT_ORG_DAILY_TURNS: "2147483647" }),
  ).toEqual({ userDailyTurns: 2147483647, organizationDailyTurns: 2147483647 });
  expect(readCopilotUsageLimits({ COPILOT_USER_DAILY_TURNS: "2", COPILOT_ORG_DAILY_TURNS: "7" })).toEqual({
    userDailyTurns: 2,
    organizationDailyTurns: 7,
  });
}

type ProviderEntry = { provide?: unknown; useFactory?: () => unknown } | unknown;

/**
 * The Nest wiring a green build does not prove: the module provides and exports
 * the service and the limits token, and the service's two constructor
 * parameters are injected by token (esbuild emits no `design:paramtypes`).
 */
export function theModuleProvidesAndExportsTheService(): void {
  const providers = (Reflect.getMetadata("providers", CopilotModule) ?? []) as ProviderEntry[];
  const exportsList = (Reflect.getMetadata("exports", CopilotModule) ?? []) as unknown[];
  expect(providers).toContain(CopilotUsageService);
  expect(exportsList).toContain(CopilotUsageService);
  const limits = providers.find(
    (p): p is { provide: unknown; useFactory: () => unknown } =>
      typeof p === "object" && p !== null && "provide" in p && p.provide === COPILOT_USAGE_LIMITS,
  );
  // Distinct, non-default values: a factory that ignores the environment, or swaps the two names, reddens.
  vi.stubEnv("COPILOT_USER_DAILY_TURNS", "7");
  vi.stubEnv("COPILOT_ORG_DAILY_TURNS", "11");
  try {
    expect(limits?.useFactory?.()).toEqual({ userDailyTurns: 7, organizationDailyTurns: 11 });
  } finally {
    vi.unstubAllEnvs();
  }
  const params = (Reflect.getMetadata("self:paramtypes", CopilotUsageService) ?? []) as { index: number; param: unknown }[];
  expect([...params].sort((a, b) => a.index - b.index).map((p) => [p.index, p.param])).toEqual([
    [0, TENANT_DRIZZLE],
    [1, COPILOT_USAGE_LIMITS],
  ]);
}
