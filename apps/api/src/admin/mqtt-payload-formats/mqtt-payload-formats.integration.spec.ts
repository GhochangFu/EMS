import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { MQTT_PAYLOAD_FORMAT_UNKNOWN_MESSAGE, type JwtPayload } from "@bms/shared";

import type { RtusAdminService } from "../rtus/rtus.service";
import type { MqttPayloadFormatsAdminService } from "./mqtt-payload-formats.service";
import { BUILTIN_FORMAT_DELETE_MESSAGE, BUILTIN_FORMAT_EDIT_MESSAGE, FORMAT_IN_USE_MESSAGE } from "./mqtt-payload-formats.service";

/**
 * `F4.334` / ADR 0116 decisions 4 and 5 (plan T3.1, T3.5, ruling Q5) — the
 * catalog service and the RTU format route against a real Postgres, on the
 * real roles (the wrapper builds them). Every row a case writes carries the
 * run's `f4334-<stamp>` code or is an RTU the wrapper created; the wrapper
 * deletes them, and their audit rows, in `afterAll`.
 */
export type MpfFixtures = {
  svc: MqttPayloadFormatsAdminService;
  rtus: RtusAdminService;
  observer: pg.Pool;
  stamp: string;
  /** An MQTT RTU of the organization admin's organization, with a `{}` connection row. */
  mqttRtuId: string;
  mqttRtuCode: string;
  /** An RTU with a `modbus_tcp` connection row. */
  modbusRtuId: string;
  /** An RTU with no connection row. */
  bareRtuId: string;
  organizationId: string;
  organizationCode: string;
  /** Format ids and session ids a case created, pushed before it asserts. */
  formatIds: string[];
  sessionIds: string[];
};

const DEFINITION = {
  kind: "declarative",
  root: "array",
  deviceKey: ["TagName"],
  time: { path: ["Timestamp"], unit: "epoch_s" },
  readings: [
    { key: "treated_water_flow_klh", register: { path: ["Data"], index: 0, type: "float32" } },
    { key: "outlet_flow_totalizer_kl", register: { path: ["Data"], index: 3, type: "float32" } },
  ],
};

const BCPL_SAMPLE = JSON.stringify([
  { Data: [16294, 26214, 81, 18230, 9202, 113, 17852, -17809, 177, 82], Timestamp: "1794077986", TagName: "BCPL_LAKWA_02" },
]);

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

async function auditActions(observer: pg.Pool, entityId: string): Promise<{ action: string; organization_id: string | null; payload: unknown }[]> {
  const { rows } = await observer.query(
    `SELECT action, organization_id, payload FROM bms.audit_log WHERE entity_id = $1 ORDER BY created_at, action`,
    [entityId],
  );
  return rows as { action: string; organization_id: string | null; payload: unknown }[];
}

/** I0 — a master-data user reads the two seeded rows; the built-in is flagged. */
export async function assertTheSeededRowsAreReadable(ctx: MpfFixtures, tenantAdmin: JwtPayload): Promise<void> {
  const listed = await ctx.svc.list(tenantAdmin);
  const codes = listed.map((row) => row.code);
  expect(codes).toContain("thinkiot-envelope");
  expect(codes).toContain("thinkiot-register-array");
  expect(listed[0]?.builtin, "the built-in row is listed first").toBe(true);
  const builtin = await ctx.svc.getByCode(tenantAdmin, "thinkiot-envelope");
  expect(builtin.builtin).toBe(true);
  expect(builtin.definition).toEqual({ kind: "builtin", name: "thinkiot-envelope" });
  expect(await settle(ctx.svc.getByCode(tenantAdmin, "no-such-format"))).toBeInstanceOf(NotFoundException);
}

