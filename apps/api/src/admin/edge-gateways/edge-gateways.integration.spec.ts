import { createHash } from "node:crypto";

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { edgeGatewaysListResponseSchema, UPLINK_TOKEN_PATTERN } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { EdgeGatewaysAdminService } from "./edge-gateways.service";
import {
  GATEWAY_REVOKED_MESSAGE,
  LOCATION_NOT_FOUND_MESSAGE,
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
 * `E7.2` / ADR 0123 decisions 5, 6 and 12 (plan T6.2) — the edge gateway admin
 * against a real Postgres, on the real roles (the wrapper builds them): the
 * service on `bms_fleet`, access control on `bms_auth`, audit on both pools.
 * Every row a case writes is a gateway the case created (its id pushed to
 * `gatewayIds` before it asserts) or a fixture the wrapper made with the run's
 * `e72gw-<stamp>` code; the wrapper deletes them, and their audit rows, in
 * `afterAll`.
 */
export type EdgeGatewayFixtures = {
  svc: EdgeGatewaysAdminService;
  observer: pg.Pool;
  stamp: string;
  organizationId: string;
  locationId: string;
  /** A location of another organization. */
  foreignLocationId: string;
  /** RTUs of the organization: two the edge may serve, then one of each refusal. */
  rtus: {
    ok1: string;
    ok2: string;
    noCode: string;
    modbus: string;
    simulatorFed: string;
    /** An RTU of another organization. */
    foreign: string;
    /** `active = false`: the cloud plan never reads it. */
    inactive: string;
    /** `ingest_enabled = false`: the cloud plan never reads it. */
    ingestOff: string;
  };
  /** A fixture organization of this run with `ingest_enabled = false`, one location and one RTU. */
  switchedOff: { organizationId: string; rtuId: string };
  /** The `mqtt` asset on `ok1`, whose `meta` an assignment must leave as it was. */
  ok1AssetId: string;
  gatewayIds: string[];
};

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

const sha256Hex = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

async function auditRows(
  observer: pg.Pool,
  entityId: string,
): Promise<{ action: string; organization_id: string | null; payload: unknown }[]> {
  const { rows } = await observer.query(
    "SELECT action, organization_id, payload FROM bms.audit_log WHERE entity_id = $1 ORDER BY created_at, action",
    [entityId],
  );
  return rows as { action: string; organization_id: string | null; payload: unknown }[];
}

async function gatewayCount(observer: pg.Pool, organizationId: string, code: string): Promise<number> {
  const { rows } = await observer.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.edge_gateways WHERE organization_id = $1 AND code = $2",
    [organizationId, code],
  );
  return rows[0]?.n ?? 0;
}

async function create(ctx: EdgeGatewayFixtures, admin: JwtPayload, suffix: string): Promise<string> {
  const created = await ctx.svc.create(admin, {
    organizationId: ctx.organizationId,
    locationId: ctx.locationId,
    code: `e72gw-${ctx.stamp}-${suffix}`,
    name: `E7.2 gateway ${suffix}`,
  });
  ctx.gatewayIds.push(created.id);
  return created.id;
}

/** I1 — an `organization_admin` and a `location_admin` get 403 on every route, the read included, and write nothing. */
export async function assertEveryRouteIsTheGlobalAdmins(
  ctx: EdgeGatewayFixtures,
  admin: JwtPayload,
  refused: readonly JwtPayload[],
): Promise<void> {
  const id = await create(ctx, admin, "gate");
  const code = `e72gw-${ctx.stamp}-refused`;
  for (const jwt of refused) {
    for (const run of [
      () => ctx.svc.list(jwt),
      () => ctx.svc.create(jwt, { organizationId: ctx.organizationId, code, name: "Refused" }),
      () => ctx.svc.update(jwt, id, { name: "Refused" }),
      () => ctx.svc.revoke(jwt, id),
      () => ctx.svc.mintToken(jwt, id),
      () => ctx.svc.replaceRtus(jwt, id, { rtuIds: [ctx.rtus.ok1] }),
    ]) {
      expect(await settle(run())).toBeInstanceOf(ForbiddenException);
    }
  }
  expect(await gatewayCount(ctx.observer, ctx.organizationId, code)).toBe(0);
  const { rows } = await ctx.observer.query(
    "SELECT name, status, token_hash FROM bms.edge_gateways WHERE id = $1",
    [id],
  );
  expect(rows).toEqual([{ name: "E7.2 gateway gate", status: "active", token_hash: null }]);
  expect((await auditRows(ctx.observer, id)).map((r) => r.action)).toEqual(["master.edge_gateway.create"]);
}

