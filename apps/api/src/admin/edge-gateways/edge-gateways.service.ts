import { createHash, randomBytes } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { z, type ZodError } from "zod";

import type { BmsDb } from "@bms/db";
import {
  createEdgeGatewayBodySchema,
  INGEST_WIRED_PROTOCOLS,
  putEdgeGatewayRtusBodySchema,
  updateEdgeGatewayBodySchema,
  UPLINK_TOKEN_PATTERN,
} from "@bms/shared";
import type {
  EdgeGatewayClockState,
  EdgeGatewayDto,
  EdgeGatewayStatus,
  EdgeGatewaysListResponse,
  EdgeGatewayTokenResponse,
  JwtPayload,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { translateConstraintErrors } from "../../database/translate-constraint-errors";
import { MasterDataAuditService } from "../master-data-audit.service";

/** The fixed 404s. An RTU of another organization is the same 404 as a missing one, and names no id. */
export const GATEWAY_NOT_FOUND_MESSAGE = "Edge gateway not found";
export const ORGANIZATION_NOT_FOUND_MESSAGE = "Organization not found";
export const LOCATION_NOT_FOUND_MESSAGE = "Location not found in the gateway's organization";
export const RTU_NOT_FOUND_MESSAGE = "RTU not found in the gateway's organization";

/** The fixed 409s (§4.7: after every 400 and 404). */
export const GATEWAY_REVOKED_MESSAGE = "This edge gateway is revoked; revoke is final";
export const RTU_INACTIVE_MESSAGE = "An inactive RTU cannot be served by an edge gateway";
export const RTU_INGEST_DISABLED_MESSAGE =
  "An RTU whose ingest is not enabled cannot be served by an edge gateway; turn ingest on for the RTU first";
export const ORGANIZATION_INGEST_DISABLED_MESSAGE =
  "The organization's ingest is switched off, so none of its RTUs can be served by an edge gateway";
export const RTU_NO_CODE_MESSAGE =
  "An RTU with no RTU code cannot be served by an edge gateway: the RTU code is its device key";
export const RTU_NO_ADAPTER_MESSAGE =
  "An RTU whose protocol has no ingest adapter cannot be served by an edge gateway";
export const RTU_SIMULATOR_FED_MESSAGE =
  "An RTU whose assets the simulator feeds cannot be served by an edge gateway; turn ingest on for the RTU first";
export const RTU_OTHER_GATEWAY_MESSAGE =
  "An RTU served by another edge gateway must be unassigned there first";

const idSchema = z.string().uuid();

/** A gateway's columns as the list reads them — an explicit list that never names `token_hash`. */
export type GatewayRow = {
  id: string;
  organization_id: string;
  organization_code: string;
  organization_name: string;
  location_id: string | null;
  location_name: string | null;
  code: string;
  name: string;
  status: string;
  token_last4: string | null;
  token_rotated_at: Date | string | null;
  last_seen_at: Date | string | null;
  reported_backlog: number | null;
  clock_state: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  rtus: { id: string; code: string; rtuCode: string | null; displayName: string }[] | null;
};

/** The row a write locks: what its checks and its audit payload need, never the hash. */
type LockedGateway = {
  id: string;
  organization_id: string;
  location_id: string | null;
  code: string;
  name: string;
  status: string;
  has_token: boolean;
};

/** One RTU an assignment names, with what decides whether the edge may serve it. */
type AssignCandidate = {
  id: string;
  rtu_code: string | null;
  protocol: string;
  edge_gateway_id: string | null;
  simulator_fed: boolean;
  /** `bms.rtus.active` and `.ingest_enabled`: the cloud plan reads only rows where both are true. */
  active: boolean;
  ingest_enabled: boolean;
  /** `bms.organizations.ingest_enabled` (ADR 0115): off, the plan skips every RTU of the organization. */
  organization_ingest_enabled: boolean;
};

type Executor = Pick<BmsDb, "execute">;

/**
 * `E7.2` / ADR 0123 decisions 5, 6 and 12 (plan T6.2, builder call C13) — the
 * edge gateways (`bms.edge_gateways`), managed by the global admin.
 *
 * **Global `admin` only, the read included** (ruling Q12-A), by the `bms.users`
 * role (`requireMasterDataUser` + `assertAdminRole`), checked before any body
 * or id is parsed: 403 → 400 → 404 → 409 (§4.7).
 *
 * **`fleetDb` only, and every statement carries its own predicate.** `bms_tenant`
 * holds SELECT only on the table (migration `0142`), and `bms_fleet` bypasses
 * row security, so nothing but the `WHERE` bounds a statement: each one names
 * the gateway id, and each write to `bms.rtus` also names the gateway's
 * organization. Audit rows are platform rows (`organizationId: null`, plan
 * P12 a) written on the same transaction.
 *
 * **The token** (decision 5, §9.6) is 256 random bits, returned once by
 * `mintToken` and never stored, logged or audited: the table holds its SHA-256
 * and its last four characters, and no audit payload names either.
 *
 * **One writer per RTU** (decision 6, `F4.59`). An assignment never writes
 * `assets.meta.telemetrySource`. It is refused (409) for an RTU the cloud plan
 * could not hand to the edge — inactive, ingest not enabled, its organization's
 * ingest switch off, no `rtu_code`, a protocol with no adapter
 * (`INGEST_WIRED_PROTOCOLS`) — and for one whose assets the simulator feeds,
 * which would otherwise be served by the simulator while the receiver counted
 * the edge's samples as foreign. Revoke unassigns the gateway's RTUs in its
 * own transaction (PR 2 security L2), so they return to the cloud plan rather
 * than going silent.
 */
@Injectable()
export class EdgeGatewaysAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Every gateway, by organization code then gateway code. */
  async list(jwt: JwtPayload): Promise<EdgeGatewaysListResponse> {
    await this.requireGlobalAdmin(jwt);
    const result = await this.fleetDb.execute(selectGateways(null));
    return rowsOf<GatewayRow>(result).map(toEdgeGatewayDto);
  }

  async create(jwt: JwtPayload, input: unknown): Promise<EdgeGatewayDto> {
    await this.requireGlobalAdmin(jwt);
    const body = parseBody(createEdgeGatewayBodySchema.safeParse(input));
    const locationId = body.locationId ?? null;
    const id = await translateConstraintErrors(
      () =>
        this.fleetDb.transaction(async (tx) => {
          const org = await tx.execute(sql`/* edge-gateways:org-exists */
            SELECT id FROM bms.organizations WHERE id = ${body.organizationId}`);
          if (rowsOf(org).length === 0) {
            throw new NotFoundException(ORGANIZATION_NOT_FOUND_MESSAGE);
          }
          if (locationId !== null) {
            await assertLocationInOrganization(tx, locationId, body.organizationId);
          }
          const inserted = await tx.execute(sql`/* edge-gateways:insert */
            INSERT INTO bms.edge_gateways (organization_id, location_id, code, name)
            VALUES (${body.organizationId}, ${locationId}, ${body.code}, ${body.name})
            RETURNING id`);
          const row = rowsOf<{ id: string }>(inserted)[0];
          if (!row) {
            throw new Error("E7.2: the gateway insert returned no row");
          }
          await this.audit.write(
            {
              actor: jwt,
              action: "master.edge_gateway.create",
              entityType: "edge_gateway",
              entityId: row.id,
              organizationId: null,
              payload: { code: body.code, name: body.name, organizationId: body.organizationId, locationId },
            },
            tx,
          );
          return row.id;
        }),
      {
        onUnique: () => new ConflictException(`An edge gateway with code "${body.code}" already exists in this organization`),
      },
    );
    return this.fetchOne(id);
  }

  /** Rename or move. A revoked gateway may still be renamed: the label is not the credential. */
  async update(jwt: JwtPayload, id: string, input: unknown): Promise<EdgeGatewayDto> {
    await this.requireGlobalAdmin(jwt);
    const gatewayId = parseId(id);
    const body = parseBody(updateEdgeGatewayBodySchema.safeParse(input));
    const fields = (["name", "locationId"] as const).filter((field) => body[field] !== undefined);
    if (fields.length === 0) {
      throw new BadRequestException("Name a name or a location to change");
    }
    await this.fleetDb.transaction(async (tx) => {
      const current = await lockGateway(tx, gatewayId);
      const locationId = body.locationId === undefined ? current.location_id : body.locationId;
      if (body.locationId !== undefined && body.locationId !== null) {
        await assertLocationInOrganization(tx, body.locationId, current.organization_id);
      }
      await tx.execute(sql`/* edge-gateways:update */
        UPDATE bms.edge_gateways
           SET name = ${body.name ?? current.name}, location_id = ${locationId}, updated_at = now()
         WHERE id = ${gatewayId} AND organization_id = ${current.organization_id}`);
      await this.audit.write(
        {
          actor: jwt,
          action: "master.edge_gateway.update",
          entityType: "edge_gateway",
          entityId: gatewayId,
          organizationId: null,
          payload: { code: current.code, fields },
        },
        tx,
      );
    });
    return this.fetchOne(gatewayId);
  }

  /**
   * Revoke is final. The hash stays, so the receiver answers the revoked
   * token `403 gateway-revoked` rather than `401`; the RTUs are unassigned in
   * this transaction and return to the cloud plan at its next reload.
   */
  async revoke(jwt: JwtPayload, id: string): Promise<EdgeGatewayDto> {
    await this.requireGlobalAdmin(jwt);
    const gatewayId = parseId(id);
    await this.fleetDb.transaction(async (tx) => {
      const current = await lockGateway(tx, gatewayId);
      if (current.status !== "active") {
        throw new ConflictException(GATEWAY_REVOKED_MESSAGE);
      }
      await tx.execute(sql`/* edge-gateways:revoke */
        UPDATE bms.edge_gateways SET status = 'revoked', updated_at = now()
         WHERE id = ${gatewayId} AND organization_id = ${current.organization_id} AND status = 'active'`);
      const unassigned = await tx.execute(sql`/* edge-gateways:unassign-all */
        UPDATE bms.rtus SET edge_gateway_id = NULL
         WHERE edge_gateway_id = ${gatewayId} AND organization_id = ${current.organization_id}
        RETURNING id`);
      await this.audit.write(
        {
          actor: jwt,
          action: "master.edge_gateway.revoke",
          entityType: "edge_gateway",
          entityId: gatewayId,
          organizationId: null,
          payload: { code: current.code, unassignedRtuIds: rowsOf<{ id: string }>(unassigned).map((r) => r.id).sort() },
        },
        tx,
      );
    });
    return this.fetchOne(gatewayId);
  }

  /**
   * Mints (or rotates) the gateway's token and returns it **once**. A second
   * mint replaces the first: the old hash is overwritten, so the old token
   * stops authenticating at once (the receiver re-checks the hash at commit).
   * The audit row names the gateway code and whether this was a rotation —
   * never the token, its hash or its last four.
   */
  async mintToken(jwt: JwtPayload, id: string): Promise<EdgeGatewayTokenResponse> {
    await this.requireGlobalAdmin(jwt);
    const gatewayId = parseId(id);
    const minted = mintGatewayToken();
    await this.fleetDb.transaction(async (tx) => {
      const current = await lockGateway(tx, gatewayId);
      if (current.status !== "active") {
        throw new ConflictException(GATEWAY_REVOKED_MESSAGE);
      }
      await tx.execute(sql`/* edge-gateways:mint */
        UPDATE bms.edge_gateways
           SET token_hash = decode(${minted.hash.toString("hex")}, 'hex'),
               token_last4 = ${minted.last4},
               token_rotated_at = now(),
               updated_at = now()
         WHERE id = ${gatewayId} AND organization_id = ${current.organization_id} AND status = 'active'`);
      await this.audit.write(
        {
          actor: jwt,
          action: current.has_token ? "master.edge_gateway.token.rotate" : "master.edge_gateway.token.mint",
          entityType: "edge_gateway",
          entityId: gatewayId,
          organizationId: null,
          payload: { code: current.code },
        },
        tx,
      );
    });
    return { gateway: await this.fetchOne(gatewayId), token: minted.token };
  }

  /**
   * Replaces the assigned set. Every RTU must be the gateway's organization's
   * (otherwise the same 404 as a missing one), carry an `rtu_code`, speak a
   * protocol with an ingest adapter, have no simulator-fed asset, and be on no
   * other gateway. `assets.meta.telemetrySource` is never written.
   */
  async replaceRtus(jwt: JwtPayload, id: string, input: unknown): Promise<EdgeGatewayDto> {
    await this.requireGlobalAdmin(jwt);
    const gatewayId = parseId(id);
    const body = parseBody(putEdgeGatewayRtusBodySchema.safeParse(input));
    const rtuIds = body.rtuIds.map((rtuId) => rtuId.toLowerCase());
    if (new Set(rtuIds).size !== rtuIds.length) {
      throw new BadRequestException("rtuIds names an RTU more than once");
    }
    await this.fleetDb.transaction(async (tx) => {
      const current = await lockGateway(tx, gatewayId);
      const organizationId = current.organization_id;
      const idArray = `{${rtuIds.join(",")}}`;
      const found = rowsOf<AssignCandidate>(
        await tx.execute(sql`/* edge-gateways:assign-candidates */
          SELECT r.id, r.rtu_code, coalesce(c.protocol, r.source_type) AS protocol, r.edge_gateway_id,
                 r.active, r.ingest_enabled, o.ingest_enabled AS organization_ingest_enabled,
                 EXISTS (
                   SELECT 1 FROM bms.assets a
                    WHERE a.rtu_id = r.id AND a.organization_id = r.organization_id
                      AND coalesce(a.meta->>'telemetrySource', 'sim') <> 'mqtt'
                 ) AS simulator_fed
            FROM bms.rtus r
            JOIN bms.organizations o ON o.id = r.organization_id
            LEFT JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id AND c.organization_id = r.organization_id
           WHERE r.id = ANY(${idArray}::uuid[]) AND r.organization_id = ${organizationId}
           ORDER BY r.id
             FOR UPDATE OF r`),
      );
      if (found.length !== rtuIds.length) {
        throw new NotFoundException(RTU_NOT_FOUND_MESSAGE);
      }
      if (current.status !== "active") {
        throw new ConflictException(GATEWAY_REVOKED_MESSAGE);
      }
      // The one-writer rule (decision 6) is checked here, at assignment, only. A later edit of the
      // RTU (ingest off, deactivate, protocol) or of its assets' `telemetrySource` is not yet
      // refused while `edge_gateway_id` is set (PR 6 security review L1; a follow-up backlog row).
      for (const rtu of found) {
        const refusal = assignmentRefusal(rtu, gatewayId);
        if (refusal !== null) {
          throw new ConflictException(refusal);
        }
      }
      const removed = await tx.execute(sql`/* edge-gateways:unassign-rest */
        UPDATE bms.rtus SET edge_gateway_id = NULL
         WHERE edge_gateway_id = ${gatewayId} AND organization_id = ${organizationId}
           AND NOT (id = ANY(${idArray}::uuid[]))
        RETURNING id`);
      const added = await tx.execute(sql`/* edge-gateways:assign */
        UPDATE bms.rtus SET edge_gateway_id = ${gatewayId}
         WHERE id = ANY(${idArray}::uuid[]) AND organization_id = ${organizationId}
           AND edge_gateway_id IS DISTINCT FROM ${gatewayId}::uuid
        RETURNING id`);
      await this.audit.write(
        {
          actor: jwt,
          action: "master.edge_gateway.rtus.replace",
          entityType: "edge_gateway",
          entityId: gatewayId,
          organizationId: null,
          payload: {
            code: current.code,
            added: rowsOf<{ id: string }>(added).map((r) => r.id).sort(),
            removed: rowsOf<{ id: string }>(removed).map((r) => r.id).sort(),
          },
        },
        tx,
      );
    });
    return this.fetchOne(gatewayId);
  }

  private async fetchOne(id: string): Promise<EdgeGatewayDto> {
    const [row] = rowsOf<GatewayRow>(await this.fleetDb.execute(selectGateways(id)));
    if (!row) {
      throw new NotFoundException(GATEWAY_NOT_FOUND_MESSAGE);
    }
    return toEdgeGatewayDto(row);
  }

  /** Global admin, by the `bms.users` role. */
  private async requireGlobalAdmin(jwt: JwtPayload): Promise<void> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);
  }
}

