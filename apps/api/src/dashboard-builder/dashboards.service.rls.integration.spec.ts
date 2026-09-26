import { expect } from "vitest";

import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { CountingDb, CountingDbMethod } from "../testing/counting-db";
import { putDashboardWidgetsBodySchema } from "./dashboards.schema";
import type { DashboardsService } from "./dashboards.service";

/**
 * `F3.1b` Task 4 — RLS-backed proof of what `DashboardsService` actually does with a REAL
 * connection. Assertions live here; `dashboards.service.rls.integration.test.ts` is the
 * Vitest entry point (ADR 0014) and owns the database lifecycle.
 */

/**
 * **Pool routing on create.** `countingDb(tenantDb).transactions() === 1`: the write AND its
 * folded read-back both run inside the one `withTenant` transaction `create()` opens — see
 * that method's own comment for why the read-back is folded rather than a second
 * `withTenant`. `countingDbMethod(fleetDb, "insert").calls() === 0`: nothing about a
 * tenant-scoped create touches the fleet pool's `.insert` (E7.1c's own generalisation of
 * `countingDb`, since `fetchRowForWrite` on other routes uses a plain `.select`, never
 * `.insert`, on `fleetDb`).
 */
export async function assertCreateRoutesOnTenantPoolOnly(
  service: DashboardsService,
  countedTenant: CountingDb,
  countedFleetInsert: CountingDbMethod,
  actor: JwtPayload,
  organizationId: string,
  slug: string,
): Promise<{ id: string }> {
  const tenantBefore = countedTenant.transactions();
  const fleetInsertBefore = countedFleetInsert.calls();

  const dto = await service.create(actor, {
    organizationId,
    slug,
    name: "F3.1b RLS proof",
  } as Parameters<DashboardsService["create"]>[1]);

  expect(countedTenant.transactions(), "create() must open exactly one tenant transaction").toBe(
    tenantBefore + 1,
  );
  expect(
    countedFleetInsert.calls(),
    "create() must never .insert on the fleet pool",
  ).toBe(fleetInsertBefore);
  expect(dto.id).toBeTruthy();
  expect(dto.slug).toBe(slug);
  expect(dto.organizationId).toBe(organizationId);
  // createdAt === updatedAt on a freshly created row — the FIRST half of "the DTO reflects
  // the write", proven without a transaction count.
  expect(dto.updatedAt).toBe(dto.createdAt);

  return { id: dto.id };
}

/**
 * The audit row, read back on a SEPARATE fleet connection — proving the write COMMITTED
 * rather than merely being issued inside a transaction this test also opened.
 */
export async function assertCreateAuditRowStamped(
  fleetDb: BmsDb,
  dashboardId: string,
  organizationId: string,
): Promise<void> {
  const rows = await fleetDb.execute(
    sql`SELECT organization_id, action FROM bms.audit_log
         WHERE entity_type = 'dashboard' AND entity_id = ${dashboardId}
           AND action = 'master.dashboard.create'`,
  );
  const row = rows.rows[0] as { organization_id: string | null; action: string } | undefined;
  expect(row, "no audit_log row for this create — the write did not commit or was not audited").toBeDefined();
  expect(row?.organization_id, "the audit row's organization_id must be stamped, never NULL").toBe(
    organizationId,
  );
  expect(row?.action).toBe("master.dashboard.create");
}

/**
 * **The read-back is gated by BEHAVIOUR, not a transaction count.** `countingDb` intercepts
 * only top-level `.transaction`, so a folded read-back inside `putWidgets`'s one `withTenant`
 * is invisible to it — a "one transaction" assertion would pass whether the read-back is
 * folded, separate, or silently dropped. Gate instead on the RETURNED DTO reflecting the
 * write, checked against a SEPARATE fleet-connection read of the same rows — new widget
 * count, and `updatedAt` strictly later than before the call. Same blindness
 * `maintenance.service.rls.integration.spec.ts:336` already records from the write side.
 */
export async function assertPutWidgetsDtoReflectsTheWrite(
  service: DashboardsService,
  fleetDb: BmsDb,
  actor: JwtPayload,
  dashboardId: string,
  pointId: string,
): Promise<void> {
  const before = await service.getBySlug(actor, await slugFor(fleetDb, dashboardId));
  expect(before.widgets.length, "fixture must start with zero widgets").toBe(0);

  // PARSED, not cast, and `F3.35` Stage C is why the cast had to go.
  //
  // This read `{...} as Parameters<DashboardsService["putWidgets"]>[2]`, which claimed a body
  // the schema had never seen. `putWidgets` takes an ALREADY-PARSED body, so every default the
  // schema fills — `points[].role`, `points[].sortOrder`, and now `sources` — was simply absent
  // at run time. Adding `sources` to the widget arms turned that from latent into a live
  // `TypeError: Cannot read properties of undefined (reading 'length')` inside `insertSources`,
  // and the cast then stopped compiling at all: the fabricated shape no longer overlapped the
  // union it was pretending to be.
  //
  // Parsing is the fix rather than widening to `as unknown as`. It costs one call, it fills the
  // defaults the service is entitled to assume, and it means this fixture cannot drift from the
  // request contract again — the next field with a default arrives filled instead of undefined.
  const after = await service.putWidgets(
    actor,
    dashboardId,
    putDashboardWidgetsBodySchema.parse({
      widgets: [
        {
          widgetType: "value_tile",
          title: "Total kW",
          gridX: 0,
          gridY: 0,
          gridW: 3,
          gridH: 2,
          config: {},
          points: [{ pointId }],
        },
      ],
    }),
  );

  expect(after.widgets.length, "the returned DTO must show the new widget count").toBe(1);
  expect(
    new Date(after.updatedAt).getTime(),
    "updatedAt must move forward — the DTO must reflect the write it just made",
  ).toBeGreaterThan(new Date(before.updatedAt).getTime());

  const onFleet = await fleetDb.execute(
    sql`SELECT COUNT(*)::int AS n FROM bms.dashboard_widgets WHERE dashboard_id = ${dashboardId}`,
  );
  expect(
    (onFleet.rows[0] as { n: number }).n,
    "a separate fleet-connection read must also see exactly one widget row — proves the write committed",
  ).toBe(1);
}

