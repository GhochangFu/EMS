import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Logger } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { replaceRtuCredentialsBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { MQTT_CREDENTIAL_CONTROL_CHARS } from "../../onboarding-discovery/discovery-credentials";
import { CredentialCryptoService } from "../../security/credential-crypto.service";
import {
  RTU_CREDENTIALS_EDGE_SERVED,
  RTU_CREDENTIALS_NEEDS_KEY,
  RTU_CREDENTIALS_NO_CONNECTION,
  RTU_CREDENTIALS_NOT_MQTT,
  RTU_CREDENTIALS_RACED,
  RTU_CREDENTIALS_REPLACE_ACTION,
  RTU_CREDENTIALS_ROLE_MESSAGE,
  RTU_CREDENTIALS_SHARED_BROKER,
  RtusCredentialsService,
  mayShareBroker,
} from "./rtus-credentials.service";

/**
 * `F4.333` (ADR 0129 decisions 2, 3 and 5; plan T3.1, T3.2, T3.5) — the
 * write-only credential replace for a committed RTU, against fakes. Real
 * Postgres and RLS are T3.3's integration suite.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
const JWT = { sub: "u-1", email: "someone@bms.local" } as JwtPayload;
const ORG = "org-1";
const OTHER_ORG = "org-2";
const SECRET = "rotated-secret-é";
const USER = "bcpl-user";

type Role = "admin" | "organization_admin" | "location_admin" | "asset_group_admin" | "operator" | "viewer";

type Row = {
  id: string;
  organizationId: string;
  locationId: string;
  active: boolean;
  edgeGatewayId: string | null;
  protocol: string | null;
  config: unknown;
  ciphertext: Buffer | null;
  keyVersion: number | null;
};

const BROKER = { host: "shapoorji.thinkiot.co.in", port: 1883, tls: false };

function rtuRow(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    organizationId: ORG,
    locationId: `loc-${id}`,
    active: true,
    edgeGatewayId: null,
    protocol: "mqtt",
    config: { ...BROKER, topic: `t/${id}` },
    ciphertext: Buffer.from("old"),
    keyVersion: 1,
    ...overrides,
  };
}

/**
 * A select chain that answers each terminal call (`await` on `where`, or
 * `limit`) with the next queued result, in call order. The service reads: the
 * target, its location, the siblings (when any), the other organizations'
 * brokers (non-admin only).
 */
function world(opts: {
  role?: Role;
  fleet: unknown[][];
  updated?: number;
  outOfScope?: readonly string[];
}) {
  const fleetQueue = [...opts.fleet];
  // Code review 1: an unexpected read fails loudly; an empty answer would let a
  // refusal pass for the wrong reason.
  const nextFleet = () => {
    if (fleetQueue.length === 0) throw new Error("unexpected fleet read");
    return fleetQueue.shift()!;
  };
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "leftJoin", "innerJoin", "where"]) {
    chain[method] = () => chain;
  }
  chain.limit = () => Promise.resolve(nextFleet());
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(nextFleet()).then(resolve, reject);
  const fleetDb = { select: () => chain };

  const sets: Record<string, unknown>[] = [];
  const wheres: unknown[] = [];
  const audits: unknown[][] = [];
  const updateChain = {
    set: (values: Record<string, unknown>) => {
      sets.push(values);
      return updateChain;
    },
    where: (condition: unknown) => {
      wheres.push(condition);
      return updateChain;
    },
    returning: () => Promise.resolve(Array.from({ length: opts.updated ?? 0 }, (_, i) => ({ rtuId: `r${i}` }))),
  };
  const tx = { execute: async () => undefined, update: () => updateChain };
  const tenantDb = { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) };

  const accessControl = {
    requireMasterDataUser: async () => ({ id: "u-1", role: opts.role ?? "admin" }),
    canManageLocation: async (_jwt: unknown, locationId: string) => !(opts.outOfScope ?? []).includes(locationId),
  };
  const audit = { writeMany: async (inputs: unknown[]) => void audits.push(inputs) };
  const rtusService = { fetchRow: async (id: string) => ({ id, credentialsSet: true }) };
  const service = new RtusCredentialsService(
    fleetDb as never,
    tenantDb as never,
    accessControl as never,
    audit as never,
    new CredentialCryptoService(),
    rtusService as never,
  );
  return { service, sets, wheres, audits, remaining: () => fleetQueue.length };
}

const LOCATION_OK = [{ organizationId: ORG }];

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
  }
  throw new Error("expected a refusal");
}

async function withKey<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = key;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
}

const BODY = { username: USER, password: SECRET };

