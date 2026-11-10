import { createHash, timingSafeEqual } from "node:crypto";

import { UPLINK_CLOCK_STATES, UPLINK_TOKEN_PATTERN } from "@bms/shared/ingest";

import type { GatewayHealth } from "./health-gateways.js";

/**
 * Edge gateway authentication for the uplink receiver (`E7.2`, ADR 0123
 * decisions 5 and 6, plan T3.1, ruling P5 (a)).
 *
 * **No database work happens before auth.** The receiver authenticates from
 * an in-memory snapshot of `bms.edge_gateways` that `main.ts` reloads on each
 * `INGEST_RELOAD_MS` tick, beside the binding plan. A revoke or a rotation
 * therefore bites within one tick (60 s by default), and an unauthenticated
 * request costs a hash and a loop, never a query.
 *
 * **The stored hash is never a credential.** The presented token is hashed
 * with SHA-256 and the two digests are compared; a caller who has read the
 * table holds only digests, and presenting one is a token that hashes to
 * something else. The compare is `timingSafeEqual` over **every** row that
 * holds a hash, with no early exit, so the time taken does not say which row
 * (if any) matched or how far a guess got. `tests/e7.2-uplink-auth-static.test.ts`
 * holds that on the source, because no behavioural test can see it.
 *
 * The host connects as `bms_fleet` (BYPASSRLS), so the snapshot is the whole
 * fleet's gateways by design; every query that *writes* a gateway filters by
 * its id itself (`uplink-write.ts`, `aggregate-repair.ts`).
 */

/** SHA-256 output length; also migration `0140`'s `octet_length(token_hash) = 32`. */
const SHA256_BYTES = 32;

/** One gateway as the receiver holds it. `tokenHash` never leaves this module's callers' memory. */
export type GatewayRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationCode: string;
  readonly code: string;
  /** `active` or `revoked`; a value this build does not know reads as `revoked`. */
  readonly status: "active" | "revoked";
  /** `organizations.ingest_enabled` (ADR 0115). */
  readonly organizationIngestEnabled: boolean;
  /** SHA-256 of the token, 32 bytes, or `null` before the first mint. */
  readonly tokenHash: Buffer | null;
  readonly lastSeenAt: Date | null;
  readonly reportedBacklog: number | null;
  readonly clockState: "synced" | "unsynced" | null;
  readonly backfillDirtyFrom: Date | null;
  readonly backfillDirtyTo: Date | null;
  /** Active RTUs with `edge_gateway_id` set to this gateway. */
  readonly rtuCount: number;
};

/** The whole fleet's gateways, as of the last reload. */
export type GatewaySnapshot = {
  readonly gateways: readonly GatewayRecord[];
};

/** An empty snapshot, for a host that has not loaded one yet. */
export const EMPTY_GATEWAY_SNAPSHOT: GatewaySnapshot = { gateways: [] };

/**
 * Every gateway, revoked ones included (a revoked token must answer 403, not
 * 401), with its organization's code and switch and its active RTU count. The
 * count's subquery filters by the gateway's own id.
 */
export const GATEWAY_QUERY = `
  SELECT
    g.id,
    g.organization_id,
    o.code AS organization_code,
    o.ingest_enabled AS organization_ingest_enabled,
    g.code,
    g.status,
    g.token_hash,
    g.last_seen_at,
    g.reported_backlog,
    g.clock_state,
    g.backfill_dirty_from,
    g.backfill_dirty_to,
    (SELECT count(*) FROM bms.rtus r WHERE r.edge_gateway_id = g.id AND r.active = true)::int AS rtu_count
  FROM bms.edge_gateways g
  INNER JOIN bms.organizations o ON o.id = g.organization_id
  ORDER BY g.id
`;

/** The slice of a `pg` pool or client `loadGateways` needs. */
export type GatewayQueryable = {
  query(text: string): Promise<{ rows: readonly Record<string, unknown>[] }>;
};

