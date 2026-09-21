import { ForbiddenException } from "@nestjs/common";
import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import { SEEDED, jwtFor } from "./access-control.integration.spec";
import type { AccessControlService } from "./access-control.service";

/**
 * `F3.5a` — ADR 0071 decision 6 (as amended by Amendment 1 items 1–3), proven
 * against the seeded users on a real database.
 *
 * The three methods under test are the whole authority for who may read a
 * report file: `canReadReportFile` is the row verdict a download or delete
 * asks for, `reportFileReadScope` is the input the list route turns into a
 * SQL predicate, and `readableAssetIdsInOrganization` bounds what an
 * on-demand render may contain. None of them can be proven by a unit test
 * with a fake handle: every branch is a grant walk, and the negative each row
 * needs (a second organization, an uncovered location id) is a fixture only
 * `pnpm db:seed` supplies.
 *
 * Read-only by construction — nothing here inserts, updates or deletes. The
 * expectations are computed with independent SQL through the pool, never read
 * back from the service, for the reason `access-control.integration.spec.ts`
 * gives: a service asserted against its own queries is only self-consistent.
 *
 * One claim per `it()`, so a mutation reddens the row that owns the claim and
 * no earlier `expect` in the same block hides it.
 */

/** Seeded ids the rows need, resolved by **code** at run time — never a uuid literal. */
export type ReportFileFixtures = {
  eskomId: string;
  phewbId: string;
  /** `RSMOC-WC` — the one location `wc-admin@bms.local` holds. */
  wcId: string;
  /** `RSMOC-GP` — an active ESKOM location `wc-admin@bms.local` does not hold. */
  otherEskomId: string;
};

const MASTER_DATA_SENTENCE =
  "Master data administration requires admin, organization_admin, or location_admin role";
const OUT_OF_SCOPE_SENTENCE = "Report file is outside your access scope";

/** Emails that resolve to no `bms.users` row fall through to their claim role. */
const UNPROVISIONED_VIEWER = "no-grants-viewer@integration.invalid";

/** Captures a rejection. A call that resolves fails here, never inside a `catch`. */
async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  let resolved = false;
  let thrown: unknown;
  try {
    await run();
    resolved = true;
  } catch (err) {
    thrown = err;
  }
  if (resolved) {
    throw new Error("expected the call to reject, but it resolved");
  }
  return thrown;
}

function setEquals(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((id) => sb.has(id));
}

