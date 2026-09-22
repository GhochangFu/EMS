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
 *
 * **The post-commit continuation** (F3.5b, ADR 0071 Amendment 2 decisions
 * 9/10, plan R-5, owner-ruled Q-4). A handler may resolve a
 * `ProcessorContinuation` instead of `void`; `runProcessor` awaits its
 * `afterCommit` **after** `withTenant` resolved — that is, after the
 * transaction the handler ran in has committed — or, for a `fleet` handler,
 * after the handler resolved. It exists because two side effects of the
 * render job must follow a commit, not precede it: an email must follow the
 * commit of the `report_files` rows it names, and a pruned object's delete
 * must follow the commit of its row's delete — done inside the transaction,
 * a rollback would leave a mail naming rows that do not exist and an object
 * missing under a row that does. The continuation runs outside any
 * transaction and outside the tenant GUC: a query it needs opens its own
 * `withTenant`. It never runs when the handler threw or when the commit
 * failed — nothing was committed for it to follow — and its rejection
 * propagates from `process` exactly as a handler throw does, so BullMQ fails
 * the job and the worker host counts it under `outcome=failed`. The
 * heartbeat and sweep handlers return `void` and are untouched.
 */

export type ProcessorDbs = { readonly tenantDb: BmsDb; readonly fleetDb: BmsDb };

export type ProcessorContext<T extends QueueTenancy> = T extends "tenant"
  ? { readonly tx: BmsTx }
  : { readonly db: BmsDb };

/** Work a handler defers until the transaction it ran in has committed (R-5). Runs outside any transaction and outside the tenant GUC. */
export type ProcessorContinuation = { readonly afterCommit: () => Promise<void> };

export type ProcessorHandler<D extends QueueDeclaration> = (
  payload: PayloadOf<D>,
  ctx: ProcessorContext<D["tenancy"]>,
) => Promise<void | ProcessorContinuation>;

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

/** Awaits the continuation a handler resolved, if any; its rejection propagates as a handler throw does. */
async function runContinuation(result: void | ProcessorContinuation): Promise<void> {
  if (typeof result === "object" && result !== null) {
    await result.afterCommit();
  }
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
        // `runInTenant` resolves only after the transaction committed; a
        // handler throw or a failed COMMIT rejects here and the continuation
        // is never reached.
        const continuation = await runInTenant(dbs.tenantDb, organizationId, (tx) =>
          handler(data, { tx } as ProcessorContext<D["tenancy"]>),
        );
        await runContinuation(continuation);
        return;
      }

      const data = parsePayload(decl, job.data);
      const continuation = await handler(data, { db: dbs.fleetDb } as ProcessorContext<D["tenancy"]>);
      await runContinuation(continuation);
    },
  };
}
