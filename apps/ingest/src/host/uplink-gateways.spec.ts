import { createHash } from "node:crypto";

import { assert } from "./normaliser.spec.js";
import {
  authenticate,
  gatewayHealth,
  hashToken,
  loadGateways,
  type GatewayRecord,
  type GatewaySnapshot,
} from "./uplink-gateways.js";

/**
 * `E7.2` / ADR 0123 decisions 5 and 6, plan T3.1 and P5 (a) — the receiver's
 * authentication, from an in-memory gateway snapshot and nothing else.
 *
 * Assertions live here; `uplink-gateways.test.ts` is the vitest entry point
 * (ADR 0014). One exported function per claim, so a mutation reddens the
 * `it()` that owns it. The constant-time rule cannot fail by behaviour, so it
 * is held on the source by `tests/e7.2-uplink-auth-static.test.ts`.
 */

/** Two valid tokens: `bmsgw_` and 43 base64url characters each. */
export const TOKEN_A = `bmsgw_${"A".repeat(42)}a`;
export const TOKEN_B = `bmsgw_${"b".repeat(42)}B`;

const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/** One snapshot row; every field a sensible default, overridable. */
export function gateway(overrides: Partial<GatewayRecord> = {}): GatewayRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    organizationCode: "ESKOM",
    code: "GW-A",
    status: "active",
    organizationIngestEnabled: true,
    tokenHash: sha256(TOKEN_A),
    lastSeenAt: null,
    reportedBacklog: null,
    clockState: null,
    backfillDirtyFrom: null,
    backfillDirtyTo: null,
    rtuCount: 0,
    ...overrides,
  };
}

const snapshotOf = (...gateways: GatewayRecord[]): GatewaySnapshot => ({ gateways });

function expectRefused(
  outcome: ReturnType<typeof authenticate>,
  status: 401 | 403,
  reason: string,
  label: string,
): void {
  assert(!outcome.ok, `${label}: must be refused, was authenticated`);
  if (outcome.ok) return;
  assert(outcome.status === status, `${label}: status must be ${status}, got ${outcome.status}`);
  assert(outcome.reason === reason, `${label}: reason must be ${reason}, got ${outcome.reason}`);
}

/** No `Authorization` header at all is 401. */
export function noHeaderIs401(): void {
  expectRefused(authenticate(snapshotOf(gateway()), undefined), 401, "unauthorized", "no header");
  expectRefused(authenticate(snapshotOf(gateway()), ""), 401, "unauthorized", "empty header");
}

/** A scheme other than `Bearer` is 401, even carrying the right token. */
export function wrongSchemeIs401(): void {
  expectRefused(authenticate(snapshotOf(gateway()), `Basic ${TOKEN_A}`), 401, "unauthorized", "Basic");
  expectRefused(authenticate(snapshotOf(gateway()), TOKEN_A), 401, "unauthorized", "bare token");
  expectRefused(
    authenticate(snapshotOf(gateway()), `Bearer  ${TOKEN_A}`),
    401,
    "unauthorized",
    "two spaces",
  );
  // The scheme is case-insensitive (RFC 9110 §11.1); the token is not.
  const lower = authenticate(snapshotOf(gateway()), `bearer ${TOKEN_A}`);
  assert(lower.ok, "a lower-case scheme carrying the right token must authenticate");
}

/** A token outside `UPLINK_TOKEN_PATTERN` is 401 before anything is hashed. */
export function malformedTokenIs401(): void {
  for (const bad of [`bmsgw_${"A".repeat(42)}`, `bmsgw_${"A".repeat(44)}`, `xxxxx_${"A".repeat(43)}`, `bmsgw_${"A".repeat(42)}=`]) {
    expectRefused(authenticate(snapshotOf(gateway()), `Bearer ${bad}`), 401, "unauthorized", `token "${bad.length}"`);
  }
}

/** A well-formed token no gateway holds is 401. */
export function unknownTokenIs401(): void {
  expectRefused(authenticate(snapshotOf(gateway()), `Bearer ${TOKEN_B}`), 401, "unauthorized", "unknown token");
  expectRefused(authenticate(snapshotOf(), `Bearer ${TOKEN_A}`), 401, "unauthorized", "empty snapshot");
}

/** The stored hash is never itself a credential: presenting it is 401. */
export function theStoredHashIsNotACredential(): void {
  const stored = sha256(TOKEN_A).toString("hex");
  expectRefused(authenticate(snapshotOf(gateway()), `Bearer ${stored}`), 401, "unauthorized", "hex hash");
  const asToken = `bmsgw_${sha256(TOKEN_A).toString("base64url")}`;
  expectRefused(authenticate(snapshotOf(gateway()), `Bearer ${asToken}`), 401, "unauthorized", "hash as token");
}

/** A revoked gateway's own token is 403 `gateway-revoked`. */
export function revokedIs403(): void {
  expectRefused(
    authenticate(snapshotOf(gateway({ status: "revoked" })), `Bearer ${TOKEN_A}`),
    403,
    "gateway-revoked",
    "revoked",
  );
}

/** A gateway whose organization is switched off (ADR 0115) is 403 `ingest-disabled`. */
export function organizationOffIs403(): void {
  expectRefused(
    authenticate(snapshotOf(gateway({ organizationIngestEnabled: false })), `Bearer ${TOKEN_A}`),
    403,
    "ingest-disabled",
    "organization off",
  );
  // Revoked wins over switched off: revoke is final, the switch is not.
  expectRefused(
    authenticate(
      snapshotOf(gateway({ status: "revoked", organizationIngestEnabled: false })),
      `Bearer ${TOKEN_A}`,
    ),
    403,
    "gateway-revoked",
    "revoked and off",
  );
}