/**
 * `F3.2` Task 3 — an ASSET-scoped create actually lands `asset_id`, and lands NOTHING in
 * `asset_template_id`.
 *
 * Read back on a separate fleet connection with independent SQL, never from the returned DTO:
 * a service asserted against its own queries proves only that it is self-consistent, which a
 * mapper that echoes the request body also is. The `asset_template_id IS NULL` half is the
 * sharp one — that column is the INSTANTIATION stamp (ADR 0067 decision 2), and a hand-built
 * dashboard claiming to have been generated from a template version would make the backfill's
 * skip query silently skip an asset that never received its defaults.
 */
export async function assertAssetScopedCreateLandsTheAssetAndNoStamp(
  service: DashboardsService,
  fleetDb: BmsDb,
  actor: JwtPayload,
  organizationId: string,
  assetId: string,
  slug: string,
  /**
   * Called with the new row's id BEFORE any assertion runs. The two rows this
   * helper leaked on 2026-09-16 were created by a reviewer's mutation runs: the
   * assertion below threw, the id never reached the caller's cleanup list, and
   * the row outlived the run. A helper that creates must hand the id back
   * before it judges the row.
   */
  track: (id: string) => void,
): Promise<{ id: string }> {
  const dto = await service.create(actor, {
    organizationId,
    slug,
    name: "F3.2 asset-scoped create proof",
    assetId,
  } as Parameters<DashboardsService["create"]>[1]);
  track(dto.id);

  // The RETURNED DTO as well as the committed row. `loadFullDto` builds it from a re-read of
  // the row, so a hardcoded `assetId: null` there would typecheck, commit the correct row, and
  // still hand the caller a DTO that denies the scope it just wrote — invisible to the
  // independent-SQL half below, which is why both halves are asserted.
  expect(dto.assetId, "the returned DTO must report the asset scope it just wrote").toBe(assetId);
  expect(dto.assetTemplateId, "a hand-built dashboard carries no instantiation stamp").toBeNull();

  const rows = await fleetDb.execute(
    sql`SELECT asset_id, asset_template_id, location_id, asset_group_id
          FROM bms.dashboards WHERE id = ${dto.id}`,
  );
  const row = rows.rows[0] as
    | {
        asset_id: string | null;
        asset_template_id: string | null;
        location_id: string | null;
        asset_group_id: string | null;
      }
    | undefined;
  expect(row, "the asset-scoped dashboard did not commit").toBeDefined();
  expect(row?.asset_id, "create() must write body.assetId into dashboards.asset_id").toBe(assetId);
  expect(
    row?.asset_template_id,
    "asset_template_id is the instantiation stamp — a hand-built create must never set it",
  ).toBeNull();
  expect(row?.location_id, "an asset-scoped dashboard must carry no location scope").toBeNull();
  expect(row?.asset_group_id, "an asset-scoped dashboard must carry no group scope").toBeNull();

  return { id: dto.id };
}

/**
 * `F3.2` Task 3 — PATCHing a `locationId` onto a row whose STORED scope is an asset is refused
 * by the merged three-way guard with a 400 that names `assetId`.
 *
 * **The message text is the assertion, not merely the status.** With the guard still counting
 * two axes, the merge passes it, the `UPDATE` reaches `dashboards_scope_check` (migration
 * 0073's count form), and the caller gets a bare `23514` carrying a constraint name — a 500,
 * or at best a 400 that says nothing about which fields conflict. Asserting on the sentence is
 * what tells those two outcomes apart.
 */
export async function assertAddingALocationToAnAssetScopedDashboardIs400(
  service: DashboardsService,
  actor: JwtPayload,
  assetScopedDashboardId: string,
  locationId: string,
): Promise<void> {
  let caught: unknown;
  try {
    await service.update(actor, assetScopedDashboardId, { locationId });
  } catch (err) {
    caught = err;
  }
  expect(caught, "setting a locationId on an asset-scoped dashboard must be refused").toBeDefined();
  expect(caught, "the refusal must be the service's own 400, not the database's 23514").toMatchObject({
    status: 400,
  });
  const message = String((caught as Error)?.message ?? caught);
  expect(
    message,
    `the 400 must name assetId as one of the conflicting axes, got: ${message}`,
  ).toContain("assetId");
  expect(
    message,
    "must NOT surface the constraint name — that is the shape a missing guard produces",
  ).not.toContain("dashboards_scope_check");
}