/** I1, I2 — the global admin creates (one org-less audit row, no definition); a tenant admin cannot. */
export async function assertCreateIsTheGlobalAdminsAndAudited(ctx: MpfFixtures, admin: JwtPayload, tenantAdmin: JwtPayload): Promise<void> {
  const code = `f4334-${ctx.stamp}-a`;
  const refused = await settle(ctx.svc.create(tenantAdmin, { code, name: "Refused", definition: DEFINITION }));
  expect(refused).toBeInstanceOf(ForbiddenException);
  const { rows: none } = await ctx.observer.query("SELECT 1 FROM bms.mqtt_payload_formats WHERE code = $1", [code]);
  expect(none).toEqual([]);

  const created = await ctx.svc.create(admin, { code, name: "Acme array", definition: DEFINITION });
  ctx.formatIds.push(created.id);
  expect(created).toMatchObject({ code, name: "Acme array", description: "", builtin: false });
  expect(created.updatedBy).not.toBeNull();
  const audit = await auditActions(ctx.observer, created.id);
  expect(audit).toEqual([
    { action: "master.mqtt_payload_format.create", organization_id: null, payload: { code, name: "Acme array" } },
  ]);

  expect(await settle(ctx.svc.create(admin, { code, name: "Again", definition: DEFINITION }))).toBeInstanceOf(ConflictException);
  const builtinKind = { code: `f4334-${ctx.stamp}-b`, name: "Builtin", definition: { kind: "builtin", name: "thinkiot-envelope" } };
  expect(await settle(ctx.svc.create(admin, builtinKind))).toBeInstanceOf(BadRequestException);
}

/** I3 — an edit moves `updated_at` and is audited; the built-in row refuses edit and delete. */
export async function assertUpdateAndTheBuiltinRow(ctx: MpfFixtures, admin: JwtPayload): Promise<void> {
  const code = `f4334-${ctx.stamp}-c`;
  const created = await ctx.svc.create(admin, { code, name: "To edit", definition: DEFINITION });
  ctx.formatIds.push(created.id);
  const updated = await ctx.svc.update(admin, code, { description: "edited" });
  expect(updated.description).toBe("edited");
  expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  const audit = await auditActions(ctx.observer, created.id);
  expect(audit.map((row) => row.action)).toEqual(["master.mqtt_payload_format.create", "master.mqtt_payload_format.update"]);
  expect(audit[1]?.payload).toEqual({ code, fields: ["description"] });

  const edit = await settle(ctx.svc.update(admin, "thinkiot-envelope", { description: "x" }));
  expect(edit instanceof ConflictException && edit.message).toBe(BUILTIN_FORMAT_EDIT_MESSAGE);
  const remove = await settle(ctx.svc.remove(admin, "thinkiot-envelope"));
  expect(remove instanceof ConflictException && remove.message).toBe(BUILTIN_FORMAT_DELETE_MESSAGE);
}

/**
 * I4 + T3.5 — the RTU route sets and clears the key; a format an RTU or an open
 * draft names cannot be deleted, and the 409 lists them (ruling Q5).
 */
