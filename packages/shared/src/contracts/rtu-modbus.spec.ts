import { expect } from "vitest";

import { POLL_INTERVAL_MAX_MS, POLL_INTERVAL_MIN_MS } from "../ingest-poll-interval";
import { adminOrganizationDtoSchema, adminRtuDtoSchema } from "./admin";
import { setOrganizationPollIntervalBodySchema } from "./organization-poll-interval";
import { rtuModbusDtoSchema, setRtuModbusBodySchema } from "./rtu-modbus";

/**
 * `F1.2` (ADR 0141 decisions 10 and 15, plan T7.1, builder call C10) — the body of
 * `PUT /admin/rtus/:id/modbus`, the body of `PUT /admin/organizations/:id/poll-interval`, and the
 * response fields both screens read. Pure: no database. The sibling `.test.ts` carries the `it()`s.
 */

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const BIND = { host: "10.0.0.5", pollIntervalMs: null, unitId: 1, profileId: PROFILE_ID };

/** M1 — the smallest bind passes; the optional connection fields pass too; the host is lower-cased. */
export function runTheBindBodyPasses(): void {
  expect(setRtuModbusBodySchema.safeParse(BIND).success).toBe(true);
  const full = setRtuModbusBodySchema.parse({
    ...BIND,
    host: "Meter-Gw.Site.LOCAL",
    port: 5020,
    timeoutMs: 2000,
    interRequestDelayMs: 50,
    pollIntervalMs: 30_000,
    unitId: 255,
  });
  expect(full.host).toBe("meter-gw.site.local");
  expect(full).toMatchObject({ port: 5020, timeoutMs: 2000, interRequestDelayMs: 50, pollIntervalMs: 30_000 });
  // An omitted port stays omitted: the stored default is the service's, not a parse side effect.
  expect(setRtuModbusBodySchema.parse(BIND).port).toBeUndefined();
}

/** M2 — `pollIntervalMs` is required (`null` inherits) and is the shared 1 s to 1 h bound. */
export function runTheBindIntervalIsTheSharedBound(): void {
  const { pollIntervalMs: _omit, ...withoutInterval } = BIND;
  expect(setRtuModbusBodySchema.safeParse(withoutInterval).success).toBe(false);
  expect(setRtuModbusBodySchema.safeParse({ ...BIND, pollIntervalMs: 999 }).success).toBe(false);
  expect(setRtuModbusBodySchema.safeParse({ ...BIND, pollIntervalMs: POLL_INTERVAL_MIN_MS }).success).toBe(true);
  expect(setRtuModbusBodySchema.safeParse({ ...BIND, pollIntervalMs: POLL_INTERVAL_MAX_MS }).success).toBe(true);
  expect(setRtuModbusBodySchema.safeParse({ ...BIND, pollIntervalMs: POLL_INTERVAL_MAX_MS + 1 }).success).toBe(false);
  expect(setRtuModbusBodySchema.safeParse({ ...BIND, pollIntervalMs: 1500.5 }).success).toBe(false);
}

/** M3 — a bad scalar, a register list or any extra key is refused (`.strict()`). */
export function runABadBindBodyIsRefused(): void {
  const refused = (patch: Record<string, unknown>) => setRtuModbusBodySchema.safeParse({ ...BIND, ...patch }).success;
  expect(refused({ unitId: 250 })).toBe(false);
  expect(refused({ unitId: 256 })).toBe(false);
  expect(refused({ port: 0 })).toBe(false);
  expect(refused({ host: "10.0.0.5:502" })).toBe(false);
  expect(refused({ host: "http://meter" })).toBe(false);
  expect(refused({ profileId: "not-a-uuid" })).toBe(false);
  expect(refused({ timeoutMs: 50 })).toBe(false);
  // The registers come from the profile row, never from the caller (decision 15).
  expect(refused({ registers: [] })).toBe(false);
  expect(refused({ device: { unitId: 1 } })).toBe(false);
  expect(refused({ organizationId: PROFILE_ID })).toBe(false);
  const { profileId: _profile, ...withoutProfile } = BIND;
  expect(setRtuModbusBodySchema.safeParse(withoutProfile).success).toBe(false);
}

