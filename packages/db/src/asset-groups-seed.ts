import type pg from "pg";

/**
 * Location backfill and derived asset groups, split out of `seed.ts` to keep it
 * under the AGENTS.md §4.5 1000-line cap. It was a pure move, and
 * `assignEskomAssetRtus` still runs between the two exported functions as
 * before; `backfillAssetLocations` has since changed its statement (the
 * `F4.169`/`F4.170` addendum, see its docblock).
 */

/**
 * The statement {@link backfillAssetLocations} runs. Exported so
 * `asset-groups-seed.spec.ts` can hold its text: the one branch that matters
 * (`location_id IS NULL`) cannot be reached by an integration test, because
 * `bms.assets.location_id` is NOT NULL.
 *
 * It fills a NULL `location_id` and never moves an asset that has one (owner
 * ruling 14). It used to also match `a.location_id <> l.id`, so an admin
 * asset at one location whose free-text `site_name` named another was moved
 * there on every boot, and its asset-group membership went with it.
 *
 * A location name is not unique — an admin may create a second location with
 * a seeded location's name — so only the OLDEST location of each name is a
 * candidate (`DISTINCT ON (name) … ORDER BY name, created_at, id`).
 */
export const BACKFILL_ASSET_LOCATIONS_SQL = `
    UPDATE bms.assets AS a
    SET location_id = l.id
    FROM (
      SELECT DISTINCT ON (name) id, name
      FROM bms.locations
      ORDER BY name, created_at, id
    ) AS l
    WHERE a.site_name = l.name
      AND a.location_id IS NULL
  `;

/**
 * Points every asset with no location at the location whose name matches its
 * site name.
 *
 * **A no-op after the first boot, and kept** (owner ruling 14, OQ4). Every
 * asset INSERT in the seed sets `location_id`, the column is NOT NULL, and
 * `enforceHierarchyNotNull` re-applies that at the end of every seed, so no
 * row it could fill survives a boot. It stays for a database on which the
 * column is still nullable and a row has no location, where it is the step
 * that lets `enforceHierarchyNotNull` pass.
 */
