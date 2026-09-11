import type { BmsDb } from "@bms/db";
import { z } from "zod";

import type { BmsTx, withTenant } from "../database/tenant-context";
import { runProcessor, type ProcessorContext } from "./queue-processor";
import { defineQueue, tenantPayloadSchema } from "./queue-registry";

/**
 * F4.24 (ADR 0063 decision 6) — the tenancy-bound processor wrapper.
 *
 * Assertions live here; `queue-processor.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per row of plan §6's second table,
 * split where a row bundles two mechanisms, plus the 2026-09-11 review's M2
 * rows (`job.data` is parsed, not cast). `withTenant` is a recording fake —
 * the real GUC binding is proved by `queue-processor.integration.spec.ts`,
 * not here. Errors are matched on `err.name` / `err.reason`, never
 * `instanceof` (F4.108).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The "expected to reject" sentinel lives outside the `try` (Unit 1's lesson). */
async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let rejected = false;
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    rejected = true;
    caught = err;
  }
  assert(rejected, "expected the call to reject, and it resolved");
  return caught;
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { name?: unknown }).name?.toString()
    : undefined;
}

function errorReason(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { reason?: unknown }).reason?.toString()
    : undefined;
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null
    ? String((err as { message?: unknown }).message)
    : String(err);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** A UUID because `tenantPayloadSchema` requires one; the suffix keeps it recognisable in a message. */
const ORG_A = "00000000-0000-4000-8000-00000000000a";

const tenantQ = defineQueue({
  name: "t",
  tenancy: "tenant",
  payload: tenantPayloadSchema.extend({ x: z.number() }),
});

const fleetQ = defineQueue({ name: "f", tenancy: "fleet", payload: z.object({ x: z.number() }) });

/** Two distinct sentinels so `db === tenantDb` cannot pass by accident. */
const tenantDb = { pool: "tenant" } as unknown as BmsDb;
const fleetDb = { pool: "fleet" } as unknown as BmsDb;
const fakeTx = { tx: "fake" } as unknown as BmsTx;

type Fixture = {
  withTenantCalls: { db: BmsDb; organizationId: string }[];
  withTenant: typeof withTenant;
};

function makeFixture(): Fixture {
  const withTenantCalls: Fixture["withTenantCalls"] = [];
  const fake: typeof withTenant = async (db, organizationId, fn) => {
    withTenantCalls.push({ db, organizationId });
    return fn(fakeTx);
  };
  return { withTenantCalls, withTenant: fake };
}

// ---------------------------------------------------------------------------
// tenant
// ---------------------------------------------------------------------------

export async function assertTenantHandlerReceivesTheTransactionFromWithTenant(): Promise<void> {
  const fixture = makeFixture();
  let received: ProcessorContext<"tenant"> | undefined;
  const registration = runProcessor(
    tenantQ,
    { tenantDb, fleetDb },
    async (_payload, ctx) => {
      received = ctx;
    },
    { withTenant: fixture.withTenant },
  );
  await registration.process({ data: { organizationId: ORG_A, x: 1 } });
  assert(
    received !== undefined && received.tx === fakeTx,
    "expected the tenant handler to receive ctx.tx from withTenant's callback",
  );
}

export async function assertTenantHandlerRunsWithTenantOnTheTenantPoolForTheOrganization(): Promise<void> {
  const fixture = makeFixture();
  const registration = runProcessor(
    tenantQ,
    { tenantDb, fleetDb },
    async () => undefined,
    { withTenant: fixture.withTenant },
  );
  await registration.process({ data: { organizationId: ORG_A, x: 1 } });
  assert(
    fixture.withTenantCalls.length === 1,
    `expected withTenant to be called exactly once, got ${fixture.withTenantCalls.length}`,
  );
  const [call] = fixture.withTenantCalls;
  assert(
    call.db === tenantDb,
    "expected withTenant to run on dbs.tenantDb — it ran on another pool (the fleet pool bypasses RLS)",
  );
  assert(
    call.organizationId === ORG_A,
    `expected withTenant to bind organizationId ${ORG_A}, got ${JSON.stringify(call.organizationId)}`,
  );
}