/** I2 — create writes one platform audit row; a duplicate code is 409, another organization's location 404, a bad body 400. */
export async function assertCreateIsAuditedAndRefusesDuplicates(ctx: EdgeGatewayFixtures, admin: JwtPayload): Promise<void> {
  const id = await create(ctx, admin, "create");
  const code = `e72gw-${ctx.stamp}-create`;
  const listed = await ctx.svc.list(admin);
  const row = listed.find((g) => g.id === id);
  expect(row).toMatchObject({
    code,
    organizationId: ctx.organizationId,
    locationId: ctx.locationId,
    status: "active",
    tokenLast4: null,
    tokenRotatedAt: null,
    rtuCount: 0,
    rtus: [],
  });
  expect(await auditRows(ctx.observer, id)).toEqual([
    {
      action: "master.edge_gateway.create",
      organization_id: null,
      payload: { code, name: "E7.2 gateway create", organizationId: ctx.organizationId, locationId: ctx.locationId },
    },
  ]);
  const duplicate = await settle(
    ctx.svc.create(admin, { organizationId: ctx.organizationId, code, name: "Again" }),
  );
  expect(duplicate).toBeInstanceOf(ConflictException);
  const foreignLocation = await settle(
    ctx.svc.create(admin, {
      organizationId: ctx.organizationId,
      locationId: ctx.foreignLocationId,
      code: `e72gw-${ctx.stamp}-misplaced`,
      name: "Misplaced",
    }),
  );
  expect(foreignLocation instanceof NotFoundException && foreignLocation.message).toBe(LOCATION_NOT_FOUND_MESSAGE);
  expect(await gatewayCount(ctx.observer, ctx.organizationId, `e72gw-${ctx.stamp}-misplaced`)).toBe(0);
  expect(await settle(ctx.svc.create(admin, { organizationId: ctx.organizationId, code: "has space", name: "x" }))).toBeInstanceOf(
    BadRequestException,
  );
}

/** I3 — rename and move; an empty patch is 400; the code never changes. */
export async function assertUpdateRenamesAndMoves(ctx: EdgeGatewayFixtures, admin: JwtPayload): Promise<void> {
  const id = await create(ctx, admin, "update");
  const renamed = await ctx.svc.update(admin, id, { name: "Renamed box", locationId: null });
  expect(renamed).toMatchObject({ name: "Renamed box", locationId: null, code: `e72gw-${ctx.stamp}-update` });
  expect(await settle(ctx.svc.update(admin, id, {}))).toBeInstanceOf(BadRequestException);
  expect(await settle(ctx.svc.update(admin, id, { locationId: ctx.foreignLocationId }))).toBeInstanceOf(NotFoundException);
  const audit = await auditRows(ctx.observer, id);
  expect(audit[1]).toEqual({
    action: "master.edge_gateway.update",
    organization_id: null,
    payload: { code: `e72gw-${ctx.stamp}-update`, fields: ["name", "locationId"] },
  });
}

/**
 * I4 — the mint returns a token on the uplink pattern once; the table holds only
 * its SHA-256 and last four; a second mint replaces it; neither the list JSON
 * nor any audit payload holds the token, its hash or its last four.
 */
