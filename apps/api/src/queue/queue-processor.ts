import type { BmsDb } from "@bms/db";

import { withTenant, type BmsTx } from "../database/tenant-context";
import {
  parsePayload,
  QueuePayloadError,
  type PayloadOf,
  type QueueDeclaration,
  type QueueTenancy,
} from "./queue-registry";

/**
 * The tenancy-bound processor wrapper (ADR 0063 decision 6).
 *
 * A processor is registered against the same `QueueDeclaration` its producer
 * enqueues with, and the declaration's `tenancy` decides which pool the
 * handler sees:
 *
 * - **`tenant`** — the handler runs inside `withTenant(dbs.tenantDb,
 *   organizationId, …)`, the same helper every API request uses, so `FORCE
 *   ROW LEVEL SECURITY` binds the worker exactly as it binds a request (ADR
 *   0043, 0045). The handler receives the **transaction**, typed `BmsTx`,
 *   never a `BmsDb` — the two differ, and a cast would hide a nested
 *   `.transaction`.
 * - **`fleet`** — the handler receives `dbs.fleetDb` directly, for
 *   cross-organization sweeps run as `bms_fleet`.
 *
 * **`job.data` is parsed, not cast** (the 2026-09-11 review, M2). BullMQ
 * hands back whatever was stored, and a job can be added by a producer that
 * is not this registry — `redis-cli`, a future service. The declaration's
 * schema is applied through the same `parsePayload` the producer used, so
 * the handler receives the schema's output and a shape the producer would
 * have refused fails here with the same `QueuePayloadError("invalid_payload")`
 * — before `withTenant`, so no transaction is opened for a job that cannot
 * run. BullMQ then fails the job and the worker host counts it under
 * `outcome=failed`.
 *
 * **The `organizationId` re-check lives here too**, and runs first on a
 * tenant queue: absent, empty or not a string →
 * `QueuePayloadError("missing_organization_id")`; present but not a UUID →
 * the schema's `invalid_payload` at `organizationId`. Decision 6's first
 * sentence is "never sees".
 *
 * `deps.withTenant` is injectable only so the unit spec can observe the
 * call. `queue-processor.integration.spec.ts` runs the real one and is the
 * proof that `app.current_organization` reaches a real connection.
 */

export type ProcessorDbs = { readonly tenantDb: BmsDb; readonly fleetDb: BmsDb };

export type ProcessorContext<T extends QueueTenancy> = T extends "tenant"
  ? { readonly tx: BmsTx }
  : { readonly db: BmsDb };

export type ProcessorHandler<D extends QueueDeclaration> = (
  payload: PayloadOf<D>,
  ctx: ProcessorContext<D["tenancy"]>,
) => Promise<void>;

/** What Unit 4's worker host hands to a BullMQ `Worker`: the queue name and a `process(job)`. */
export type ProcessorRegistration = {
  readonly decl: QueueDeclaration;
  readonly process: (job: { readonly data: unknown }) => Promise<void>;
};

function readOrganizationId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const value = (data as { organizationId?: unknown }).organizationId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Wraps `handler` as a BullMQ processor that parses `job.data` against the declaration and binds its tenancy before running it. */
export function runProcessor<D extends QueueDeclaration>(
  decl: D,
  dbs: ProcessorDbs,
  handler: ProcessorHandler<D>,
  deps: { withTenant?: typeof withTenant } = {},
): ProcessorRegistration {
  const runInTenant = deps.withTenant ?? withTenant;

  return {
    decl,
    process: async (job) => {
      // The casts on `ctx` are the price of a conditional type: TypeScript
      // cannot narrow `ProcessorContext<D["tenancy"]>` from a check on
      // `decl.tenancy`, so each branch asserts the shape it just built.
      if (decl.tenancy === "tenant") {
        const organizationId = readOrganizationId(job.data);
        if (organizationId === undefined) {
          throw new QueuePayloadError("missing_organization_id", decl.name);
        }
        const data = parsePayload(decl, job.data);
        await runInTenant(dbs.tenantDb, organizationId, (tx) =>
          handler(data, { tx } as ProcessorContext<D["tenancy"]>),
        );
        return;
      }

      const data = parsePayload(decl, job.data);
      await handler(data, { db: dbs.fleetDb } as ProcessorContext<D["tenancy"]>);
    },
  };
}
