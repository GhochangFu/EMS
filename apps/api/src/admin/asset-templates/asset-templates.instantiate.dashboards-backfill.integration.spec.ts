import type pg from "pg";

import type { AdminAssetTemplateDto } from "@bms/shared";

import {
  assert,
  dashboardsOf,
  expectRejection,
  expectRejectionNamed,
  TEST_ASSET_PREFIX,
  VIEW_OVERVIEW,
  type Fixtures,
  type Services,
} from "./asset-templates.instantiate.dashboards.integration.spec";

/**
 * `F3.2` / ADR 0067 decision 4 and Q7 — the **backfill** half of the per-asset
 * default dashboards, as database outcomes.
 *
 * Split out of `asset-templates.instantiate.dashboards.integration.spec.ts` on
 * 2026-09-17 under AGENTS.md §4.2, when the chunking cases took that file to
 * 1002 lines against §4.5's cap of 1000. Every case and every assertion crossed
 * unchanged; what stayed behind is the instantiate-trigger family, and the
 * fixture builders both need are imported from it rather than copied.
 *
 * The two files each publish their own fixture template: the per-run suffix in
 * `TEST_TEMPLATE_CODE` / `TEST_ASSET_PREFIX` is evaluated once per module
 * registry, and Vitest gives each test file its own, so the two runs cannot
 * sweep one another's committed rows.
 */

/** What G2 hands the cases after it: the version it published, and the audit rows its own call left. */
export type BackfilledVersion = {
  version: AdminAssetTemplateDto;
  /** The `master.dashboard.backfill` rows created by G2's call alone. */
  auditRowIds: string[];
};

/**
 * G2 and G2b — the backfill creates for the unstamped, skips the stamped, and
 * stamps from the version it was asked for rather than from the one the asset
 * is pinned to.
 */
export async function assertBackfillCreatesAndSkips(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  template: AdminAssetTemplateDto,
): Promise<BackfilledVersion> {
  const codes = ["G2A", "G2B", "G2C"].map((suffix) => `${TEST_ASSET_PREFIX}${suffix}`);
  await svc.instantiate(fx.adminJwt, template.id, {
    rtuId: fx.rtuId,
    assets: codes.map((code) => ({ code, name: `Backfill ${code}` })),
  });

  // Two of the three lose their defaults, which is the state the backfill
  // exists for: assets pinned to a version whose dashboards they do not have.
  for (const code of codes.slice(0, 2)) {
    await pool.query(
      `DELETE FROM bms.dashboards WHERE asset_id IN (SELECT id FROM bms.assets WHERE code = $1)`,
      [code],
    );
  }

  // A NEW version of the same code. The three assets stay pinned to v1.
  const v2Draft = await svc.templates.createDraftFrom(fx.adminJwt, template.id);
  const v2 = await svc.templates.publish(fx.adminJwt, v2Draft.id);
  assert(v2.version > template.version, "the fixture's second version must outrank the first");

  // Asserted per code, not on the totals alone: earlier cases in this file also
  // leave assets pinned to this template code, and a total that happened to
  // match would say nothing about which asset was skipped and why.
  // The audit rows this ONE call leaves are identified by taking the id set
  // before it and reading what is new afterwards. G2d used to read "the oldest
  // row for this template id", which a later case writing rows for the same id
  // (G2f does) would silently turn into a different row — case order deciding
  // what an assertion reads is not a property this suite may rely on.
  const { rows: auditBefore } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.audit_log WHERE action = 'master.dashboard.backfill' AND entity_id = $1`,
    [v2.id],
  );
  const result = await svc.dashboards.backfill(fx.adminJwt, v2.id);
  const { rows: auditAfter } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.audit_log WHERE action = 'master.dashboard.backfill' AND entity_id = $1`,
    [v2.id],
  );
  const known = new Set(auditBefore.map((row) => row.id));
  const auditRowIds = auditAfter.map((row) => row.id).filter((id) => !known.has(id));
  const outcomes = new Map(result.assets.map((entry) => [entry.code, entry.outcome]));
  assert(
    outcomes.get(codes[0]) === "created" &&
      outcomes.get(codes[1]) === "created" &&
      outcomes.get(codes[2]) === "skipped_existing",
    `outcomes must follow the stamp, got ${[...outcomes].map(([c, o]) => `${c}=${o}`).join(" ")}`,
  );
  assert(
    result.createdCount === result.assets.filter((e) => e.outcome === "created").length,
    `createdCount ${result.createdCount} disagrees with the per-asset outcomes`,
  );
  assert(
    result.skippedCount === result.assets.filter((e) => e.outcome === "skipped_existing").length,
    `skippedCount ${result.skippedCount} disagrees with the per-asset outcomes`,
  );
  assert(
    result.createdCount === 2,
    `exactly the two assets whose dashboards were deleted must be created, got ${result.createdCount}`,
  );

  // G2b — an asset pinned to v1 carries **v2**'s stamp after the backfill.
  const created = await dashboardsOf(pool, codes[0]);
  assert(created.length === 2, `the backfilled asset must carry both views, got ${created.length}`);
  assert(
    created.every((row) => row.asset_template_id === v2.id),
    "the backfill stamps the version it was called on, not the version the asset is pinned to",
  );
  const { rows: pinned } = await pool.query<{ template_id: string | null }>(
    `SELECT template_id FROM bms.assets WHERE code = $1`,
    [codes[0]],
  );
  assert(
    pinned[0]?.template_id === template.id,
    "the backfill must not re-pin the asset — only its dashboards are new",
  );

  // The second call is the idempotence claim, by row count as well as by report.
  const { rows: countBefore } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.dashboards WHERE slug LIKE $1`,
    [`${TEST_ASSET_PREFIX.toLowerCase()}%`],
  );
  const again = await svc.dashboards.backfill(fx.adminJwt, v2.id);
  assert(
    again.createdCount === 0,
    `the second call must create nothing, got ${again.createdCount}`,
  );
  const repeat = new Map(again.assets.map((entry) => [entry.code, entry.outcome]));
  assert(
    codes.every((code) => repeat.get(code) === "skipped_existing"),
    `every asset must now be skipped, got ${[...repeat].map(([c, o]) => `${c}=${o}`).join(" ")}`,
  );
  const { rows: countAfter } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.dashboards WHERE slug LIKE $1`,
    [`${TEST_ASSET_PREFIX.toLowerCase()}%`],
  );
  assert(
    countBefore[0].n === countAfter[0].n,
    `the second call changed the dashboard count from ${countBefore[0].n} to ${countAfter[0].n}`,
  );
  return { version: v2, auditRowIds };
}

