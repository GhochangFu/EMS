import type pg from "pg";

/**
 * `E5.2` — the `bms.asset_domains` rows a domain pack adds through the seed.
 *
 * **The path ADR 0031 Amendment 1 A1.1 prescribed and nothing had used.**
 * `F4.45` made the plant domain a table so that a domain pack could add one
 * without a migration and a deploy per sector: *"declaring a value is an
 * `INSERT` a domain pack ships in its own seed."* Migration `0029` seeded the
 * five — `electrical`, `hvac`, `it`, `environment`, `water` — and until this
 * module it was the table's only writer: `E5.1` filed the STP, the ETP and the
 * cooling tower under `water` and added none. ADR 0053 decision 2 rules the
 * sixth, **`mechanical` / `Mechanical` / `sort_order 60`**, for the pump set,
 * the VFD, the air compressor and the boiler (the chiller and the AHU are
 * `hvac`). It is the first domain added since `0029`, and this is the module
 * `E5.3` copies for `facility` — one more entry in {@link PACK_ASSET_DOMAINS},
 * under its own ADR, and `verifyHierarchySeed`'s Pass 1 count moves with it.
 *
 * **Why no tenant context, and why no grant** (plan §4.3, measured on the
 * running stack rather than reasoned): `bms_owner` owns the table since `0041`
 * re-owned every `bms.*` relation to it, and an owner needs no `GRANT` to
 * `INSERT`. No policy and no `FORCE ROW LEVEL SECURITY` bind it — `0047`
 * deliberately left the global-vocabulary class (`asset_domains`,
 * `rule_categories`, `alarm_severities`, `alarm_skills`) unpoliced, and `0059`
 * policed `point_keys` only. So `seed.ts` calls this **outside** every
 * `withOrganization` bracket, exactly as it calls `seedPointKeyCatalog`: a
 * domain belongs to no organization, and a tenant context here would be a
 * claim about whose row this is. `asset-domains-seed.spec.ts` pins both facts
 * by reading `seed.ts` as text.
 *
 * **Order.** Domains first, then the point keys `keysForDomain(…, "mechanical")`
 * files under one. `bms.point_keys.domain` is a plain `varchar(64)` with no
 * foreign key, so the database does not enforce this; the spec does, because
 * a convention nothing checks is one a later edit reorders without noticing.
 *
 * **`DO NOTHING`, not `DO UPDATE`, for two reasons.** First, this seed re-runs
 * on every `compose up` (the `migrate` service runs `db:seed` and then the
 * count check), and a global administrator's retirement of a domain
 * (`active = false`) or relabel must survive that boot — `DO UPDATE` would
 * silently undo it, the same rule `ruled-point-catalog-seed.ts` holds for a
 * catalogued point. Second, this module owns the row's *existence*, never its
 * contents: the statement does not even name `active`, so it has no way back
 * to `true` for a row someone retired. The cost is the same one
 * `point-keys-seed.ts` states for `unit`: a correction to the label or the
 * sort order here reaches fresh databases only. An existing one is corrected
 * through the vocabulary the way ADR 0051 Amendment 1 names — by the
 * administrator, not by the next boot.
 */

/** One domain row a pack declares. `sortOrder` places it in every `<select>`. */
export type AssetDomainSeed = {
  readonly code: string;
  readonly label: string;
  readonly sortOrder: number;
};

/**
 * The rows. Exactly one today, and a second is a second ADR — the spec asserts
 * the literal, so an addition is a deliberate edit to both.
 */
export const PACK_ASSET_DOMAINS: readonly AssetDomainSeed[] = [
  { code: "mechanical", label: "Mechanical", sortOrder: 60 },
];

/**
 * Exported so the spec can assert the arbiter and the conflict action as text.
 * `active` is not in the column list on purpose — see the module docblock.
 */
export const ASSET_DOMAIN_SQL = `
  INSERT INTO bms.asset_domains (code, label, sort_order)
  VALUES ($1, $2, $3)
  ON CONFLICT (code) DO NOTHING
`;

/** Seeds every pack-declared domain. Idempotent; never overwrites (see above). */
export async function seedAssetDomains(pool: pg.Pool): Promise<void> {
  for (const row of PACK_ASSET_DOMAINS) {
    await pool.query(ASSET_DOMAIN_SQL, [row.code, row.label, row.sortOrder]);
  }
}