/** A gateway with no minted token (NULL hash) matches nothing. */
export function aNullHashNeverMatches(): void {
  const unminted = gateway({ tokenHash: null });
  expectRefused(authenticate(snapshotOf(unminted), `Bearer ${TOKEN_A}`), 401, "unauthorized", "null hash");
  // A wrong-length hash (the CHECK forbids it; the loader drops it) is skipped, not thrown on.
  const short = gateway({ tokenHash: Buffer.alloc(31) });
  expectRefused(authenticate(snapshotOf(short), `Bearer ${TOKEN_A}`), 401, "unauthorized", "31-byte hash");
}

/** With two gateways, each token returns its own gateway, whatever the order. */
export function twoGatewaysReturnTheRightOne(): void {
  const a = gateway();
  const b = gateway({ id: "33333333-3333-4333-8333-333333333333", code: "GW-B", tokenHash: sha256(TOKEN_B) });
  for (const snapshot of [snapshotOf(a, b), snapshotOf(b, a)]) {
    const forA = authenticate(snapshot, `Bearer ${TOKEN_A}`);
    const forB = authenticate(snapshot, `Bearer ${TOKEN_B}`);
    assert(forA.ok && forA.gateway.id === a.id, "token A must return gateway A");
    assert(forB.ok && forB.gateway.id === b.id, "token B must return gateway B");
  }
}

/** `hashToken` is SHA-256 over the UTF-8 token, 32 bytes. */
export function hashTokenIsSha256(): void {
  const digest = hashToken(TOKEN_A);
  assert(digest.length === 32, `digest must be 32 bytes, got ${digest.length}`);
  assert(digest.toString("hex") === sha256(TOKEN_A).toString("hex"), "digest must equal sha256(token)");
}

/** `loadGateways` maps the query's columns and normalises the hash. */
export async function loadGatewaysMapsRows(): Promise<void> {
  const seen: string[] = [];
  const dirtyFrom = new Date("2026-11-10T01:00:00.000Z");
  const dirtyTo = new Date("2026-11-10T02:00:00.000Z");
  const lastSeen = new Date("2026-11-10T09:00:00.000Z");
  const snapshot = await loadGateways({
    async query(text: string) {
      seen.push(text);
      return {
        rows: [
          {
            id: "g1",
            organization_id: "o1",
            organization_code: "ESKOM",
            organization_ingest_enabled: true,
            code: "GW-1",
            status: "active",
            token_hash: sha256(TOKEN_A),
            last_seen_at: lastSeen,
            reported_backlog: 12,
            clock_state: "unsynced",
            backfill_dirty_from: dirtyFrom,
            backfill_dirty_to: dirtyTo,
            rtu_count: 3,
          },
          {
            id: "g2",
            organization_id: "o1",
            organization_code: "ESKOM",
            organization_ingest_enabled: false,
            code: "GW-2",
            status: "revoked",
            token_hash: null,
            last_seen_at: null,
            reported_backlog: null,
            clock_state: "something-new",
            backfill_dirty_from: null,
            backfill_dirty_to: null,
            rtu_count: "2",
          },
        ],
      };
    },
  });
  assert(seen.length === 1, "loadGateways must run exactly one query");
  const [g1, g2] = snapshot.gateways;
  assert(g1.id === "g1" && g1.organizationCode === "ESKOM" && g1.code === "GW-1", "g1 identity");
  assert(g1.status === "active" && g1.organizationIngestEnabled, "g1 status");
  assert(g1.tokenHash !== null && g1.tokenHash.length === 32, "g1 hash kept");
  assert(g1.lastSeenAt === lastSeen && g1.reportedBacklog === 12 && g1.clockState === "unsynced", "g1 report");
  assert(g1.backfillDirtyFrom === dirtyFrom && g1.backfillDirtyTo === dirtyTo, "g1 dirty window");
  assert(g1.rtuCount === 3, "g1 rtu count");
  assert(g2.status === "revoked" && !g2.organizationIngestEnabled, "g2 status");
  assert(g2.tokenHash === null, "g2 null hash stays null");
  assert(g2.clockState === null, "an unknown clock_state reads as null, not as a value the host never heard of");
  assert(g2.rtuCount === 2, "a bigint-as-string count is read as a number");
}

/** A status the host does not know reads as revoked: the closed, safe reading. */
export async function anUnknownStatusReadsAsRevoked(): Promise<void> {
  const snapshot = await loadGateways({
    async query() {
      return {
        rows: [
          {
            id: "g1",
            organization_id: "o1",
            organization_code: "ESKOM",
            organization_ingest_enabled: true,
            code: "GW-1",
            status: "suspended",
            token_hash: sha256(TOKEN_A),
            last_seen_at: null,
            reported_backlog: null,
            clock_state: null,
            backfill_dirty_from: null,
            backfill_dirty_to: null,
            rtu_count: 0,
          },
        ],
      };
    },
  });
  expectRefused(authenticate(snapshot, `Bearer ${TOKEN_A}`), 403, "gateway-revoked", "unknown status");
}

/** The health view carries no hash and no token-derived field. */
export function gatewayHealthCarriesNoHash(): void {
  const health = gatewayHealth(snapshotOf(gateway({ rtuCount: 2 })));
  assert(health.length === 1, "one health entry per gateway");
  const keys = Object.keys(health[0]).sort().join(",");
  assert(!/hash|token/i.test(keys), `the health view must not carry a hash or token field, got ${keys}`);
  assert(health[0].rtus === 2 && health[0].code === "GW-A", "the health view keeps code and rtu count");
}
