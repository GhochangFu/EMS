import { expect, vi } from "vitest";

import { serviceAccountTokens, users } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  hashServiceTokenSecret,
  issueServiceToken,
  looksLikeServiceToken,
  parseServiceToken,
  secretMatches,
  SERVICE_TOKEN_PATTERN,
} from "./service-token-codec";
import {
  catchUpServiceTokens,
  decodeServiceTokenRevoked,
  handleServiceTokenRevoked,
  type ServiceTokenRevokedDeps,
} from "./service-token-notify";
import { holdServiceTokenSocket, tagServiceTokenSocket, type TokenSocket } from "./service-token-socket";
import {
  LAST_USED_TOUCH_INTERVAL_MS,
  SERVICE_TOKEN_CACHE_TTL_MS,
  ServiceTokenVerifier,
  UNKNOWN_TOKEN_CACHE_MS,
} from "./service-token-verifier.service";

/**
 * `F4.17` / ADR 0125 decisions 11–13 — the token codec, the verifier over a
 * fake auth pool, and the revoke-notification handlers. The verifier against
 * real `bms_auth` grants and policies is `service-token.integration.spec.ts`.
 */

// ── codec ───────────────────────────────────────────────────────────────────

export function assertAnIssuedTokenHasTheFormatAndHashesItsSecret(): void {
  const issued = issueServiceToken();
  expect(issued.token).toMatch(/^bms_sat_[A-Za-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
  expect(issued.token).toMatch(SERVICE_TOKEN_PATTERN);
  const parsed = parseServiceToken(issued.token);
  expect(parsed?.tokenId).toBe(issued.tokenId);
  expect(issued.tokenHash).toHaveLength(32);
  // The hash is of the secret alone, not of the whole token.
  expect(issued.tokenHash.equals(hashServiceTokenSecret(parsed?.secret ?? ""))).toBe(true);
  expect(issued.tokenHash.equals(hashServiceTokenSecret(issued.token))).toBe(false);
}

export function assertTokensAreUnique(): void {
  const ids = new Set<string>();
  for (let i = 0; i < 500; i += 1) ids.add(issueServiceToken().tokenId);
  expect(ids.size).toBe(500);
}

export function assertMalformedTokensParseToNull(): void {
  const good = issueServiceToken().token;
  for (const bad of [
    "",
    "bms_sat_",
    good.slice(0, -1),
    `${good}x`,
    ` ${good}`,
    good.replace("bms_sat_", "bms_sak_"),
    good.replace(/_([A-Za-z0-9]{12})_/, "_$1!"),
    "bms_sat_ABCDEFGHIJK_" + "a".repeat(43),
    "eyJhbGciOiJIUzI1NiJ9.e30.x",
  ]) {
    expect(parseServiceToken(bad), JSON.stringify(bad)).toBeNull();
  }
  expect(looksLikeServiceToken("eyJhbGciOiJIUzI1NiJ9.e30.x")).toBe(false);
  expect(looksLikeServiceToken(good)).toBe(true);
}

export function assertSecretMatchesOnlyItsOwnHash(): void {
  const issued = issueServiceToken();
  const { secret } = parseServiceToken(issued.token) ?? { secret: "" };
  expect(secretMatches(secret, issued.tokenHash)).toBe(true);
  expect(secretMatches(`${secret.slice(0, -1)}A`, issued.tokenHash)).toBe(secret.endsWith("A"));
  expect(secretMatches(secret, Buffer.alloc(32))).toBe(false);
  expect(secretMatches(secret, Buffer.alloc(31))).toBe(false);
}

// ── verifier over a fake auth pool ──────────────────────────────────────────

const ORG = "00000000-0000-4000-8000-0000000000d1";
const ACCOUNT = "00000000-0000-4000-8000-0000000000f1";
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);

type FakeState = {
  tokenRow: Record<string, unknown> | null;
  accountRow: Record<string, unknown> | null;
  tokenReads: number;
  accountReads: number;
  touches: number;
  touchFails: boolean;
};

function fakeAuthDb(state: FakeState): BmsDb {
  const select = () => {
    let table: unknown;
    const chain = {
      from: (t: unknown) => {
        table = t;
        return chain;
      },
      where: () => chain,
      limit: async () => {
        if (table === serviceAccountTokens) {
          state.tokenReads += 1;
          return state.tokenRow ? [state.tokenRow] : [];
        }
        if (table === users) {
          state.accountReads += 1;
          return state.accountRow ? [state.accountRow] : [];
        }
        throw new Error("unexpected table");
      },
    };
    return chain;
  };
  const update = () => ({
    set: () => ({
      where: () => {
        state.touches += 1;
        return state.touchFails ? Promise.reject(new Error("boom")) : Promise.resolve([]);
      },
    }),
  });
  return { select, update } as unknown as BmsDb;
}

function setup(overrides: { token?: Record<string, unknown> | null; account?: Record<string, unknown> | null } = {}) {
  const issued = issueServiceToken();
  const state: FakeState = {
    tokenRow:
      overrides.token === null
        ? null
        : {
            id: "00000000-0000-4000-8000-0000000000aa",
            organizationId: ORG,
            serviceAccountId: ACCOUNT,
            tokenHash: issued.tokenHash,
            readOnly: false,
            expiresAt: new Date(T0 + 86_400_000),
            revokedAt: null,
            ...overrides.token,
          },
    accountRow:
      overrides.account === null
        ? null
        : {
            id: ACCOUNT,
            email: "svc-1@service-account.invalid",
            displayName: "Integration",
            role: "operator",
            organizationId: ORG,
            oidcSubject: null,
            disabledAt: null,
            kind: "service",
            ...overrides.account,
          },
    tokenReads: 0,
    accountReads: 0,
    touches: 0,
    touchFails: false,
  };
  const verifier = new ServiceTokenVerifier(fakeAuthDb(state));
  let now = T0;
  verifier.now = () => now;
  return { verifier, state, issued, setNow: (t: number) => (now = t) };
}

export async function assertAValidTokenResolvesToItsServiceAccount(): Promise<void> {
  const { verifier, issued } = setup();
  const principal = await verifier.verify(issued.token);
  expect(principal).toEqual({
    payload: { sub: ACCOUNT, email: "svc-1@service-account.invalid", name: "Integration", role: "operator" },
    identity: expect.objectContaining({ id: ACCOUNT, organizationId: ORG, kind: "service", role: "operator" }),
    tokenId: issued.tokenId,
    readOnly: false,
    expiresAt: T0 + 86_400_000,
  });
}

export async function assertEveryRefusalIsNull(): Promise<void> {
  const cases: Array<[string, Parameters<typeof setup>[0], (token: string) => string]> = [
    ["an unknown token id", { token: null }, (t) => t],
    ["a wrong secret", {}, (t) => `${t.slice(0, -2)}${t.endsWith("AA") ? "BB" : "AA"}`],
    ["a revoked token", { token: { revokedAt: new Date(T0 - 1) } }, (t) => t],
    ["an expired token", { token: { expiresAt: new Date(T0) } }, (t) => t],
    ["a human account", { account: { kind: "human" } }, (t) => t],
    ["a disabled account", { account: { disabledAt: new Date(T0 - 1) } }, (t) => t],
    ["a missing account", { account: null }, (t) => t],
    ["an account role above operator", { account: { role: "organization_admin" } }, (t) => t],
    ["a malformed token", {}, () => "bms_sat_short"],
  ];
  for (const [why, overrides, mutate] of cases) {
    const { verifier, issued } = setup(overrides);
    expect(await verifier.verify(mutate(issued.token)), why).toBeNull();
  }
}

export async function assertAMalformedTokenNeverReachesTheDatabase(): Promise<void> {
  const { verifier, state } = setup();
  expect(await verifier.verify("bms_sat_nope")).toBeNull();
  expect(state.tokenReads).toBe(0);
}

export async function assertTheCacheHoldsThirtySecondsAndStillProvesTheSecret(): Promise<void> {
  const { verifier, state, issued, setNow } = setup();
  expect(await verifier.verify(issued.token)).not.toBeNull();
  expect(await verifier.verify(issued.token)).not.toBeNull();
  expect(state.tokenReads).toBe(1);
  // A cached id with a wrong secret is still refused.
  expect(await verifier.verify(`${issued.token.slice(0, -1)}${issued.token.endsWith("x") ? "y" : "x"}`)).toBeNull();
  setNow(T0 + SERVICE_TOKEN_CACHE_TTL_MS);
  expect(await verifier.verify(issued.token)).not.toBeNull();
  expect(state.tokenReads).toBe(2);
}

export async function assertForgetDropsTheCacheSoARevokeTakesEffect(): Promise<void> {
  const { verifier, state, issued } = setup();
  expect(await verifier.verify(issued.token)).not.toBeNull();
  state.tokenRow = null; // what bms_auth's live-only policy shows after a revoke
  verifier.forget(issued.tokenId);
  expect(await verifier.verify(issued.token)).toBeNull();
}

export async function assertLastUsedIsTouchedOncePerMinuteAndAFailureServesTheRequest(): Promise<void> {
  const { verifier, state, issued, setNow } = setup();
  await verifier.verify(issued.token);
  await verifier.verify(issued.token);
  expect(state.touches).toBe(1);
  setNow(T0 + LAST_USED_TOUCH_INTERVAL_MS);
  state.touchFails = true;
  const warn = vi.spyOn((verifier as unknown as { logger: { warn: (m: string) => void } }).logger, "warn");
  warn.mockImplementation(() => undefined);
  expect(await verifier.verify(issued.token)).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.touches).toBe(2);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).not.toContain(issued.token);
}