/**
 * `F3.2` Task 3 — `list()` reports the asset's OWN code for an asset-scoped row (ADR 0067
 * §"Gate questions" Q4: the badge reads `Asset · <code>`).
 *
 * **Run with a single-organization actor on purpose.** A multi-organization caller takes
 * `withOrganizationReadScope`'s FLEET branch, which runs as `bms_fleet` (`BYPASSRLS`) — it
 * would pass over a `leftJoin(assets)` that `bms_tenant` has no grant or no policy for. The
 * tenant branch is the one every scoped caller uses, so it is the one this proves.
 *
 * The expected code is read by independent SQL from `bms.assets`, never taken from the
 * fixture's own variable.
 */
export async function assertListReportsTheAssetCode(
  service: DashboardsService,
  fleetDb: BmsDb,
  singleOrgActor: JwtPayload,
  assetScopedDashboardId: string,
  assetId: string,
): Promise<void> {
  const codeRows = await fleetDb.execute(sql`SELECT code FROM bms.assets WHERE id = ${assetId}`);
  const expectedCode = (codeRows.rows[0] as { code: string } | undefined)?.code;
  expect(expectedCode, "the fixture asset must exist — run pnpm db:seed").toBeTruthy();

  const listed = await service.list(singleOrgActor);
  const item = listed.items.find((candidate) => candidate.id === assetScopedDashboardId);
  expect(item, "a scoped reader must still see the asset-scoped dashboard — read is org-wide").toBeDefined();
  expect(item?.assetId, "the summary must carry the asset scope").toBe(assetId);
  expect(
    item?.assetCode,
    "the summary must carry the JOINED asset code, not null — the leftJoin(assets) is missing",
  ).toBe(expectedCode);

  // The positive control's neighbour: a row with no asset scope must still list, with a null
  // code. Without this, an inner join that dropped every organization-wide dashboard would
  // leave the assertion above perfectly green.
  const organizationWide = listed.items.find((candidate) => candidate.assetId === null);
  expect(
    organizationWide,
    "a non-asset-scoped dashboard must still be listed — leftJoin, never an inner join",
  ).toBeDefined();
  expect(organizationWide?.assetCode, "a non-asset-scoped row reports a null assetCode").toBeNull();
}

async function slugFor(fleetDb: BmsDb, dashboardId: string): Promise<string> {
  const rows = await fleetDb.execute(sql`SELECT slug FROM bms.dashboards WHERE id = ${dashboardId}`);
  return (rows.rows[0] as { slug: string }).slug;
}

/**
 * Cross-tenant read: an ESKOM-scoped caller reading a PHEWB dashboard by its own slug (which
 * happens to collide with nothing in ESKOM) gets a 404 — not a row, and not a 403 that would
 * disclose it exists in another organization.
 */
export async function assertCrossTenantSlugReadIs404(
  service: DashboardsService,
  eskomScopedActor: JwtPayload,
  phewbSlug: string,
): Promise<void> {
  await expect(service.getBySlug(eskomScopedActor, phewbSlug)).rejects.toMatchObject({
    status: 404,
  });
}

/**
 * `F3.69` step-5 security review, Low 2, N1 — the negative pair with the request shape the web
 * actually sends: `SiteDashboardView` (D3) always passes `organizationId`, so
 * `assertCrossTenantSlugReadIs404` above (no third argument) never exercises the caller-supplied
 * `organizationId` at all. This calls `getBySlug` with the SAME single-organization (tenant
 * branch) actor as that test, but passes the FOREIGN organization's own id as the explicit third
 * argument — proving the tenant branch's `withTenant(tenantDb, <actor's own org>, ...)` (never
 * the passed `organizationId`) is what scopes the read, so the extra `eq(organizationId, …)`
 * condition in `getBySlug` can only narrow a read, never widen it onto another organization's
 * GUC. Still 404: RLS never resolves the PHEWB row under the ESKOM GUC, whatever the caller
 * claims `organizationId` is.
 */
export async function assertTenantBranchIgnoresAnExplicitForeignOrganizationId(
  service: DashboardsService,
  eskomScopedActor: JwtPayload,
  phewbSlug: string,
  phewbOrgId: string,
): Promise<void> {
  await expect(service.getBySlug(eskomScopedActor, phewbSlug, phewbOrgId)).rejects.toMatchObject({
    status: 404,
  });
}

