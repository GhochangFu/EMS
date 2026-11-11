import { createHash } from "node:crypto";

import { BadRequestException, ConflictException, ForbiddenException, HttpStatus, NotFoundException } from "@nestjs/common";
import { HEADERS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { expect } from "vitest";

import { edgeGatewayDtoSchema, edgeGatewaysListResponseSchema, UPLINK_TOKEN_PATTERN } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { AuditInput } from "../master-data-audit.service";
import { EdgeGatewaysAdminController } from "./edge-gateways.controller";
import {
  EdgeGatewaysAdminService,
  GATEWAY_REVOKED_MESSAGE,
  mintGatewayToken,
  RTU_NO_ADAPTER_MESSAGE,
  RTU_NO_CODE_MESSAGE,
  RTU_NOT_FOUND_MESSAGE,
  RTU_OTHER_GATEWAY_MESSAGE,
  RTU_SIMULATOR_FED_MESSAGE,
  ORGANIZATION_INGEST_DISABLED_MESSAGE,
  RTU_INACTIVE_MESSAGE,
  RTU_INGEST_DISABLED_MESSAGE,
} from "./edge-gateways.service";

/**
 * `E7.2` / ADR 0123 decisions 5, 6 and 12 (plan T6.2) — the edge gateway
 * service's gates, secrecy and assignment rules, against an in-memory model of
 * the two tables. The model reads each statement's own SQL text and
 * parameters (rendered by Drizzle's `PgDialect`) and applies only the
 * predicates the statement carries, so a statement that drops its
 * organization predicate behaves here as it would on `bms_fleet` (which
 * bypasses row security). Postgres is the integration spec's: this file proves
 * the order and the payloads, not the SQL's meaning.
 */

const JWT = { sub: "u", email: "admin@bms.local", role: "admin" } as unknown as JwtPayload;

export const ORG_A = "00000000-0000-4000-8000-00000000000a";
export const ORG_B = "00000000-0000-4000-8000-00000000000b";
const LOC_A = "00000000-0000-4000-8000-0000000000a1";
const LOC_B = "00000000-0000-4000-8000-0000000000b1";
const GW = "00000000-0000-4000-8000-0000000000f1";
const GW_OTHER = "00000000-0000-4000-8000-0000000000f2";
const GW_REVOKED = "00000000-0000-4000-8000-0000000000f3";
const MISSING = "00000000-0000-4000-8000-0000000000ff";
const RTU = {
  ok: "00000000-0000-4000-8000-000000000c01",
  ok2: "00000000-0000-4000-8000-000000000c02",
  noCode: "00000000-0000-4000-8000-000000000c03",
  modbus: "00000000-0000-4000-8000-000000000c04",
  simFed: "00000000-0000-4000-8000-000000000c05",
  elsewhere: "00000000-0000-4000-8000-000000000c06",
  foreign: "00000000-0000-4000-8000-000000000c07",
  assigned: "00000000-0000-4000-8000-000000000c08",
  inactive: "00000000-0000-4000-8000-000000000c09",
  ingestOff: "00000000-0000-4000-8000-000000000c0a",
} as const;

type Gateway = {
  id: string;
  organization_id: string;
  location_id: string | null;
  code: string;
  name: string;
  status: string;
  token_hash: string | null;
  token_last4: string | null;
};
type Rtu = {
  id: string;
  organization_id: string;
  code: string;
  rtu_code: string | null;
  protocol: string;
  simulator_fed: boolean;
  active: boolean;
  ingest_enabled: boolean;
  edge_gateway_id: string | null;
};
type Statement = { tag: string; sql: string; params: unknown[]; tx: number };

const dialect = new PgDialect();

/** The parameter bound to `<column> = $n` in a statement, or `undefined` when it carries no such predicate. */
function bound(text: string, params: unknown[], column: string): unknown {
  const match = new RegExp(`(?<![\\w.])(?:[a-z]\\.)?${column} = \\$(\\d+)`).exec(text);
  return match ? params[Number(match[1]) - 1] : undefined;
}

function idList(text: string, params: unknown[], negated: boolean): string[] | undefined {
  const match = new RegExp(`${negated ? "NOT \\(" : "(?<!NOT \\()"}(?:[a-z]\\.)?id = ANY\\(\\$(\\d+)::uuid\\[\\]\\)`).exec(text);
  if (!match) return undefined;
  const literal = String(params[Number(match[1]) - 1]);
  return literal === "{}" ? [] : literal.slice(1, -1).split(",");
}

/** Two tables, in memory, and every statement the service sent. */
export class FakeFleet {
  gateways = new Map<string, Gateway>();
  /** `bms.organizations.ingest_enabled`, by organization id (ADR 0115). */
  organizationIngest = new Map<string, boolean>([
    [ORG_A, true],
    [ORG_B, true],
  ]);
  rtus: Rtu[] = [];
  statements: Statement[] = [];
  transactions = 0;
  private current = 0;

  constructor() {
    const gw = (id: string, code: string, status = "active", org = ORG_A): Gateway => ({
      id,
      organization_id: org,
      location_id: null,
      code,
      name: code,
      status,
      token_hash: null,
      token_last4: null,
    });
    this.gateways.set(GW, gw(GW, "GW-1"));
    this.gateways.set(GW_OTHER, gw(GW_OTHER, "GW-2"));
    this.gateways.set(GW_REVOKED, gw(GW_REVOKED, "GW-3", "revoked"));
    const rtu = (id: string, over: Partial<Rtu> = {}): Rtu => ({
      id,
      organization_id: ORG_A,
      code: id.slice(-4),
      rtu_code: `R-${id.slice(-4)}`,
      protocol: "mqtt",
      simulator_fed: false,
      active: true,
      ingest_enabled: true,
      edge_gateway_id: null,
      ...over,
    });
    this.rtus = [
      rtu(RTU.ok),
      rtu(RTU.ok2),
      rtu(RTU.noCode, { rtu_code: null }),
      rtu(RTU.modbus, { protocol: "modbus_tcp" }),
      rtu(RTU.simFed, { simulator_fed: true }),
      rtu(RTU.elsewhere, { edge_gateway_id: GW_OTHER }),
      rtu(RTU.foreign, { organization_id: ORG_B }),
      rtu(RTU.assigned, { edge_gateway_id: GW }),
      rtu(RTU.inactive, { active: false }),
      rtu(RTU.ingestOff, { ingest_enabled: false }),
    ];
  }

  async execute(query: SQL): Promise<{ rows: unknown[] }> {
    return this.run(query, 0);
  }

  async transaction<T>(fn: (tx: { execute: (q: SQL) => Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T> {
    const id = ++this.transactions;
    const saved = { gateways: structuredClone([...this.gateways]), rtus: structuredClone(this.rtus) };
    this.current = id;
    try {
      return await fn({ execute: async (q: SQL) => this.run(q, id) });
    } catch (err) {
      this.gateways = new Map(saved.gateways);
      this.rtus = saved.rtus;
      throw err;
    } finally {
      this.current = 0;
    }
  }

  ofTag(tag: string): Statement[] {
    return this.statements.filter((s) => s.tag === tag);
  }

  private async run(query: SQL, tx: number): Promise<{ rows: unknown[] }> {
    const { sql: text, params } = dialect.sqlToQuery(query);
    const tag = /edge-gateways:([a-z-]+)/.exec(text)?.[1] ?? "untagged";
    this.statements.push({ tag, sql: text, params, tx: tx || this.current });
    const org = bound(text, params, "organization_id");
    const keepRtu = (r: Rtu): boolean => org === undefined || r.organization_id === org;
    switch (tag) {
      case "select-all":
      case "select-one": {
        const only = tag === "select-one" ? params[0] : undefined;
        const rows = [...this.gateways.values()]
          .filter((g) => only === undefined || g.id === only)
          .map((g) => ({
            id: g.id,
            organization_id: g.organization_id,
            organization_code: g.organization_id === ORG_A ? "PHE" : "ESKOM",
            organization_name: g.organization_id === ORG_A ? "PHE" : "Eskom",
            location_id: g.location_id,
            location_name: g.location_id === null ? null : "Plant",
            code: g.code,
            name: g.name,
            status: g.status,
            token_last4: g.token_last4,
            token_rotated_at: g.token_hash === null ? null : new Date("2026-11-10T00:00:00Z"),
            last_seen_at: null,
            reported_backlog: null,
            clock_state: "unsynced",
            created_at: new Date("2026-11-10T00:00:00Z"),
            updated_at: new Date("2026-11-10T00:00:00Z"),
            rtus: this.rtus
              .filter((r) => r.edge_gateway_id === g.id && r.organization_id === g.organization_id)
              .map((r) => ({ id: r.id, code: r.code, rtuCode: r.rtu_code, displayName: r.code })),
            // Only when the statement selects it — what a mapper that leaks it would see.
            ...(/token_hash/.test(text) ? { token_hash: g.token_hash === null ? null : Buffer.from(g.token_hash, "hex") } : {}),
          }));
        return { rows };
      }
      case "org-exists":
        return { rows: [ORG_A, ORG_B].includes(String(params[0])) ? [{ id: params[0] }] : [] };
      case "location-in-org": {
        const known = [
          { id: LOC_A, organization_id: ORG_A },
          { id: LOC_B, organization_id: ORG_B },
        ];
        return { rows: known.filter((l) => l.id === params[0] && (org === undefined || l.organization_id === org)) };
      }
      case "insert": {
        const [organizationId, locationId, code, name] = params as [string, string | null, string, string];
        if ([...this.gateways.values()].some((g) => g.organization_id === organizationId && g.code === code)) {
          throw Object.assign(new Error("duplicate"), { code: "23505" });
        }
        const id = `00000000-0000-4000-8000-${String(this.gateways.size + 1).padStart(12, "0")}`;
        this.gateways.set(id, {
          id,
          organization_id: organizationId,
          location_id: locationId,
          code,
          name,
          status: "active",
          token_hash: null,
          token_last4: null,
        });
        return { rows: [{ id }] };
      }
      case "lock": {
        const g = this.gateways.get(String(params[0]));
        return {
          rows: g
            ? [{ id: g.id, organization_id: g.organization_id, location_id: g.location_id, code: g.code, name: g.name, status: g.status, has_token: g.token_hash !== null }]
            : [],
        };
      }
      case "update": {
        const g = this.gateways.get(String(bound(text, params, "id")));
        if (g && (org === undefined || g.organization_id === org)) {
          g.name = String(bound(text, params, "name"));
          g.location_id = (bound(text, params, "location_id") as string | null) ?? null;
        }
        return { rows: [] };
      }
      case "revoke": {
        const g = this.gateways.get(String(bound(text, params, "id")));
        if (g && (org === undefined || g.organization_id === org) && g.status === "active") g.status = "revoked";
        return { rows: [] };
      }
      case "mint": {
        const g = this.gateways.get(String(bound(text, params, "id")));
        if (g && (org === undefined || g.organization_id === org) && g.status === "active") {
          g.token_hash = String(params[0]);
          g.token_last4 = String(bound(text, params, "token_last4"));
        }
        return { rows: [] };
      }
      case "assign-candidates": {
        const ids = idList(text, params, false) ?? [];
        return {
          rows: this.rtus
            .filter((r) => ids.includes(r.id) && keepRtu(r))
            .map((r) => ({
              id: r.id,
              rtu_code: r.rtu_code,
              protocol: r.protocol,
              edge_gateway_id: r.edge_gateway_id,
              simulator_fed: r.simulator_fed,
              // Only what the statement selects — a dropped column reads as missing, as on Postgres.
              ...(/r\.active\b/.test(text) ? { active: r.active } : {}),
              ...(/r\.ingest_enabled\b/.test(text) ? { ingest_enabled: r.ingest_enabled } : {}),
              ...(/o\.ingest_enabled AS organization_ingest_enabled/.test(text)
                ? { organization_ingest_enabled: this.organizationIngest.get(r.organization_id) ?? false }
                : {}),
            })),
        };
      }
      case "unassign-all":
      case "unassign-rest":
      case "assign": {
        const gw = String(bound(text, params, "edge_gateway_id") ?? params[0]);
        const keep = idList(text, params, true);
        const only = idList(text, params, false);
        const touched: string[] = [];
        for (const r of this.rtus) {
          if (!keepRtu(r)) continue;
          if (tag === "assign") {
            if (only?.includes(r.id) && r.edge_gateway_id !== gw) {
              r.edge_gateway_id = gw;
              touched.push(r.id);
            }
          } else if (r.edge_gateway_id === gw && !(keep ?? []).includes(r.id)) {
            r.edge_gateway_id = null;
            touched.push(r.id);
          }
        }
        return { rows: touched.map((id) => ({ id })) };
      }
      default:
        throw new Error(`the fake has no handler for ${tag}: ${text}`);
    }
  }
}

type Harness = { svc: EdgeGatewaysAdminService; db: FakeFleet; audits: { input: AuditInput; executor: unknown }[] };

function harness(role = "admin"): Harness {
  const db = new FakeFleet();
  const audits: Harness["audits"] = [];
  const accessControl = {
    requireMasterDataUser: async () => ({ id: "u-1", role }),
    assertAdminRole: (r: string) => {
      if (r !== "admin") throw new ForbiddenException("global admin only");
    },
  };
  const audit = {
    write: async (input: AuditInput, executor: unknown) => {
      audits.push({ input, executor });
    },
  };
  return { svc: new EdgeGatewaysAdminService(db as never, accessControl as never, audit as never), db, audits };
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

/** Every route, as the service sees it, with a body that would otherwise be good. */
function everyRoute(svc: EdgeGatewaysAdminService): (() => Promise<unknown>)[] {
  return [
    () => svc.list(JWT),
    () => svc.create(JWT, { organizationId: ORG_A, code: "GW-9", name: "Box" }),
    () => svc.update(JWT, GW, { name: "Renamed" }),
    () => svc.revoke(JWT, GW),
    () => svc.mintToken(JWT, GW),
    () => svc.replaceRtus(JWT, GW, { rtuIds: [RTU.ok] }),
  ];
}

/** G1 — a non-admin is refused every route, the read included, before any statement or audit. */
export async function aNonAdminIsRefusedEveryRouteFirst(): Promise<void> {
  for (const role of ["organization_admin", "location_admin"]) {
    const { svc, db, audits } = harness(role);
    for (const run of everyRoute(svc)) {
      expect(await settle(run())).toBeInstanceOf(ForbiddenException);
    }
    // A malformed id and body still meet the role gate first.
    expect(await settle(svc.update(JWT, "not-an-id", { nope: 1 }))).toBeInstanceOf(ForbiddenException);
    expect(db.statements).toEqual([]);
    expect(audits).toEqual([]);
  }
  // Positive control: the same calls as the admin reach the database.
  const { svc, db } = harness();
  for (const run of everyRoute(svc)) await settle(run());
  expect(db.statements.length).toBeGreaterThan(0);
}

/** G2 — a malformed id or body is a 400 before any statement. */
export async function aMalformedInputIsA400First(): Promise<void> {
  const { svc, db } = harness();
  const refusals = [
    svc.create(JWT, { organizationId: ORG_A, code: "GW 9", name: "Box" }),
    svc.create(JWT, { organizationId: ORG_A, code: "GW-9", name: "Box", tokenHash: "00" }),
    svc.update(JWT, "not-an-id", { name: "x" }),
    svc.update(JWT, GW, {}),
    svc.update(JWT, GW, { code: "GW-2" }),
    svc.revoke(JWT, "not-an-id"),
    svc.mintToken(JWT, "1; DROP TABLE"),
    svc.replaceRtus(JWT, "not-an-id", { rtuIds: [] }),
    svc.replaceRtus(JWT, GW, { rtuIds: ["R-1"] }),
    svc.replaceRtus(JWT, GW, { rtuIds: [RTU.ok, RTU.ok.toUpperCase()] }),
  ];
  for (const run of refusals) {
    expect(await settle(run)).toBeInstanceOf(BadRequestException);
  }
  expect(db.statements).toEqual([]);
}

/** G3 — 404 for what does not exist, and every 404 before any 409 (§4.7). */
export async function notFoundComesBeforeConflict(): Promise<void> {
  const { svc, audits } = harness();
  for (const run of [
    () => svc.update(JWT, MISSING, { name: "x" }),
    () => svc.revoke(JWT, MISSING),
    () => svc.mintToken(JWT, MISSING),
    () => svc.replaceRtus(JWT, MISSING, { rtuIds: [] }),
    () => svc.create(JWT, { organizationId: MISSING, code: "GW-9", name: "Box" }),
    // A location of another organization is the same 404 as a missing one.
    () => svc.create(JWT, { organizationId: ORG_A, locationId: LOC_B, code: "GW-9", name: "Box" }),
    () => svc.update(JWT, GW, { locationId: LOC_B }),
    // A revoked gateway and a foreign RTU: the 404 wins.
    () => svc.replaceRtus(JWT, GW_REVOKED, { rtuIds: [RTU.foreign] }),
  ]) {
    expect(await settle(run())).toBeInstanceOf(NotFoundException);
  }
  const duplicate = await settle(svc.create(JWT, { organizationId: ORG_A, code: "GW-1", name: "Again" }));
  expect(duplicate).toBeInstanceOf(ConflictException);
  expect(audits).toEqual([]);
}

/** G4 — the mint: the token once, on the uplink pattern; only its SHA-256 and last four stored; a second mint replaces it; no audit payload holds any of the three. */
export async function theMintStoresOnlyTheHash(): Promise<void> {
  const { svc, db, audits } = harness();
  const first = await svc.mintToken(JWT, GW);
  expect(first.token).toMatch(UPLINK_TOKEN_PATTERN);
  const hashOf = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
  expect(db.gateways.get(GW)?.token_hash).toBe(hashOf(first.token));
  expect(db.gateways.get(GW)?.token_last4).toBe(first.token.slice(-4));
  expect(edgeGatewayDtoSchema.safeParse(first.gateway).success).toBe(true);
  expect(first.gateway.tokenLast4).toBe(first.token.slice(-4));
  expect(JSON.stringify(first.gateway)).not.toContain(first.token);

  const second = await svc.mintToken(JWT, GW);
  expect(second.token).not.toBe(first.token);
  expect(db.gateways.get(GW)?.token_hash).toBe(hashOf(second.token));
  expect(audits.map((a) => a.input.action)).toEqual(["master.edge_gateway.token.mint", "master.edge_gateway.token.rotate"]);

  // No statement the mint sends carries the token itself, only its digest.
  for (const statement of db.statements) {
    expect(JSON.stringify(statement.params)).not.toContain(first.token);
    expect(JSON.stringify(statement.params)).not.toContain(second.token);
  }
  for (const { input, executor } of audits) {
    expect(input.organizationId).toBeNull();
    expect(input.entityType).toBe("edge_gateway");
    expect(input.payload).toEqual({ code: "GW-1" });
    expect(executor, "the audit row rides the write's transaction").not.toBe(db);
    for (const token of [first.token, second.token]) {
      const text = JSON.stringify(input);
      expect(text).not.toContain(token);
      expect(text).not.toContain(hashOf(token));
      expect(text).not.toContain(token.slice(-4));
    }
  }
}

/** G5 — revoke is final: a mint, an assignment or a second revoke on a revoked gateway is 409, and writes nothing. */
export async function revokeIsFinal(): Promise<void> {
  const { svc, db, audits } = harness();
  for (const run of [
    () => svc.mintToken(JWT, GW_REVOKED),
    () => svc.revoke(JWT, GW_REVOKED),
    () => svc.replaceRtus(JWT, GW_REVOKED, { rtuIds: [] }),
  ]) {
    const refused = await settle(run());
    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).message).toBe(GATEWAY_REVOKED_MESSAGE);
  }
  expect(db.gateways.get(GW_REVOKED)?.token_hash).toBeNull();
  expect(db.ofTag("mint")).toEqual([]);
  expect(audits).toEqual([]);
  // A revoked gateway may still be renamed: the label is not the credential.
  expect((await svc.update(JWT, GW_REVOKED, { name: "Retired box" })).name).toBe("Retired box");
}

/** G6 — revoke unassigns the gateway's RTUs in its own transaction, and audits the ids. */
export async function revokeUnassignsInTheSameTransaction(): Promise<void> {
  const { svc, db, audits } = harness();
  const revoked = await svc.revoke(JWT, GW);
  expect(revoked.status).toBe("revoked");
  expect(revoked.rtus).toEqual([]);
  expect(db.rtus.find((r) => r.id === RTU.assigned)?.edge_gateway_id).toBeNull();
  // Another gateway's RTU is untouched.
  expect(db.rtus.find((r) => r.id === RTU.elsewhere)?.edge_gateway_id).toBe(GW_OTHER);
  const [revoke] = db.ofTag("revoke");
  const [unassign] = db.ofTag("unassign-all");
  expect(revoke?.tx).toBeGreaterThan(0);
  expect(unassign?.tx).toBe(revoke?.tx);
  expect(unassign?.sql).toMatch(/organization_id = \$\d/);
  expect(audits.map((a) => a.input)).toEqual([
    expect.objectContaining({
      action: "master.edge_gateway.revoke",
      organizationId: null,
      payload: { code: "GW-1", unassignedRtuIds: [RTU.assigned] },
    }),
  ]);
}

/** G7 — the assignment rules: another organization's RTU is 404 with no echo; each refusal is a fixed 409; nothing is written on a refusal. */
export async function theAssignmentRules(): Promise<void> {
  const { svc, db, audits } = harness();
  const foreign = await settle(svc.replaceRtus(JWT, GW, { rtuIds: [RTU.ok, RTU.foreign] }));
  expect(foreign).toBeInstanceOf(NotFoundException);
  expect((foreign as NotFoundException).message).toBe(RTU_NOT_FOUND_MESSAGE);
  expect(JSON.stringify((foreign as NotFoundException).getResponse())).not.toContain(RTU.foreign);
  expect(db.rtus.find((r) => r.id === RTU.foreign)?.edge_gateway_id).toBeNull();

  for (const [rtuId, message] of [
    [RTU.noCode, RTU_NO_CODE_MESSAGE],
    [RTU.modbus, RTU_NO_ADAPTER_MESSAGE],
    [RTU.simFed, RTU_SIMULATOR_FED_MESSAGE],
    [RTU.elsewhere, RTU_OTHER_GATEWAY_MESSAGE],
    // What `bindings.ts` plans: `r.active AND r.ingest_enabled`, and the organization's switch on.
    [RTU.inactive, RTU_INACTIVE_MESSAGE],
    [RTU.ingestOff, RTU_INGEST_DISABLED_MESSAGE],
  ] as const) {
    const refused = await settle(svc.replaceRtus(JWT, GW, { rtuIds: [RTU.ok, rtuId] }));
    expect(refused, rtuId).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).message).toBe(message);
  }
  db.organizationIngest.set(ORG_A, false);
  const switchedOff = await settle(svc.replaceRtus(JWT, GW, { rtuIds: [RTU.ok] }));
  expect(switchedOff).toBeInstanceOf(ConflictException);
  expect((switchedOff as ConflictException).message).toBe(ORGANIZATION_INGEST_DISABLED_MESSAGE);
  db.organizationIngest.set(ORG_A, true);
  expect(db.ofTag("assign")).toEqual([]);
  expect(db.rtus.find((r) => r.id === RTU.assigned)?.edge_gateway_id).toBe(GW);
  expect(audits).toEqual([]);
}

/** G8 — a replace assigns the named set, unassigns the rest, never writes an asset, and audits added and removed. */
export async function aReplaceWritesTheSet(): Promise<void> {
  const { svc, db, audits } = harness();
  const after = await svc.replaceRtus(JWT, GW, { rtuIds: [RTU.ok, RTU.ok2] });
  expect(after.rtus.map((r) => r.id).sort()).toEqual([RTU.ok, RTU.ok2]);
  expect(after.rtuCount).toBe(2);
  expect(db.rtus.find((r) => r.id === RTU.assigned)?.edge_gateway_id).toBeNull();
  for (const statement of db.statements) {
    expect(statement.sql, statement.tag).not.toMatch(/UPDATE\s+bms\.assets|INSERT\s+INTO\s+bms\.assets/i);
  }
  for (const tag of ["assign-candidates", "unassign-rest", "assign"]) {
    expect(db.ofTag(tag)[0]?.sql, tag).toMatch(/organization_id = \$\d/);
  }
  expect(audits.map((a) => a.input)).toEqual([
    expect.objectContaining({
      action: "master.edge_gateway.rtus.replace",
      organizationId: null,
      payload: { code: "GW-1", added: [RTU.ok, RTU.ok2], removed: [RTU.assigned] },
    }),
  ]);
  // `[]` unassigns every RTU.
  expect((await svc.replaceRtus(JWT, GW, { rtuIds: [] })).rtus).toEqual([]);
}

/** G9 — the list: strict DTOs, no hash or token anywhere, and the select never names the hash column. */
export async function theListCarriesNoSecret(): Promise<void> {
  const { svc, db } = harness();
  const minted = await svc.mintToken(JWT, GW);
  const listed = await svc.list(JWT);
  expect(edgeGatewaysListResponseSchema.safeParse(listed).success).toBe(true);
  const text = JSON.stringify(listed);
  expect(text).not.toMatch(/hash/i);
  expect(text).not.toContain(minted.token);
  expect(text).not.toContain(createHash("sha256").update(minted.token, "utf8").digest("hex"));
  for (const tag of ["select-all", "select-one"]) {
    expect(db.ofTag(tag)[0]?.sql, tag).not.toMatch(/token_hash/);
  }
  const create = await svc.create(JWT, { organizationId: ORG_A, locationId: LOC_A, code: "GW-9", name: "Box" });
  expect(create).toMatchObject({ code: "GW-9", status: "active", tokenLast4: null, rtuCount: 0 });
}

/** G10 — the token generator: 256 bits, base64url, the uplink pattern, SHA-256 of its UTF-8 bytes. */
export function theTokenGeneratorMatchesTheReceiver(): void {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const { token, hash, last4 } = mintGatewayToken();
    expect(token).toMatch(UPLINK_TOKEN_PATTERN);
    expect(Buffer.from(token.slice("bmsgw_".length), "base64url")).toHaveLength(32);
    expect(hash).toHaveLength(32);
    expect(hash.equals(createHash("sha256").update(token, "utf8").digest())).toBe(true);
    expect(last4).toBe(token.slice(-4));
    seen.add(token);
  }
  expect(seen.size).toBe(200);
}

