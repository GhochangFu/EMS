import pg from "pg";

import { getOrganizationId } from "./hierarchy-seed";
import { withOrganization } from "./seed-tenant";

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
 */
export async function verifyHierarchySeed(
  pool: pg.Pool,
  organizationIds?: { eskomOrgId: string; phewbOrgId: string },
): Promise<void> {
  const eskomOrgId = organizationIds?.eskomOrgId ?? (await getOrganizationId(pool, "ESKOM"));
  const phewbOrgId = organizationIds?.phewbOrgId ?? (await getOrganizationId(pool, "PHEWB"));

  const errors: string[] = [];
  const expect = (label: string, actual: string | undefined, wanted: number): void => {
    if (Number(actual) !== wanted) {
      errors.push(`${label}: expected ${wanted}, got ${actual ?? "no row"}`);
    }
  };

  // ── Pass 1: no tenant context ─────────────────────────────────────────────
  // Only `bms.organizations` stays here — it carries no policy. Everything else
  // that used to live in this query touches a table `0047` now policies, so it
  // moved under a per-organization context below (see the module header).
  const global = await pool.query<{ orgs: string }>(`
    SELECT (SELECT COUNT(*)::text FROM bms.organizations) AS orgs
  `);
  const g = global.rows[0];
  if (!g) {
    throw new Error("verifyHierarchySeed: no results");
  }
  expect("organizations", g.orgs, 2);

  // ── Pass 2: ESKOM ─────────────────────────────────────────────────────────
  await withOrganization(pool, eskomOrgId, async () => {
    const res = await pool.query<{
      eskom_locs: string;
      eskom_uncovered_electrical_assets: string;
      orphan_assets: string;
      loc_mismatch: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM bms.locations l
          INNER JOIN bms.organizations o ON o.id = l.organization_id
          WHERE o.code = 'ESKOM') AS eskom_locs,
        -- Zero uncovered assets, not a nonzero total: a total alone cannot tell
        -- "every asset got its five rules" from "most did, one silently didn't"
        -- (migration review, PR #100 -- the gap ESK-MANUAL-01 itself exposed).
        (SELECT COUNT(*)::text FROM bms.assets a
          INNER JOIN bms.locations l ON l.id = a.location_id
          INNER JOIN bms.organizations o ON o.id = l.organization_id
          WHERE o.code = 'ESKOM' AND a.domain = 'electrical'
            AND NOT EXISTS (
              SELECT 1 FROM bms.automation_rules r
              WHERE r.asset_id = a.id AND r.source = 'simulator_threshold'
            )) AS eskom_uncovered_electrical_assets,
        -- Whole-fleet invariants, ESKOM's half (the PHEWB pass has the other).
        -- ADR 0018: a null rtu_id is legal — an asset need not be wired. The
        -- axis that must never be null is the spatial one, because every scoped
        -- authorization check filters on it. Asserting the old invariant here
        -- would turn db:seed red on the first gateway-less asset from F1.8/F1.9.
        (SELECT COUNT(*)::text FROM bms.assets WHERE location_id IS NULL) AS orphan_assets,
        (SELECT COUNT(*)::text FROM bms.assets a
          INNER JOIN bms.rtus r ON r.id = a.rtu_id
          WHERE a.location_id IS DISTINCT FROM r.location_id) AS loc_mismatch
    `);
    const row = res.rows[0];
    // 11 = 10 operational + the deliberately inactive ESK-DECOMM-01 that F4.10
    // needs in order to tell `WHERE active = true` apart from no predicate.
    expect("ESKOM locations", row?.eskom_locs, 11);
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
    expect(
      "ESKOM electrical assets with no simulator_threshold rule",
      row?.eskom_uncovered_electrical_assets,
      0,
    );
  });

  // ── Pass 3: PHEWB ─────────────────────────────────────────────────────────
  await withOrganization(pool, phewbOrgId, async () => {
    const res = await pool.query<{
      phe_locs: string;
      phe_rtus: string;
      phe_assets: string;
      phe_points: string;
      orphan_assets: string;
      loc_mismatch: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM bms.locations l
          INNER JOIN bms.organizations o ON o.id = l.organization_id
          WHERE o.code = 'PHEWB') AS phe_locs,
        (SELECT COUNT(*)::text FROM bms.rtus r
          INNER JOIN bms.locations l ON l.id = r.location_id
          INNER JOIN bms.organizations o ON o.id = l.organization_id
          WHERE o.code = 'PHEWB') AS phe_rtus,
        -- Moved here from Pass 1: assets/asset_points are policied since 0047,
        -- and every PHE row is PHEWB's, so this pass sees exactly them.
        (SELECT COUNT(*)::text FROM bms.assets WHERE code LIKE 'PHE-%') AS phe_assets,
        (SELECT COUNT(*)::text FROM bms.asset_points ap
          INNER JOIN bms.assets a ON a.id = ap.asset_id
          WHERE a.code LIKE 'PHE-%') AS phe_points,
        -- Whole-fleet invariants, PHEWB's half (see the ESKOM pass).
        (SELECT COUNT(*)::text FROM bms.assets WHERE location_id IS NULL) AS orphan_assets,
        (SELECT COUNT(*)::text FROM bms.assets a
          INNER JOIN bms.rtus r ON r.id = a.rtu_id
          WHERE a.location_id IS DISTINCT FROM r.location_id) AS loc_mismatch
    `);
    const row = res.rows[0];
    expect("PHEWB locations", row?.phe_locs, 6);
    expect("PHEWB RTUs", row?.phe_rtus, 12);
    expect("PHE assets", row?.phe_assets, 48);
    // 252, not 264: the catalog's 12 `TS` sensors are the MQTT envelope's own
    // timestamp, which the ingest adapter consumes as the sample time and can
    // never deliver as a reading. `phe-pilot-seed.ts` stopped cataloguing them on
    // 2026-08-06 rather than keep 12 rows claiming a provenance that is false by
    // construction. One per PHE device that carries the sensor.
    expect("PHE asset_points", row?.phe_points, 252);
    expect("PHEWB assets without location_id", row?.orphan_assets, 0);
    expect("PHEWB asset/RTU location mismatch", row?.loc_mismatch, 0);
  });

  if (errors.length > 0) {
    throw new Error(`Hierarchy seed verification failed:\n- ${errors.join("\n- ")}`);
  }
}