export async function assertInUseFormatsCannotBeDeleted(ctx: MpfFixtures, admin: JwtPayload, tenantAdmin: JwtPayload): Promise<void> {
  const code = `f4334-${ctx.stamp}-d`;
  const created = await ctx.svc.create(admin, { code, name: "In use", definition: DEFINITION });
  ctx.formatIds.push(created.id);

  // The RTU route: an organization admin may set its own RTU's format.
  const set = await ctx.rtus.setPayloadFormat(tenantAdmin, ctx.mqttRtuId, { payloadFormat: code });
  expect(set.payloadFormat).toBe(code);
  const { rows: stored } = await ctx.observer.query<{ code: string | null }>(
    "SELECT config->>'payloadFormat' AS code FROM bms.rtu_connection_configs WHERE rtu_id = $1",
    [ctx.mqttRtuId],
  );
  expect(stored).toEqual([{ code }]);
  const rtuAudit = (await auditActions(ctx.observer, ctx.mqttRtuId)).filter((row) => row.action === "master.rtu.payload_format.update");
  expect(rtuAudit).toEqual([
    { action: "master.rtu.payload_format.update", organization_id: ctx.organizationId, payload: { from: null, to: code } },
  ]);

  const byRtu = await settle(ctx.svc.remove(admin, code));
  expect(byRtu).toBeInstanceOf(ConflictException);
  expect((byRtu as ConflictException).getResponse()).toEqual({
    message: FORMAT_IN_USE_MESSAGE,
    rtus: [{ rtuCode: ctx.mqttRtuCode, organizationCode: ctx.organizationCode }],
    drafts: [],
  });

  // `null` removes the key — never stores a null (ingest would refuse the config).
  const cleared = await ctx.rtus.setPayloadFormat(tenantAdmin, ctx.mqttRtuId, { payloadFormat: null });
  expect(cleared.payloadFormat).toBeNull();
  const { rows: after } = await ctx.observer.query<{ has: boolean }>(
    "SELECT config ? 'payloadFormat' AS has FROM bms.rtu_connection_configs WHERE rtu_id = $1",
    [ctx.mqttRtuId],
  );
  expect(after).toEqual([{ has: false }]);

  const { rows: session } = await ctx.observer.query<{ id: string }>(
    `INSERT INTO bms.onboarding_sessions (organization_id, status, draft)
     VALUES ($1, 'draft', $2::jsonb) RETURNING id`,
    [ctx.organizationId, JSON.stringify({ rtus: [{ code: "X", protocol: "mqtt", config: { payloadFormat: code } }] })],
  );
  const sessionId = session[0]?.id as string;
  ctx.sessionIds.push(sessionId);
  const byDraft = await settle(ctx.svc.remove(admin, code));
  expect((byDraft as ConflictException).getResponse()).toEqual({
    message: FORMAT_IN_USE_MESSAGE,
    rtus: [],
    drafts: [{ sessionId, organizationCode: ctx.organizationCode }],
  });

  await ctx.observer.query("UPDATE bms.onboarding_sessions SET status = 'abandoned' WHERE id = $1", [sessionId]);
  await ctx.svc.remove(admin, code);
  const { rows: gone } = await ctx.observer.query("SELECT 1 FROM bms.mqtt_payload_formats WHERE code = $1", [code]);
  expect(gone).toEqual([]);
  expect((await auditActions(ctx.observer, created.id)).map((row) => row.action)).toEqual([
    "master.mqtt_payload_format.create",
    "master.mqtt_payload_format.delete",
  ]);
}

/** T3.5 — the RTU route's refusals: unknown code 409, non-MQTT 400, no connection row 404. */
export async function assertTheRtuRouteRefusals(ctx: MpfFixtures, tenantAdmin: JwtPayload): Promise<void> {
  const unknown = await settle(ctx.rtus.setPayloadFormat(tenantAdmin, ctx.mqttRtuId, { payloadFormat: "no-such-format" }));
  expect(unknown instanceof ConflictException && unknown.message).toBe(MQTT_PAYLOAD_FORMAT_UNKNOWN_MESSAGE);
  const modbus = await settle(ctx.rtus.setPayloadFormat(tenantAdmin, ctx.modbusRtuId, { payloadFormat: "thinkiot-register-array" }));
  expect(modbus).toBeInstanceOf(BadRequestException);
  const bare = await settle(ctx.rtus.setPayloadFormat(tenantAdmin, ctx.bareRtuId, { payloadFormat: "thinkiot-register-array" }));
  expect(bare).toBeInstanceOf(NotFoundException);
}

/** I5 — the test route decodes the sample and writes no audit row. */
export async function assertTheTestRouteWritesNothing(ctx: MpfFixtures, admin: JwtPayload): Promise<void> {
  const { rows: before } = await ctx.observer.query<{ n: string }>(
    "SELECT count(*) AS n FROM bms.audit_log WHERE action LIKE 'master.mqtt_payload_format.%'",
  );
  const answer = await ctx.svc.test(admin, { definition: DEFINITION, topic: "BCPL/LAKWA", sample: BCPL_SAMPLE });
  expect(answer.records[0]?.values).toEqual({
    treated_water_flow_klh: 1.2999999523162842,
    outlet_flow_totalizer_kl: 46627.9453125,
  });
  const { rows: after } = await ctx.observer.query<{ n: string }>(
    "SELECT count(*) AS n FROM bms.audit_log WHERE action LIKE 'master.mqtt_payload_format.%'",
  );
  expect(after[0]?.n).toBe(before[0]?.n);
}
