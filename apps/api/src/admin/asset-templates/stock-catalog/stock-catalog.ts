import { ELECTRICAL_STOCK_ASSET_TEMPLATES } from "./electrical";
import { MECHANICAL_STOCK_ASSET_TEMPLATES } from "./mechanical";
import type { StockAssetTemplateEntry } from "./types";
import { WATER_STOCK_ASSET_TEMPLATES } from "./water";

/**
 * `F2.13` — the stock asset-template catalog (ADR 0052 decision 1).
 *
 * **This is repository data, not a database seed.** The delivery mechanism
 * `bms.dashboard_templates` already has (`../dashboard-templates/stock-catalog.ts`,
 * ADR 0049 decision 3), given to `bms.asset_templates`: an entry is *imported*
 * into a real row the organization then owns, never seeded per organization
 * (decision 9 — `db:seed` gains nothing, `BASELINE-*` are untouched) and never
 * a NULL-organization row (ADR 0015 resolved decision 3, re-declined by ADR
 * 0052 option C).
 *
 * ---
 *
 * **WHY A TYPESCRIPT MODULE UNDER `apps/api`, NOT JSON, AND NOT
 * `packages/shared`.** ADR 0052 decision 1's three reasons, the same three the
 * dashboard catalog records:
 *
 *  1. **The reader is the API in a container.** `apps/api` runs from `dist/`,
 *     a cwd nobody tests a runtime file read against; a module import has no
 *     cwd.
 *  2. **A TS module is typechecked**, so a malformed entry is a BUILD error —
 *     `pnpm typecheck` refuses it — rather than a 500 the first time an
 *     administrator opens the catalog. `StockAssetTemplateEntry` is the create
 *     body itself, so the entry cannot drift from what `create` accepts.
 *  3. **A `.ts` diff is reviewed as code**, with the `git blame` and the PR
 *     review a logic change gets, rather than waved through as "just data".
 *
 * It stays out of `packages/shared` because the browser reaches the catalog
 * only through `GET /admin/asset-templates/stock` — six packs' worth of
 * template content never enters the web bundle.
 *
 * ---
 *
 * **ONE MODULE PER PACK — and, since `F2.12`, one module per CLASS inside the
 * electrical pack.** This file aggregates; it authors nothing. The packs,
 * each under the §4.5 line cap and each carrying its own docblock of sources
 * and deferrals:
 *
 *  - `electrical.ts` — the pack index only, since `F2.12` (plan Task 1). The
 *    six electrical classes are their own modules —
 *    `electrical-feeder.ts` (`F2.13`, §1), `electrical-transformer.ts` (§2),
 *    `electrical-dg-set.ts` (§3), `electrical-ups.ts` (§4),
 *    `electrical-solar-pv.ts` (§5) and `electrical-apfc.ts` (§6), plus the
 *    shared `point-fields.ts` — because appending all five remaining classes
 *    to one `electrical.ts` was projected at ~1550-1800 lines (plan §4.3),
 *    well past the cap AGENTS.md §4.5 reads whole-file.
 *  - `water.ts` — the pack index only, since `E5.1` (plan Task 2). The six
 *    water-treatment plant classes are their own modules — `water-stp.ts`
 *    (§5), `water-etp.ts` (§6), `water-cooling-tower.ts` (§4),
 *    `water-wtp.ts` (§1), `water-ro.ts` (§2) and `water-softener.ts` (§3),
 *    listed in ADR 0040 ruling 2's authoring order rather than the tag list's —
 *    because all six in one `water.ts` was projected at ~1400-1800 lines
 *    (plan §4.5: 103 point rows, 40 alarms each carrying a populated
 *    `philosophy`, 8 formulas and 23 maintenance plans), well past the cap
 *    AGENTS.md §4.5 reads whole-file. They share `point-fields.ts` with the
 *    electrical pack, which is not edited.
 *  - `mechanical.ts` — the pack index only, since `E5.2` (plan Task 5). The six
 *    mechanical/utility machine classes are their own modules —
 *    `mechanical-pump.ts` (§1), `mechanical-vfd.ts` (§2),
 *    `mechanical-compressor.ts` (§3), `hvac-chiller.ts` (§4), `hvac-ahu.ts`
 *    (§6) and `mechanical-boiler.ts` (§7), listed in ADR 0053 decision 1's
 *    document order — for the same §4.5 reason as the other two packs: 141
 *    point rows, 52 alarms each carrying a populated `philosophy`, 13 formulas
 *    and 24 maintenance plans project well past the 1000-line cap AGENTS.md
 *    §4.5 reads whole-file. **Two of the six are `hvac-*.ts` under the
 *    MECHANICAL index, and that is deliberate**: ADR 0053 decision 2 files the
 *    chiller and the AHU under `hvac`, the domain whose vocabulary already
 *    holds nine of their keys, while the module name follows the entry code the
 *    way `water-stp.ts` does. A pack is one source document and one index; the
 *    code prefix is the DOMAIN. Splitting them into an `hvac.ts` would need a
 *    second index and a second provenance story for one document — which is why
 *    `PACK_SOURCE_DOC` in `stock-catalog.spec.ts` declares two prefixes
 *    (`hvac`, `mechanical`) against the same file. They share `point-fields.ts`
 *    with the other two packs, which is not edited.
 *  - `facility.ts` — `E5.3`.
 *
 * **A NEW PACK FILE — OR, INSIDE THE ELECTRICAL PACK, A NEW CLASS MODULE —
 * MUST JOIN `STOCK_ASSET_RELS` IN
 * `tests/f2.13-asset-stock-catalog-vocabulary.test.ts`, with that file's
 * anti-vacuity bounds moved to the new actuals.** That guard reads the source
 * files as TEXT and scans every `pointKey:` against the `*_POINT_KEYS` arrays
 * in `packages/shared/src/constants.ts`; it cannot follow the spread below, so
 * a pack OR a class module left off the list has its keys checked against no
 * vocabulary at all, and every assertion there stays green while checking
 * less. `tests/f3.38` carries the same instruction for the dashboard catalog.
 * This paragraph named the electrical pack's split before it existed, on
 * purpose; it now names the per-class split the same way.
 *
 * ---
 *
 * **EACH ENTRY CARRIES ITS OWN `stockVersion`.** Never one exported constant
 * spread across the packs: improving the STP template to release 2 must not
 * renumber the transformer (decision 2). A bump is recorded in the pack's
 * docblock (decision 6) and reaches an organization only by re-import
 * (decision 4) → publish → migrate (decision 7); it touches no row by itself.
 *
 * **WHAT THIS FILE DOES NOT DO.** It reads no database and must not gain an
 * import from `packages/db` to check its keys — that is `stock-catalog.spec.ts`
 * at build time (both schemas), `tests/f2.13-asset-stock-catalog-vocabulary`
 * at build time (the vocabulary), and `AssetTemplatesAdminService.create` at
 * run time (`assertPointKeysActive`, `assertAssetDomain`, the alarm
 * vocabularies, the content reference check) — decision 5: nothing the
 * catalog says can bypass a rule the form enforces.
 *
 * **`readonly` here is the immutability.** `stockAssetTemplateDtoSchema` in
 * `@bms/shared` deliberately carries no `.readonly()`; the wire has already
 * copied a DTO, and the array below is the only place a caller could mutate
 * the source.
 */
export const STOCK_ASSET_TEMPLATE_CATALOG: readonly StockAssetTemplateEntry[] = [
  ...ELECTRICAL_STOCK_ASSET_TEMPLATES,
  ...WATER_STOCK_ASSET_TEMPLATES,
  // Empty until `E5.2` plan Task 6 authors the pump — the pack is declared one
  // commit before its first entry, and `mechanical.ts` says why it ships empty
  // rather than as six skeletons. `stock-catalog-deferrals.spec.ts` holds the
  // resulting catalog to the head of `STOCK_ENTRY_CODES` until all six land.
  ...MECHANICAL_STOCK_ASSET_TEMPLATES,
];