export async function backfillAssetLocations(pool: pg.Pool): Promise<void> {
  await pool.query(BACKFILL_ASSET_LOCATIONS_SQL);
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
 *    charts rather than one — see its docblock in `stock-catalog-electrical.ts`.
 *
 *    This is the same call case 2 below already makes for ESKOM's `ht-panel`,
 *    so the two readings now agree instead of one of them being a deferral.
 * 2. **`ht-panel`** matches nothing: the seeded estate steps 11 kV incomer →
 *    100 kVA transformer → 415 V bus, so it holds no HT panel. The stock
 *    electrical template's "HT Panel Load" chart therefore resolves nothing for
 *    ESKOM, and that is the correct answer rather than a gap to paper over —
 *    it is exactly what ADR 0049 Amendment 2's resolution report exists to say.
 *
 * 3. **`F3.73` plan D12 (ruling Q6b: "the seed gives roles to UPS, battery,
 *    HVAC, IT and environment assets").** The SMOC standard site layout binds
 *    its UPS, HVAC, IT and ENV tiles to the roles migration `0089` seeds, so
 *    without these every one of those tiles resolved nothing. Domain-keyed
 *    branches run FIRST, before the electrical guard: an HVAC unit is `crac`
 *    (the SMOC pages call both `CR-HVAC-*` and `CH-CRAC-*` CRAC units), a PDU
 *    is `pdu` (tested before `RACK`, since `CR-NET-RACK-PDU-A` holds both), a
 *    rack is `it-rack`, a room sensor `CR-ENV-*` is `indoor-air`, and the
 *    `CR-LEAK-*` / `CR-SMOKE-*` sensors take `0095`'s `leak-sensor` and
 *    `smoke-detector` (OQ6). Each reads the CODE as well as the domain, so the
 *    PHE gateways (`environment` domain, case 1) stay unroled. The UPS and
 *    battery branches read the code and run AFTER the guard, because those
 *    assets are electrical-domain and a room sensor named `CR-ENV-UPS-ROOM` is
 *    not a UPS.
 */
export function demoRoleForAsset(code: string, domain: string): string | null {
  if (domain === "hvac" && /CRAC|CR-HVAC/.test(code)) {
    return "crac";
  }
  if (domain === "it" && code.includes("PDU")) {
    return "pdu";
  }
  if (domain === "it" && code.includes("RACK")) {
    return "it-rack";
  }
  if (domain === "environment" && /(^|-)CR-ENV-/.test(code)) {
    return "indoor-air";
  }
  if (domain === "environment" && code.startsWith("CR-LEAK-")) {
    return "leak-sensor";
  }
  if (domain === "environment" && code.startsWith("CR-SMOKE-")) {
    return "smoke-detector";
  }
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
  // `F3.74` D10 — the twelve control-room breakers, each one of five breaker roles, from a table
  // rather than the old `/^CR-Q\d+$/ → mcc` pattern. A thirteenth `CR-Q` code decides nothing.
  const breakerRole = CR_BREAKER_ROLES[code];
  if (breakerRole !== undefined) {
    return breakerRole;
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
  // `LIGHT-AUX`, and starts with neither `TX-` nor `PV-INV`; the `CR_BREAKER_ROLES`
  // lookup is exact. And no ESKOM code begins `PHE-`, so these two cannot claim one
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
  // `F3.73` — case 3's code-keyed half, electrical only. No branch above claims
  // a UPS or battery code: none holds `UTILITY`, `XFMR`, `MAIN-BUS` or `MDB`.
  if (code.includes("UPS")) {
    return "ups";
  }
  if (code.includes("BATT")) {
    return "battery";
  }
  return null;
}

/**
 * `F3.74` D10 — the role of each control-room breaker, a table and not a pattern. `main-breaker`
 * is the incomer, the UPS input and output pairs follow `CR-UPS-1`/`-2`, the four PDU feeders are
 * `load-feeder-breaker`, and the HVAC and lighting feeders are `mains-feeder-breaker`. A code
 * outside the table (a thirteenth `CR-Q`) decides nothing and keeps its NULL.
 */
const CR_BREAKER_ROLES: Readonly<Record<string, string>> = {
  "CR-Q1": "main-breaker",
  "CR-Q2": "ups-input-breaker",
  "CR-Q3": "ups-input-breaker",
  "CR-Q4": "ups-output-breaker",
  "CR-Q5": "ups-output-breaker",
  "CR-Q6": "load-feeder-breaker",
  "CR-Q7": "load-feeder-breaker",
  "CR-Q8": "load-feeder-breaker",
  "CR-Q9": "load-feeder-breaker",
  "CR-Q10": "mains-feeder-breaker",
  "CR-Q11": "mains-feeder-breaker",
  "CR-Q12": "mains-feeder-breaker",
};

/**
 * `F2.8` ruling 2 — the reserved group code the incomer's `it_kw` formula
 * resolves through: `sum({rack_kw} @group('IT_LOAD'))` (`pue-demo-seed.ts`).
 * `bms.asset_groups` is unique on `(location_id, code)` (migration `0010`),
 * so the group is per site, which is what lets `@group` resolve against the
 * owner's location (ADR 0055 decision 9).
 */
export const IT_LOAD_GROUP_CODE = "IT_LOAD";

/**
 * The demo groups an asset joins, derived from its domain and code — one per
 * asset, except an IT asset, which joins two.
 *
 * **`IT_LOAD` is a second group and `it-rack` stays** (`F2.8`, plan §11
 * decision 2). Two readers name `it-rack` — `apps/web/src/lib/
 * control-room-access.ts` and migration `0013` — so ruling 2 adds the reserved
 * code rather than renaming the one the scoped-access demo is built on. Keyed
 * on the `it` domain, so PHE WB (electrical and environment only) gets no
 * `IT_LOAD` group by construction; `asset-groups-seed.spec.ts` runs the real
 * PHE catalog through this to hold that.
 *
 * Pure and exported so the mapping is testable through the real function
 * rather than restated in a test — the same reason `demoRoleForAsset` is.
 */
export function demoGroupCodesForAsset(code: string, domain: string): readonly string[] {
  if (domain === "hvac") {
    return ["hvac"];
  }
  if (domain === "it") {
    return ["it-rack", IT_LOAD_GROUP_CODE];
  }
  if (domain === "environment") {
    return ["environment"];
  }
  // `E4.3` U11 — without this branch a water asset fell through to the
  // electrical default below and joined its site's ELECTRICAL group.
  if (domain === "water") {
    return ["water"];
  }
  if (code.includes("UPS") || code.includes("BATT")) {
    return ["ups-battery"];
  }
  return ["electrical"];
}

/** The picker-facing name of a demo group; the code is what a formula names. */
export function demoGroupName(groupCode: string): string {
  switch (groupCode) {
    case "it-rack":
      return "IT & Rack Load";
    case "ups-battery":
      return "UPS & Battery";
    case IT_LOAD_GROUP_CODE:
      return "IT load (PUE)";
    default:
      return groupCode[0]!.toUpperCase() + groupCode.slice(1);
  }
}

/**
 * `F3.73` plan D12 — the asset domain a demo group stands for, which the site-layout planner
 * reads to bind a tab (`asset_groups.domain`, migration `0095`). `IT_LOAD` is a formula group
 * (`F2.8`) and stands for none: bound as an `it` candidate beside `it-rack`, it would make the
 * `it` tab ambiguous at every RSMOC. Every other code is its own domain, and the upsert keeps
 * the value only when `bms.asset_domains` holds it.
 */
export function demoGroupDomain(groupCode: string): string | null {
  switch (groupCode) {
    case IT_LOAD_GROUP_CODE:
      return null;
    case "ups-battery":
      return "electrical";
    case "it-rack":
      return "it";
    default:
      return groupCode;
  }
}

/**
 * The group upsert {@link seedAssetGroups} runs, exported so `asset-groups-seed.spec.ts` can hold
 * its `domain` rule. `domain` is written only while it is NULL (`COALESCE` on the stored value,
 * the membership role's rule below), so an administrator's re-filing survives the next boot, and
 * only as a live `bms.asset_domains` code, so a code that names no domain writes NULL rather than
 * failing the foreign key and aborting the tenant transaction.
 * Params: `[locationId, code, name, description, organizationId, domain]`.
 */
export const ASSET_GROUP_UPSERT_SQL = `
        INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id, domain)
        VALUES ($1, $2, $3, $4, $5, (SELECT d.code FROM bms.asset_domains d WHERE d.code = $6))
        ON CONFLICT (location_id, code) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            organization_id = EXCLUDED.organization_id,
            domain = COALESCE(bms.asset_groups.domain, EXCLUDED.domain)
        RETURNING id
        `;

function demoGroupDescription(groupCode: string): string {
  if (groupCode === IT_LOAD_GROUP_CODE) {
    return (
      "Seeded IT load group (F2.8 ruling 2). The reserved code the site incomer's " +
      "it_kw formula resolves through @group('IT_LOAD'); one per site."
    );
  }
  return "Seeded operational asset group for scoped access demos.";
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
    for (const groupCode of demoGroupCodesForAsset(row.code, row.domain)) {
      const group = await pool.query<{ id: string }>(ASSET_GROUP_UPSERT_SQL, [
        row.location_id,
        groupCode,
        demoGroupName(groupCode),
        demoGroupDescription(groupCode),
        organizationId,
        demoGroupDomain(groupCode),
      ]);
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
}
