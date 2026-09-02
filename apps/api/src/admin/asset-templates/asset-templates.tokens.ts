/**
 * `F2.13` / ADR 0052 — the injection token for the stock asset-template
 * catalog, following `apps/api/src/database/database.tokens.ts`.
 *
 * **Kept even though a real entry ships, for three reasons the plan records**
 * (`docs/plans/f2.13-stock-asset-template-catalog.md` Task 3):
 *
 *  1. The peer-mutation test (ADR 0049 decision 3 / ADR 0052 decision 5) must
 *     write a peer organization's row of the same `code`, mutate it, and assert
 *     the import still yields the *catalog's* content. Run against
 *     `electrical-feeder` it would create and delete a 33-point, 11-alarm
 *     template in two organizations on every run, and any later edit to the
 *     shipped entry would silently change what the property test asserts — a
 *     test whose expected value is a moving 33-row literal is not a property
 *     test.
 *  2. The unknown-code 400 must be checked against an **empty** catalog too,
 *     so the message still reads as a sentence with nothing to list.
 *  3. `assertImportRunsEveryAuthoringGuard` needs an entry naming a
 *     deliberately **inactive** point key, which the shipped catalog must never
 *     contain.
 *
 * `admin.module.ts` provides `STOCK_ASSET_TEMPLATE_CATALOG` under it; the
 * integration suite provides a fixture catalog by constructing the service by
 * hand. One provider line buys all three.
 */
export const STOCK_ASSET_TEMPLATE_CATALOG_TOKEN = Symbol("STOCK_ASSET_TEMPLATE_CATALOG");
