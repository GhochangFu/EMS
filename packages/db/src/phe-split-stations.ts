/**
 * ADR 0139 decision 1 (plan D1) — the PHE stations the seed splits into one
 * site per RTU, by catalog `StationCode` (for example `CBLTPT1`, Lotapata).
 *
 * Source, not an environment variable, so a cold start and the demo host seed
 * the same tree. This file imports nothing and reads nothing: it is the one
 * line releases B and C change, each after the owner's yes, together with the
 * pinned assertion in `tests/f4.388-split-list-is-source.test.ts`.
 *
 * `seedPheCatalog`, `phePilotExpectedRows` and `hierarchyExpectations` read it
 * as the default of a `splitStationCodes` parameter. Production passes no list
 * (`seed.ts` and `verify-hierarchy-cli.ts`), so this constant is the only list
 * a deployed seed ever reads; a test drives the split path through the
 * parameter. A code that is not a catalog station's throws before any write.
 *
 * Release A commits it empty: nothing moves on any database.
 */
export const PHE_SPLIT_STATION_CODES: readonly string[] = [];
