import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  noAttachmentByteReachesAnyTable,
  theSwitchOffIs403AndCountsNothing,
  theSwitchOnRunsAndCountsOnce,
} from "./copilot-attachments.integration.spec";
import type { HistoryCtx } from "./copilot-history.rls.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.87",
  label: "a copilot turn that carries files",
  because:
    "an attached file is never stored (ADR 0099 Amendment 3 A4) and the attachment switch is read on the server " +
    "(A7); only a real database can show no table holds the bytes and that the switch gates the real counters.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.87",
  label: "the copilot attachment fixture users and switches",
  because: "Only the superuser inserts and deletes a bms.users row under FORCE, and scans every table. Setup, scans and teardown use it.",
  connection: "superuser",
});

const FAMILY = `F387-ATT-${Date.now()}`;
const FAMILY_PATTERN = "F387-ATT-%";

describe.skipIf(!connectionString)("F3.87 PR 7 — a copilot turn that carries files, on the real tables", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: HistoryCtx;
  let orgId: string | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F3.87");
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F3.87");
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.87");
    // A run killed before afterAll leaves its fixtures; conversations, messages and counters go with their user.
    await superPool.query("DELETE FROM bms.users WHERE email LIKE $1 AND created_at < now() - interval '30 minutes'", [
      FAMILY_PATTERN.toLowerCase(),
    ]);
    await superPool.query("DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'", [
      FAMILY_PATTERN,
    ]);
    const org = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.87 attachments', 'INR') RETURNING id",
      [FAMILY],
    );
    orgId = org.rows[0]?.id;
    if (!orgId) throw new Error("F3.87: fixture organization was not created");
    const user = async (suffix: string, organizationId: string | null, role: string): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id",
        [organizationId, `${FAMILY.toLowerCase()}-${suffix}@example.test`, `F3.87 ${suffix}`, role],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.87: fixture user ${suffix} was not created`);
      return id;
    };
    ctx = {
      tenantDb: createDb(tenantPool),
      fleetPool,
      superPool,
      orgA: orgId,
      orgY: orgId,
      userA: await user("a", orgId, "organization_admin"),
      userB: await user("b", orgId, "organization_admin"),
      globalAdmin: await user("global", null, "admin"),
    };
  });

  afterAll(async () => {
    await superPool?.query("DELETE FROM bms.users WHERE email LIKE $1", [`${FAMILY.toLowerCase()}-%`]);
    if (orgId) {
      await superPool.query("DELETE FROM bms.audit_log WHERE organization_id = $1", [orgId]);
      await superPool.query("DELETE FROM bms.copilot_org_settings WHERE organization_id = $1", [orgId]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = $1", [orgId]);
    }
    await Promise.all([tenantPool?.end(), fleetPool?.end(), superPool?.end()]);
  });

  it("(i) no byte of an attached file reaches any table; the placeholder holds its sha256", async () => {
    await noAttachmentByteReachesAnyTable(ctx);
  });
  it("(ii) the switch off is a 403 and counts nothing", async () => {
    await theSwitchOffIs403AndCountsNothing(ctx);
  });
  it("(iii) the switch on runs the turn and counts it once", async () => {
    await theSwitchOnRunsAndCountsOnce(ctx);
  });
});
