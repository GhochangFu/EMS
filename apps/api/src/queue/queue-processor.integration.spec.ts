import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import { createDb } from "@bms/db";

import { runProcessor } from "./queue-processor";
import { defineQueue, tenantPayloadSchema } from "./queue-registry";

/**
 * F4.24 (ADR 0063 decision 6) — the one proof that a `tenant` processor's
 * handler runs on a connection whose `app.current_organization` is the
 * payload's `organizationId`, through the **real** `withTenant`.
 *
 * `queue-processor.spec.ts` observes a recording fake; this spec is what
 * shows decision 6's "FORCE ROW LEVEL SECURITY binds the worker exactly as
 * it binds a request" reaches a real connection through this wrapper.
 * Whether the GUC then filters rows is `tenant-context.integration.spec.ts`'s
 * claim, already held; this one stops at the GUC.
 *
 * The pool must be a **tenant** pool (`bms_tenant`, via `asRole`) — the
 * setting is readable on any role, but a processor that ran on the fleet
 * pool would bypass RLS whatever the GUC says, and the wrapper's promise is
 * that it never does.
 */
export async function assertTenantProcessorBindsTheOrganizationGuc(
  tenantPool: pg.Pool,
  organizationId: string,
): Promise<void> {
  const tenantDb = createDb(tenantPool);
  // A `tenant` processor never touches `fleetDb`; the same pool stands in
  // rather than a second connection the test would then have to close.
  const fleetDb = tenantDb;

  const decl = defineQueue({
    name: "f4.24-tenancy-probe",
    tenancy: "tenant",
    payload: tenantPayloadSchema,
  });

  let seen: string | null | undefined;
  const registration = runProcessor(decl, { tenantDb, fleetDb }, async (_payload, ctx) => {
    const result = await ctx.tx.execute(
      sql`select current_setting('app.current_organization', true) as organization_id`,
    );
    seen = (result.rows[0] as { organization_id: string | null }).organization_id;
  });

  await registration.process({ data: { organizationId } });

  expect(seen).toBe(organizationId);
}