// ── revoke notifications ────────────────────────────────────────────────────

function deps(overrides: Partial<ServiceTokenRevokedDeps> = {}) {
  const calls: string[] = [];
  const d: ServiceTokenRevokedDeps = {
    forget: (id) => calls.push(`forget ${id}`),
    forgetAll: () => calls.push("forgetAll"),
    disconnectServiceToken: (id) => {
      calls.push(`disconnect ${id}`);
      return 1;
    },
    connectedServiceTokenIds: () => [],
    readLiveTokenIds: async () => [],
    logger: { log: () => undefined, warn: (m) => calls.push(`warn ${m}`), error: () => undefined },
    ...overrides,
  };
  return { d, calls };
}

export function assertARevokeNotificationForgetsAndDisconnectsThatToken(): void {
  const { d, calls } = deps();
  handleServiceTokenRevoked("ABCDEFGHIJ12", d);
  expect(calls).toEqual(["forget ABCDEFGHIJ12", "disconnect ABCDEFGHIJ12"]);
  const bad = deps();
  handleServiceTokenRevoked("not a token id", bad.d);
  expect(bad.calls).toEqual([`warn Dropped an undecodable bms_service_token_revoked payload`]);
  expect(decodeServiceTokenRevoked(undefined)).toBeNull();
}