/** T3.1 — the body is strict, bounded and a full replacement. */
export function runReplaceBodySchemaTests(): void {
  const ok = (value: unknown) => replaceRtuCredentialsBodySchema.safeParse(value).success;
  const id = "11111111-1111-4111-8111-111111111111";
  assert(ok(BODY), "username and password");
  assert(ok({ ...BODY, alsoApplyTo: [id] }), "with siblings");
  assert(!ok({ password: SECRET }), "both fields are required (a replacement, never a merge)");
  assert(!ok({ ...BODY, username: "" }) && !ok({ ...BODY, password: "" }), "an empty value is refused");
  assert(!ok({ ...BODY, password: "x".repeat(4097) }), "over 4096 characters is refused");
  assert(ok({ ...BODY, password: "x".repeat(4096) }), "4096 characters is accepted");
  assert(!ok({ ...BODY, alsoApplyTo: Array.from({ length: 101 }, () => id) }), "over 100 siblings is refused");
  assert(!ok({ ...BODY, alsoApplyTo: ["not-a-uuid"] }), "a sibling must be a uuid");
  assert(!ok({ ...BODY, host: "evil.example" }), "no other key: the route cannot change host, port or TLS");
}

/** T3.2 — decision 3 (Q4): admin and organization_admin only; scope still applies. */
export async function runReplaceRoleTests(): Promise<void> {
  await withKey(TEST_KEY, async () => {
    for (const role of ["location_admin", "asset_group_admin", "operator", "viewer"] as Role[]) {
      const w = world({ role, fleet: [[rtuRow("a")]] });
      const message = await refusal(() => w.service.replace(JWT, "a", BODY));
      assert(message === `ForbiddenException: ${RTU_CREDENTIALS_ROLE_MESSAGE}`, `${role} is refused: ${message}`);
      assert(w.sets.length === 0 && w.audits.length === 0, `${role} writes nothing`);
    }
    const outside = world({ role: "organization_admin", fleet: [[rtuRow("a")]], outOfScope: ["loc-a"] });
    const scoped = await refusal(() => outside.service.replace(JWT, "a", BODY));
    assert(scoped === "ForbiddenException: RTU is outside your access scope", `another org's admin is refused: ${scoped}`);
    for (const role of ["admin", "organization_admin"] as Role[]) {
      // organization_admin also reads the other organizations' brokers (none here).
      const fleet = role === "admin" ? [[rtuRow("a")], LOCATION_OK] : [[rtuRow("a")], LOCATION_OK, []];
      const w = world({ role, fleet, updated: 1 });
      const result = await w.service.replace(JWT, "a", BODY);
      assert((result as { id: string }).id === "a", `${role} may replace`);
      assert(w.remaining() === 0, `${role}: every read was the expected one`);
    }
  });
}

/** T3.2 — the refusals, in order, each writing nothing. */
export async function runReplaceRefusalTests(): Promise<void> {
  await withKey(TEST_KEY, async () => {
    const cases: [string, unknown[][], string, typeof BODY?][] = [
      ["no RTU", [[]], "NotFoundException: RTU not found"],
      ["no connection row", [[rtuRow("a", { protocol: null, config: null })], LOCATION_OK], `NotFoundException: ${RTU_CREDENTIALS_NO_CONNECTION}`],
      ["not MQTT", [[rtuRow("a", { protocol: "modbus_tcp" })], LOCATION_OK], `BadRequestException: ${RTU_CREDENTIALS_NOT_MQTT}`],
      ["edge-served", [[rtuRow("a", { edgeGatewayId: "gw-1" })], LOCATION_OK], `ConflictException: ${RTU_CREDENTIALS_EDGE_SERVED}`],
      [
        "a control character",
        [[rtuRow("a")], LOCATION_OK],
        `BadRequestException: ${MQTT_CREDENTIAL_CONTROL_CHARS}`,
        { username: USER, password: "pw\r\nCONFIG SET dir /tmp" },
      ],
      ["an org that disagrees with its location", [[rtuRow("a")], [{ organizationId: OTHER_ORG }]], "InternalServerErrorException"],
    ];
    for (const [name, fleet, expected, body] of cases) {
      const w = world({ fleet, updated: 1 });
      const message = await refusal(() => w.service.replace(JWT, "a", body ?? BODY));
      assert(message.startsWith(expected), `${name}: expected ${expected}, got ${message}`);
      assert(w.sets.length === 0 && w.audits.length === 0, `${name} writes nothing`);
    }
  });
  await withKey(undefined, async () => {
    const w = world({ fleet: [[rtuRow("a")], LOCATION_OK], updated: 1 });
    const message = await refusal(() => w.service.replace(JWT, "a", BODY));
    assert(message === `ServiceUnavailableException: ${RTU_CREDENTIALS_NEEDS_KEY}`, `no key fails closed: ${message}`);
    assert(w.sets.length === 0, "and writes nothing");
    // Code review 3: the order — no key answers before the body's control character.
    const both = world({ fleet: [[rtuRow("a")], LOCATION_OK], updated: 1 });
    const first = await refusal(() => both.service.replace(JWT, "a", { username: USER, password: "a\nb" }));
    assert(first.startsWith("ServiceUnavailableException"), `503 before the body's 400: ${first}`);
  });
  await withKey(TEST_KEY, async () => {
    // The role answers before the body's control character, and edge-served before not-MQTT is never reached.
    const viewer = world({ role: "viewer", fleet: [[rtuRow("a")]], updated: 1 });
    const role = await refusal(() => viewer.service.replace(JWT, "a", { username: USER, password: "a\nb" }));
    assert(role === `ForbiddenException: ${RTU_CREDENTIALS_ROLE_MESSAGE}`, `403 before the body's 400: ${role}`);
    const twoDefects = world({ fleet: [[rtuRow("a", { protocol: "modbus_tcp", edgeGatewayId: "gw-1" })], LOCATION_OK], updated: 1 });
    const kind = await refusal(() => twoDefects.service.replace(JWT, "a", BODY));
    assert(kind === `BadRequestException: ${RTU_CREDENTIALS_NOT_MQTT}`, `not-MQTT before edge-served: ${kind}`);
  });
}