/**
 * G2e — the backfill of a template with **no views** creates nothing and says
 * so (code review #2).
 *
 * The defect this replaces reported `outcome: "created"` and a `createdCount`
 * equal to the asset count, having written no row at all. The row count is
 * asserted independently, because the report was exactly what lied.
 */
export async function assertBackfillOfAViewlessTemplateIsRefused(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  plain: AdminAssetTemplateDto,
): Promise<void> {
  await expectRejection(
    () => svc.dashboards.backfill(fx.adminJwt, plain.id),
    new RegExp(`${plain.code} v${plain.version} declares no dashboard views`),
    "a version with no dashboard views must be refused by name",
  );
  await expectRejectionNamed(
    () => svc.dashboards.backfill(fx.adminJwt, plain.id),
    "ConflictException",
    "a version with no dashboard views is a 409",
  );

  // The two absence claims, and they are the point: the refusal is raised
  // BEFORE the estate is selected, so neither a dashboard row nor an audit row
  // may exist for this template. The defect this replaces reported every asset
  // `created` after writing neither.
  const { rows: dashboardRows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.dashboards WHERE asset_template_id = $1`,
    [plain.id],
  );
  assert(
    Number(dashboardRows[0].n) === 0,
    `the refused backfill wrote ${dashboardRows[0].n} dashboard rows`,
  );
  const { rows: auditRows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.audit_log
      WHERE action = 'master.dashboard.backfill' AND entity_id = $1`,
    [plain.id],
  );
  assert(
    Number(auditRows[0].n) === 0,
    `the refused backfill left ${auditRows[0].n} audit rows behind`,
  );
}

/**
 * G2f — ADR 0067 Q7: a failing chunk stops the call, the chunks before it stay
 * committed, and a re-run resumes.
 *
 * The cap is lowered to one asset per chunk through {@link backfill}'s third
 * parameter — the real ceiling is 8,000 widget rows and no fixture can seed an
 * estate that large. The collision is seeded on the **second** chunk's asset,
 * so "the first chunk's rows exist afterwards" is a claim about rows that were
 * written and kept, not about rows a single transaction never reached.
 */
