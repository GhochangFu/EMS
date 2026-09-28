import pg from "pg";

import { PACK_ASSET_DOMAINS } from "./asset-domains-seed";
import type { LadderCollisionSkip } from "./automation-rules-seed";
import { getOrganizationId } from "./hierarchy-seed";
import { hierarchyExpectations } from "./verify-hierarchy-expected";
import { withOrganization } from "./seed-tenant";
import { DEMO_WATER_ASSET_CODES, DEMO_WATER_TEMPLATE_CODES } from "./water-plant-demo-seed";

/** The rows migration `0029` inserts: electrical, hvac, it, environment, water. */
const MIGRATION_0029_ASSET_DOMAINS = 5;

/**
 * Verifies org → location → RTU → asset → point_key counts after seed.
 *
 * **`E7.1a` split this from one cross-organization query into three passes.**
 * `bms.locations` now carries `FORCE ROW LEVEL SECURITY` and the seed runs as
 * `bms_owner`, so a single unfiltered `SELECT` would return zero location rows
 * and every location-derived count would read `0` — the check would fail
 * loudly, which is the good case, but it could not be made to pass without
 * either widening the role or making the assertion vacuous.
 *
 * The split is not merely a workaround. Under a tenant context the ESKOM pass
 * cannot see PHEWB's rows *at all*, so `eskom_locs = 11` now means "11
 * locations visible to ESKOM's tenant context, all of which join ESKOM" rather
 * than "11 rows that happen to carry ESKOM's id". The `INNER JOIN
 * bms.organizations` in each pass is kept for exactly that reason: on its own
 * the policy proves the context filtered correctly, and on its own the join
 * proves the column is right; together they prove both, and a mismatch between
 * the GUC and the column shows up as a count of zero rather than as silence.
 *
 * **`E7.1b` widened the split.** `0047` added `tenant_isolation` + `FORCE` to
 * `bms.assets`, `bms.asset_points` and `bms.rtus`, which Pass 1 counted with no
 * context. Those counts now read 0 as `bms_owner`, so the PHE asset/point totals
 * moved into the PHEWB pass and the two whole-fleet invariants — assets with no
 * location, and an asset whose location disagrees with its RTU's — run once per
 * organization. `organization_id` is NOT NULL on `assets`/`rtus` since `0047`,
 * so every asset is visible in exactly one context and the union of the two
 * single-org passes is the whole fleet. The residual limit is stated, not
 * hidden: a *cross-org* asset→RTU pairing would have an RTU row invisible to
 * either single-org pass and drop out of the `loc_mismatch` join — but such a
 * pairing cannot exist (an asset and its RTU share an org, empirically 0
 * divergence), so the per-org check is complete for every pairing that can.
 *
 * **The `F4.169`/`F4.170` addendum made each count an admin write can move a
 * claim about the seed's own rows** (owner ruling 5, 2026-09-28). This check
 * runs on every `compose up`, because the `migrate` service re-seeds and the
 * `api` waits on it. The admin API adds organizations, locations, RTUs, assets,
 * points and group members, so an exact `COUNT(*)` over a table stopped the
 * whole stack after an ordinary write — a 12th ESKOM location, with a long code
 * or a short one, read `expected 11, got 12`. Those counts now read the rows the
 * seed writes, listed by `verify-hierarchy-expected.ts` from the seed's own
 * catalogs, and the wanted number is the length of that list. That holds on
 * every healthy boot: nothing deletes a seeded row (the admin surfaces have no
 * DELETE for these tables) and the seed re-creates each one before this runs.
 *
 * What a presence count cannot see, a zero count states: the decommissioned
 * fixture location stays inactive, no legacy per-RTU PHE location survives
 * `cleanupLegacyPheRtuLocations`, and no `TS` point is catalogued. The counts
 * no admin write can move stay exact: asset domains (no admin surface creates
 * one), the four water counts and the RSMOC-WC control-room view (each already
 * reads only seeded rows), and the zero counts for orphan and mismatched
 * assets. The uncovered-electrical-asset count exempts the ladder seed's
 * collision skips — see {@link EskomCheckOptions}.
 */