export async function assertTheMintStoresOnlyTheHash(ctx: EdgeGatewayFixtures, admin: JwtPayload): Promise<void> {
  const id = await create(ctx, admin, "mint");
  const first = await ctx.svc.mintToken(admin, id);
  expect(first.token).toMatch(UPLINK_TOKEN_PATTERN);
  const stored = async () =>
    (
      await ctx.observer.query<{ hash: string; last4: string; rotated: Date | null }>(
        "SELECT encode(token_hash, 'hex') AS hash, token_last4 AS last4, token_rotated_at AS rotated FROM bms.edge_gateways WHERE id = $1",
        [id],
      )
    ).rows[0];
  expect(await stored()).toMatchObject({ hash: sha256Hex(first.token), last4: first.token.slice(-4) });
  expect((await stored())?.rotated).not.toBeNull();
  expect(first.gateway.tokenLast4).toBe(first.token.slice(-4));

  const second = await ctx.svc.mintToken(admin, id);
  expect(second.token).not.toBe(first.token);
  expect((await stored())?.hash).toBe(sha256Hex(second.token));
  const { rows: oldHash } = await ctx.observer.query(
    "SELECT 1 FROM bms.edge_gateways WHERE token_hash = decode($1, 'hex')",
    [sha256Hex(first.token)],
  );
  expect(oldHash, "a second mint replaces the first").toEqual([]);

  // Only this run's gateways: the database is shared, and another suite's rows are not this claim.
  const listed = (await ctx.svc.list(admin)).filter((g) => ctx.gatewayIds.includes(g.id));
  expect(listed.map((g) => g.id)).toContain(id);
  expect(edgeGatewaysListResponseSchema.safeParse(listed).success).toBe(true);
  const listText = JSON.stringify(listed);
  expect(listText).not.toMatch(/hash/i);
  for (const token of [first.token, second.token]) {
    expect(listText).not.toContain(token);
    expect(listText).not.toContain(sha256Hex(token));
  }

  const audit = await auditRows(ctx.observer, id);
  expect(audit.map((r) => r.action)).toEqual([
    "master.edge_gateway.create",
    "master.edge_gateway.token.mint",
    "master.edge_gateway.token.rotate",
  ]);
  for (const row of audit) {
    expect(row.organization_id).toBeNull();
    const text = JSON.stringify(row.payload);
    for (const token of [first.token, second.token]) {
      expect(text).not.toContain(token);
      expect(text).not.toContain(sha256Hex(token));
      expect(text).not.toContain(token.slice(-4));
    }
  }
}

/**
 * I5 — assignment: another organization's RTU is 404 naming no id; no `rtu_code`,
 * a protocol with no adapter, a simulator-fed asset and another gateway are each a
 * fixed 409; a replace assigns and unassigns; `assets.meta` is left as it was.
 */
export async function assertTheAssignmentRules(ctx: EdgeGatewayFixtures, admin: JwtPayload): Promise<void> {
  const id = await create(ctx, admin, "assign");
  const metaOf = async () =>
    (await ctx.observer.query<{ meta: unknown }>("SELECT meta FROM bms.assets WHERE id = $1", [ctx.ok1AssetId])).rows[0]?.meta;
  const metaBefore = await metaOf();
  const edgeOf = async (rtuId: string) =>
    (await ctx.observer.query<{ g: string | null }>("SELECT edge_gateway_id AS g FROM bms.rtus WHERE id = $1", [rtuId])).rows[0]?.g;

  const foreign = await settle(ctx.svc.replaceRtus(admin, id, { rtuIds: [ctx.rtus.ok1, ctx.rtus.foreign] }));
  expect(foreign instanceof NotFoundException && foreign.message).toBe(RTU_NOT_FOUND_MESSAGE);
  expect(JSON.stringify((foreign as NotFoundException).getResponse())).not.toContain(ctx.rtus.foreign);
  expect(await edgeOf(ctx.rtus.foreign)).toBeNull();
  expect(await edgeOf(ctx.rtus.ok1), "a refused replace writes nothing").toBeNull();

  for (const [rtuId, message] of [
    [ctx.rtus.noCode, RTU_NO_CODE_MESSAGE],
    [ctx.rtus.modbus, RTU_NO_ADAPTER_MESSAGE],
    [ctx.rtus.simulatorFed, RTU_SIMULATOR_FED_MESSAGE],
    // What `apps/ingest/src/host/bindings.ts` plans: `r.active AND r.ingest_enabled`.
    [ctx.rtus.inactive, RTU_INACTIVE_MESSAGE],
    [ctx.rtus.ingestOff, RTU_INGEST_DISABLED_MESSAGE],
  ] as const) {
    const refused = await settle(ctx.svc.replaceRtus(admin, id, { rtuIds: [rtuId] }));
    expect(refused instanceof ConflictException && refused.message, rtuId).toBe(message);
    expect(await edgeOf(rtuId)).toBeNull();
  }

  // An organization whose ingest switch is off (ADR 0115): the plan skips all of its RTUs.
  const offGateway = await ctx.svc.create(admin, {
    organizationId: ctx.switchedOff.organizationId,
    code: `e72gw-${ctx.stamp}-off`,
    name: "E7.2 gateway off",
  });
  ctx.gatewayIds.push(offGateway.id);
  const switchedOff = await settle(ctx.svc.replaceRtus(admin, offGateway.id, { rtuIds: [ctx.switchedOff.rtuId] }));
  expect(switchedOff instanceof ConflictException && switchedOff.message).toBe(ORGANIZATION_INGEST_DISABLED_MESSAGE);
  expect(await edgeOf(ctx.switchedOff.rtuId)).toBeNull();

  const assigned = await ctx.svc.replaceRtus(admin, id, { rtuIds: [ctx.rtus.ok1, ctx.rtus.ok2] });
  expect(assigned.rtus.map((r) => r.id).sort()).toEqual([ctx.rtus.ok1, ctx.rtus.ok2].sort());
  expect(assigned.rtuCount).toBe(2);
  expect(await edgeOf(ctx.rtus.ok1)).toBe(id);
  expect(await metaOf(), "the assignment leaves assets.meta.telemetrySource as it was (F4.59)").toEqual(metaBefore);

  // Another gateway may not take an RTU this one serves.
  const other = await create(ctx, admin, "other");
  const taken = await settle(ctx.svc.replaceRtus(admin, other, { rtuIds: [ctx.rtus.ok1] }));
  expect(taken instanceof ConflictException && taken.message).toBe(RTU_OTHER_GATEWAY_MESSAGE);

  const replaced = await ctx.svc.replaceRtus(admin, id, { rtuIds: [ctx.rtus.ok2] });
  expect(replaced.rtus.map((r) => r.id)).toEqual([ctx.rtus.ok2]);
  expect(await edgeOf(ctx.rtus.ok1)).toBeNull();
  const audit = (await auditRows(ctx.observer, id)).filter((r) => r.action === "master.edge_gateway.rtus.replace");
  expect(audit).toEqual([
    {
      action: "master.edge_gateway.rtus.replace",
      organization_id: null,
      payload: { code: `e72gw-${ctx.stamp}-assign`, added: [ctx.rtus.ok1, ctx.rtus.ok2].sort(), removed: [] },
    },
    {
      action: "master.edge_gateway.rtus.replace",
      organization_id: null,
      payload: { code: `e72gw-${ctx.stamp}-assign`, added: [], removed: [ctx.rtus.ok1] },
    },
  ]);
}