export async function assertTheCatchUpClearsTheCacheAndClosesDeadTokensSockets(): Promise<void> {
  const { d, calls } = deps({
    connectedServiceTokenIds: () => ["AAAAAAAAAAAA", "BBBBBBBBBBBB"],
    readLiveTokenIds: async () => ["AAAAAAAAAAAA"],
  });
  expect(await catchUpServiceTokens(d)).toBe(1);
  expect(calls).toEqual(["forgetAll", "disconnect BBBBBBBBBBBB"]);
}

// ── PR 4 security review: L1, L4, M1, L2 ────────────────────────────────────

/** L4: an unknown id costs one read per id per 5 s, not one per request. */
export async function assertAnUnknownIdIsRememberedBrieflyAndForgetClearsIt(): Promise<void> {
  const { verifier, state, issued, setNow } = setup({ token: null });
  expect(await verifier.verify(issued.token)).toBeNull();
  expect(await verifier.verify(issued.token)).toBeNull();
  expect(state.tokenReads).toBe(1);
  setNow(T0 + UNKNOWN_TOKEN_CACHE_MS);
  expect(await verifier.verify(issued.token)).toBeNull();
  expect(state.tokenReads).toBe(2);
  // A wrong secret under a real id is never remembered: the real token still works.
  const real = setup();
  const wrong = `${real.issued.token.slice(0, -2)}${real.issued.token.endsWith("AA") ? "BB" : "AA"}`;
  expect(await real.verifier.verify(wrong)).toBeNull();
  expect(await real.verifier.verify(real.issued.token)).not.toBeNull();
}