/** G11 — the routes: mounted at `admin/edge-gateways`; the mint is `200` and `Cache-Control: no-store`. */
export function theRoutesAreMounted(): void {
  expect(Reflect.getMetadata(PATH_METADATA, EdgeGatewaysAdminController)).toBe("admin/edge-gateways");
  const proto = EdgeGatewaysAdminController.prototype;
  expect(Reflect.getMetadata(PATH_METADATA, proto.mintToken)).toBe(":id/token");
  expect(Reflect.getMetadata(PATH_METADATA, proto.revoke)).toBe(":id/revoke");
  expect(Reflect.getMetadata(PATH_METADATA, proto.replaceRtus)).toBe(":id/rtus");
  expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.mintToken)).toBe(HttpStatus.OK);
  expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.revoke)).toBe(HttpStatus.OK);
  expect(Reflect.getMetadata(HEADERS_METADATA, proto.mintToken)).toEqual([{ name: "Cache-Control", value: "no-store" }]);
}

/** G12 — each controller route hands its service method the raw input. */
export async function eachRouteReachesItsServiceMethod(): Promise<void> {
  const calls: string[] = [];
  const record = (name: string) => async (...args: unknown[]) => {
    calls.push(`${name} ${JSON.stringify(args.slice(1))}`);
    return {};
  };
  const service = {
    list: record("list"),
    create: record("create"),
    update: record("update"),
    revoke: record("revoke"),
    mintToken: record("mintToken"),
    replaceRtus: record("replaceRtus"),
  };
  const controller = new EdgeGatewaysAdminController(service as unknown as EdgeGatewaysAdminService);
  await controller.list(JWT);
  await controller.create({ code: "x" }, JWT);
  await controller.update("id-1", { name: "y" }, JWT);
  await controller.revoke("id-1", JWT);
  await controller.mintToken("id-1", JWT);
  await controller.replaceRtus("id-1", { rtuIds: [] }, JWT);
  expect(calls).toEqual([
    "list []",
    'create [{"code":"x"}]',
    'update ["id-1",{"name":"y"}]',
    'revoke ["id-1"]',
    'mintToken ["id-1"]',
    'replaceRtus ["id-1",{"rtuIds":[]}]',
  ]);
}