export async function verifyHierarchySeed(
  pool: pg.Pool,
  organizationIds?: { eskomOrgId: string; phewbOrgId: string },
  options?: EskomCheckOptions,
): Promise<void> {
  const eskomOrgId = organizationIds?.eskomOrgId ?? (await getOrganizationId(pool, "ESKOM"));
  const phewbOrgId = organizationIds?.phewbOrgId ?? (await getOrganizationId(pool, "PHEWB"));

  const checks: HierarchyCheck[] = [...(await readGlobalChecks(pool))];
  await withOrganization(pool, eskomOrgId, async () => {
    checks.push(...(await readEskomChecks(pool, eskomOrgId, options)));
  });
  await withOrganization(pool, phewbOrgId, async () => {
    checks.push(...(await readPhewbChecks(pool, phewbOrgId)));
  });

  const errors = failingChecks(checks);
  if (errors.length > 0) {
    throw new Error(`Hierarchy seed verification failed:\n- ${errors.join("\n- ")}`);
  }
}

/**
 * One claim the verifier makes: `actual` read from the database, `wanted` the
 * number it must equal (`exact`) or reach (`atLeast`).
 *
 * The three `read*Checks` passes below return these and decide nothing;
 * {@link failingChecks} decides. The split exists so an integration test can
 * run a pass inside its own `BEGIN` … `ROLLBACK` — {@link verifyHierarchySeed}
 * wraps Passes 2 and 3 in `withOrganization`, whose `COMMIT` on the `max: 1`
 * seed pool would commit the test's fixture.
 */
export type HierarchyCheck = {
  readonly label: string;
  readonly actual: number;
  readonly wanted: number;
  readonly kind: "exact" | "atLeast";
};

/** A count column as a number; a missing row is `NaN`, which fails every check. */
function countOf(value: string | undefined): number {
  return value === undefined ? Number.NaN : Number(value);
}

function exactCheck(label: string, actual: string | undefined, wanted: number): HierarchyCheck {
  return { label, actual: countOf(actual), wanted, kind: "exact" };
}

/**
 * The failure message for every check that does not hold, in input order.
 *
 * Fails closed on `NaN` for both kinds: an `exact` check compares with `!==`,
 * and an `atLeast` check is written `!(actual >= wanted)` rather than
 * `actual < wanted`, because every comparison with `NaN` is false.
 */
export function failingChecks(checks: readonly HierarchyCheck[]): string[] {
  const failures: string[] = [];
  for (const check of checks) {
    const got = Number.isNaN(check.actual) ? "no row" : String(check.actual);
    if (check.kind === "atLeast") {
      if (!(check.actual >= check.wanted)) {
        failures.push(`${check.label}: expected at least ${check.wanted}, got ${got}`);
      }
    } else if (check.actual !== check.wanted) {
      failures.push(`${check.label}: expected ${check.wanted}, got ${got}`);
    }
  }
  return failures;
}

/**
 * Pass 1 — the checks that need no tenant context.
 */
export async function readGlobalChecks(pool: pg.Pool): Promise<HierarchyCheck[]> {
  // ── Pass 1: no tenant context ─────────────────────────────────────────────
  // Only `bms.organizations` and `bms.asset_domains` live here — neither
  // carries a policy (`0047` left the global-vocabulary class unpoliced).
  // Everything else that used to live in this query touches a table `0047`
  // now policies, so it moved under a per-organization context below (see the
  // module header).
  const expected = hierarchyExpectations();
  // The seed's organizations present, not every row: `POST
  // /admin/organizations` adds one, and the next boot re-seeds and runs this.
  const global = await pool.query<{ orgs: string; asset_domains: string }>(`
    SELECT
      (SELECT COUNT(*)::text FROM bms.organizations
        WHERE code = ANY($1::varchar[])) AS orgs,
      (SELECT COUNT(*)::text FROM bms.asset_domains) AS asset_domains
  `, [expected.organizationCodes]);
  const g = global.rows[0];
  if (!g) {
    throw new Error("verifyHierarchySeed: no results");
  }
  const checks: HierarchyCheck[] = [
    exactCheck("seed organizations present", g.orgs, expected.organizationCodes.length),
  ];
  // `E5.2`/`E5.3` — seven: five from migration `0029` plus the ones
  // `asset-domains-seed.ts` writes (`mechanical`, ADR 0053 decision 2;
  // `facility`, ADR 0054 decision 2), added through the seed path rather
  // than a migration (ADR 0031 Amendment 1 A1.1). A fixed seed cardinality,
  // not a lifetime counter — and it counts every row, not the active ones,
  // because a global administrator's retirement (`active = false`) must
  // survive `compose up`, which runs this check on every boot; the seed's
  // `DO NOTHING` never reactivates a retired row. The number is DERIVED
  // from the seed's own list rather than written here, because this line is
  // a boot gate: the compose `migrate` service runs `db:seed`, `api` waits
  // on it, and a disagreement between the two would keep the API from
  // starting (the `E5.2` migration review's one Medium). `E5.3` appended
  // `facility` to `PACK_ASSET_DOMAINS`, and this expectation moved to 7 by
  // itself. It stays an exact count of every row, unlike the counts the
  // `F4.169`/`F4.170` addendum folded, because no admin surface creates an
  // asset domain: only a migration or this seed can move it.
  checks.push(
    exactCheck("asset domains", g.asset_domains, MIGRATION_0029_ASSET_DOMAINS + PACK_ASSET_DOMAINS.length),
  );
  return checks;
}