/** T3.2 — the write: four columns only, current key version, one audit row each, no value anywhere. */
export async function runReplaceWriteTests(): Promise<void> {
  const logged: string[] = [];
  const restore = (["log", "error", "warn", "debug", "verbose"] as const).map((level) => {
    const original = Logger.prototype[level];
    Logger.prototype[level] = function (this: Logger, ...args: unknown[]) {
      logged.push(JSON.stringify(args));
    } as never;
    return () => {
      Logger.prototype[level] = original;
    };
  });
  try {
    await withKey(TEST_KEY, async () => {
      const w = world({ fleet: [[rtuRow("a", { keyVersion: 3 })], LOCATION_OK], updated: 1 });
      const result = await w.service.replace(JWT, "a", BODY);
      assert(w.sets.length === 1, "one UPDATE");
      const set = w.sets[0]!;
      assert(
        JSON.stringify(Object.keys(set).sort()) === JSON.stringify(["credentialsCiphertext", "credentialsIv", "keyVersion", "updatedAt"]),
        `only the credential columns and updated_at: ${Object.keys(set).join(",")}`,
      );
      assert(set.keyVersion === CredentialCryptoService.currentKeyVersion(), "at the current key version");
      // Security review L1 / code review 2: the UPDATE re-checks protocol and edge serving at write time.
      const rendered = new PgDialect().sqlToQuery(w.wheres[0] as SQL).sql;
      assert(rendered.includes('"protocol" = $'), `the UPDATE requires MQTT: ${rendered}`);
      assert(rendered.includes("r.edge_gateway_id IS NULL"), `the UPDATE re-checks edge serving: ${rendered}`);
      const stored = (set.credentialsCiphertext as Buffer).toString("utf8");
      assert(!stored.includes(SECRET) && !stored.includes("rotated"), "the stored blob is not plaintext");
      const decrypted = new CredentialCryptoService().decrypt(
        set.credentialsCiphertext as Buffer,
        set.credentialsIv as Buffer,
        set.keyVersion as number,
      );
      assert(JSON.stringify(decrypted) === JSON.stringify(BODY), "the blob decrypts to the sent credential");

      assert(w.audits.length === 1 && w.audits[0]!.length === 1, "one audit row");
      const row = w.audits[0]![0] as { action: string; entityType: string; entityId: string; organizationId: string; payload: unknown };
      assert(row.action === RTU_CREDENTIALS_REPLACE_ACTION && row.entityType === "rtu" && row.entityId === "a", "the action and entity");
      assert(row.organizationId === ORG, "stamped with the RTU's organization");
      assert(
        JSON.stringify(row.payload) ===
          JSON.stringify({ hadCredential: true, fromKeyVersion: 3, toKeyVersion: CredentialCryptoService.currentKeyVersion() }),
        `exactly three fields: ${JSON.stringify(row.payload)}`,
      );
      for (const [where, text] of [
        ["audit", JSON.stringify(w.audits)],
        ["response", JSON.stringify(result)],
        ["logs", logged.join("\n")],
      ] as const) {
        assert(!text.includes(SECRET) && !text.includes(USER), `no value in the ${where}`);
      }

      // A first credential on an RTU that had none.
      const fresh = world({ fleet: [[rtuRow("a", { ciphertext: null })], LOCATION_OK], updated: 1 });
      await fresh.service.replace(JWT, "a", BODY);
      const first = (fresh.audits[0]![0] as { payload: { hadCredential: boolean; fromKeyVersion: unknown } }).payload;
      assert(first.hadCredential === false && first.fromKeyVersion === null, `no prior credential: ${JSON.stringify(first)}`);

      // The UPDATE hit fewer rows than it read: everything rolls back, no audit row.
      const raced = world({ fleet: [[rtuRow("a")], LOCATION_OK], updated: 0 });
      const message = await refusal(() => raced.service.replace(JWT, "a", BODY));
      assert(message === `ConflictException: ${RTU_CREDENTIALS_RACED}`, `a raced write is a 409: ${message}`);
      assert(raced.audits.length === 0, "and audits nothing");
    });
  } finally {
    for (const undo of restore) undo();
  }
}

