import { ForbiddenException, Logger } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { expect, vi } from "vitest";

import type { JwtPayload, MqttPayloadFormatDto } from "@bms/shared";

import { MqttPayloadFormatsAdminService } from "../../admin/mqtt-payload-formats/mqtt-payload-formats.service";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { CopilotToolContext } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { DECODE_PAYLOAD_SAMPLE_MAX } from "./decode-payload-sample.tool";
import { COPILOT_PAYLOAD_FORMATS_ROLE_REFUSAL } from "./list-payload-formats.tool";

/**
 * `F4.334` PR 5 (ADR 0099 Amendment 17 decisions 2 and 3) — `list_payload_formats` and
 * `decode_payload_sample` over a fake `MqttPayloadFormatsAdminService` (the decode runs the real
 * service's `test`, so the BCPL golden sample goes through the real decoder): global admin only,
 * refused before any read; the RTU counts are read only inside the turn's allowed organizations;
 * no definition body in the list; a decode answers device keys, times and readings, or schema
 * issues that never echo a value; a sample over 16 KiB is refused by the schema; nothing logs it.
 * Mutation, applied once and seen red: drop the role check in `decode_payload_sample`
 * ({@link aTenantAdministratorIsRefusedBothTools}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";

/** The `thinkiot-register-array` definition (the BCPL pilot, ADR 0116). */
export const BCPL_DEFINITION = {
  kind: "declarative",
  root: "array",
  deviceKey: ["TagName"],
  time: { path: ["Timestamp"], unit: "epoch_s" },
  readings: [
    { key: "treated_water_flow_klh", register: { path: ["Data"], index: 0, type: "float32" } },
    { key: "outlet_flow_totalizer_kl", register: { path: ["Data"], index: 3, type: "float32" } },
  ],
};
const BCPL_SAMPLE =
  '[{"Data":[16294,26214,81,18230,9202,113,17852,-17809,177,82],"Timestamp":"1794077986","TagName":"BCPL_LAKWA_02"}]';

function ctx(role: string, allowed: readonly string[] = [ORG_X, ORG_Y]): CopilotToolContext {
  return {
    identity: { id: USER, role, organizationId: role === "admin" ? null : ORG_X } as ResolvedIdentity,
    user: { sub: USER, role } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-11-08T06:00:00Z"),
  };
}