/** M4 — the organization default body: a bounded integer or `null`, one key, strict. */
export function runTheOrganizationBodyIsBounded(): void {
  const ok = (value: unknown) => setOrganizationPollIntervalBodySchema.safeParse(value).success;
  expect(ok({ defaultPollIntervalMs: null })).toBe(true);
  expect(ok({ defaultPollIntervalMs: 60_000 })).toBe(true);
  expect(ok({ defaultPollIntervalMs: 999 })).toBe(false);
  expect(ok({ defaultPollIntervalMs: POLL_INTERVAL_MAX_MS + 1 })).toBe(false);
  expect(ok({ defaultPollIntervalMs: "60000" })).toBe(false);
  expect(ok({})).toBe(false);
  expect(ok({ defaultPollIntervalMs: null, ingestEnabled: true })).toBe(false);
}

const RTU = {
  id: "r1",
  locationId: "l1",
  locationName: "Loc",
  organizationCode: "ORG",
  code: "RTU-1",
  displayName: "RTU 1",
  sourceType: "catalog",
  domain: null,
  externalRtuId: null,
  rtuCode: "M1",
  mqttTopic: null,
  releasedMqttTopic: null,
  expectedIntervalSeconds: null,
  stationCode: null,
  stationName: null,
  ingestEnabled: false,
  organizationIngestEnabled: true,
  active: true,
  meta: null,
  createdAt: "2026-11-22T00:00:00.000Z",
  tls: null,
  payloadFormat: null,
  credentialsSet: false,
};

const MODBUS = {
  host: "10.0.0.5",
  port: 502,
  unitId: 1,
  timeoutMs: null,
  interRequestDelayMs: null,
  pollIntervalMs: null,
  profile: { code: "selec-mfm384", version: 2 },
  registerCount: 12,
};

/** M5 — the RTU DTO requires `modbus` (null when not Modbus) and the organization's default. */
export function runTheRtuDtoRequiresTheModbusFields(): void {
  const full = { ...RTU, modbus: MODBUS, organizationDefaultPollIntervalMs: 60_000 };
  expect(adminRtuDtoSchema.safeParse(full).success).toBe(true);
  expect(adminRtuDtoSchema.safeParse({ ...full, modbus: null, organizationDefaultPollIntervalMs: null }).success).toBe(true);
  const { modbus: _m, ...withoutModbus } = full;
  expect(adminRtuDtoSchema.safeParse(withoutModbus).success).toBe(false);
  const { organizationDefaultPollIntervalMs: _d, ...withoutDefault } = full;
  expect(adminRtuDtoSchema.safeParse(withoutDefault).success).toBe(false);
  // A Modbus row onboarding stored before a bind: no unit id yet, no profile, no registers.
  expect(rtuModbusDtoSchema.safeParse({ ...MODBUS, unitId: null, profile: null, registerCount: 0 }).success).toBe(true);
  // Response side: not strict (AGENTS.md §4.8), so a later field does not break an older client.
  expect(rtuModbusDtoSchema.safeParse({ ...MODBUS, later: true }).success).toBe(true);
  expect(rtuModbusDtoSchema.safeParse({ ...MODBUS, registerCount: -1 }).success).toBe(false);
}

/** M6 — the organization DTO requires `defaultPollIntervalMs`, a number or `null`. */
export function runTheOrganizationDtoRequiresTheDefault(): void {
  const org = {
    id: "o1",
    code: "ORG",
    name: "Org",
    active: true,
    currency: "INR",
    timezone: "UTC",
    colourProfile: null,
    designSystem: null,
    ingestEnabled: true,
    energyFeatures: "auto",
    cardPrimaryMetric: "auto",
    meta: null,
    createdAt: "2026-11-22T00:00:00.000Z",
  };
  expect(adminOrganizationDtoSchema.safeParse({ ...org, defaultPollIntervalMs: null }).success).toBe(true);
  expect(adminOrganizationDtoSchema.safeParse({ ...org, defaultPollIntervalMs: 60_000 }).success).toBe(true);
  expect(adminOrganizationDtoSchema.safeParse(org).success).toBe(false);
  expect(adminOrganizationDtoSchema.safeParse({ ...org, defaultPollIntervalMs: "60000" }).success).toBe(false);
}