/**
 * `F3.69` U4 — the positive control the suite lacked: a `location_admin` actually reads a
 * dashboard scoped to ITS OWN location by slug. `readableOrganizationIds` resolves
 * `location_admin` through the single `"location"` source (`readScopeSourcesForRole`), which is
 * a single organization, so `getBySlug` takes the tenant branch — the same branch
 * `assertCrossTenantSlugReadIs404` (above) proves refuses a FOREIGN organization's slug for the
 * SAME actor shape. That is A1's negative pair: same actor, same branch, opposite organization.
 *
 * **This is not the `organizationIdFilter` mutation's proof.** `F3.69`'s plan asks A2 to drop
 * `organizationIdFilter` in `getBySlug`. On the tenant branch (a single-organization actor, this
 * one included) `withOrganizationReadScope` passes `organizationIdFilter = null`, so removing
 * the `if (organizationIdFilter)` guard changes nothing here or in
 * `assertCrossTenantSlugReadIs404` — RLS is the only isolation control on that branch, not the
 * filter. That mutation only has a leg to stand on on the FLEET branch (a multi-organization
 * actor, `bms_fleet` under `BYPASSRLS`), and `assertFleetBranchExcludesAForeignOrganization`'s
 * final `getBySlug` assertion already exercises exactly that — measured by applying the
 * mutation: `finding 1 (HIGH) — a two-organization caller's fleet-branch read excludes a third
 * organization` turned red (a dashboard resolved instead of a 404), while this suite's other 16
 * cases, including `assertCrossTenantSlugReadIs404`, stayed green. No A2 is added here — it
 * would duplicate that existing case.
 */
export async function assertLocationReaderMayReadItsSitesDashboardBySlug(
  service: DashboardsService,
  eskomLocationAdmin: JwtPayload,
  slug: string,
  eskomOrgId: string,
  expectedLocationId: string,
): Promise<void> {
  const dto = await service.getBySlug(eskomLocationAdmin, slug, eskomOrgId);
  expect(
    dto.locationId,
    "a location_admin reading its own site's dashboard by slug must get that site's DTO back",
  ).toBe(expectedLocationId);
}

/**
 * `F4.161` U4 — the `F3.69` end-to-end claim: a `viewer` whose organization grant reaches no
 * active site (a fresh organization with no location at all) and whose location grant sits in a
 * DIFFERENT organization (ESKOM) still reads that site's dashboard by slug.
 *
 * Before `F4.161`, `readableOrganizationIds` stopped at the first grant SOURCE with any row at
 * all — here, the `organization` source, which resolves to the fresh empty organization's own
 * id and nothing in ESKOM — so this viewer's read of an ESKOM site dashboard 404'd even though
 * `scopeForUser` (and so `currentUser`) already reported the ESKOM location scope, the same one
 * {@link assertLocationReaderMayReadItsSitesDashboardBySlug} proves a `location_admin` gets. This
 * is the mixed-grant case the fix exists for: a two-source role (`viewer`) whose first source
 * yields no active site, and whose read must fall through to the second source that does.
 */
export async function assertMixedGrantViewerReadsItsSitesDashboardBySlug(
  service: DashboardsService,
  viewerJwt: JwtPayload,
  slug: string,
  eskomOrgId: string,
  expectedLocationId: string,
): Promise<void> {
  const dto = await service.getBySlug(viewerJwt, slug, eskomOrgId);
  expect(
    dto.locationId,
    "a viewer whose org grant reaches no active site must still read its site's dashboard by " +
      "slug, through the location grant readableOrganizationIds now falls through to",
  ).toBe(expectedLocationId);
}

/**
 * Cross-tenant write, id-addressed: an ESKOM `admin` targeting a PHEWB dashboard's id through
 * `update()` gets the SAME 404 a nonexistent id would — `rules.service.ts:753-757`'s
 * cross-tenant-existence-oracle precedent. `fetchRowForWrite` runs on `fleetDb` (BYPASSRLS) and
 * WOULD find the row; `canManageDashboard` is what refuses it, and the refusal is folded into
 * the same 404 as "no such id" rather than surfaced as a distinguishable 403.
 */
export async function assertForeignOrgIdUpdateIs404SameAsNonexistent(
  service: DashboardsService,
  eskomOrgAdmin: JwtPayload,
  phewbDashboardId: string,
): Promise<void> {
  const nonexistentId = "00000000-0000-4000-8000-0000000000ff";

  let foreignMessage: unknown;
  try {
    await service.update(eskomOrgAdmin, phewbDashboardId, { name: "should not land" });
  } catch (err) {
    foreignMessage = (err as { response?: unknown; message?: unknown }).response ?? (err as Error).message;
  }
  let nonexistentMessage: unknown;
  try {
    await service.update(eskomOrgAdmin, nonexistentId, { name: "should not land" });
  } catch (err) {
    nonexistentMessage = (err as { response?: unknown; message?: unknown }).response ?? (err as Error).message;
  }

  expect(foreignMessage, "a foreign-org dashboard id must be refused").toBeDefined();
  expect(
    foreignMessage,
    "a foreign-org id and a nonexistent id must produce the SAME body — otherwise the error " +
      "is a cross-tenant existence oracle",
  ).toEqual(nonexistentMessage);
}

/**
 * Cross-tenant write, scope: creating an ESKOM-stamped dashboard scoped to a PHEWB
 * `location_id` is refused by `tenant_isolation`'s `WITH CHECK` — `0050`'s header records that
 * `WITH CHECK` runs before the foreign key's `AFTER` trigger, so this is an RLS refusal, not
 * `dashboards_location_id_fkey`. Assert the message names row-level security, and does NOT
 * name the constraint.
 */
