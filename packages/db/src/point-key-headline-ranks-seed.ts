import type pg from "pg";

/**
 * One rule of the OQ1 seeded order (`docs/plans/f3.68-generated-site-view.md`,
 * "Owner rulings"): an on/off code matched by a `LIKE` pattern, or a single
 * code matched exactly. `rank` is the value `bms.point_keys.headline_rank`
 * (D1: lower shows first) takes when the rule matches.
 *
 * A discriminated union, not two lists, so `seedPointKeyHeadlineRanks` builds
 * one `CASE`/`WHERE` from a single pass over one array — there is no second
 * place a rule can be added and forgotten.
 */
export type HeadlineRankRule =
  | { readonly kind: "like"; readonly pattern: string }
  | { readonly kind: "code"; readonly code: string };

export type HeadlineRankSeedEntry = HeadlineRankRule & { readonly rank: number };

/**
 * OQ1's ranks, in the order the ruling states them. `breaker_%` and `%_on`
 * cover every on/off code the catalog carries today (`breaker_main`,
 * `breaker_trip`, `breaker_spring_charged`, `chlorine_pump_on`) and any later
 * one shaped the same way, without naming each code by hand.
 *
 * The `_` in both patterns is a real underscore, not the `LIKE` single-
 * character wildcard — `seedPointKeyHeadlineRanks` escapes it with a literal
 * backslash before it reaches Postgres. Without the escape `%_on` would also
 * match a code that merely *ends* in "on" with any one character before it
 * (`"xon"`), which is not what an on/off code is.
 */
export const HEADLINE_RANK_SEED: readonly HeadlineRankSeedEntry[] = [
  { kind: "like", pattern: "breaker\\_%", rank: 10 },
  { kind: "like", pattern: "%\\_on", rank: 10 },
  { kind: "code", code: "kw", rank: 20 },
  { kind: "code", code: "kwh_total", rank: 30 },
  { kind: "code", code: "pf", rank: 40 },
  { kind: "code", code: "frequency_hz", rank: 50 },
];

/**
 * D8 — seeds `bms.point_keys.headline_rank` (migration `0083`) in one
 * `UPDATE … CASE … WHERE headline_rank IS NULL AND (…)`, built from
 * {@link HEADLINE_RANK_SEED}. Every pattern and code is a bound `$n`
 * parameter — never interpolated into the SQL text, so a code containing a
 * `%`, `_` or quote cannot change what the statement means.
 *
 * **`headline_rank IS NULL` is the whole of OQ3.** This is not a `unit`-style
 * `COALESCE` (this seed never *sets a value the row already had*, it only
 * fills an absent one), but it is the same shape of promise: a global admin's
 * own rank, once set, survives every later `pnpm db:seed`. A code that
 * already carries the seeded value looks unchanged either way, which is why
 * the seed's own idempotence is proved by re-running it, not by reading one
 * row (`tests/f3.68-point-key-headline-ranks-seed.integration.test.ts`, I2).
 *
 * **Call this after `seedPointKeyCatalog` AND after the PHE pilot seed
 * (`seedPheCatalog`), on every path** (D8; pinned by the T8 static gate in
 * `tests/f3.68-generated-site-view.test.ts`) — both insert
 * `bms.point_keys` rows with `headline_rank` left `NULL` by
 * default, and a rank seeded before either writer ran would apply to a row
 * that did not exist yet.
 *
 * Not in the migration (D8): a migration runs once per database and never
 * again, so it cannot re-fill a rank an admin clears (`PATCH … { headlineRank:
 * null }`) back toward the seeded default on a later boot the way this seed
 * can, and — symmetrically — cannot leave alone a rank an admin sets away
 * from it either. Doing this as a migration would silently re-decide OQ3's
 * "fills only NULL" promise as "always wins once".
 *
 * @returns the number of rows the statement changed (0 on a fully-seeded,
 * fully-admin-owned catalog).
 */
export async function seedPointKeyHeadlineRanks(pool: pg.Pool): Promise<number> {
  const params: Array<string | number> = [];
  const whenClauses: string[] = [];
  const predicates: string[] = [];

  for (const entry of HEADLINE_RANK_SEED) {
    const matchIndex =
      params.push(entry.kind === "like" ? entry.pattern : entry.code) /* 1-based */;
    const rankIndex = params.push(entry.rank);
    const matchClause =
      entry.kind === "like" ? `code LIKE $${matchIndex}` : `code = $${matchIndex}`;
    whenClauses.push(`WHEN ${matchClause} THEN $${rankIndex}::smallint`);
    predicates.push(matchClause);
  }

  const sql = `
    UPDATE bms.point_keys
       SET headline_rank = CASE
         ${whenClauses.join("\n         ")}
       END
     WHERE headline_rank IS NULL
       AND (${predicates.join(" OR ")})
  `;

  const result = await pool.query(sql, params);
  return result.rowCount ?? 0;
}
