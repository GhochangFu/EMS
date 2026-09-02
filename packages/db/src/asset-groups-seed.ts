import type pg from "pg";

/**
 * Location backfill and derived asset groups, split out of `seed.ts` to keep it
 * under the AGENTS.md §4.5 1000-line cap. Pure move — the statements and their
 * order are unchanged, and `assignEskomAssetRtus` still runs between the two
 * exported functions exactly as before.
 */

/** Points every asset at the location whose name matches its site name. */
export async function backfillAssetLocations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    UPDATE bms.assets AS a
    SET location_id = l.id
    FROM bms.locations AS l
    WHERE a.site_name = l.name
      AND (a.location_id IS NULL OR a.location_id <> l.id)
  `);
}

/**
 * Derives one asset group per domain per location and re-points membership.
 * Runs after the location backfill so a moved asset leaves its old group first.
 *
 * **`E7.1b` / ADR 0043 decisions 5 + 6.** `0047` gives `bms.asset_groups` a
 * NOT-NULL `organization_id` with `tenant_isolation` + `FORCE`, and the
 * `asset_group_members` junction a policy keyed on both parents' org. This ran
 * once across every organization before; it now runs once *per* organization,
 * inside that org's `withOrganization` context (`seed.ts`), so the `assets` read
 * returns only this org's rows and the group/member writes satisfy the policy.
 * `organizationId` is stamped on every group and equals the current context —
 * safe because a group is derived per `(domain, location)` and a location
 * belongs to exactly one org, so the group's org is its location's org.
 */
/**
 * `F3.38` — the demo role each membership plays in its electrical train.
 *
 * **Why this is seeded at all.** `F3.37` shipped `bms.asset_group_members.role`
 * and the admin surface that sets it, but nothing ever wrote a value, so every
 * row in every organization was NULL. A section template resolves its widgets
 * by matching `assetRoleCode` against exactly this column, so out of the box
 * every bound widget of every stock template reported `unresolved` — a feature
 * with no working happy path anywhere in the seeded data. The surface is not
 * the gap; the demonstration is.
 *
 * **Every entry is a reading of the asset's own name, not a decision.**
 * `CR-UTILITY-11KV` is "Control Room Utility 11 kV Incomer"; `CR-XFMR-100KVA`
 * is "Control Room Transformer 100 kVA"; `CR-Q1`…`CR-Q12` are breakers on the
 * board. Where a name does not decide the role, this returns `null` and the
 * membership keeps its NULL — an admin sets it through `F3.37`'s picker.
 *
 * 1. **PHEWB's electrical assets carry a ruling rather than a reading, and
 *    `F3.41` is where it landed.** They are two meters (`PHE-MFM-*`) and four
 *    pumps (two mains `PHE-PUMP-M-*`, two chlorine dosing `PHE-PUMP-C-*`) per
 *    site. A meter is not a train position, so which code they fill was never a
 *    reading of a name the way `CR-XFMR-100KVA` is. `F3.40` added the `meter`
 *    and `pump` codes in migration `0060`; this is the other half.
 *
 *    **THE RULING, given by the repository owner on 2026-09-02 at the
 *    `build-operating-model.md` step 2 gate:** `PHE-MFM-*` fills `meter`, and
 *    **both** pump shapes fill `pump`. No `dosing-pump`, and therefore no
 *    migration — `0051` step 4 made the junction's role index deliberately NOT
 *    UNIQUE so one role may match several members, and `F3.40`'s own closure
 *    had already recorded the same reading of the same catalog. The two
 *    `PHE-AIRSP1051M-*` gateways per site stay NULL: they are `environment`
 *    domain and fit no electrical role, which is `F3.40`'s asymmetry argument —
 *    an unused role is easy to add and a wrong one is hard to retire.
 *
 *    **THE CONSEQUENCE THE OWNER ACCEPTED, RECORDED BESIDE THE BRANCH THAT
 *    CAUSES IT.** One `pump` role matches four members per site carrying two
 *    **disjoint** point sets: `PHE-PUMP-M-*` registers only `breaker_main` and
 *    `PHE-PUMP-C-*` only `chlorine_pump_on`. So a `breaker_main` binding
 *    resolves on two of the four matched members and not on the other two, and
 *    a `chlorine_pump_on` binding does the reverse.
 *
 *    That is a **reported** state and not a silent one — but which state it
 *    reports depends on the widget, and `outcomeOf` in
 *    `dashboard-templates-instantiate.service.ts` is why. It tests `truncated`
 *    **before** `partial`, so a cap-1 `value_tile` reports `truncated`, whose
 *    stated remedy is "the widget cannot hold them all — use another widget".
 *    That would be false here: the widget holds them fine, and two members
 *    simply carry no such point. A `chart` reports `partial` at 4 matched / 2
 *    bound, which is the honest word and the honest number. This is why
 *    `electrical-metered-pumping` puts both binaries on charts, and on two
 *    charts rather than one — see its docblock in `stock-catalog.ts`.
 *
 *    This is the same call case 2 below already makes for ESKOM's `ht-panel`,
 *    so the two readings now agree instead of one of them being a deferral.
 * 2. **`ht-panel`** matches nothing: the seeded estate steps 11 kV incomer →
 *    100 kVA transformer → 415 V bus, so it holds no HT panel. The stock
 *    electrical template's "HT Panel Load" chart therefore resolves nothing for
 *    ESKOM, and that is the correct answer rather than a gap to paper over —
 *    it is exactly what ADR 0049 Amendment 2's resolution report exists to say.
 *
 * Nothing here covers HVAC. `CH-CRAC-101` plausibly reads as `ahu-fcu`, but
 * `CR-HVAC-1`/`CR-HVAC-2` decide nothing between `chiller` and `ahu-fcu`, and a
 * coin toss seeded as master data is worse than a NULL an admin must fill.
 */
export function demoRoleForAsset(code: string, domain: string): string | null {
  if (domain !== "electrical") {
    return null;
  }
  if (code.includes("UTILITY")) {
    return "incoming-supply";
  }
  if (code.includes("XFMR") || code.startsWith("TX-")) {
    return "transformer";
  }
  if (code.includes("MAIN-BUS") || code.includes("MDB")) {
    return "lt-panel";
  }
  if (/^CR-Q\d+$/.test(code)) {
    return "mcc";
  }
  if (code.includes("LIGHT-AUX") || code.startsWith("PV-INV")) {
    return "utilities";
  }
  // `F3.41` — the owner's ruling, LAST so the diff is an addition rather than a
  // reordering of live branches.
  //
  // Anchored on the `PHE-` prefix, not on a bare substring, and the position is
  // safe in both directions rather than only one. No branch above can claim a
  // PHE code: `"PHE-PUMP-M-000000000"` holds no `UTILITY`, no `XFMR`, no
  // `MAIN-BUS` and no `MDB` — the `P-U-M-P-M` run does not produce one — no
  // `LIGHT-AUX`, and starts with neither `TX-` nor `PV-INV`; `/^CR-Q\d+$/` is
  // anchored. And no ESKOM code begins `PHE-`, so these two cannot claim one
  // either. `asset-groups-seed.spec.ts` checks both directions per code rather
  // than leaving this comment as the only statement of it.
  if (code.startsWith("PHE-MFM-")) {
    return "meter";
  }
  // ONE branch for both pump shapes, because the ruling gives them one code.
  // Splitting it into `pump` and `dosing-pump` is a migration and reopens a
  // decision `F3.40` closed — its closure states "One `pump` code and not also
  // `dosing-pump`" and gives the reason.
  if (code.startsWith("PHE-PUMP-")) {
    return "pump";
  }
  return null;
}

export async function seedAssetGroups(
  pool: pg.Pool,
  organizationId: string,
): Promise<void> {
  await pool.query(`
    DELETE FROM bms.asset_group_members AS agm
    USING bms.asset_groups AS ag,
          bms.assets AS a
    WHERE agm.asset_group_id = ag.id
      AND agm.asset_id = a.id
      AND a.location_id IS NOT NULL
      AND ag.location_id <> a.location_id
  `);

  const assetScopeRows = await pool.query<{
    asset_id: string;
    code: string;
    domain: string;
    location_id: string;
  }>(`
    SELECT id AS asset_id, code, domain, location_id
    FROM bms.assets
    WHERE location_id IS NOT NULL
    ORDER BY site_name, code
  `);

  for (const row of assetScopeRows.rows) {
    const groupCode =
      row.domain === "hvac"
        ? "hvac"
        : row.domain === "it"
          ? "it-rack"
          : row.domain === "environment"
            ? "environment"
            : row.code.includes("UPS") || row.code.includes("BATT")
              ? "ups-battery"
              : "electrical";
    const groupName =
      groupCode === "it-rack"
        ? "IT & Rack Load"
        : groupCode === "ups-battery"
          ? "UPS & Battery"
          : groupCode[0]!.toUpperCase() + groupCode.slice(1);
    const group = await pool.query<{ id: string }>(
      `
      INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (location_id, code) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          organization_id = EXCLUDED.organization_id
      RETURNING id
      `,
      [
        row.location_id,
        groupCode,
        groupName,
        "Seeded operational asset group for scoped access demos.",
        organizationId,
      ],
    );
    const groupId = group.rows[0]?.id;
    if (!groupId) {
      continue;
    }
    // `COALESCE` on the existing value, not `EXCLUDED.role`: this seed re-runs
    // on every `compose up`, and `F3.37`'s whole purpose is that an admin sets
    // this column. Writing `EXCLUDED.role` would silently revert their choice
    // at the next boot. So the seed fills a NULL and never overwrites a value.
    await pool.query(
      `
      INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (asset_group_id, asset_id) DO UPDATE
      SET role = COALESCE(bms.asset_group_members.role, EXCLUDED.role)
      `,
      [groupId, row.asset_id, demoRoleForAsset(row.code, row.domain)],
    );
  }
}
