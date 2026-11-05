import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { PointKeyStatesAdminService } from "../admin/point-key-states/point-key-states.service";
import { AccessControlService } from "../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import {
  anOrganizationAdminIsRefused,
  anUnknownIdIsRefused,
  aSeededPairCreateIsRefused,
  aSeededRowIsRefusedWithItsSentence,
  type PointKeyStateTargetsCtx,
  theAdminRowResolvesByItsName,
  theReadToolListsTheRowsAndWritesNoAudit,
  theReadToolRefusesAnOrganizationAdmin,
} from "./copilot-point-key-state-targets.integration.spec";
import { CopilotTargetResolver } from "./copilot-target-resolver";
import type { CopilotReadServices } from "./tools/copilot-read-tool";
import { createCopilotReadTools } from "./tools/copilot-read-tool-set";

/**
 * `F4.309` PR 3 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle: one per-run point key and one committed state label on it,
 * removed in `afterAll` (the label cascades from the key, migration `0097`). Built from the real
 * roles as the PR 1 service suite is: the resolver reads on `bms_tenant`, access control reads
 * `bms.users` on `bms_auth`, and the admin list reads on `bms_fleet`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.309",
  label: "the copilot's pointKeyState target and list_point_key_states against real, non-owner roles",
  because:
    "the card's name is the row bms_tenant reads, the seeded refusal is a comparison with the rows the " +
    "seed wrote, and the gate is AccessControlService's read of bms.users; a green run without a database " +
    "asserts none of them.",
});

// Per-run fixture code (F4.65): randomUUID() sits in the const's own declaration.
const RUN_KEY = `f4309t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

describe.skipIf(!connectionString)("F4.309 PR 3 — the pointKeyState target and list_point_key_states under real roles", () => {
  let observer: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let releasePointKeys: (() => Promise<void>) | undefined;
  let ctx: PointKeyStateTargetsCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    observer = await openIntegrationPool(url, "F4.309");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.309");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.309");
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.309");
    await primeSeededSubjects(fleetPool);
    releasePointKeys = await registerFixturePointKeys(observer, [RUN_KEY]);
    const inserted = await observer.query<{ id: string }>(
      "INSERT INTO bms.point_key_states (point_key_code, value, label, tone) VALUES ($1, 3, 'F4309T', 'open') RETURNING id",
      [RUN_KEY],
    );
    const org = await observer.query<{ id: string }>("SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 1");
    if (!org.rows[0]) throw new Error("F4.309: no organization — run pnpm db:seed.");

    const fleetDb = createDb(fleetPool);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const pointKeyStates = new PointKeyStatesAdminService(fleetDb, access, new MasterDataAuditService(createDb(tenantPool), fleetDb));
    ctx = {
      resolver: new CopilotTargetResolver(createDb(tenantPool), access, {} as never, {} as never),
      // Only the service this tool calls: any other tool would fail on the missing one.
      tools: createCopilotReadTools({ pointKeyStates } as unknown as CopilotReadServices),
      observer,
      organizationId: org.rows[0].id,
      pointKey: RUN_KEY,
      rowId: inserted.rows[0]!.id,
      admin: jwtFor(SEEDED.globalAdmin, "admin"),
      organizationAdmin: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
    };
  });

  afterAll(async () => {
    // `point_key_states` cascades from `point_keys` (migration `0097`).
    await releasePointKeys?.();
    await Promise.all([observer?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("resolves the admin row for the global admin, named by its key, value and label", () => theAdminRowResolvesByItsName(ctx));
  it("refuses an organization_admin the admin row and the seeded row", () => anOrganizationAdminIsRefused(ctx));
  it("refuses an id no row has", () => anUnknownIdIsRefused(ctx));
  it("refuses an edit of the seeded (breaker_main, 1) with its sentence", () => aSeededRowIsRefusedWithItsSentence(ctx));
  it("refuses a create of a seeded pair, and resolves a free pair", () => aSeededPairCreateIsRefused(ctx));
  it("lists the seeded rows as seeded and the admin row as not, by value, with no audit row", () =>
    theReadToolListsTheRowsAndWritesNoAudit(ctx));
  it("refuses the list to an organization_admin", () => theReadToolRefusesAnOrganizationAdmin(ctx));
});