/** T3.2 — Q3: siblings get the same blob; one bad sibling refuses the whole request. */
export async function runReplaceSiblingTests(): Promise<void> {
  await withKey(TEST_KEY, async () => {
    // Each sibling that passes the other checks has its location read (review L2).
    const ok = world({ fleet: [[rtuRow("a")], LOCATION_OK, [rtuRow("b"), rtuRow("c")], LOCATION_OK, LOCATION_OK], updated: 3 });
    await ok.service.replace(JWT, "a", { ...BODY, alsoApplyTo: ["b", "c", "a", "b"] });
    assert(ok.sets.length === 1, "one UPDATE for all three: one blob, one IV");
    assert(ok.audits[0]?.length === 3, `one audit row per RTU written, got ${ok.audits[0]?.length}`);
    const ids = (ok.audits[0] as { entityId: string }[]).map((row) => row.entityId).join(",");
    assert(ids === "a,b,c", `the target and each sibling once: ${ids}`);

    const bad: [name: string, sibling: Row | null, outOfScope?: string[]][] = [
      ["another organization", rtuRow("b", { organizationId: OTHER_ORG })],
      ["another port", rtuRow("b", { config: { ...BROKER, port: 8883 } })],
      ["TLS where the target is plain", rtuRow("b", { config: { ...BROKER, tls: true } })],
      ["edge-served", rtuRow("b", { edgeGatewayId: "gw-1" })],
      ["inactive", rtuRow("b", { active: false })],
      ["not MQTT", rtuRow("b", { protocol: "modbus_tcp" })],
      ["unknown", null],
      ["out of scope", rtuRow("b"), ["loc-b"]],
      ["on a broker with no stored port", rtuRow("b", { config: { host: BROKER.host, tls: false } })],
    ];
    for (const [name, sibling, outOfScope] of bad) {
      // The sibling's location answers its own organization, so only the check under test can refuse it.
      const w = world({
        fleet: [[rtuRow("a")], LOCATION_OK, sibling === null ? [] : [sibling], [{ organizationId: sibling?.organizationId ?? ORG }]],
        updated: 2,
        ...(outOfScope ? { outOfScope } : {}),
      });
      const message = await refusal(() => w.service.replace(JWT, "a", { ...BODY, alsoApplyTo: ["b"] }));
      assert(message.startsWith("BadRequestException: These RTUs cannot take this credential") && message.includes(": b."), `${name}: ${message}`);
      assert(w.sets.length === 0 && w.audits.length === 0, `${name}: nothing is written`);
    }

    // Neither stores a port: ingest would fill both from its environment, so they are not
    // known to share a broker, and the sibling is refused.
    const noPort = { host: BROKER.host, tls: false };
    const portless = world({
      fleet: [[rtuRow("a", { config: noPort })], LOCATION_OK, [rtuRow("b", { config: noPort })], LOCATION_OK],
      updated: 2,
    });
    const unknownPort = await refusal(() => portless.service.replace(JWT, "a", { ...BODY, alsoApplyTo: ["b"] }));
    assert(unknownPort.includes("These RTUs cannot take this credential"), `no stored port on either side: ${unknownPort}`);
    assert(portless.sets.length === 0, "and nothing is written");

    // Security review L2: a sibling whose organization disagrees with its location's is refused.
    const drifted = world({ fleet: [[rtuRow("a")], LOCATION_OK, [rtuRow("b")], [{ organizationId: OTHER_ORG }]], updated: 2 });
    const message = await refusal(() => drifted.service.replace(JWT, "a", { ...BODY, alsoApplyTo: ["b"] }));
    assert(message.includes("These RTUs cannot take this credential") && message.includes(": b."), `a drifted sibling: ${message}`);
    assert(drifted.sets.length === 0, "and nothing is written");
  });
}