export async function assertCrossOrgLocationScopeRefusedByRls(
  service: DashboardsService,
  eskomAdmin: JwtPayload,
  eskomOrgId: string,
  phewbLocationId: string,
  slug: string,
): Promise<void> {
  let caught: unknown;
  try {
    await service.create(eskomAdmin, {
      organizationId: eskomOrgId,
      slug,
      name: "F3.1b cross-org scope proof",
      locationId: phewbLocationId,
    } as Parameters<DashboardsService["create"]>[1]);
  } catch (err) {
    caught = err;
  }

  expect(caught, "an ESKOM dashboard scoped to a PHEWB location must be refused").toBeDefined();
  const message = String((caught as Error)?.message ?? caught);
  expect(
    message,
    `expected a row-level-security refusal, got: ${message}`,
  ).toMatch(/row-level security|policy/i);
  expect(
    message,
    "must NOT name the foreign key — 0050's header records WITH CHECK runs before the FK's AFTER trigger",
  ).not.toMatch(/dashboards_location_id_fkey/i);
}

/**
 * `F3.34` (security review, Medium) — the **group axis** of the case above, on `create` AND on
 * `update`. The row lets an `admin` or `organization_admin` pick an asset group in the UI, and
 * for those two roles `canManageDashboard` answers before `assetGroupBelongsToOrganization`
 * ever runs (`admin` is unconditionally true; `organization_admin` is `canManageOrganization`),
 * so the ONLY server-side refusal of a foreign `assetGroupId` is `tenant_isolation`'s
 * `WITH CHECK` on `bms.dashboards` (`0073`: `asset_group_id IS NULL OR EXISTS (… g.organization_id
 * = current org)`), translated by `translateWriteError` to a 400 that names `assetGroupId`.
 * The location axis had this proof; the group axis did not, so a migration that re-created
 * the policy without the group `EXISTS` clause would have turned no test red. Both legs assert
 * the 400 names the field and not the foreign key.
 */
export async function assertCrossOrgAssetGroupScopeIs400NamingAssetGroupId(
  service: DashboardsService,
  eskomAdmin: JwtPayload,
  eskomOrgId: string,
  phewbAssetGroupId: string,
  createSlug: string,
  existingEskomDashboardId: string,
): Promise<void> {
  let createCaught: unknown;
  try {
    await service.create(eskomAdmin, {
      organizationId: eskomOrgId,
      slug: createSlug,
      name: "F3.34 cross-org group scope proof",
      assetGroupId: phewbAssetGroupId,
    } as Parameters<DashboardsService["create"]>[1]);
  } catch (err) {
    createCaught = err;
  }
  expect(createCaught, "an ESKOM dashboard created with a PHEWB assetGroupId must be refused").toBeDefined();
  const createMessage = String((createCaught as Error)?.message ?? createCaught);
  expect(createMessage, `create: expected the RLS 400 naming assetGroupId, got: ${createMessage}`).toMatch(
    /assetGroupId .* row-level security/i,
  );
  expect(createMessage, "create: must NOT name the foreign key").not.toMatch(/asset_group_id_fkey/i);

  let updateCaught: unknown;
  try {
    await service.update(eskomAdmin, existingEskomDashboardId, {
      locationId: null,
      assetGroupId: phewbAssetGroupId,
    });
  } catch (err) {
    updateCaught = err;
  }
  expect(updateCaught, "an ESKOM dashboard moved onto a PHEWB assetGroupId must be refused").toBeDefined();
  const updateMessage = String((updateCaught as Error)?.message ?? updateCaught);
  expect(updateMessage, `update: expected the RLS 400 naming assetGroupId, got: ${updateMessage}`).toMatch(
    /assetGroupId .* row-level security/i,
  );
  expect(updateMessage, "update: must NOT name the foreign key").not.toMatch(/asset_group_id_fkey/i);
}

/**
 * **Finding 1 (review, HIGH) — the fleet-branch negative.** `assertCrossTenantSlugReadIs404`-
 * style tests that use a SINGLE-organization actor exercise only the TENANT branch, where the
 * `0047` `FORCE` RLS policy masks a missing caller-side filter — which is exactly how the
 * original `readableAssetIds`-routed implementation shipped with a cross-tenant read leak that
 * every earlier test passed. This is the test that only fails if `withOrganizationReadScope`'s
 * fleet branch is missing its `inArray(dashboards.organizationId, organizationIdFilter)`
 * filter: a genuinely two-organization caller (ADR 0043 decision 3's documented fallback —
 * `organization_admin` with two `user_organization_access` rows) must see only ITS OWN two
 * organizations' dashboards, never a third, unrelated organization's — not as a row in
 * `list()`, and not even as the ambiguity-disclosing 400 `getBySlug` used to be capable of.
 */
export async function assertFleetBranchExcludesAForeignOrganization(
  service: DashboardsService,
  twoOrgActor: JwtPayload,
  ownOrgIds: readonly string[],
  foreignOrgDashboard: { readonly id: string; readonly slug: string },
): Promise<void> {
  const listed = await service.list(twoOrgActor);
  expect(
    listed.items.some((item) => item.id === foreignOrgDashboard.id),
    "a two-organization caller's list() must not include a third organization's dashboard",
  ).toBe(false);
  for (const item of listed.items) {
    expect(
      ownOrgIds.includes(item.organizationId),
      `list() returned a dashboard (${item.id}, org ${item.organizationId}) outside the ` +
        "caller's own two organizations — the fleet-branch leak this test exists to catch",
    ).toBe(true);
  }

  await expect(service.getBySlug(twoOrgActor, foreignOrgDashboard.slug)).rejects.toMatchObject({
    status: 404,
  });
}