export async function assertTenantHandlerReceivesThePayload(): Promise<void> {
  const fixture = makeFixture();
  let received: unknown;
  const registration = runProcessor(
    tenantQ,
    { tenantDb, fleetDb },
    async (payload) => {
      received = payload;
    },
    { withTenant: fixture.withTenant },
  );
  const data = { organizationId: ORG_A, x: 7 };
  await registration.process({ data });
  assert(
    JSON.stringify(received) === JSON.stringify(data),
    `expected the handler to receive the declared payload, got ${JSON.stringify(received)}`,
  );
}

// --- review M2: job.data is parsed, not cast --------------------------------

export async function assertTenantPayloadFailingItsSchemaIsRefusedAtTheProcessor(): Promise<void> {
  const fixture = makeFixture();
  let handlerCalls = 0;
  const registration = runProcessor(
    tenantQ,
    { tenantDb, fleetDb },
    async () => {
      handlerCalls += 1;
    },
    { withTenant: fixture.withTenant },
  );
  const err = await captureRejection(() =>
    registration.process({ data: { organizationId: ORG_A, x: "seven" } }),
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) for x: "seven" against z.number(), got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(
    errorMessage(err).includes("x") && !errorMessage(err).includes("seven"),
    `expected the message to name the field path "x" and not the value, got "${errorMessage(err)}"`,
  );
  assert(handlerCalls === 0, "expected the handler never to run for a payload its schema refuses");
  assert(
    fixture.withTenantCalls.length === 0,
    "expected withTenant never to be called for a payload its schema refuses — no transaction for a job that cannot run",
  );
}

/**
 * Which reason fires when, at the processor: absent or empty →
 * `missing_organization_id` (the row above); present and not a UUID → the
 * schema's `invalid_payload`, and `withTenant` is never entered with it.
 */
export async function assertTenantNonUuidOrganizationIdIsInvalidPayloadAtTheProcessor(): Promise<void> {
  const fixture = makeFixture();
  const registration = runProcessor(
    tenantQ,
    { tenantDb, fleetDb },
    async () => undefined,
    { withTenant: fixture.withTenant },
  );
  const err = await captureRejection(() =>
    registration.process({ data: { organizationId: "org-a", x: 1 } }),
  );
  assert(
    errorReason(err) !== "missing_organization_id",
    "a present, non-empty organizationId answered missing_organization_id — the re-check must only refuse absence",
  );
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) for a non-UUID organizationId, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(
    fixture.withTenantCalls.length === 0,
    "expected withTenant never to be called with a non-UUID organizationId — Postgres would fail it closed as 22P02, three times",
  );
}