/** Build ruling on the PR 2 review's L2: a broker another organization uses is a global administrator's call. */
export async function runReplaceSharedBrokerTests(): Promise<void> {
  await withKey(TEST_KEY, async () => {
    const shared = [{ config: { host: "SHAPOORJI.thinkiot.co.in", port: 1883, tls: false } }];
    const orgAdmin = world({ role: "organization_admin", fleet: [[rtuRow("a")], LOCATION_OK, shared], updated: 1 });
    const message = await refusal(() => orgAdmin.service.replace(JWT, "a", BODY));
    assert(message === `ConflictException: ${RTU_CREDENTIALS_SHARED_BROKER}`, `an org admin is refused: ${message}`);
    assert(orgAdmin.sets.length === 0, "and writes nothing");

    const elsewhere = world({
      role: "organization_admin",
      fleet: [[rtuRow("a")], LOCATION_OK, [{ config: { ...BROKER, port: 8883 } }]],
      updated: 1,
    });
    await elsewhere.service.replace(JWT, "a", BODY);
    assert(elsewhere.sets.length === 1, "another organization on another port does not block");

    const admin = world({ role: "admin", fleet: [[rtuRow("a")], LOCATION_OK], updated: 1 });
    await admin.service.replace(JWT, "a", BODY);
    assert(admin.sets.length === 1 && admin.remaining() === 0, "a global admin proceeds without the check");

    // Security review M1: ingest fills an absent host or port from its environment, so a
    // stored null may be any broker and the check fails closed for an organization admin.
    // TLS on both sides (an absent `tls` reads as true): only host and port are unknown.
    const tlsBroker = { host: "phe.thinkiot.co.in", port: 8883 };
    const nullCases: [string, unknown, unknown][] = [
      ["the target stores no host or port", { topic: "t/a" }, tlsBroker],
      ["the other row stores no host or port", tlsBroker, { topic: "t/x" }],
      ["the target stores no port", { host: tlsBroker.host }, tlsBroker],
      // Code review 4: another organization's MQTT RTU with no connection row (the PHE pilot's).
      ["the other RTU has no connection row", tlsBroker, null],
    ];
    for (const [name, mine, theirs] of nullCases) {
      const w = world({ role: "organization_admin", fleet: [[rtuRow("a", { config: mine })], LOCATION_OK, [{ config: theirs }]], updated: 1 });
      const refused = await refusal(() => w.service.replace(JWT, "a", BODY));
      assert(refused === `ConflictException: ${RTU_CREDENTIALS_SHARED_BROKER}`, `${name}: ${refused}`);
      assert(w.sets.length === 0, `${name}: nothing is written`);
    }
  });
}

/** Security review M1: the fail-closed broker match. */
export function runMayShareBrokerTests(): void {
  const b = (host: string | null, port: number | null, tls = true) => ({ host, port, tls });
  assert(mayShareBroker(b("h", 1), b("h", 1)), "equal");
  assert(!mayShareBroker(b("h", 1), b("g", 1)) && !mayShareBroker(b("h", 1), b("h", 2)), "a known difference");
  assert(!mayShareBroker(b("h", 1, true), b("h", 1, false)), "TLS differs");
  assert(mayShareBroker(b(null, 1), b("h", 1)) && mayShareBroker(b("h", null), b("h", 1)), "a null matches anything");
  assert(mayShareBroker(b(null, null), b("h", 8883)), "an env-fallback row may share any broker");
}

/** T3.5 — the controller hands the parsed body to the service only; no body reaches an audit payload. */
export function runReplaceNoBodyInAuditTests(): void {
  const here = __dirname;
  const controller = readFileSync(join(here, "rtus.controller.ts"), "utf8");
  assert(
    controller.includes("this.credentials.replace(user, idParamSchema.parse(id), replaceRtuCredentialsBodySchema.parse(body))"),
    "the route passes the parsed body to the service",
  );
  const service = readFileSync(join(here, "rtus-credentials.service.ts"), "utf8");
  assert(!/payload:\s*body\b/.test(service) && !/payload:\s*\{[^}]*body\./.test(service), "no request body in an audit payload");
  assert(!/password|username/.test(service.split("payload: {")[1]?.split("}")[0] ?? ""), "the audit payload names no credential field");
}