/** L1: a forget that lands while a verify is reading is not undone by the read finishing. */
export async function assertAForgetDuringAReadIsNotUndoneByTheCache(): Promise<void> {
  const { verifier, state, issued } = setup();
  const realSelect = (verifier as unknown as { authDb: BmsDb }).authDb.select;
  let forgotOnce = false;
  (verifier as unknown as { authDb: { select: typeof realSelect } }).authDb.select = ((...args: unknown[]) => {
    if (!forgotOnce) {
      forgotOnce = true;
      verifier.forget(issued.tokenId); // the revoke NOTIFY arrives mid-read
    }
    return (realSelect as (...a: unknown[]) => unknown)(...args);
  }) as typeof realSelect;
  expect(await verifier.verify(issued.token)).not.toBeNull();
  // Not cached: the next verify reads again and sees the revoke.
  state.tokenRow = null;
  expect(await verifier.verify(issued.token)).toBeNull();
}

function fakeSocket(): TokenSocket & { closed: boolean; onDisconnect?: () => void } {
  const socket = {
    data: {} as { serviceTokenId?: unknown },
    closed: false,
    onDisconnect: undefined as undefined | (() => void),
    disconnect() {
      socket.closed = true;
      socket.onDisconnect?.();
      return socket;
    },
    once(_event: "disconnect", listener: () => void) {
      socket.onDisconnect = listener;
      return socket;
    },
  };
  return socket;
}

/** M1: tagged before verifying; re-checked live once registered; a JWT socket is untouched. */
export async function assertATokenSocketIsTaggedEarlyAndReCheckedLive(): Promise<void> {
  const issued = issueServiceToken();
  const socket = fakeSocket();
  tagServiceTokenSocket(socket, issued.token);
  expect(socket.data.serviceTokenId).toBe(issued.tokenId);
  const facts = { tokenId: issued.tokenId, expiresAt: Date.now() + 60_000 };
  expect(await holdServiceTokenSocket(socket, facts, { isLive: async () => false })).toBe(false);
  expect(socket.closed).toBe(true);
  const kept = fakeSocket();
  expect(await holdServiceTokenSocket(kept, facts, { isLive: async () => true })).toBe(true);
  expect(kept.closed).toBe(false);
  kept.disconnect(); // clears the expiry timer
  const noVerifier = fakeSocket();
  expect(await holdServiceTokenSocket(noVerifier, facts, undefined)).toBe(false);
  const jwtSocket = fakeSocket();
  tagServiceTokenSocket(jwtSocket, "eyJhbGciOiJIUzI1NiJ9.e30.x");
  expect(jwtSocket.data.serviceTokenId).toBeUndefined();
  expect(await holdServiceTokenSocket(jwtSocket, null, undefined)).toBe(true);
}

/** L2: a token socket closes when its token expires. */
export async function assertATokenSocketClosesAtExpiry(): Promise<void> {
  vi.useFakeTimers();
  try {
    const socket = fakeSocket();
    const start = Date.now();
    await holdServiceTokenSocket(socket, { tokenId: "AAAAAAAAAAAA", expiresAt: start + 1_000 }, { isLive: async () => true });
    expect(socket.closed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(socket.closed).toBe(true);
  } finally {
    vi.useRealTimers();
  }
}

/** F1 (code review): a token that expires inside its 30 s cache window stops at its expiry, not at the TTL. */
export async function assertACachedTokenStopsAtItsOwnExpiry(): Promise<void> {
  const { verifier, setNow, issued } = setup({ token: { expiresAt: new Date(T0 + 10_000) } });
  expect(await verifier.verify(issued.token)).not.toBeNull();
  setNow(T0 + 9_999);
  expect(await verifier.verify(issued.token)).not.toBeNull();
  setNow(T0 + 10_000);
  expect(await verifier.verify(issued.token)).toBeNull();
}

/** F4: the touch-failure warning is latched — once per outage, not once per request. */
export async function assertATouchFailureIsLoggedOncePerOutage(): Promise<void> {
  const { verifier, state, issued, setNow } = setup();
  state.touchFails = true;
  const warn = vi.spyOn((verifier as unknown as { logger: { warn: (m: string) => void } }).logger, "warn");
  warn.mockImplementation(() => undefined);
  for (let i = 0; i < 3; i += 1) {
    setNow(T0 + i * LAST_USED_TOUCH_INTERVAL_MS);
    await verifier.verify(issued.token);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(state.touches).toBe(3);
  expect(warn).toHaveBeenCalledTimes(1);
  // Just inside the interval: no touch at all.
  setNow(T0 + 2 * LAST_USED_TOUCH_INTERVAL_MS + LAST_USED_TOUCH_INTERVAL_MS - 1);
  await verifier.verify(issued.token);
  expect(state.touches).toBe(3);
}