/** A token: `bmsgw_` + 256 random bits as base64url (43 characters), its SHA-256 and its last four. */
export function mintGatewayToken(): { token: string; hash: Buffer; last4: string } {
  const token = `bmsgw_${randomBytes(32).toString("base64url")}`;
  if (!UPLINK_TOKEN_PATTERN.test(token)) {
    // Unreachable for 32 bytes; a guard against a changed pattern, never echoing the value.
    throw new Error("E7.2: a minted token does not match UPLINK_TOKEN_PATTERN");
  }
  // SHA-256 of the UTF-8 token: what `apps/ingest/src/host/uplink-gateways.ts` `hashToken` compares.
  return { token, hash: createHash("sha256").update(token, "utf8").digest(), last4: token.slice(-4) };
}

/** Why one RTU may not be assigned to `gatewayId`, or `null`. Pure; exported for the gates spec. */
export function assignmentRefusal(rtu: AssignCandidate, gatewayId: string): string | null {
  // `apps/ingest/src/host/bindings.ts` plans only `r.active AND r.ingest_enabled`, and skips an
  // organization whose switch is off; the receiver drops an unplanned RTU's samples as foreign.
  if (!rtu.active) {
    return RTU_INACTIVE_MESSAGE;
  }
  if (!rtu.ingest_enabled) {
    return RTU_INGEST_DISABLED_MESSAGE;
  }
  if (!rtu.organization_ingest_enabled) {
    return ORGANIZATION_INGEST_DISABLED_MESSAGE;
  }
  if (rtu.rtu_code === null || rtu.rtu_code === "") {
    return RTU_NO_CODE_MESSAGE;
  }
  if (!(INGEST_WIRED_PROTOCOLS as readonly string[]).includes(rtu.protocol)) {
    return RTU_NO_ADAPTER_MESSAGE;
  }
  if (rtu.simulator_fed) {
    return RTU_SIMULATOR_FED_MESSAGE;
  }
  if (rtu.edge_gateway_id !== null && rtu.edge_gateway_id !== gatewayId) {
    return RTU_OTHER_GATEWAY_MESSAGE;
  }
  return null;
}