function dateOrNull(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

/** A 32-byte buffer, or `null`: a hash of any other length can never match. */
function storedDigest(value: unknown): Buffer | null {
  if (!Buffer.isBuffer(value)) {
    return null;
  }
  return value.byteLength === SHA256_BYTES ? value : null;
}

function clockStateOf(value: unknown): "synced" | "unsynced" | null {
  return (UPLINK_CLOCK_STATES as readonly unknown[]).includes(value)
    ? (value as "synced" | "unsynced")
    : null;
}

function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Runs `GATEWAY_QUERY` and maps each row. Unknown values read as the safe one. */
export async function loadGateways(db: GatewayQueryable): Promise<GatewaySnapshot> {
  const { rows } = await db.query(GATEWAY_QUERY);
  return {
    gateways: rows.map((row) => ({
      id: String(row.id),
      organizationId: String(row.organization_id),
      organizationCode: String(row.organization_code),
      code: String(row.code),
      status: row.status === "active" ? "active" : "revoked",
      organizationIngestEnabled: row.organization_ingest_enabled === true,
      tokenHash: storedDigest(row.token_hash),
      lastSeenAt: dateOrNull(row.last_seen_at),
      reportedBacklog: integerOrNull(row.reported_backlog),
      clockState: clockStateOf(row.clock_state),
      backfillDirtyFrom: dateOrNull(row.backfill_dirty_from),
      backfillDirtyTo: dateOrNull(row.backfill_dirty_to),
      rtuCount: integerOrNull(row.rtu_count) ?? 0,
    })),
  };
}

/** SHA-256 of the token's UTF-8 bytes — what the admin mint stores (PR 6). */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Why a request was refused. Fixed codes; never the header or the token. */
export type AuthRefusal = {
  readonly ok: false;
  readonly status: 401 | 403;
  readonly reason: "unauthorized" | "gateway-revoked" | "ingest-disabled";
};

export type AuthOutcome = { readonly ok: true; readonly gateway: GatewayRecord } | AuthRefusal;

const UNAUTHORIZED: AuthRefusal = { ok: false, status: 401, reason: "unauthorized" };

/** `Bearer <token>`, one space, scheme case-insensitive (RFC 9110 §11.1). */
const BEARER = /^Bearer ([^ ]+)$/i;

/**
 * Authenticates one `Authorization` header against the snapshot.
 *
 * 401 for anything that is not one well-formed token some gateway holds; 403
 * `gateway-revoked` for a revoked gateway's token (revoke is final, so it wins
 * over the switch); 403 `ingest-disabled` for a gateway whose organization is
 * switched off (ADR 0115, decision 6). The edge retries all three on its
 * backoff and keeps buffering.
 */
export function authenticate(snapshot: GatewaySnapshot, header: string | undefined): AuthOutcome {
  const parsed = header === undefined ? null : BEARER.exec(header);
  if (parsed === null || !UPLINK_TOKEN_PATTERN.test(parsed[1])) {
    return UNAUTHORIZED;
  }
  const presented = hashToken(parsed[1]);

  // Every row is compared, matched or not: no `break`, no `return` in here.
  let matched: GatewayRecord | undefined;
  for (const candidate of snapshot.gateways) {
    const stored = candidate.tokenHash;
    if (stored === null || stored.byteLength !== SHA256_BYTES) {
      continue;
    }
    const equal = timingSafeEqual(stored, presented);
    if (equal && matched === undefined) {
      matched = candidate;
    }
  }

  if (matched === undefined) {
    return UNAUTHORIZED;
  }
  if (matched.status !== "active") {
    return { ok: false, status: 403, reason: "gateway-revoked" };
  }
  if (!matched.organizationIngestEnabled) {
    return { ok: false, status: 403, reason: "ingest-disabled" };
  }
  return { ok: true, gateway: matched };
}

/** The snapshot as the health body shows it: no hash, no token field. */
export function gatewayHealth(snapshot: GatewaySnapshot): readonly GatewayHealth[] {
  return snapshot.gateways.map((g) => ({
    id: g.id,
    code: g.code,
    organizationCode: g.organizationCode,
    status: g.status,
    ingestEnabled: g.organizationIngestEnabled,
    rtus: g.rtuCount,
    lastSeenAt: g.lastSeenAt,
    reportedBacklog: g.reportedBacklog,
    clockState: g.clockState,
    dirtyFrom: g.backfillDirtyFrom,
    dirtyTo: g.backfillDirtyTo,
  }));
}
