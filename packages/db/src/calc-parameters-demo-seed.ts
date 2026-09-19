import type { SeedQueryable } from "./seed-tenant";

/**
 * `E4.1c` (ADR 0070 decision 7; the owner's Q1 ruling of 2026-09-19) — the
 * demo organization's energy tariff, as a `bms.calc_parameters` row.
 *
 * **Why this exists.** Until `E4.1c` the Energy Centre's indicative cost was
 * kWh × a tariff read from the process environment, with a hardcoded Rand
 * default. Decision 7 removes both: the tariff is now the organization's
 * `energy_tariff_per_kwh` parameter, resolved through `CalcParametersService`,
 * and a scope with no row answers `null`. On a database with no parameter
 * value that turns the demo's cost tile from a number into a dash. This row
 * restores the demo's parity — the same `2.15` the environment default carried,
 * for the same organization whose tariff it was.
 *
 * **ESKOM only, never PHEWB.** ADR 0070 Context 3 forbids a *stock key*
 * shipping with a value, and the pilot is a real client: a guessed rupee
 * tariff on its screen is the B14 risk verbatim. `db:seed` is demo data for
 * the demo tenant (`meta.tenant = "demo"`), and that is the whole reach of
 * this module. `verify-hierarchy-seed.ts` counts the row as the fleet role.
 *
 * **Insert-if-absent, not update.** The other seeds re-assert their rows on
 * every `compose up` (`ON CONFLICT … DO UPDATE`), because those rows are the
 * seed's to own. A tariff is the organization's to own: an administrator who
 * enters a different value, or ends this one's validity, on
 * `/admin/calc-parameters` must not have it put back on the next boot. The
 * predicate is "no organization-scope row for this key, effective or not" —
 * so a deliberately ended row also stays ended. (`calc_parameters_no_overlap`
 * would refuse an overlapping insert anyway; the predicate is what makes the
 * refusal never happen.)
 *
 * Runs inside the ESKOM `withOrganization` bracket: `bms.calc_parameters` is
 * `FORCE ROW LEVEL SECURITY` and the seed's `bms_owner` needs the tenant GUC
 * to write it (`0074`'s header).
 */

/** The key `0074_calc_parameters.sql` seeds and both cost reads resolve. */
export const DEMO_ENERGY_TARIFF_KEY = "energy_tariff_per_kwh";

/** The value the removed environment default carried; Rand, the demo organization's currency. */
export const DEMO_ENERGY_TARIFF_VALUE = 2.15;

/** Open-ended from the start of the demo year, so any report range this year resolves it. */
export const DEMO_ENERGY_TARIFF_EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";

const INSERT_IF_ABSENT_SQL = `
  INSERT INTO bms.calc_parameters (organization_id, key, location_id, asset_id, value, effective_from, effective_to)
  SELECT $1::uuid, $2, NULL, NULL, $3::float8, $4::timestamptz, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM bms.calc_parameters
     WHERE organization_id = $1::uuid
       AND key = $2
       AND location_id IS NULL
       AND asset_id IS NULL
  )
`;

/** Seeds the demo organization's tariff row if the organization holds none at its own scope. */
export async function seedCalcParametersDemo(pool: SeedQueryable, organizationId: string): Promise<void> {
  await pool.query(INSERT_IF_ABSENT_SQL, [
    organizationId,
    DEMO_ENERGY_TARIFF_KEY,
    DEMO_ENERGY_TARIFF_VALUE,
    DEMO_ENERGY_TARIFF_EFFECTIVE_FROM,
  ]);
}
