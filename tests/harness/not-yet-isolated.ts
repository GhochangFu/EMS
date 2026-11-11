/**
 * `F4.5` (ADR 0124 decision 6, ruling 7) — database suites not yet moved onto their worker's own
 * database. A listed file runs as it always has: on the run's one shared database (`bms_shared`
 * on the run's own container; the database `DATABASE_URL` names on an external server). Every
 * other database suite, including every new one, gets its worker's own copy.
 *
 * **This list only shrinks.** `tests/f4.5-isolation-ratchet.test.ts` fails if a listed path is
 * not a database suite, if the list is not sorted, or if its length differs from
 * `NOT_YET_ISOLATED_COUNT` — so adding a file fails, and moving a batch means lowering the count
 * in the same change. The batches are PRs 3–5 of `docs/plans/f4.5-testcontainers.md`.
 */

export const NOT_YET_ISOLATED_COUNT = 0;

export const NOT_YET_ISOLATED: readonly string[] = [
];