/**
 * `F3.69` step-5 security review, Low 2, N2 — the fleet-branch half of the same negative pair as
 * N1, above. Same two-organization actor and same foreign dashboard as
 * {@link assertFleetBranchExcludesAForeignOrganization}, but this time the FOREIGN organization's
 * own id is passed as `getBySlug`'s explicit third argument — the shape `SiteDashboardView`
 * sends. On the fleet branch `bms_fleet` holds `BYPASSRLS`, so `organizationIdFilter`'s
 * `inArray(dashboards.organizationId, [own two orgs])` is the ONLY isolation control; a caller
 * that could pass its own `organizationId` argument to reach past that filter would leak the
 * third organization's row through the very argument the filter exists to make irrelevant.
 * Still 404: the filter conjoins with, and never yields to, the caller-supplied id.
 */
export async function assertFleetBranchExcludesAnExplicitForeignOrganizationId(
  service: DashboardsService,
  twoOrgActor: JwtPayload,
  foreignOrgDashboard: { readonly slug: string },
  foreignOrgId: string,
): Promise<void> {
  await expect(
    service.getBySlug(twoOrgActor, foreignOrgDashboard.slug, foreignOrgId),
  ).rejects.toMatchObject({
    status: 404,
  });
}

/**
 * **Finding 5 (review) — the test commit `15a1ab9`'s `update()` reorder shipped without.**
 * `dashboards.service.rls.integration.spec.ts`'s existing update() calls all send `{name}`
 * only, so the "both scope columns set" 400 branch was never reached and reverting the reorder
 * left the whole suite green. This targets a dashboard whose STORED scope already carries
 * `assetGroupId`, PATCHes only `locationId`, and — with an actor `canManageDashboard` refuses
 * for this row — asserts the SAME 404 a nonexistent id gets. Before the reorder, the
 * "both set" 400 ran first and would have disclosed both that the row exists and that its
 * stored scope is an asset group, to a caller with no authority over it.
 */
export async function assertUnauthorizedUpdateWithScopeConflictIs404(
  service: DashboardsService,
  unauthorizedActor: JwtPayload,
  dashboardIdWithStoredAssetGroupId: string,
  anyLocationId: string,
): Promise<void> {
  const nonexistentId = "00000000-0000-4000-8000-0000000000ff";

  let scopedConflictMessage: unknown;
  try {
    await service.update(unauthorizedActor, dashboardIdWithStoredAssetGroupId, {
      locationId: anyLocationId,
    });
  } catch (err) {
    scopedConflictMessage =
      (err as { response?: unknown; message?: unknown }).response ?? (err as Error).message;
  }
  let nonexistentMessage: unknown;
  try {
    await service.update(unauthorizedActor, nonexistentId, { locationId: anyLocationId });
  } catch (err) {
    nonexistentMessage =
      (err as { response?: unknown; message?: unknown }).response ?? (err as Error).message;
  }

  expect(
    scopedConflictMessage,
    "an unauthorized caller PATCHing a dashboard whose merge would violate the scope invariant must still be refused",
  ).toBeDefined();
  expect(
    scopedConflictMessage,
    "must be the SAME 404 as a nonexistent id — a distinguishable 400 here would disclose the " +
      "row exists, and that its stored scope is an asset group, before this caller has any " +
      "authority to know either",
  ).toEqual(nonexistentMessage);
}

/**
 * **Review finding (HIGH) — `update()` authorized only the target scope, never the row's
 * stored one.** A `location_admin` may list every dashboard in its organization (read is
 * organization-wide by design), then PATCH an organization-wide one with its OWN `locationId`.
 * The old check asked only "may you write to the destination", which such a PATCH passes, so an
 * ownerless, tenant-wide dashboard could be re-homed under one site by a caller ADR 0047
 * Amendment 2 ruling 2 never lets CREATE one. This asserts the re-home is refused with the same
 * 404 every other `update()` refusal on this route uses — not a 403, which would disclose that
 * the row exists and that this caller can reach it.
 */
export async function assertLocationAdminCannotRehomeOrganizationWideDashboard(
  service: DashboardsService,
  eskomLocationAdmin: JwtPayload,
  organizationWideDashboardId: string,
  eskomLocationAdminOwnLocationId: string,
): Promise<void> {
  await expect(
    service.update(eskomLocationAdmin, organizationWideDashboardId, {
      locationId: eskomLocationAdminOwnLocationId,
    }),
  ).rejects.toMatchObject({ status: 404 });
}

/**
 * The narrow half of the finding above: the fix must not become a blanket refusal. A
 * `location_admin` PATCHing a dashboard ALREADY scoped to its own location — no re-home, no
 * scope change at all — must still succeed, proven by the returned DTO reflecting the write.
 */
export async function assertLocationAdminMayStillUpdateItsOwnLocationDashboard(
  service: DashboardsService,
  eskomLocationAdmin: JwtPayload,
  ownLocationDashboardId: string,
  newName: string,
): Promise<void> {
  const after = await service.update(eskomLocationAdmin, ownLocationDashboardId, { name: newName });
  expect(after.name, "an authorized in-scope PATCH must still succeed and be reflected in the DTO").toBe(
    newName,
  );
}