/** The label of the check that counts ESKOM electrical assets with no ladder rule. */
export const UNCOVERED_ELECTRICAL_LABEL = "ESKOM electrical assets with no simulator_threshold rule";

export type EskomCheckOptions = {
  /**
   * The assets `seedEskomLadderRules` skipped a rule for on a code collision
   * in this seed run. The uncovered-asset check exempts exactly these, by id,
   * and logs each one it exempts. Empty by default, so a caller that passes
   * nothing — the `verify:hierarchy` CLI — fails closed on every uncovered
   * asset.
   */
  readonly ladderCollisionSkips?: readonly LadderCollisionSkip[];
  /** Where each exemption line goes; `console.error` by default. */
  readonly log?: (line: string) => void;
};

/**
 * Pass 2 — the ESKOM checks. The caller holds ESKOM's tenant context
 * (`app.current_organization`); this function opens no transaction.
 */
export async function readEskomChecks(
  pool: pg.Pool,
  eskomOrgId: string,
  options: EskomCheckOptions = {},
): Promise<HierarchyCheck[]> {
  const { ladderCollisionSkips = [], log = (line: string) => console.error(line) } = options;
  const checks: HierarchyCheck[] = [];
  const expect = (label: string, actual: string | undefined, wanted: number): void => {
    checks.push(exactCheck(label, actual, wanted));
  };
  // ── Pass 2: ESKOM ─────────────────────────────────────────────────────────
  // Zero uncovered assets, not a nonzero total: a total alone cannot tell
  // "every asset got its five rules" from "most did, one silently didn't"
  // (migration review, PR #100 -- the gap ESK-MANUAL-01 itself exposed). Read
  // as rows, not a count, so the assets `seedEskomLadderRules` reported as
  // collision skips can be exempted by id, and each exemption logged.
  const uncovered = await pool.query<{ id: string; code: string }>(`
    SELECT a.id, a.code FROM bms.assets a
      INNER JOIN bms.locations l ON l.id = a.location_id
      INNER JOIN bms.organizations o ON o.id = l.organization_id
      WHERE o.code = 'ESKOM' AND a.domain = 'electrical'
        AND NOT EXISTS (
          SELECT 1 FROM bms.automation_rules r
          WHERE r.asset_id = a.id AND r.source = 'simulator_threshold'
        )
      ORDER BY a.code, a.id
  `);
  const skippedIds = new Set(ladderCollisionSkips.map((skip) => skip.assetId));
  let uncoveredCount = 0;
  for (const asset of uncovered.rows) {
    if (skippedIds.has(asset.id)) {
      log(
        `verifyHierarchySeed: exempted ${asset.code} (${asset.id}) from "${UNCOVERED_ELECTRICAL_LABEL}": ` +
          "seedEskomLadderRules skipped its ladder rules because another rule holds the code",
      );
      continue;
    }
    uncoveredCount += 1;
  }

  // Every count below that an admin write can move reads the seed's own rows
  // (verify-hierarchy-expected.ts), as its own statement: the statement after
  // it keeps its parameter list, which tests/e4.3-demo-water-plant.test.ts
  // reads.
  const expected = hierarchyExpectations();
  const presence = await pool.query<{
    eskom_locs: string;
    eskom_decomm_active: string;
    eskom_incomers_on_pue_template: string;
    eskom_it_load_members: string;
    eskom_it_rack_kw_points: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM bms.locations l
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'ESKOM'
          AND l.code = ANY($1::varchar[])) AS eskom_locs,
      -- F4.10: the decommissioned fixture location must stay inactive, or
      -- the read-scope active filter it exists to prove is untested again.
      (SELECT COUNT(*)::text FROM bms.locations l
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'ESKOM'
          AND l.code = $2
          AND l.active = true) AS eskom_decomm_active,
      -- F2.8. THE THREE COUNTS BELOW PROVE THE SEED ORDER FOR THE DEMO PUE,
      -- the same way the PHE membership counts in the PHEWB pass do for
      -- F3.41. seedPueDemo runs last in the ESKOM bracket and depends on
      -- three earlier calls: seedAssetGroups (the incoming-supply role that
      -- selects the incomer, and the IT_LOAD group), seedPointKeyCatalog
      -- (the FK for rack_kw and the three derived keys) and
      -- seedAssetTemplateHealth (the copy source and the pin it moves). A
      -- developer database has been seeded many times and holds every row
      -- already; only a cold database (CI, or the scratch container plan
      -- section 8 asks for) can show a call that ran too early, and only
      -- these counts read it. Each reads only the catalog codes ($3, $4), so
      -- an admin asset pinned to the incomer template, or an admin IT asset,
      -- cannot move it.
      --
      -- NO BACKTICK MAY APPEAR IN THIS COMMENT (see the PHEWB pass).
      (SELECT COUNT(*)::text FROM bms.assets a
        INNER JOIN bms.asset_templates t ON t.id = a.template_id
        INNER JOIN bms.organizations o ON o.id = a.organization_id
        WHERE o.code = 'ESKOM'
          AND a.code = ANY($3::varchar[])
          AND t.code = 'BASELINE-ELECTRICAL-INCOMER') AS eskom_incomers_on_pue_template,
      (SELECT COUNT(*)::text FROM bms.asset_group_members agm
        INNER JOIN bms.asset_groups ag ON ag.id = agm.asset_group_id
        INNER JOIN bms.organizations o ON o.id = ag.organization_id
        INNER JOIN bms.assets a ON a.id = agm.asset_id
        WHERE o.code = 'ESKOM' AND ag.code = 'IT_LOAD'
          AND a.code = ANY($4::varchar[])) AS eskom_it_load_members,
      (SELECT COUNT(*)::text FROM bms.asset_points ap
        INNER JOIN bms.assets a ON a.id = ap.asset_id
        INNER JOIN bms.organizations o ON o.id = a.organization_id
        WHERE o.code = 'ESKOM' AND a.domain = 'it'
          AND a.code = ANY($4::varchar[])
          AND ap.point_key = 'rack_kw') AS eskom_it_rack_kw_points
  `, [
    expected.eskomLocationCodes,
    expected.decommissionedLocationCode,
    expected.eskomIncomerCodes,
    expected.eskomItCodes,
  ]);
  const present = presence.rows[0];

  const res = await pool.query<{
    orphan_assets: string;
    loc_mismatch: string;
    eskom_energy_tariff_rows: string;
    eskom_water_assets_roled: string;
    eskom_water_assets_on_demo_templates: string;
    eskom_water_intake_assets: string;
    eskom_water_group_members: string;
    eskom_rsmoc_wc_control_room_view: string;
  }>(`
    SELECT
      -- Whole-fleet invariants, ESKOM's half (the PHEWB pass has the other).
      -- ADR 0018: a null rtu_id is legal — an asset need not be wired. The
      -- axis that must never be null is the spatial one, because every scoped
      -- authorization check filters on it. Asserting the old invariant here
      -- would turn db:seed red on the first gateway-less asset from F1.8/F1.9.
      (SELECT COUNT(*)::text FROM bms.assets WHERE location_id IS NULL) AS orphan_assets,
      (SELECT COUNT(*)::text FROM bms.assets a
        INNER JOIN bms.rtus r ON r.id = a.rtu_id
        WHERE a.location_id IS DISTINCT FROM r.location_id) AS loc_mismatch,
      -- E4.1c. The demo tariff row (calc-parameters-demo-seed.ts): at least
      -- one organization-scope energy_tariff_per_kwh row, effective or not.
      -- A floor, not an exact count, because an administrator may end it and
      -- enter another on the demo, and the seed must not put the first back.
      (SELECT COUNT(*)::text FROM bms.calc_parameters cp
        WHERE cp.organization_id = $1
          AND cp.key = 'energy_tariff_per_kwh'
          AND cp.location_id IS NULL
          AND cp.asset_id IS NULL) AS eskom_energy_tariff_rows,
      -- E4.3 U11. THE FOUR COUNTS BELOW PROVE THE DEMO WATER PLANT LANDED.
      -- Fixed cardinalities read off the repository file
      -- water-plant-demo-seed.ts (five classes, one intake), NOT lifetime
      -- counters. They catch a role that was not written, a pin that was
      -- dropped, a wrong intake, and a water asset filed under another
      -- group (the demoGroupCodesForAsset branch). The seed ORDER is held
      -- elsewhere: run after seedAssetTemplateHealth on a cold database,
      -- the health seed pins the five assets to a BASELINE-WATER that
      -- declares no point and throws unusable = 1 before this check runs.
      -- Each count reads ONLY the five demo asset codes, passed as $2 from
      -- DEMO_WATER_ASSET_CODES (owner ruling R1, 2026-09-24), so another
      -- water asset in ESKOM cannot move them. The pin count pairs each
      -- asset code with its own class template code ($3, from
      -- DEMO_WATER_TEMPLATE_CODES, the same class order), so a demo asset
      -- pinned to another class mirror is not counted.
      --
      -- NO BACKTICK MAY APPEAR IN THIS COMMENT (see the PHEWB pass).
      (SELECT COUNT(*)::text FROM bms.assets a
        INNER JOIN bms.organizations o ON o.id = a.organization_id
        WHERE o.code = 'ESKOM' AND a.domain = 'water'
          AND a.code = ANY($2::varchar[])
          AND a.water_balance_role IS NOT NULL) AS eskom_water_assets_roled,
      (SELECT COUNT(*)::text FROM bms.assets a
        INNER JOIN bms.asset_templates t ON t.id = a.template_id
        INNER JOIN bms.organizations o ON o.id = a.organization_id
        WHERE o.code = 'ESKOM' AND a.domain = 'water'
          AND a.code = ANY($2::varchar[])
          AND (a.code, t.code) IN (
            SELECT x.asset_code, x.template_code
            FROM unnest($2::varchar[], $3::varchar[]) AS x(asset_code, template_code)
          )) AS eskom_water_assets_on_demo_templates,
      (SELECT COUNT(*)::text FROM bms.assets a
        INNER JOIN bms.organizations o ON o.id = a.organization_id
        WHERE o.code = 'ESKOM' AND a.domain = 'water'
          AND a.code = ANY($2::varchar[])
          AND a.water_balance_role = 'intake') AS eskom_water_intake_assets,
      (SELECT COUNT(*)::text FROM bms.asset_group_members agm
        INNER JOIN bms.asset_groups ag ON ag.id = agm.asset_group_id
        INNER JOIN bms.organizations o ON o.id = ag.organization_id
        INNER JOIN bms.assets a ON a.id = agm.asset_id
        WHERE o.code = 'ESKOM' AND ag.code = 'water'
          AND a.code = ANY($2::varchar[])) AS eskom_water_group_members,
      -- F3.67 (ADR 0076 decision 6, owner ruling OQ2): the row must exist,
      -- but the seed does not own its contents once written -- an admin may
      -- have re-pointed RSMOC-WC at a dashboard or back to 'generated', and
      -- a re-seed must not revert that. So this counts the row's presence,
      -- of any kind, not only kind = 'builtin'.
      --
      -- NO BACKTICK MAY APPEAR IN THIS COMMENT (see the PHEWB pass).
      (SELECT COUNT(*)::text FROM bms.site_control_room_views scrv
        INNER JOIN bms.locations l ON l.id = scrv.location_id
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'ESKOM' AND l.code = 'RSMOC-WC') AS eskom_rsmoc_wc_control_room_view
  `, [eskomOrgId, DEMO_WATER_ASSET_CODES, DEMO_WATER_TEMPLATE_CODES]);
  const row = res.rows[0];
  // The canonical locations plus the deliberately inactive ESK-DECOMM-01 that
  // F4.10 needs in order to tell `WHERE active = true` apart from no
  // predicate (11 today), counted present: an admin or onboarding location
  // is not one of them, so it cannot move this count.
  expect("ESKOM seed locations present", present?.eskom_locs, expected.eskomLocationCodes.length);
  expect("ESKOM decommissioned fixture location active", present?.eskom_decomm_active, 0);
  expect("ESKOM assets without location_id", row?.orphan_assets, 0);
  expect("ESKOM asset/RTU location mismatch", row?.loc_mismatch, 0);
  // Migration review (F3.6): migration 0033's own seed of these rows is a
  // silent no-op on a fresh database (it joins assets that only exist once
  // seed has already run, and seed runs after migrate). This is what would
  // have caught it — `automation-rules-seed.ts`'s `seedEskomLadderRules` is
  // the seed-side source of truth now, so an asset with zero `simulator_
  // threshold` rows here means it broke, not that a fresh database is merely
  // missing a migration-only feature. A nonzero-total check alone would not
  // have caught `ESK-MANUAL-01` being silently skipped — a total can stay
  // nonzero while one asset quietly loses all five of its rules.
  checks.push({ label: UNCOVERED_ELECTRICAL_LABEL, actual: uncoveredCount, wanted: 0, kind: "exact" });
  // `F2.8`. Fixed seed cardinalities read off the ESKOM catalog
  // (`eskom-assets-seed.ts`, a repository file) — NOT lifetime counters.
  // Nine incomers: one `*-CR-UTILITY*` asset per RSMOC site, each carrying
  // `role = 'incoming-supply'` from `demoRoleForAsset`; CSMOC Gauteng has
  // no incomer and the decommissioned substation's one asset has no role,
  // so both stay on `BASELINE-ELECTRICAL`. Fourteen IT assets: one at each
  // of eight RSMOC sites and six at Western Cape, each a member of its
  // site's `IT_LOAD` group and each with one `rack_kw` catalog row — the
  // row `readScopeMembers` needs before `sum({rack_kw} @group('IT_LOAD'))`
  // resolves any member at all. Each count reads only the catalog's codes
  // (`verify-hierarchy-expected.ts`), and the wanted number is the length of
  // that list.
  expect(
    "ESKOM catalog incomers pinned to BASELINE-ELECTRICAL-INCOMER",
    present?.eskom_incomers_on_pue_template,
    expected.eskomIncomerCodes.length,
  );
  expect("ESKOM catalog IT assets in IT_LOAD", present?.eskom_it_load_members, expected.eskomItCodes.length);
  expect(
    "ESKOM catalog IT assets with a rack_kw catalog row",
    present?.eskom_it_rack_kw_points,
    expected.eskomItCodes.length,
  );
  // `E4.3` U11 (owner ruling Q7). Five demo water assets at CSMOC Gauteng,
  // each carrying a balance role and pinned to its `DEMO-WATER-<CLASS>`
  // mirror; one of them (`WTR-WTP-01`) is the balance's `intake`; all five
  // are members of the site's `water` group (`demoGroupCodesForAsset`).
  // Fixed cardinalities read off `water-plant-demo-seed.ts`, and each count
  // reads only the five codes in `DEMO_WATER_ASSET_CODES` (owner ruling R1,
  // 2026-09-24). What still fails the boot is a change to a demo asset
  // itself: an admin who clears a demo asset's role or re-pins it fails
  // these on the next boot — the same exposure the PUE incomer count above
  // carries. An admin's own water assets, or a leaked test fixture in the
  // water domain, can no longer move these counts.
  expect("ESKOM water assets carrying a balance role", row?.eskom_water_assets_roled, 5);
  expect("ESKOM water demo assets pinned to their own DEMO-WATER template", row?.eskom_water_assets_on_demo_templates, 5);
  expect("ESKOM water intake assets", row?.eskom_water_intake_assets, 1);
  expect("ESKOM water group members", row?.eskom_water_group_members, 5);
  // F3.67 — RSMOC-WC always carries exactly one Control Room view row,
  // whatever kind an administrator has set it to (OQ2).
  expect("ESKOM RSMOC-WC control room view row", row?.eskom_rsmoc_wc_control_room_view, 1);
  // `E4.1c` — a floor of one (see the SQL comment); `expect` is exact, so
  // the floor is written as its own check.
  checks.push({
    label: "ESKOM organization-scope energy_tariff_per_kwh rows",
    actual: countOf(row?.eskom_energy_tariff_rows),
    wanted: 1,
    kind: "atLeast",
  });
  return checks;
}

