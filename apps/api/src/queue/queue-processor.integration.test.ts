import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assertTenantProcessorBindsTheOrganizationGuc } from "./queue-processor.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";

/**
 * F4.24 (ADR 0063 decision 6) — Vitest entry point for the real-`withTenant`
 * processor case. Gated like every other `*.integration.test.ts`: skipped
 * locally without `DATABASE_URL` (with the gate's stderr line), refused
 * under `CI`, and a set-but-unreachable URL fails rather than skips.
 */
const connectionString = requireIntegrationDb({
  item: "F4.24",
  label: "queue processor tenancy tests",
  because:
    "they are the only proof that a tenant-queue processor's handler runs inside the " +
    "real withTenant, on a tenant-role connection whose app.current_organization is the " +
    "payload's organizationId — the binding FORCE ROW LEVEL SECURITY reads in the worker.",
});

/**
 * A UUID because `tenantPayloadSchema` requires one (migration 0040 casts the
 * GUC to `uuid`); the value is still arbitrary — the GUC binding is what is
 * under test, not the seed. `f424…` so a leak is attributable.
 */
const PROBE_ORGANIZATION_ID = "f4240000-0000-4000-8000-000000000001";

describe.skipIf(!connectionString)("F4.24 — tenant processor binds app.current_organization", () => {
  let tenantPool: pg.Pool;

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.24",
    );
  });

  afterAll(async () => {
    await tenantPool?.end();
  });

  it("runs the handler on a tenant connection whose GUC equals the payload's organizationId", async () => {
    await assertTenantProcessorBindsTheOrganizationGuc(tenantPool, PROBE_ORGANIZATION_ID);
  });
});
