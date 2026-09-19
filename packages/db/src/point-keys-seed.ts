import type pg from "pg";

import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_CLASS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  ENVIRONMENT_CLASS_POINT_KEYS,
  FACILITY_CLASS_POINT_KEYS,
  HVAC_CLASS_POINT_KEYS,
  HVAC_POINT_KEYS,
  MECHANICAL_CLASS_POINT_KEYS,
  METERED_PUMPING_POINT_KEYS,
  SUSTAINABILITY_ELECTRICAL_POINT_KEYS,
  SUSTAINABILITY_FACILITY_POINT_KEYS,
  SUSTAINABILITY_HVAC_POINT_KEYS,
  SUSTAINABILITY_MECHANICAL_POINT_KEYS,
  SUSTAINABILITY_WATER_POINT_KEYS,
  VERTICAL_TRANSPORT_CLASS_POINT_KEYS,
  WATER_CLASS_POINT_KEYS,
} from "@bms/shared";

import { UNIT_BY_KEY } from "./point-key-units";

type PointKeySeed = {
  code: string;
  name: string;
  domain: string;
  unit: string | null;
};

function titleCase(code: string): string {
  return code
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function keysForDomain(
  codes: readonly string[],
  domain: string,
): PointKeySeed[] {
  return codes.map((code) => ({
    code,
    name: titleCase(code),
    domain,
    unit: UNIT_BY_KEY[code] ?? null,
  }));
}

/**
 * `F3.39` / ADR 0051 decision 2 — ONE catalog, not one per organization.
 *
 * This was two lists: an `ESKOM_CATALOG` of 34 codes and a `PHE_CATALOG` of 15,
 * the second a strict subset of the first built from the same two arrays. That
 * split described nothing — a code names a measurement, not an estate — and it
 * broke the one thing a stock dashboard template needs, which is that a
 * `pointKey` means the same quantity in every organization. Migration `0057`
 * drops `point_keys.organization_id`, so there is no longer an axis to split on.
 *
 * The union is exactly what `ESKOM_CATALOG` already held, so nothing is added
 * here and nothing is lost. What PHEWB gains is the 19 codes it was denied for
 * no reason — including `frequency_hz`, which its pilot meters have been
 * reading all along while its own catalog did not name it.
 */
const GLOBAL_CATALOG: PointKeySeed[] = [
  ...keysForDomain(ELECTRICAL_POINT_KEYS, "electrical"),
  ...keysForDomain(HVAC_POINT_KEYS, "hvac"),
  ...keysForDomain(CONTROL_ROOM_UPS_POINT_KEYS, "electrical"),
  ...keysForDomain(CONTROL_ROOM_IT_POINT_KEYS, "it"),
  ...keysForDomain(CONTROL_ROOM_ENVIRONMENT_POINT_KEYS, "environment"),
  ...keysForDomain(
    CONTROL_ROOM_ELECTRICAL_POINT_KEYS.filter(
      (key) => !(ELECTRICAL_POINT_KEYS as readonly string[]).includes(key),
    ),
    "electrical",
  ),
  // `F3.41` — the real-ingest metered-pumping set, LAST and unfiltered.
  //
  // Last so the `.filter()` above, which subtracts `ELECTRICAL_POINT_KEYS` from
  // the control-room array, keeps reading exactly what it read before. This
  // array needs no such filter: its twelve codes are disjoint from all six
  // arrays above, which `tests/f3.39-global-point-key-vocabulary.test.ts`'s
  // clash check proves rather than this comment asserting it.
  //
  // Filed under `electrical` because `deviceDomain()` in `phe-pilot-seed.ts`
  // files the MFM and both PUMP shapes that carry these codes under
  // `electrical`. A disagreement here would give one code two domains, and
  // after `F3.39`'s single-pass `ON CONFLICT (code) DO UPDATE` the later array
  // would win silently — which is the drift that clash check exists for.
  ...keysForDomain(METERED_PUMPING_POINT_KEYS, "electrical"),
  // `F2.11` — the electrical class point keys (ADR 0051 Amendment 6), LAST
  // and unfiltered, for the same two reasons `F3.41`'s array above is last.
  //
  // (a) The `.filter()` above, which subtracts `ELECTRICAL_POINT_KEYS` from
  // the control-room array, keeps reading exactly what it read before.
  //
  // (b) `created_at` ordering. Five fixtures pick their point key with
  // `ORDER BY created_at, code` over the whole table
  // (telemetry-write.spec.ts, telemetry-import.spec.ts,
  // resolve-catalog-point-key.spec.ts,
  // asset-templates.instantiate.integration.spec.ts,
  // asset-templates.lifecycle.integration.spec.ts). Appending this array
  // last gives 138 of its 139 rows the newest `created_at` on every database,
  // existing and fresh, so no NEW row enters a head window. The exception is
  // `battery_charge_pct`: it already holds a row that `seedPheCatalog` wrote
  // earlier, `ON CONFLICT ... DO UPDATE` leaves `created_at` alone, and on a
  // cold start that row is the OLDEST in the table. Its unit filling
  // `NULL` → `"%"` therefore moves it INTO the two `unit IS NOT NULL ...
  // LIMIT 5` windows (telemetry-write.spec.ts, telemetry-import.spec.ts) at
  // position 0 and evicts the fifth row — harmless, since `"%"` is a real
  // unit and both specs need four, but a reader who trusts "none move" would
  // be wrong by exactly one row. Verified on a scratch cold start (F2.11).
  ...keysForDomain(ELECTRICAL_CLASS_POINT_KEYS, "electrical"),
  // `E5.1` — the water-treatment class point keys (ADR 0040), LAST and
  // unfiltered, for the same two reasons the electrical class array above is
  // last. (a) The `.filter()` above, which subtracts `ELECTRICAL_POINT_KEYS`
  // from the control-room array, keeps reading exactly what it read before.
  // (b) `created_at` ordering: the same five fixtures pick their point key
  // with `ORDER BY created_at, code`, and appending this array last gives
  // all 98 rows the newest `created_at` on every database, existing and
  // fresh — and unlike `ELECTRICAL_CLASS_POINT_KEYS`'s `battery_charge_pct`,
  // there is no pre-existing row among these 98, so no fixture window moves
  // at all (verified on a cold start, not assumed).
  ...keysForDomain(WATER_CLASS_POINT_KEYS, "water"),
  // `E5.2` — the mechanical and HVAC class point keys (ADR 0053), LAST and
  // unfiltered, for the same two reasons the water class array above is
  // last. (a) The `.filter()` above, which subtracts `ELECTRICAL_POINT_KEYS`
  // from the control-room array, keeps reading exactly what it read before.
  // (b) `created_at` ordering: the same five fixtures pick their point key
  // with `ORDER BY created_at, code`, and appending these arrays last gives
  // all 107 rows the newest `created_at` on every database, existing and
  // fresh — none of the 107 pre-exists, so no fixture window moves at all
  // (verified on a cold start, not assumed). The `hvac` line files 39 codes
  // under a domain that already holds `HVAC_POINT_KEYS`'s nine; the clash
  // check `tests/f3.39-global-point-key-vocabulary.test.ts` runs is per
  // code, not per domain.
  ...keysForDomain(MECHANICAL_CLASS_POINT_KEYS, "mechanical"),
  ...keysForDomain(HVAC_CLASS_POINT_KEYS, "hvac"),
  // `E5.3` — the facility pack (ADR 0054), LAST and unfiltered, for the same
  // two reasons the mechanical arrays above are last, and from a second
  // shared file (plan §4.5: `constants.ts` is at the §4.5 line cap). None of
  // the 104 pre-exists, so no `ORDER BY created_at, code` fixture window
  // moves. The `environment` line files 13 codes under a domain that already
  // holds six rows, of which `CONTROL_ROOM_ENVIRONMENT_POINT_KEYS` declares
  // FOUR. The other two — `controller_power_status` and `network_strength` —
  // are the PHE gateway's own health points and reach this table only through
  // `phe-pilot-seed.ts`, in no shared array at all. That matters beyond
  // arithmetic: the clash check in
  // `tests/f3.39-global-point-key-vocabulary.test.ts` iterates `ARRAY_DOMAIN`
  // over the parsed source files, so those two are OUTSIDE its reach, and a
  // later pack that declared either would be silently re-filed by this seed's
  // `domain = EXCLUDED.domain` with nothing failing. `E5.3` is safe — all 104
  // codes were checked against both, and against every code in
  // `GLOBAL_CATALOG`, with zero overlap.
  ...keysForDomain(FACILITY_CLASS_POINT_KEYS, "facility"),
  ...keysForDomain(ENVIRONMENT_CLASS_POINT_KEYS, "environment"),
  // `E5.3` PR 2 — the vertical-transport pack (ADR 0054), LAST and unfiltered,
  // for the same two reasons the facility arrays above are last, and from the
  // same second shared file. None of the 102 pre-exists, so no
  // `ORDER BY created_at, code` fixture window moves. This line files 102 codes
  // under a domain that already holds 68 (`MECHANICAL_CLASS_POINT_KEYS`) — the
  // `HVAC_CLASS_POINT_KEYS` precedent; the clash check in
  // `tests/f3.39-global-point-key-vocabulary.test.ts` is per code, not per
  // domain, and all 102 were checked against every code in `GLOBAL_CATALOG`
  // with zero overlap.
  ...keysForDomain(VERTICAL_TRANSPORT_CLASS_POINT_KEYS, "mechanical"),
  // `E4.1c` — the sustainability codes (ADR 0070 decision 8), AFTER every pack
  // array and from a third shared file. None of the 29 pre-exists (`load_pct`,
  // which the DG set authors, is the UPS's and is not redeclared). A code
  // declared here and authored by another pack's entry (`availability_pct_24h`,
  // `starts_per_day` on the pump, lift and escalator in PR 2b) keeps THIS
  // domain — the `load_pct` rule; the per-code clash check in
  // `tests/f3.39-global-point-key-vocabulary.test.ts` holds.
  ...keysForDomain(SUSTAINABILITY_ELECTRICAL_POINT_KEYS, "electrical"),
  ...keysForDomain(SUSTAINABILITY_WATER_POINT_KEYS, "water"),
  ...keysForDomain(SUSTAINABILITY_MECHANICAL_POINT_KEYS, "mechanical"),
  ...keysForDomain(SUSTAINABILITY_HVAC_POINT_KEYS, "hvac"),
  ...keysForDomain(SUSTAINABILITY_FACILITY_POINT_KEYS, "facility"),
];

/**
 * Every code this seed writes, in declaration order.
 *
 * Exported so a fixture that names a catalog code can prove the code is **stock
 * vocabulary** rather than a row some integration suite registered and is about
 * to delete. A database lookup cannot tell those apart; this list can, and it
 * grows with the `*_POINT_KEYS` arrays instead of duplicating them.
 *
 * **`F3.42`'s post-merge sweep is why the distinction is worth an export.**
 * `access-fixtures-seed.ts` chose its point with `ORDER BY created_at, code
 * LIMIT 1` over the whole table, which was bounded only while `bms.point_keys`
 * carried an organization predicate. `0057` removed it, so the answer became
 * whatever the database's own history put first — a transient fixture code was
 * reachable, and on a fresh database a PHE pilot code won. That fixture names
 * its code now, and this list is what keeps the name honest.
 */
export const STOCK_POINT_KEY_CODES: readonly string[] = GLOBAL_CATALOG.map((row) => row.code);

/**
 * Seeds the fleet-wide point key catalog.
 *
 * **`F3.39` — no tenant context, because there is no tenant.** This used to run
 * inside `withOrganization` once per organization: `bms.point_keys` was one of
 * the five tables carrying `FORCE ROW LEVEL SECURITY` (`E7.1a`), so a write
 * needed `app.current_organization` set and an explicit `organization_id` bind
 * for the policy's `WITH CHECK` to compare against. Migration `0057` removes
 * the policy, the FORCE flag and the column, so both are gone: a context that
 * nothing reads and a bind for a column that does not exist.
 *
 * The upsert arbiter moves with the index — `(organization_id, code)` was
 * dropped by `0057` and `(code)` replaces it.
 *
 * `description` is deliberately not written and not overwritten. A repaired
 * orphan row from `0057` carries a NULL one and an admin may fill it in; this
 * seed re-runs on every `compose up` and must not revert that.
 *
 * **`unit` is `COALESCE`d for exactly the same reason, since `F3.41`.** It used
 * to be a plain `unit = EXCLUDED.unit`, which reverted an administrator's fill
 * on every `compose up` — and `bms.point_keys` is fleet-wide and unpoliced
 * since `0057`, so the administrator in question is a global one and ADR 0051
 * Amendment 1 names their correction as the remedy for a code the platform
 * mislabels. `phe-pilot-seed.ts` had already made this call for the codes it
 * writes, in those words: *"an admin who fills one in must not have it reverted
 * at the next boot."* The two seeds disagreed, and `seedPointKeyCatalog` runs
 * **last**, so the plain assignment won.
 *
 * `F3.41` is what made that reachable rather than theoretical: it added twelve
 * PHE codes to `GLOBAL_CATALOG` that until then reached the table only through
 * `phe-pilot-seed.ts`'s protective upsert, so a branch about a dashboard
 * template would have quietly removed a protection from twelve rows. Found by
 * the `security-reviewer` sweep.
 *
 * **THE COST, STATED RATHER THAN DISCOVERED LATER: this seed can no longer
 * CORRECT a unit.** Change a value in `UNIT_BY_KEY` and existing databases keep
 * the old one; only a fresh row takes the new. That is the same trade
 * `phe-pilot-seed.ts` and `description` above already accept, and it is the
 * right way round — a seed that overwrites is a seed that silently undoes
 * operator input, and an admin can always re-`PATCH` the code through
 * `/api/v1/admin/point-keys/:id`.
 *
 * `name` and `domain` stay assigned outright, AND THAT IS A COST TOO — this
 * paragraph used to claim neither was administrator-editable, which is false:
 * `updatePointKeyBodySchema` in `apps/api/src/admin/point-keys/point-keys.schema.ts`
 * is a `.partial()` over `name`, `domain`, `unit` and `description`, so a
 * global administrator's `PATCH` of a `name` is reverted on the next
 * `compose up`, with the `master.point_key.update` audit row left asserting
 * a change the table no longer holds. Found by the `F2.11` security and
 * migration reviews (2026-09-02); pre-existing since `F3.39`, and `F2.11`
 * multiplies the exposure from 46 rows to 185, most of them `titleCase`
 * names ("Dga H2 Ppm", "Oltc In Progress") an administrator is likely to
 * correct. Left as-is here because the seed MUST be able to correct a
 * `domain` — `ARRAY_DOMAIN`'s clash check in
 * `tests/f3.39-global-point-key-vocabulary.test.ts` is entitled to assume the
 * seed corrects a drifted one, and ADR 0051 Amendment 6 decision 3 is
 * implemented by exactly this assignment. Whether `name` should be
 * `COALESCE`d like `unit`, or the `PATCH` body narrowed, is an owner decision
 * filed as a backlog row by the `F2.11` closure sweep.
 */
export async function seedPointKeyCatalog(pool: pg.Pool): Promise<void> {
  for (const row of GLOBAL_CATALOG) {
    await pool.query(
      `
      INSERT INTO bms.point_keys (code, name, domain, unit, active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        domain = EXCLUDED.domain,
        unit = COALESCE(bms.point_keys.unit, EXCLUDED.unit)
      `,
      [row.code, row.name, row.domain, row.unit],
    );
  }
}