/**
 * `F3.2` review (security Medium / migration High) — moving a stamped dashboard's scope OFF its
 * asset clears `asset_template_id` in the SAME `UPDATE`.
 *
 * `asset_template_id` is provenance: it says "this dashboard was instantiated from that asset
 * template version, for THAT asset". `dashboards_asset_stamp_check` (migration `0073`) encodes
 * half of it — a stamp implies an asset — so a PATCH that clears `assetId` while leaving the
 * stamp behind hits the CHECK and reaches the caller as a raw `23514`. The other half is not a
 * constraint at all and cannot be: moving the row to ANOTHER asset keeps the stamp valid to the
 * database while making it a lie, and the backfill's skip query reads exactly that column to
 * decide which assets already have their defaults.
 *
 * The stamp is written here by direct SQL because no request body may set it (ADR 0067
 * decision 2: only the instantiator does), and it is read back before the PATCH so the case
 * cannot pass by having stamped nothing.
 */
export async function assertClearingTheAssetScopeAlsoClearsTheStamp(
  service: DashboardsService,
  fleetDb: BmsDb,
  actor: JwtPayload,
  dashboardId: string,
  assetTemplateId: string,
  locationId: string,
): Promise<void> {
  await stampAssetTemplate(fleetDb, dashboardId, assetTemplateId);

  const dto = await service.update(actor, dashboardId, { locationId, assetId: null });

  expect(dto.assetId, "the PATCH must move the scope off the asset").toBeNull();
  expect(dto.locationId, "the PATCH must land the new location scope").toBe(locationId);
  expect(
    dto.assetTemplateId,
    "a dashboard that no longer names an asset must not still claim an asset-template stamp",
  ).toBeNull();
  await expectStamp(fleetDb, dashboardId, { assetId: null, assetTemplateId: null });
}

/**
 * The same clause, the other direction: a PATCH that MOVES the dashboard to a different asset
 * must not carry the old asset's stamp with it. The database permits this row — the CHECK only
 * asks that a stamp has SOME asset — so nothing but the service refuses the forged provenance.
 */
export async function assertMovingTheAssetClearsTheStamp(
  service: DashboardsService,
  fleetDb: BmsDb,
  actor: JwtPayload,
  dashboardId: string,
  assetTemplateId: string,
  otherAssetId: string,
): Promise<void> {
  await stampAssetTemplate(fleetDb, dashboardId, assetTemplateId);

  const dto = await service.update(actor, dashboardId, { assetId: otherAssetId });

  expect(dto.assetId, "the PATCH must move the scope to the other asset").toBe(otherAssetId);
  expect(
    dto.assetTemplateId,
    "a dashboard moved to another asset must not keep the stamp of the asset it came from — " +
      "the backfill's skip query would then skip an asset that never received its defaults",
  ).toBeNull();
  await expectStamp(fleetDb, dashboardId, { assetId: otherAssetId, assetTemplateId: null });
}

/** Writes the instantiation stamp no request body may set, and proves it landed. */
async function stampAssetTemplate(
  fleetDb: BmsDb,
  dashboardId: string,
  assetTemplateId: string,
): Promise<void> {
  await fleetDb.execute(
    sql`UPDATE bms.dashboards SET asset_template_id = ${assetTemplateId} WHERE id = ${dashboardId}`,
  );
  const rows = await fleetDb.execute(
    sql`SELECT asset_template_id FROM bms.dashboards WHERE id = ${dashboardId}`,
  );
  expect(
    (rows.rows[0] as { asset_template_id: string | null } | undefined)?.asset_template_id,
    "the fixture stamp did not land — the case below would assert that nothing was cleared",
  ).toBe(assetTemplateId);
}

/** The committed row, read on a separate fleet connection rather than off the returned DTO. */
async function expectStamp(
  fleetDb: BmsDb,
  dashboardId: string,
  expected: { assetId: string | null; assetTemplateId: string | null },
): Promise<void> {
  const rows = await fleetDb.execute(
    sql`SELECT asset_id, asset_template_id FROM bms.dashboards WHERE id = ${dashboardId}`,
  );
  const row = rows.rows[0] as { asset_id: string | null; asset_template_id: string | null } | undefined;
  expect(row, "the dashboard row is gone").toBeDefined();
  expect(row?.asset_id, "the committed asset scope").toBe(expected.assetId);
  expect(row?.asset_template_id, "the committed asset-template stamp").toBe(expected.assetTemplateId);
}

/**
 * `F3.2` review (security Low) — a cross-organization `assetId` on create is refused by the
 * SERVICE with a 400 that names the field, not by an untranslated database error.
 *
 * `canManageDashboard` admits a global `admin` for any organization and never looks at the
 * asset's own organization for that role, so the only thing standing between this body and a
 * committed row is `tenant_isolation`'s `WITH CHECK` on `bms.dashboards` (re-created by
 * migration `0073` to check the asset parent as well). That refusal is correct and it surfaces
 * as a 500: the caller cannot tell a mistyped `assetId` from an outage.
 *
 * Asserted on the STATUS and the field name, and on the absence of a row read back by slug on
 * the FLEET pool — a tenant-pool count returns 0 under FORCE RLS whether or not a foreign-org
 * row landed, so it would pass either way.
 */