async function idByCode(pool: pg.Pool, table: "organizations" | "locations", code: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.${table} WHERE code = $1`,
    [code],
  );
  const id = rows[0]?.id;
  if (!id || rows.length !== 1) {
    throw new Error(
      `report-file-access: expected exactly one bms.${table} row with code ${code}, found ${rows.length} — run pnpm db:seed`,
    );
  }
  return id;
}

/**
 * Resolves the four seeded ids. Fails, with the missing code named, on an
 * unseeded database rather than letting every containment row pass vacuously.
 */
export async function loadReportFileFixtures(pool: pg.Pool): Promise<ReportFileFixtures> {
  const [eskomId, phewbId, wcId, otherEskomId] = await Promise.all([
    idByCode(pool, "organizations", "ESKOM"),
    idByCode(pool, "organizations", "PHEWB"),
    idByCode(pool, "locations", "RSMOC-WC"),
    idByCode(pool, "locations", "RSMOC-GP"),
  ]);
  // The rows below assume these two facts about the seed; check them here so a
  // changed seed fails with a sentence instead of a wrong verdict.
  const { rows: grants } = await pool.query<{ location_id: string }>(
    `SELECT a.location_id FROM bms.user_location_access a
       JOIN bms.users u ON u.id = a.user_id
      WHERE u.email = $1`,
    [SEEDED.locationAdmin],
  );
  const granted = new Set(grants.map((r) => r.location_id));
  if (!granted.has(wcId)) {
    throw new Error(`report-file-access: ${SEEDED.locationAdmin} does not hold RSMOC-WC`);
  }
  if (granted.has(otherEskomId)) {
    throw new Error(`report-file-access: ${SEEDED.locationAdmin} holds RSMOC-GP; pick another code`);
  }
  return { eskomId, phewbId, wcId, otherEskomId };
}

const admin = (): JwtPayload => jwtFor(SEEDED.globalAdmin, "admin");
const pheAdmin = (): JwtPayload => jwtFor(SEEDED.organizationAdmin, "organization_admin");
const wcAdmin = (): JwtPayload => jwtFor(SEEDED.locationAdmin, "location_admin");
const wcHvacAdmin = (): JwtPayload => jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");

// ---------------------------------------------------------------------------
// canReadReportFile — decision 6's read rule
// ---------------------------------------------------------------------------

/** `admin` reads every file: another organization's, and one with an empty array. */
export async function globalAdminReadsEverything(
  svc: AccessControlService,
  fx: ReportFileFixtures,
): Promise<void> {
  const own = await svc.canReadReportFile(admin(), { organizationId: fx.eskomId, locationIds: [] });
  const foreign = await svc.canReadReportFile(admin(), {
    organizationId: fx.phewbId,
    locationIds: [fx.wcId],
  });
  if (own !== true || foreign !== true) {
    throw new Error(`admin: expected true/true, got ${String(own)}/${String(foreign)}`);
  }
}

/** `phe-admin` reads PHEWB's files and is refused ESKOM's — the negative the rule needs. */
export async function organizationAdminReadsItsOwnOrganizationOnly(
  svc: AccessControlService,
  fx: ReportFileFixtures,
): Promise<void> {
  const own = await svc.canReadReportFile(pheAdmin(), { organizationId: fx.phewbId, locationIds: [] });
  const foreign = await svc.canReadReportFile(pheAdmin(), {
    organizationId: fx.eskomId,
    locationIds: [],
  });
  if (own !== true || foreign !== false) {
    throw new Error(`phe-admin: expected true/false, got ${String(own)}/${String(foreign)}`);
  }
}

/** `wc-admin` reads a file whose every location id it holds. */
export async function locationAdminReadsWhenEveryIdIsCovered(
  svc: AccessControlService,
  fx: ReportFileFixtures,
): Promise<void> {
  const verdict = await svc.canReadReportFile(wcAdmin(), {
    organizationId: fx.eskomId,
    locationIds: [fx.wcId],
  });
  if (verdict !== true) {
    throw new Error(`wc-admin on [WC]: expected true, got ${String(verdict)}`);
  }
}

/** One uncovered id refuses the whole file — `every`, not `some`. */
export async function locationAdminIsRefusedByOneUncoveredId(
  svc: AccessControlService,
  fx: ReportFileFixtures,
): Promise<void> {
  const verdict = await svc.canReadReportFile(wcAdmin(), {
    organizationId: fx.eskomId,
    locationIds: [fx.wcId, fx.otherEskomId],
  });
  if (verdict !== false) {
    throw new Error(`wc-admin on [WC, OTHER]: expected false, got ${String(verdict)}`);
  }
}

/**
 * Step-5 security L1 — the location verdict checks the organization too. A
 * file stamped with PHEWB's `organization_id` and `wc-admin`'s own `RSMOC-WC`
 * location id (a row no honest writer produces, but one the verdict must
 * still refuse) is outside `wc-admin`'s organizations. Before the fix the
 * branch ran only the `every` over `locationIds` and answered true.
 * `locationAdminReadsWhenEveryIdIsCovered` is the positive control: the same
 * location ids under ESKOM answer true.
 */
export async function locationAdminIsRefusedByAForeignOrganization(
  svc: AccessControlService,
  fx: ReportFileFixtures,
): Promise<void> {
  const verdict = await svc.canReadReportFile(wcAdmin(), {
    organizationId: fx.phewbId,
    locationIds: [fx.wcId],
  });
  if (verdict !== false) {
    throw new Error(`wc-admin on PHEWB/[WC]: expected false, got ${String(verdict)}`);
  }
}

/** An empty array means the whole organization, which a location admin does not hold. */
export async function locationAdminIsRefusedByAnEmptyArray(
  svc: AccessControlService,
  fx: ReportFileFixtures,
): Promise<void> {
  const verdict = await svc.canReadReportFile(wcAdmin(), {
    organizationId: fx.eskomId,
    locationIds: [],
  });
  if (verdict !== false) {
    throw new Error(`wc-admin on []: expected false, got ${String(verdict)}`);
  }
}

/**
 * `wc-hvac-admin` (`asset_group_admin`) is refused by `assertMasterDataRole`
 * with that guard's sentence — and **not** with the out-of-scope sentence the
 * service's download route uses for a covered role. One error class, many
 * guards: the message is the only evidence of which one fired.
 */
export async function assetGroupAdminIsRefusedWithTheMasterDataSentence(
  svc: AccessControlService,
  fx: ReportFileFixtures,
): Promise<void> {
  const err = await captureRejection(() =>
    svc.canReadReportFile(wcHvacAdmin(), { organizationId: fx.eskomId, locationIds: [fx.wcId] }),
  );
  if (!(err instanceof ForbiddenException)) {
    throw new Error(`wc-hvac-admin: expected ForbiddenException, got ${String(err)}`);
  }
  if (err.getStatus() !== 403) {
    throw new Error(`wc-hvac-admin: expected status 403, got ${err.getStatus()}`);
  }
  if (err.message === OUT_OF_SCOPE_SENTENCE) {
    throw new Error("wc-hvac-admin: the out-of-scope guard fired, not the master-data role guard");
  }
  if (err.message !== MASTER_DATA_SENTENCE) {
    throw new Error(`wc-hvac-admin: unexpected message ${JSON.stringify(err.message)}`);
  }
}

/** A viewer is refused with 403 before any grant is read. */
export async function viewerIsRefused(
  svc: AccessControlService,
  fx: ReportFileFixtures,
): Promise<void> {
  const err = await captureRejection(() =>
    svc.canReadReportFile(jwtFor(UNPROVISIONED_VIEWER, "viewer"), {
      organizationId: fx.eskomId,
      locationIds: [],
    }),
  );
  if (!(err instanceof ForbiddenException) || err.getStatus() !== 403) {
    throw new Error(`viewer: expected a 403 ForbiddenException, got ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// reportFileReadScope — the list route's inputs
// ---------------------------------------------------------------------------

/**
 * Three roles, three kinds. `wc-admin`'s `locationIds` must equal exactly its
 * `user_location_access` rows and its `organizationIds` the organizations
 * those locations belong to — both counted from the source, not the service.
 */
export async function readScopeKindsPerRole(
  svc: AccessControlService,
  pool: pg.Pool,
  fx: ReportFileFixtures,
): Promise<void> {
  const global = await svc.reportFileReadScope(admin());
  if (global.kind !== "global") {
    throw new Error(`admin: expected kind global, got ${global.kind}`);
  }

  const organization = await svc.reportFileReadScope(pheAdmin());
  if (organization.kind !== "organization" || !setEquals(organization.organizationIds, [fx.phewbId])) {
    throw new Error(`phe-admin: expected organization [PHEWB], got ${JSON.stringify(organization)}`);
  }

  const { rows: grants } = await pool.query<{ location_id: string; organization_id: string }>(
    `SELECT a.location_id, l.organization_id
       FROM bms.user_location_access a
       JOIN bms.users u ON u.id = a.user_id
       JOIN bms.locations l ON l.id = a.location_id
      WHERE u.email = $1`,
    [SEEDED.locationAdmin],
  );
  if (grants.length === 0) {
    throw new Error(`${SEEDED.locationAdmin} has no user_location_access rows — run pnpm db:seed`);
  }
  const location = await svc.reportFileReadScope(wcAdmin());
  if (location.kind !== "location") {
    throw new Error(`wc-admin: expected kind location, got ${location.kind}`);
  }
  if (location.locationIds.length !== grants.length) {
    throw new Error(
      `wc-admin: expected ${grants.length} location ids from user_location_access, got ${location.locationIds.length}`,
    );
  }
  if (!setEquals(location.locationIds, grants.map((r) => r.location_id))) {
    throw new Error("wc-admin: locationIds is not the user_location_access set");
  }
  if (!setEquals(location.organizationIds, grants.map((r) => r.organization_id))) {
    throw new Error(
      `wc-admin: organizationIds ${JSON.stringify(location.organizationIds)} is not the granted locations' organizations`,
    );
  }
}

/** The other roles are refused by the same guard, before any grant is read. */
export async function readScopeRefusesAssetGroupAdmin(svc: AccessControlService): Promise<void> {
  const err = await captureRejection(() => svc.reportFileReadScope(wcHvacAdmin()));
  if (!(err instanceof ForbiddenException) || err.message !== MASTER_DATA_SENTENCE) {
    throw new Error(`wc-hvac-admin readScope: expected the master-data 403, got ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// readableAssetIdsInOrganization — the render bound
// ---------------------------------------------------------------------------

const eskomAssetIds = (pool: pg.Pool, eskomId: string) =>
  pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE organization_id = $1`, [eskomId]);

/**
 * For `admin` (`readableAssetIds` → `null`) the set is exactly the
 * organization's assets; for `wc-admin` it is a strict subset of that and
 * equals `readableAssetIds(wc-admin)` ∩ it. The seed gives `wc-admin` 43 of
 * ESKOM's 100 assets, so "subset" is a real claim and not an equality in
 * disguise — the strict check guards that.
 *
 * `bms.assets` is shared with every other `apps/api` integration suite in a
 * full run, which inserts into and deletes from it concurrently (`F4.53`). So
 * the expectation is bracketed the way `access-control.integration.spec.ts`'s
 * `stableIds` does it: the same `SELECT` before and after the service calls,
 * and the claims are made on the ids present at both ends. Ids are
 * `defaultRandom()` uuids that are never reused, so an id in both reads
 * existed for the whole interval. An id the service returned that neither
 * read saw is still a defect (it is not ESKOM's); an id one read saw and the
 * other did not is a concurrent suite's row and is ignored on both sides.
 */
export async function readableAssetIdsInOrganizationIntersects(
  svc: AccessControlService,
  pool: pg.Pool,
  fx: ReportFileFixtures,
): Promise<void> {
  const before = await eskomAssetIds(pool, fx.eskomId);
  const forAdmin = await svc.readableAssetIdsInOrganization(admin(), fx.eskomId);
  const readable = await svc.readableAssetIds(wcAdmin());
  const forWc = await svc.readableAssetIdsInOrganization(wcAdmin(), fx.eskomId);
  const after = await eskomAssetIds(pool, fx.eskomId);

  const seenAtEitherEnd = new Set([...before.rows, ...after.rows].map((r) => r.id));
  const afterIds = new Set(after.rows.map((r) => r.id));
  const stable = before.rows.map((r) => r.id).filter((id) => afterIds.has(id));
  if (stable.length === 0) {
    throw new Error("ESKOM has no assets — run pnpm db:seed");
  }
  const stableSet = new Set(stable);
  const onlyStable = (ids: readonly string[]) => ids.filter((id) => stableSet.has(id));

  if (!forAdmin.every((id) => seenAtEitherEnd.has(id))) {
    throw new Error("admin: an id outside ESKOM leaked into the organization-bounded set");
  }
  const adminStable = onlyStable(forAdmin);
  if (adminStable.length !== stable.length) {
    throw new Error(`admin: expected ${stable.length} stable ESKOM assets, got ${adminStable.length}`);
  }
  if (!setEquals(adminStable, stable)) {
    throw new Error("admin: the set is not ESKOM's assets");
  }

  if (readable === null) {
    throw new Error("wc-admin: readableAssetIds is null — the fixture is not a location admin");
  }
  if (!forWc.every((id) => seenAtEitherEnd.has(id))) {
    throw new Error("wc-admin: an id outside ESKOM leaked into the organization-bounded set");
  }
  const wcStable = onlyStable(forWc);
  if (wcStable.length >= stable.length) {
    throw new Error(
      `wc-admin: expected a strict subset of ESKOM's ${stable.length} assets, got ${wcStable.length}`,
    );
  }
  const expected = onlyStable(readable);
  if (!setEquals(wcStable, expected)) {
    throw new Error(
      `wc-admin: expected readableAssetIds ∩ ESKOM (${expected.length}), got ${wcStable.length}`,
    );
  }
}
