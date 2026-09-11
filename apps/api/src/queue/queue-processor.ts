import type { BmsDb } from "@bms/db";

import { withTenant, type BmsTx } from "../database/tenant-context";
import {
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
 * **The `organizationId` re-check lives here too**, not only at `enqueue`.
 * A job can be added by a producer that is not this registry — `redis-cli`,
 * a future service — and decision 6's first sentence is "never sees". A
 * refusal throws `QueuePayloadError("missing_organization_id")`; BullMQ then
 * fails the job and Unit 4's worker host counts it under `outcome=failed`.
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
      // `job.data` is `unknown` at this seam on purpose: BullMQ hands back
      // whatever was stored, and the payload type is the declaration's
      // promise, not Redis's. The tenant branch checks the one field it
      // depends on; the rest is the handler's contract with its producer.
      const data = job.data as PayloadOf<D>;

      // The casts on `ctx` are the price of a conditional type: TypeScript
      // cannot narrow `ProcessorContext<D["tenancy"]>` from a check on
      // `decl.tenancy`, so each branch asserts the shape it just built.
      if (decl.tenancy === "tenant") {
        const organizationId = readOrganizationId(data);
        if (organizationId === undefined) {
          throw new QueuePayloadError("missing_organization_id", decl.name);
        }
        await runInTenant(dbs.tenantDb, organizationId, (tx) =>
          handler(data, { tx } as ProcessorContext<D["tenancy"]>),
        );
        return;
      }

      await handler(data, { db: dbs.fleetDb } as ProcessorContext<D["tenancy"]>);
    },
  };
}
