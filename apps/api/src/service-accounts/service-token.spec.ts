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
import {
  LAST_USED_TOUCH_INTERVAL_MS,
  SERVICE_TOKEN_CACHE_TTL_MS,
  ServiceTokenVerifier,
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