export async function assertAFailingChunkKeepsTheEarlierChunks(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  version: AdminAssetTemplateDto,
): Promise<void> {
  const codes = ["G3A", "G3B", "G3C"].map((suffix) => `${TEST_ASSET_PREFIX}${suffix}`);
  await svc.instantiate(fx.adminJwt, version.id, {
    rtuId: fx.rtuId,
    assets: codes.map((code) => ({ code, name: `Chunked ${code}` })),
  });
  // Instantiation already built their defaults; the backfill exists for assets
  // that lack them, so all three lose theirs first.
  for (const code of codes) {
    await pool.query(
      `DELETE FROM bms.dashboards WHERE asset_id IN (SELECT id FROM bms.assets WHERE code = $1)`,
      [code],
    );
  }

  // The second chunk's first (and only) asset, first view in write order.
  const collision = `${codes[1].toLowerCase()}-${VIEW_OVERVIEW}`;
  await pool.query(
    `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3)`,
    [fx.organizationId, collision, "Hand-made chunk collision"],
  );
  try {
    // Five widget rows per asset (three authored + two fallback tiles), so a cap
    // of five is exactly one asset per chunk.
    let message = "";
    let name = "";
    try {
      await svc.dashboards.backfill(fx.adminJwt, version.id, 5);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
      name = err instanceof Error ? err.constructor.name : String(err);
    }
    assert(message.includes(collision), `the refusal must name the taken slug: got "${message}"`);
    // The class, which the message match cannot see: the failing chunk's error
    // is REBUILT to carry the resumable sentence, and rebuilding it as a bare
    // `Error` would turn the 409 naming the slug into a 500.
    assert(name === "ConflictException", `a chunk collision must stay a 409, got a ${name}`);
    assert(
      /\b1 of \d+ assets already have their default/.test(message),
      `the refusal must say how many assets were created before it: got "${message}"`,
    );

    const first = await dashboardsOf(pool, codes[0]);
    assert(
      first.length === 2,
      `the committed chunk's dashboards must survive the later failure, found ${first.length}`,
    );
    const third = await dashboardsOf(pool, codes[2]);
    assert(third.length === 0, `the chunk after the failure must not have run, found ${third.length}`);

    // The re-run is what "resumable" means: the committed asset is skipped by
    // its stamp, and the same slug still refuses.
    let again = "";
    try {
      await svc.dashboards.backfill(fx.adminJwt, version.id, 5);
    } catch (err) {
      again = err instanceof Error ? err.message : String(err);
    }
    assert(again.includes(collision), `the re-run must fail on the same slug: got "${again}"`);
    assert(
      /\b0 of \d+ assets already have their default/.test(again),
      `the re-run created nothing before the same failure: got "${again}"`,
    );
    const stillFirst = await dashboardsOf(pool, codes[0]);
    assert(
      stillFirst.length === 2,
      `the re-run must skip the stamped asset, not duplicate it, found ${stillFirst.length}`,
    );
  } finally {
    await pool.query(`DELETE FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`, [
      fx.organizationId,
      collision,
    ]);
  }
}

/** G2c — permission is decided BEFORE the status is read. */
export async function assertBackfillRefusesDraftAndLocationAdmin(
  svc: Services,
  fx: Fixtures,
  v2: AdminAssetTemplateDto,
): Promise<void> {
  const draft = await svc.templates.createDraftFrom(fx.adminJwt, v2.id);

  await expectRejection(
    () => svc.dashboards.backfill(fx.adminJwt, draft.id),
    /Only a published template can be instantiated/,
    "a draft version must be refused with the lifecycle sentence",
  );
  await expectRejectionNamed(
    () => svc.dashboards.backfill(fx.adminJwt, draft.id),
    "ConflictException",
    "a draft version is a 409",
  );

  // The SAME draft id with a location admin's JWT. A 403 and not the 409 above
  // is the whole claim: a caller who may not author learns nothing about the
  // version's lifecycle state.
  await expectRejectionNamed(
    () => svc.dashboards.backfill(fx.locationAdminJwt, draft.id),
    "ForbiddenException",
    "a location admin must be refused BEFORE the draft status is disclosed",
  );
}

/**
 * G2d — the backfill leaves its own audit row.
 *
 * Read by the **row ids G2's own call created**, not by "the oldest row for
 * this template id": G2f later writes `master.dashboard.backfill` rows for the
 * same template, and an `ORDER BY created_at` read would silently change which
 * row this case grades if the two were ever re-ordered.
 */
export async function assertBackfillAuditRow(
  pool: pg.Pool,
  backfilled: BackfilledVersion,
): Promise<void> {
  assert(
    backfilled.auditRowIds.length === 1,
    `G2's backfill ran as one chunk, so it left one audit row; found ${backfilled.auditRowIds.length}`,
  );
  const { rows } = await pool.query<{
    entity_type: string;
    payload: { createdCount?: number; templateCode?: string };
  }>(`SELECT entity_type, payload FROM bms.audit_log WHERE id = $1`, [
    backfilled.auditRowIds[0],
  ]);
  const row = rows[0];
  assert(row !== undefined, "the backfill must write a master.dashboard.backfill audit row");
  assert(
    row.entity_type === "asset_template",
    `the audit row's entity is the template, got ${row.entity_type}`,
  );
  assert(
    row.payload.createdCount === 2,
    `the audit payload must carry createdCount 2, got ${String(row.payload.createdCount)}`,
  );
}