export async function assertCrossOrgAssetScopeIs400NamingAssetId(
  service: DashboardsService,
  fleetDb: BmsDb,
  actor: JwtPayload,
  organizationId: string,
  foreignOrgAssetId: string,
  slug: string,
): Promise<void> {
  let caught: unknown;
  try {
    await service.create(actor, {
      organizationId,
      slug,
      name: "F3.2 cross-organization asset scope proof",
      assetId: foreignOrgAssetId,
    } as Parameters<DashboardsService["create"]>[1]);
  } catch (err) {
    caught = err;
  }

  expect(caught, "an asset from another organization must be refused").toBeDefined();
  expect(
    caught,
    "the refusal must be the service's own 400, not the driver's untranslated error surfacing as a 500",
  ).toMatchObject({ status: 400 });
  const message = String((caught as Error)?.message ?? caught);
  expect(message, `the 400 must name assetId, got: ${message}`).toContain("assetId");

  const rows = await fleetDb.execute(sql`SELECT id FROM bms.dashboards WHERE slug = ${slug}`);
  expect(rows.rows.length, "no dashboard row may exist for a refused create").toBe(0);
}

/**
 * `F3.31` Task 3 — `list(jwt, organizationId?, assetId?)` narrows WITHIN the caller's read
 * scope and never widens it (ADR 0068 decision 4, ruling 4).
 *
 * **Run as `bms_tenant` on purpose.** `singleOrgActor` is `wc-admin@bms.local`, a
 * single-organization, location-scoped reader: that is what routes `list()` onto
 * `withOrganizationReadScope`'s TENANT branch (`bms_tenant` under FORCE RLS) rather than the
 * fleet one (`bms_fleet`, `BYPASSRLS`). The out-of-scope case below is only a proof on the
 * branch every scoped caller uses.
 *
 * T1 — filtered to `eskomAssetId`: B (the SAME-organization neighbour on another asset) is
 * asserted absent FIRST, because with the `eq(dashboards.assetId, …)` push removed the
 * organization-wide rows (`assetId: null`) would also fail the every-item claim, and the
 * reddened assertion must name the leak, not the neighbour it hides. B is asserted present in
 * the UNFILTERED list first, so its absence is the filter's doing and not invisibility.
 *
 * T2 — filtered to `phewbAssetId`: P is proven to exist with that `asset_id` by independent
 * SQL on the FLEET pool (a tenant-pool read returns 0 rows under FORCE RLS whether or not P
 * exists), then the call RESOLVES with an empty list. A `rejects` here is ruling 4's refused
 * shape — a 403 would confirm the id exists.
 *
 * **What T2 holds and what it does not.** On the tenant branch the empty list comes from
 * FORCE RLS, not from the `assetId` predicate: probed as `bms_tenant` under ESKOM, P counts 0
 * with and without the predicate. So T2 proves ruling 4's SHAPE (resolves, never throws) and
 * cannot redden for a filter that widens scope on the FLEET branch — a refactor that puts the
 * `assetId` condition outside `and(...conditions)` keeps T1 and T2 green and leaks for a
 * two-organization caller. That case needs a third organization with an asset carrying the
 * filtered id (an org → location → asset fixture chain this suite does not build); it is
 * recorded as a residual in the `F3.31` closure row, not claimed here.
 */
export async function assertListFiltersByAssetIdWithinScope(
  service: DashboardsService,
  fleetDb: BmsDb,
  singleOrgActor: JwtPayload,
  fixtures: {
    readonly eskomAssetId: string;
    readonly dashboardAId: string;
    readonly dashboardBId: string;
    readonly phewbAssetId: string;
    readonly dashboardPId: string;
  },
): Promise<void> {
  const unfiltered = await service.list(singleOrgActor);
  expect(
    unfiltered.items.some((item) => item.id === fixtures.dashboardBId),
    "control: the unfiltered list must contain B, or its absence below proves nothing",
  ).toBe(true);

  const filtered = await service.list(singleOrgActor, undefined, fixtures.eskomAssetId);
  expect(
    filtered.items.some((item) => item.id === fixtures.dashboardBId),
    "B is scoped to ANOTHER asset in the same organization and must not be listed — the " +
      "assetId filter is not applied",
  ).toBe(false);
  expect(
    filtered.items.some((item) => item.id === fixtures.dashboardAId),
    "A is scoped to the requested asset and must be listed",
  ).toBe(true);
  for (const item of filtered.items) {
    expect(item.assetId, `item ${item.id} is not scoped to the requested asset`).toBe(
      fixtures.eskomAssetId,
    );
  }

  const control = await fleetDb.execute(
    sql`SELECT asset_id FROM bms.dashboards WHERE id = ${fixtures.dashboardPId}`,
  );
  const pRow = control.rows[0] as { asset_id: string | null } | undefined;
  expect(pRow?.asset_id, "control: P must exist with asset_id = the PHEWB asset").toBe(
    fixtures.phewbAssetId,
  );

  const outOfScope = await service.list(singleOrgActor, undefined, fixtures.phewbAssetId);
  expect(
    outOfScope.items.length,
    "an out-of-scope assetId answers [] on the tenant branch — never a throw (ruling 4)",
  ).toBe(0);
}