export async function assertFleetPayloadFailingItsSchemaIsRefusedAtTheProcessor(): Promise<void> {
  const fixture = makeFixture();
  let handlerCalls = 0;
  const registration = runProcessor(
    fleetQ,
    { tenantDb, fleetDb },
    async () => {
      handlerCalls += 1;
    },
    { withTenant: fixture.withTenant },
  );
  const err = await captureRejection(() => registration.process({ data: { x: "one" } }));
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "invalid_payload",
    `expected QueuePayloadError(invalid_payload) on the fleet path, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(handlerCalls === 0, "expected the fleet handler never to run for a payload its schema refuses");
}

/** The handler receives the schema's output: an undeclared key a foreign producer stored is stripped. */
export async function assertHandlerReceivesTheSchemaOutputNotRawJobData(): Promise<void> {
  const fixture = makeFixture();
  let received: unknown;
  const registration = runProcessor(
    fleetQ,
    { tenantDb, fleetDb },
    async (payload) => {
      received = payload;
    },
    { withTenant: fixture.withTenant },
  );
  await registration.process({ data: { x: 7, smuggled: "yes" } });
  assert(
    JSON.stringify(received) === JSON.stringify({ x: 7 }),
    `expected the handler to receive the parsed output { x: 7 } with the undeclared key stripped, got ${JSON.stringify(received)}`,
  );
}

export async function assertTenantPayloadWithoutOrganizationIdIsRefusedAtTheProcessor(): Promise<void> {
  const fixture = makeFixture();
  let handlerCalls = 0;
  const registration = runProcessor(
    tenantQ,
    { tenantDb, fleetDb },
    async () => {
      handlerCalls += 1;
    },
    { withTenant: fixture.withTenant },
  );
  const err = await captureRejection(() => registration.process({ data: { x: 1 } }));
  assert(
    errorName(err) === "QueuePayloadError" && errorReason(err) === "missing_organization_id",
    `expected QueuePayloadError(missing_organization_id) from the processor-side re-check, got ${errorName(err)}(${errorReason(err)})`,
  );
  assert(handlerCalls === 0, "expected the handler never to run for a payload without organizationId");
  assert(
    fixture.withTenantCalls.length === 0,
    "expected withTenant never to be called for a payload without organizationId",
  );
}

export async function assertTenantHandlerThrowPropagatesUnchanged(): Promise<void> {
  const fixture = makeFixture();
  const registration = runProcessor(
    tenantQ,
    { tenantDb, fleetDb },
    async () => {
      throw new Error("handler failed: tenant");
    },
    { withTenant: fixture.withTenant },
  );
  const err = await captureRejection(() =>
    registration.process({ data: { organizationId: ORG_A, x: 1 } }),
  );
  assert(
    (err as { message?: unknown }).message === "handler failed: tenant",
    `expected the handler's error to propagate unchanged, got ${JSON.stringify((err as { message?: unknown }).message)} — a swallowed failure would be counted completed`,
  );
}

// ---------------------------------------------------------------------------
// fleet
// ---------------------------------------------------------------------------

export async function assertFleetHandlerReceivesTheFleetDb(): Promise<void> {
  const fixture = makeFixture();
  let received: ProcessorContext<"fleet"> | undefined;
  const registration = runProcessor(
    fleetQ,
    { tenantDb, fleetDb },
    async (_payload, ctx) => {
      received = ctx;
    },
    { withTenant: fixture.withTenant },
  );
  await registration.process({ data: { x: 1 } });
  assert(
    received !== undefined && received.db === fleetDb,
    "expected the fleet handler to receive ctx.db === dbs.fleetDb",
  );
}

/** The tenant rows above are this row's positive control: the fake is known to record when called. */
export async function assertFleetHandlerNeverEntersWithTenant(): Promise<void> {
  const fixture = makeFixture();
  const registration = runProcessor(
    fleetQ,
    { tenantDb, fleetDb },
    async () => undefined,
    { withTenant: fixture.withTenant },
  );
  await registration.process({ data: { x: 1 } });
  assert(
    fixture.withTenantCalls.length === 0,
    `expected withTenant never to be called for a fleet queue, got ${fixture.withTenantCalls.length} call(s) — fleet jobs must not run in a tenant transaction`,
  );
}

export async function assertFleetHandlerThrowPropagatesUnchanged(): Promise<void> {
  const fixture = makeFixture();
  const registration = runProcessor(
    fleetQ,
    { tenantDb, fleetDb },
    async () => {
      throw new Error("handler failed: fleet");
    },
    { withTenant: fixture.withTenant },
  );
  const err = await captureRejection(() => registration.process({ data: { x: 1 } }));
  assert(
    (err as { message?: unknown }).message === "handler failed: fleet",
    `expected the handler's error to propagate unchanged, got ${JSON.stringify((err as { message?: unknown }).message)}`,
  );
}

// ---------------------------------------------------------------------------
// registration shape
// ---------------------------------------------------------------------------

/** Unit 4's worker host keys the BullMQ `Worker` on `registration.decl.name`. */
export function assertRegistrationCarriesTheDeclaration(): void {
  const fixture = makeFixture();
  const registration = runProcessor(fleetQ, { tenantDb, fleetDb }, async () => undefined, {
    withTenant: fixture.withTenant,
  });
  assert(
    registration.decl === fleetQ,
    "expected the registration to carry the same declaration object it was built from",
  );
}