/** I6 — revoke is final and unassigns the RTUs; the hash stays so the receiver answers 403. */
export async function assertRevokeIsFinalAndUnassigns(ctx: EdgeGatewayFixtures, admin: JwtPayload): Promise<void> {
  const id = await create(ctx, admin, "revoke");
  const minted = await ctx.svc.mintToken(admin, id);
  await ctx.svc.replaceRtus(admin, id, { rtuIds: [ctx.rtus.ok1] });
  const revoked = await ctx.svc.revoke(admin, id);
  expect(revoked).toMatchObject({ status: "revoked", rtuCount: 0, rtus: [] });
  const { rows } = await ctx.observer.query<{ status: string; hash: string }>(
    "SELECT status, encode(token_hash, 'hex') AS hash FROM bms.edge_gateways WHERE id = $1",
    [id],
  );
  expect(rows).toEqual([{ status: "revoked", hash: sha256Hex(minted.token) }]);
  const { rows: rtu } = await ctx.observer.query("SELECT edge_gateway_id FROM bms.rtus WHERE id = $1", [ctx.rtus.ok1]);
  expect(rtu).toEqual([{ edge_gateway_id: null }]);

  for (const run of [
    () => ctx.svc.mintToken(admin, id),
    () => ctx.svc.revoke(admin, id),
    () => ctx.svc.replaceRtus(admin, id, { rtuIds: [ctx.rtus.ok1] }),
  ]) {
    const refused = await settle(run());
    expect(refused instanceof ConflictException && refused.message).toBe(GATEWAY_REVOKED_MESSAGE);
  }
  const { rows: after } = await ctx.observer.query<{ hash: string }>(
    "SELECT encode(token_hash, 'hex') AS hash FROM bms.edge_gateways WHERE id = $1",
    [id],
  );
  expect(after[0]?.hash, "a refused mint on a revoked gateway changes nothing").toBe(sha256Hex(minted.token));
  const audit = (await auditRows(ctx.observer, id)).filter((r) => r.action === "master.edge_gateway.revoke");
  expect(audit).toEqual([
    {
      action: "master.edge_gateway.revoke",
      organization_id: null,
      payload: { code: `e72gw-${ctx.stamp}-revoke`, unassignedRtuIds: [ctx.rtus.ok1] },
    },
  ]);
}