/**
 * Pass 3 — the PHEWB checks. The caller holds PHEWB's tenant context; this
 * function opens no transaction.
 */
export async function readPhewbChecks(pool: pg.Pool, phewbOrgId: string): Promise<HierarchyCheck[]> {
  // The caller names the context it holds; Pass 3's SQL filters on the
  // organization's code, so the id itself is not read here.
  void phewbOrgId;
  const checks: HierarchyCheck[] = [];
  const expect = (label: string, actual: string | undefined, wanted: number): void => {
    checks.push(exactCheck(label, actual, wanted));
  };
  // ── Pass 3: PHEWB ─────────────────────────────────────────────────────────
  // Every count an admin write can move reads the rows seedPheCatalog writes
  // for phe-catalog.json (phePilotExpectedRows), counted present.
  const phe = hierarchyExpectations().phe;
  const res = await pool.query<{
    phe_locs: string;
    phe_legacy_locs: string;
    phe_rtus: string;
    phe_assets: string;
    phe_points: string;
    phe_ts_points: string;
    orphan_assets: string;
    loc_mismatch: string;
    phe_elec_members: string;
    phe_elec_roled: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM bms.locations l
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'PHEWB'
          AND l.code = ANY($1::varchar[])) AS phe_locs,
      -- The one-RTU-per-location rows cleanupLegacyPheRtuLocations deletes,
      -- by the same twelve slugs (owner ruling 13), never a pattern an admin
      -- slug can match. The old exact location count was what caught a
      -- cleanup that ran without a tenant context and deleted nothing; this
      -- zero count keeps that, now that the location count reads only the
      -- catalog codes.
      (SELECT COUNT(*)::text FROM bms.locations l
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'PHEWB'
          AND l.slug = ANY($2::varchar[])) AS phe_legacy_locs,
      (SELECT COUNT(*)::text FROM bms.rtus r
        INNER JOIN bms.locations l ON l.id = r.location_id
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'PHEWB'
          AND r.external_rtu_id = ANY($3::int[])) AS phe_rtus,
      -- Moved here from Pass 1: assets/asset_points are policied since 0047,
      -- and every PHE row is PHEWB's, so this pass sees exactly them.
      (SELECT COUNT(*)::text FROM bms.assets
        WHERE code = ANY($4::varchar[])) AS phe_assets,
      (SELECT COUNT(*)::text FROM bms.asset_points ap
        INNER JOIN bms.assets a ON a.id = ap.asset_id
        WHERE (a.code, ap.point_key) IN (
          SELECT x.asset_code, x.point_key
          FROM unnest($5::varchar[], $6::varchar[]) AS x(asset_code, point_key)
        )) AS phe_points,
      -- The TS pairs the seed deletes rather than catalogues: zero, so a
      -- seed that catalogued them again fails here and not only in a total.
      (SELECT COUNT(*)::text FROM bms.asset_points ap
        INNER JOIN bms.assets a ON a.id = ap.asset_id
        WHERE (a.code, ap.point_key) IN (
          SELECT x.asset_code, x.point_key
          FROM unnest($7::varchar[], $8::varchar[]) AS x(asset_code, point_key)
        )) AS phe_ts_points,
      -- Whole-fleet invariants, PHEWB's half (see the ESKOM pass).
      (SELECT COUNT(*)::text FROM bms.assets WHERE location_id IS NULL) AS orphan_assets,
      (SELECT COUNT(*)::text FROM bms.assets a
        INNER JOIN bms.rtus r ON r.id = a.rtu_id
        WHERE a.location_id IS DISTINCT FROM r.location_id) AS loc_mismatch,
      -- F3.41. THE TWO COUNTS BELOW ARE WHAT PROVE THE SEED ORDER, and they
      -- are the only gate that can. Until this row, PHEWB's seedAssetGroups
      -- pass ran BEFORE seedPheCatalog created the assets it derives from, so
      -- on a fresh database it matched nothing and PHE WB got no group, no
      -- membership and no role. That was invisible on a developer machine —
      -- which has been re-seeded many times and therefore holds the rows
      -- already — and invisible in CI, which seeds once and asserted none of
      -- this. Both read only the catalog electrical codes ($9).
      --
      -- NO BACKTICK MAY APPEAR IN THIS COMMENT. The whole SELECT is a
      -- JavaScript template literal, so a backtick here closes it and the
      -- file fails to transform with "Expected ) but found ..." pointing at a
      -- line that looks like ordinary prose.
      (SELECT COUNT(*)::text FROM bms.asset_group_members agm
        INNER JOIN bms.asset_groups ag ON ag.id = agm.asset_group_id
        INNER JOIN bms.assets a ON a.id = agm.asset_id
        WHERE ag.code = 'electrical'
          AND a.code = ANY($9::varchar[])) AS phe_elec_members,
      (SELECT COUNT(*)::text FROM bms.asset_group_members agm
        INNER JOIN bms.asset_groups ag ON ag.id = agm.asset_group_id
        INNER JOIN bms.assets a ON a.id = agm.asset_id
        WHERE ag.code = 'electrical'
          AND a.code = ANY($9::varchar[])
          AND agm.role IS NOT NULL) AS phe_elec_roled
  `, [
    phe.locationCodes,
    phe.legacyLocationSlugs,
    phe.externalRtuIds,
    phe.assetCodes,
    phe.points.map((point) => point.assetCode),
    phe.points.map((point) => point.pointKey),
    phe.tsPoints.map((point) => point.assetCode),
    phe.tsPoints.map((point) => point.pointKey),
    phe.electricalAssetCodes,
  ]);
  const row = res.rows[0];
  expect("PHEWB catalog locations present", row?.phe_locs, phe.locationCodes.length);
  expect("PHEWB legacy per-RTU locations", row?.phe_legacy_locs, 0);
  expect("PHEWB catalog RTUs present", row?.phe_rtus, phe.externalRtuIds.length);
  expect("PHE catalog assets present", row?.phe_assets, phe.assetCodes.length);
  // 252 today, not 264: the catalog's 12 `TS` sensors are the MQTT envelope's
  // own timestamp, which the ingest adapter consumes as the sample time and
  // can never deliver as a reading. `phe-pilot-seed.ts` stopped cataloguing
  // them on 2026-08-06 rather than keep 12 rows claiming a provenance that is
  // false by construction. One per PHE device that carries the sensor.
  expect("PHE catalog asset_points present", row?.phe_points, phe.points.length);
  expect("PHE TS asset_points", row?.phe_ts_points, 0);
  expect("PHEWB assets without location_id", row?.orphan_assets, 0);
  expect("PHEWB asset/RTU location mismatch", row?.loc_mismatch, 0);
  // `F3.41`. 36 today = 6 stations × (2 MFM + 2 PUMP-M + 2 PUMP-C), read off
  // `phe-catalog.json`, which is a frozen repository file — NOT lifetime
  // counters that drift with use.
  expect("PHE catalog electrical group members", row?.phe_elec_members, phe.electricalAssetCodes.length);
  // Every one of them carries a role after the owner's 2026-09-02 ruling:
  // 12 `meter` and 24 `pump`. A NULL here means `demoRoleForAsset` stopped
  // matching, or the group pass ran before the assets existed again. The
  // other half of the ruling — the 12 `PHE-AIRSP1051M-*` gateways stay
  // unroled — is held by `asset-groups-seed.spec.ts` rather than here: an
  // administrator may give a gateway a role through the picker, and that
  // must not stop the next boot (owner ruling 10, 2026-09-28).
  expect("PHE catalog electrical members carrying a role", row?.phe_elec_roled, phe.electricalAssetCodes.length);
  return checks;
}
