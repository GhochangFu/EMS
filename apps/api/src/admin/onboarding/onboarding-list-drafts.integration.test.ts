import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../../testing/seeded-subjects";
import {
  aScopedAdminWithNoOrganizationListsItsHome,
  eachLocationNameComesFromTheDraft,
  noItemCarriesTheDraft,
  theListHoldsTheOrganizationsDraftsNewestFirst,
  theStarterIsJoinedFromUsers,
  type ListDraftsCtx,
} from "./onboarding-list-drafts.integration.spec";
import { OnboardingService } from "./onboarding.service";

/**
 * `F4.255` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. The service reads on the
 * real roles: `bms_fleet` for the list, `bms_tenant` for the organization read,
 * `bms_auth` for the access check. The fixture rows are written by the
 * superuser with explicit `updated_at`, and deleted by id in `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.255",
  label: "OnboardingService.listDrafts lists one organization's drafts with their starter",
  because:
    "the unit spec renders the join and the projection against a fake chain; only real " +
    "Postgres proves the left join on created_by, the JSON path and the bms_fleet grants.",
});

const RUN = Date.now();

describe.skipIf(!connectionString)("F4.255 — the draft list on real Postgres", () => {
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let superPool: pg.Pool;
  const organizationIds: string[] = [];
  const sessionIds: string[] = [];
  const ctx = {} as ListDraftsCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.255");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.255",
    );
    authPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "auth", process.env), "F4.255");
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.255");

    await primeSeededSubjects(fleetPool);
    const starter = await superPool.query<{ id: string; display_name: string | null }>(
      "SELECT id, display_name FROM bms.users WHERE email = $1",
      [SEEDED.globalAdmin],
    );
    const starterRow = starter.rows[0];
    if (!starterRow || starterRow.display_name === null) {
      throw new Error(`F4.255: ${SEEDED.globalAdmin} is missing or has no display name — run pnpm db:seed.`);
    }
    ctx.starter = { id: starterRow.id, displayName: starterRow.display_name };

    const organization = async (suffix: string): Promise<string> => {
      const res = await superPool.query<{ id: string }>(
        "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
        [`F4255-${suffix}-${RUN}`, `F4.255 ${suffix} ${RUN}`],
      );
      organizationIds.push(res.rows[0].id);
      return res.rows[0].id;
    };
    const session = async (
      organizationId: string,
      values: { status: string; locationName: string; updatedAt: string; createdBy: string | null },
    ): Promise<string> => {
      const draft = { location: { name: values.locationName }, _secrets: { "rtu-0": "sealed" } };
      const res = await superPool.query<{ id: string }>(
        `INSERT INTO bms.onboarding_sessions
           (organization_id, status, current_phase, draft, messages, created_by, updated_at, committed_at)
         VALUES ($1, $2::varchar, 'rtu', $3::jsonb, '[]'::jsonb, $4, $5::timestamptz,
                 CASE WHEN $2::varchar = 'committed' THEN now() END)
         RETURNING id`,
        [organizationId, values.status, JSON.stringify(draft), values.createdBy, values.updatedAt],
      );
      sessionIds.push(res.rows[0].id);
      return res.rows[0].id;
    };

    const orgA = await organization("A");
    const orgB = await organization("B");
    ctx.newerLocationName = `F4.255 Newer ${RUN}`;
    ctx.olderLocationName = `F4.255 Older ${RUN}`;
    // The newer draft is inserted first, so insertion order cannot pass the order check.
    ctx.newerDraft = await session(orgA, {
      status: "draft",
      locationName: ctx.newerLocationName,
      updatedAt: "2026-10-13T10:00:00Z",
      createdBy: ctx.starter.id,
    });
    ctx.olderDraft = await session(orgA, {
      status: "draft",
      locationName: ctx.olderLocationName,
      updatedAt: "2026-10-13T09:00:00Z",
      createdBy: null,
    });
    await session(orgA, {
      status: "committed",
      locationName: `F4.255 Committed ${RUN}`,
      updatedAt: "2026-10-13T11:00:00Z",
      createdBy: ctx.starter.id,
    });
    await session(orgB, {
      status: "draft",
      locationName: `F4.255 Other ${RUN}`,
      updatedAt: "2026-10-13T12:00:00Z",
      createdBy: ctx.starter.id,
    });

    const fleetDb = createDb(fleetPool);
    const none = {} as never;
    const service = new OnboardingService(
      fleetDb,
      createDb(tenantPool),
      new AccessControlService(createDb(authPool), fleetDb),
      none,
      none,
      none,
      none,
      none,
      none,
      none,
    );
    ctx.list = await service.listDrafts(jwtFor(SEEDED.globalAdmin, "admin"), orgA);

    // The home fallback: the seeded organization administrator names no organization.
    const home = await superPool.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM bms.users WHERE email = $1",
      [SEEDED.organizationAdmin],
    );
    const homeOrganization = home.rows[0]?.organization_id ?? null;
    if (homeOrganization === null) {
      throw new Error(`F4.255: ${SEEDED.organizationAdmin} is missing or has no home organization — run pnpm db:seed.`);
    }
    ctx.homeOrganization = homeOrganization;
    ctx.homeDraft = await session(homeOrganization, {
      status: "draft",
      locationName: `F4.255 Home ${RUN}`,
      updatedAt: "2026-10-13T08:00:00Z",
      createdBy: null,
    });
    ctx.homeList = await service.listDrafts(jwtFor(SEEDED.organizationAdmin, "organization_admin"), undefined);
  }, 60_000);

  afterAll(async () => {
    if (superPool && sessionIds.length > 0) {
      await superPool.query("DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)", [sessionIds]);
    }
    if (superPool && organizationIds.length > 0) {
      await superPool.query("DELETE FROM bms.organizations WHERE id = ANY($1)", [organizationIds]);
    }
    await Promise.all([fleetPool?.end(), tenantPool?.end(), authPool?.end(), superPool?.end()]);
  }, 60_000);

  it("holds exactly the organization's two drafts, newest update first", () => {
    theListHoldsTheOrganizationsDraftsNewestFirst(ctx);
  });

  it("reads each location name out of the draft JSON", () => {
    eachLocationNameComesFromTheDraft(ctx);
  });

  it("joins the starter from users, and null for an unstamped draft", () => {
    theStarterIsJoinedFromUsers(ctx);
  });

  it("carries the summary keys and never the draft", () => {
    noItemCarriesTheDraft(ctx);
  });

  it("lists a scoped administrator's home organization when none is named", () => {
    aScopedAdminWithNoOrganizationListsItsHome(ctx);
  });
});