/** The row → DTO map: every field by name, so a column added to the select cannot reach the wire. */
export function toEdgeGatewayDto(row: GatewayRow): EdgeGatewayDto {
  const rtus = (row.rtus ?? []).map((rtu) => ({
    id: rtu.id,
    code: rtu.code,
    rtuCode: rtu.rtuCode,
    displayName: rtu.displayName,
  }));
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationCode: row.organization_code,
    organizationName: row.organization_name,
    locationId: row.location_id,
    locationName: row.location_name,
    code: row.code,
    name: row.name,
    status: row.status as EdgeGatewayStatus,
    tokenLast4: row.token_last4,
    tokenRotatedAt: isoOrNull(row.token_rotated_at),
    lastSeenAt: isoOrNull(row.last_seen_at),
    reportedBacklog: row.reported_backlog === null ? null : Number(row.reported_backlog),
    clockState: row.clock_state as EdgeGatewayClockState | null,
    rtuCount: rtus.length,
    rtus,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** The list (`id === null`) or one gateway. `token_hash` is never selected. */
function selectGateways(id: string | null): SQL {
  const where = id === null ? sql`` : sql`WHERE g.id = ${id}`;
  const tag = id === null ? sql.raw("/* edge-gateways:select-all */") : sql.raw("/* edge-gateways:select-one */");
  return sql`${tag}
    SELECT g.id, g.organization_id, o.code AS organization_code, o.name AS organization_name,
           g.location_id, l.name AS location_name, g.code, g.name, g.status,
           g.token_last4, g.token_rotated_at, g.last_seen_at, g.reported_backlog, g.clock_state,
           g.created_at, g.updated_at,
           coalesce(
             json_agg(
               json_build_object('id', r.id, 'code', r.code, 'rtuCode', r.rtu_code, 'displayName', r.display_name)
               ORDER BY r.code
             ) FILTER (WHERE r.id IS NOT NULL),
             '[]'::json
           ) AS rtus
      FROM bms.edge_gateways g
      JOIN bms.organizations o ON o.id = g.organization_id
      LEFT JOIN bms.locations l ON l.id = g.location_id AND l.organization_id = g.organization_id
      LEFT JOIN bms.rtus r ON r.edge_gateway_id = g.id AND r.organization_id = g.organization_id
      ${where}
     GROUP BY g.id, o.code, o.name, l.name
     ORDER BY o.code, g.code`;
}

/** Locks one gateway for a write; 404 when it does not exist. */
async function lockGateway(tx: Executor, id: string): Promise<LockedGateway> {
  const [row] = rowsOf<LockedGateway>(
    await tx.execute(sql`/* edge-gateways:lock */
      SELECT id, organization_id, location_id, code, name, status, token_hash IS NOT NULL AS has_token
        FROM bms.edge_gateways WHERE id = ${id}
         FOR UPDATE`),
  );
  if (!row) {
    throw new NotFoundException(GATEWAY_NOT_FOUND_MESSAGE);
  }
  return row;
}

async function assertLocationInOrganization(tx: Executor, locationId: string, organizationId: string): Promise<void> {
  const found = await tx.execute(sql`/* edge-gateways:location-in-org */
    SELECT id FROM bms.locations WHERE id = ${locationId} AND organization_id = ${organizationId}`);
  if (rowsOf(found).length === 0) {
    throw new NotFoundException(LOCATION_NOT_FOUND_MESSAGE);
  }
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function parseId(id: string): string {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    throw new BadRequestException("Not an edge gateway id");
  }
  return parsed.data.toLowerCase();
}

/** A refused body is a 400 with the flattened issues — the `MqttPayloadFormatsAdminService` idiom. */
function parseBody<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}