function format(code: string, builtin = false): MqttPayloadFormatDto {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(code.length).padStart(12, "0")}`,
    code,
    name: `Name ${code}`,
    description: `About ${code}`,
    definition: builtin ? { kind: "builtin", name: "thinkiot-envelope" } : (BCPL_DEFINITION as MqttPayloadFormatDto["definition"]),
    builtin,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    updatedBy: null,
  };
}

/** A service whose pools throw if touched; `role` is the `bms.users` role its gate reads. */
function realService(role: string): MqttPayloadFormatsAdminService {
  const untouched = new Proxy({}, { get: (_t, key) => { throw new Error(`the database was reached (${String(key)})`); } });
  const accessControl = {
    requireMasterDataUser: async () => ({ id: USER, role }),
    assertAdminRole: (r: string) => {
      if (r !== "admin") throw new ForbiddenException("global admin only");
    },
  };
  return new MqttPayloadFormatsAdminService(untouched as never, accessControl as never, {} as never, untouched as never);
}

function fake(items: unknown[], counts: Record<string, number> = {}) {
  const calls: string[] = [];
  const counted: Array<readonly string[]> = [];
  const decoder = realService("admin");
  const services = {
    mqttPayloadFormats: {
      list: async () => {
        calls.push("list");
        return items;
      },
      rtuCountsInOrganizations: async (_jwt: JwtPayload, organizationIds: readonly string[]) => {
        calls.push("count");
        counted.push(organizationIds);
        return { counts, organizationIds: [...organizationIds] };
      },
      test: async (jwt: JwtPayload, input: unknown) => {
        calls.push("test");
        return decoder.test(jwt, input);
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), calls, counted };
}

const ADMIN = ctx("admin");

/** Each format's code, name, description, builtin and rtuCount; no definition body; the counted organizations named. */
export async function listsEveryFormatWithItsScopedRtuCount(): Promise<void> {
  const { tools, counted } = fake([format("thinkiot-envelope", true), format("thinkiot-register-array")], { "thinkiot-register-array": 21 });
  const out = await tools.dispatch("list_payload_formats", {}, ADMIN);
  expect(out).toEqual({
    ok: true,
    result: {
      truncated: false,
      items: [
        { code: "thinkiot-envelope", name: "Name thinkiot-envelope", description: "About thinkiot-envelope", builtin: true, rtuCount: 0 },
        { code: "thinkiot-register-array", name: "Name thinkiot-register-array", description: "About thinkiot-register-array", builtin: false, rtuCount: 21 },
      ],
    },
    organizationIds: [ORG_X, ORG_Y],
  });
  // The count is asked for the turn's allowed organizations only — never a fleet-wide read.
  expect(counted).toEqual([[ORG_X, ORG_Y]]);
}

/** `code` returns that one format with its definition. */
export async function aCodeReturnsOneFormatWithItsDefinition(): Promise<void> {
  const { tools } = fake([format("thinkiot-envelope", true), format("thinkiot-register-array")], { "thinkiot-register-array": 2 });
  const out = await tools.dispatch("list_payload_formats", { code: "thinkiot-register-array" }, ctx("admin", [ORG_X]));
  if (!out.ok) throw new Error(out.error);
  expect(out.result.items).toEqual([
    {
      code: "thinkiot-register-array",
      name: "Name thinkiot-register-array",
      description: "About thinkiot-register-array",
      builtin: false,
      rtuCount: 2,
      // The stored contract's parse fills the schema's word and byte order defaults.
      definition: { ...BCPL_DEFINITION, wordOrder: "big", byteOrder: "big" },
    },
  ]);
  expect(out.organizationIds).toEqual([ORG_X]);
}

/** Global admin only: every other role is refused both tools, and nothing is read or decoded. */
export async function aTenantAdministratorIsRefusedBothTools(): Promise<void> {
  for (const role of ["organization_admin", "location_admin", "asset_group_admin", "operator"]) {
    const { tools, calls } = fake([format("thinkiot-envelope", true)]);
    expect(await tools.dispatch("list_payload_formats", {}, ctx(role)), role).toEqual({ ok: false, error: COPILOT_PAYLOAD_FORMATS_ROLE_REFUSAL });
    expect(
      await tools.dispatch("decode_payload_sample", { definition: BCPL_DEFINITION, sample: BCPL_SAMPLE }, ctx(role)),
      role,
    ).toEqual({ ok: false, error: COPILOT_PAYLOAD_FORMATS_ROLE_REFUSAL });
    expect(calls, role).toEqual([]);
  }
}

/** The stored rows go through the guarded parse: a row off its contract throws, never passes through. */
export async function theServicesRowsAreParsed(): Promise<void> {
  await expect(fake([{ code: 7 }]).tools.dispatch("list_payload_formats", {}, ADMIN)).rejects.toThrow();
}

/** The BCPL golden sample decodes to the pilot's two readings (the real decoder, through the service's `test`). */
export async function theBcplGoldenSampleDecodes(): Promise<void> {
  const { tools, calls } = fake([]);
  const out = await tools.dispatch("decode_payload_sample", { definition: BCPL_DEFINITION, sample: BCPL_SAMPLE }, ADMIN);
  expect(out).toEqual({
    ok: true,
    result: {
      valid: true,
      decoded: true,
      truncated: false,
      records: [
        {
          deviceKey: "BCPL_LAKWA_02",
          at: new Date(1794077986 * 1000).toISOString(),
          values: { treated_water_flow_klh: 1.2999999523162842, outlet_flow_totalizer_kl: 46627.9453125 },
        },
      ],
    },
    organizationIds: [],
  });
  // It decodes and writes nothing: no list, no count, no audit (the service's `test` writes none).
  expect(calls).toEqual(["test"]);
}

/** A sample the definition cannot read answers `decoded: false` and the decoder's fixed reason. */
export async function anUndecodableSampleAnswersTheReason(): Promise<void> {
  const out = await fake([]).tools.dispatch("decode_payload_sample", { definition: BCPL_DEFINITION, sample: "not json at all" }, ADMIN);
  if (!out.ok) throw new Error(out.error);
  expect(out.result).toMatchObject({ valid: true, decoded: false, records: [] });
  expect(typeof out.result.reason).toBe("string");
}

/** A bad definition answers its issues as paths and fixed messages — never a value the user wrote. */
export async function aBadDefinitionAnswersIssuesWithoutEchoingValues(): Promise<void> {
  const { tools, calls } = fake([]);
  const bad = {
    ...BCPL_DEFINITION,
    root: "SECRET_ROOT_VALUE",
    readings: [{ key: "k", register: { path: ["Data"], index: 0, type: "SECRET_TYPE_VALUE" } }],
  };
  const out = await tools.dispatch("decode_payload_sample", { definition: bad, sample: BCPL_SAMPLE }, ADMIN);
  if (!out.ok) throw new Error(out.error);
  expect(out.result.valid).toBe(false);
  const issues = out.result.issues as Array<{ path: string; message: string }>;
  expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["root", "readings.0.register.type"]));
  const text = JSON.stringify(out.result);
  expect(text).not.toContain("SECRET_ROOT_VALUE");
  expect(text).not.toContain("SECRET_TYPE_VALUE");
  expect(text).not.toContain("BCPL_LAKWA_02");
  // A refused definition never reaches the decoder.
  expect(calls).toEqual([]);
  // A kind that is neither shape is one issue at `kind`.
  const kind = await tools.dispatch("decode_payload_sample", { definition: { kind: "SECRET_KIND" }, sample: "{}" }, ADMIN);
  if (!kind.ok) throw new Error(kind.error);
  expect(kind.result.issues).toEqual([{ path: "kind", message: 'must be one of "builtin", "declarative", "binary"' }]);
}

/** The input is strict: a definition, a sample of at most 16 KiB and a topic of at most 255 — no credential field. */
export function theSchemaBoundsTheSampleAndTakesNoCredential(): void {
  const schema = fake([]).tools.registry.schemas.decode_payload_sample!;
  expect(DECODE_PAYLOAD_SAMPLE_MAX).toBe(16_384);
  expect(schema.safeParse({ definition: BCPL_DEFINITION, sample: "x".repeat(16_384) }).success).toBe(true);
  expect(schema.safeParse({ definition: BCPL_DEFINITION, sample: "x".repeat(16_385) }).success).toBe(false);
  expect(schema.safeParse({ definition: BCPL_DEFINITION, sample: "{}", topic: "t".repeat(256) }).success).toBe(false);
  expect(schema.safeParse({ definition: BCPL_DEFINITION, sample: "{}", password: "p" }).success).toBe(false);
  const definition = fake([]).tools.registry.definitions.find((d) => d.name === "decode_payload_sample");
  expect(Object.keys((definition?.parameters as { properties: Record<string, unknown> }).properties).sort()).toEqual(["definition", "sample", "topic"]);
}

/** `list_payload_formats` takes only an optional `code` (strict). */
export function theListTakesOnlyACode(): void {
  const definition = fake([]).tools.registry.definitions.find((d) => d.name === "list_payload_formats");
  expect(definition?.parameters).toMatchObject({ type: "object", additionalProperties: false });
  expect(Object.keys((definition?.parameters as { properties: Record<string, unknown> }).properties)).toEqual(["code"]);
}

/** §9.6: a decode logs nothing — no line carries the sample, its device key or a register value. */
export async function aDecodeLogsNoSample(): Promise<void> {
  const lines: unknown[][] = [];
  const spies = [
    ...(["log", "warn", "error", "debug", "verbose", "fatal"] as const).map((level) =>
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void lines.push(args)),
    ),
    ...(["log", "warn", "error", "debug", "verbose", "fatal"] as const).map((level) =>
      vi.spyOn(Logger, level).mockImplementation((...args: unknown[]) => void lines.push(args)),
    ),
    ...(["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args)),
    ),
  ];
  try {
    const { tools } = fake([]);
    await tools.dispatch("decode_payload_sample", { definition: BCPL_DEFINITION, sample: BCPL_SAMPLE }, ADMIN);
    await tools.dispatch("decode_payload_sample", { definition: { kind: "x" }, sample: BCPL_SAMPLE }, ADMIN);
    await tools.dispatch("decode_payload_sample", { definition: BCPL_DEFINITION, sample: BCPL_SAMPLE.slice(0, 40) }, ADMIN);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  const text = JSON.stringify(lines);
  for (const fragment of ["BCPL_LAKWA_02", "16294", "1794077986"]) expect(text).not.toContain(fragment);
}

/**
 * The service's count: global admin only (refused before any pool is touched), then one
 * `withTenant` transaction per allowed organization on the tenant pool, each naming its
 * organization and reading `payloadFormat` alone — never a credential column.
 */
export async function theServiceCountsPerOrganizationOnTheTenantPool(): Promise<void> {
  await expect(realService("organization_admin").rtuCountsInOrganizations({} as JwtPayload, [ORG_X])).rejects.toBeInstanceOf(ForbiddenException);

  const dialect = new PgDialect();
  const transactions: Array<Array<{ sql: string; params: unknown[] }>> = [];
  const answers: Record<string, Array<{ code: string; rtus: number }>> = {
    [ORG_X]: [{ code: "thinkiot-register-array", rtus: 21 }],
    [ORG_Y]: [
      { code: "thinkiot-register-array", rtus: 1 },
      { code: "acme", rtus: 3 },
    ],
  };
  const tenantDb = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const queries: Array<{ sql: string; params: unknown[] }> = [];
      transactions.push(queries);
      return fn({
        execute: async (query: SQL) => {
          const rendered = dialect.sqlToQuery(query);
          queries.push(rendered);
          const organizationId = queries[0]!.params[0] as string;
          return { rows: queries.length === 1 ? [] : answers[organizationId] };
        },
      });
    },
  };
  const untouched = new Proxy({}, { get: (_t, key) => { throw new Error(`the fleet pool was reached (${String(key)})`); } });
  const accessControl = { requireMasterDataUser: async () => ({ id: USER, role: "admin" }), assertAdminRole: () => undefined };
  const svc = new MqttPayloadFormatsAdminService(untouched as never, accessControl as never, {} as never, tenantDb as never);
  expect(await svc.rtuCountsInOrganizations({} as JwtPayload, [ORG_X, ORG_Y])).toEqual({
    counts: { "thinkiot-register-array": 22, acme: 3 },
    organizationIds: [ORG_X, ORG_Y],
  });
  expect(transactions).toHaveLength(2);
  for (const [index, organizationId] of [ORG_X, ORG_Y].entries()) {
    const [scope, count] = transactions[index]!;
    expect(scope!.sql).toContain("set_config('app.current_organization'");
    expect(scope!.params).toEqual([organizationId]);
    expect(count!.sql).toContain("bms.rtu_connection_configs");
    expect(count!.sql).not.toContain("credentials");
    expect(count!.params).toEqual([organizationId]);
  }
  // No organization allowed: no read at all.
  transactions.length = 0;
  expect(await svc.rtuCountsInOrganizations({} as JwtPayload, [])).toEqual({ counts: {}, organizationIds: [] });
  expect(transactions).toEqual([]);
}
