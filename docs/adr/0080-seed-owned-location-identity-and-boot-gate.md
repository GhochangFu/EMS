# ADR 0080 — The seed owns its location identity, and the boot gate counts presence (`F4.169`, `F4.170`)

## Status

Accepted — drafted on 2026-09-28 after the build, as the record of rulings the
owner made one at a time on 2026-09-27 and 2026-09-28 while rows `F4.169` and
`F4.170` were planned, built and reviewed. The owner reviewed and approved this
written record on 2026-09-28, before the PR was pushed.

Implements rows `F4.169` and `F4.170` (one PR by owner ruling). Promotes nothing
out of `AGENTS.md` §6. No migration, no schema change, no new dependency.

## Context

Both rows began as small `packages/db` fixes: a lowercase asset code with an
edited ladder threshold stopped `db:seed` with `23505` (`F4.169`), and a long
location code or name stopped it with `22001` (`F4.170`). Every `compose up`
runs `db:seed`, so each defect meant the stack did not boot.

Verifying the fixes against the running stack and through four review rounds
showed that ordinary admin writes could stop the boot in more ways, all present
on `main` before this change:

- `verifyHierarchySeed` asserted exact totals (11 ESKOM locations, 2
  organizations, 6 PHEWB locations, 12 PHEWB RTUs, 48 PHE assets, 252 PHE
  asset points, …), so one admin-created row stopped the boot.
- The seed found canonical ESKOM locations by slug, so an admin PATCH of a
  canonical location's slug or code made the next seed raise `23505`.
- The legacy PHE cleanup deleted any PHEWB location whose slug matched
  `^phe-.+-(i|ii)$`, with its grants and RTUs (and their encrypted
  credentials), silently.
- `backfillAssetLocations` moved admin assets by their free-text `site_name`.
- The simulator RTU for an asset was resolved by location name with `LIMIT 1`
  and no order.

The owner ruled to fold each of these into this PR. The stable identity the
seed then needed (`meta.seedKey`) was itself writable through the admin API,
which the owner closed at the API (decision 5).

## Decision

1. **The boot gate counts presence, not totals** (rulings 5, 10). Each count an
   admin write can move becomes "the canonical seeded set is present", derived
   from the seed's own catalogs (`packages/db/src/verify-hierarchy-expected.ts`),
   never from restated literals. New zero-counts keep each old count's reason
   (decommissioned location active, legacy PHE per-RTU locations, PHE `TS`
   points). Counts no admin surface can move stay exact. The PHE environment-role
   count moved from the boot gate to `asset-groups-seed.spec.ts`. A presence
   count cannot see an extra row: the SQL text gates in the seed specs are the
   guard against an unbounded seed statement, and stale rows after a catalog
   re-key are not caught (recorded in `F4.172`).
2. **The ladder seed matches a seeded rule by asset and suffix** (rulings 1, 2,
   15, 18, 19). Guard 1 (the condition tuple) counts only published rules,
   enabled or not; guard 2 matches `asset_id` + `source = 'simulator_threshold'`
   + the code's `_<suffix>` tail; guard 3 skips, and logs, a code another row
   already holds. The seed never rewrites a stored code. The verifier's
   uncovered-asset check uses guard 1's definition of covered and exempts, with
   a log line, exactly the assets guard 3 skipped. An asset with no rule and no
   collision still stops the boot.
3. **The seed owns the identity of its canonical ESKOM locations** (ruling 16,
   OQ2–OQ6, rulings 17, 20). Each canonical location and `ESK-DECOMM-01` carries
   `meta.seedKey` (its canonical slug). The seed resolves an identity from rows
   keyed for it and unkeyed rows matching its canonical slug or code: one row →
   adopt; the oldest candidate is the only row keyed for it → adopt; otherwise
   write nothing and log every candidate. On an adopted row the seed restores the
   canonical slug and code (a holder of either is logged and skipped, never
   `23505`) and, as before, name, type and coordinates; for `ESK-DECOMM-01` only
   slug, code and `active = false`. Later seed steps (the control-room view, the
   simulator RTUs, the demo grant) act only on resolved rows.
4. **The seed never moves or deletes an admin's row by a free-text match**
   (rulings 8, 9, 13, 14). The legacy PHE cleanup deletes only the twelve legacy
   slugs derived from the catalog, and logs each. `backfillAssetLocations` fills
   only `location_id IS NULL`. The simulator RTU is resolved by the asset's
   `location_id` and the seed's own RTU code, keeping the `site_name` predicate
   so the set of wired assets is unchanged.
5. **`meta.seedKey` is seed-owned in the admin API** (ruling 20). Location
   `POST`, location `PATCH` and the onboarding commit never write a `seedKey`
   from a request; a `PATCH` that replaces `meta` keeps the stored key. Touches
   `apps/api/src/admin/locations/` and
   `apps/api/src/admin/onboarding/onboarding-commit.service.ts`. The response
   contract is unchanged; `seedKey` is visible in responses and is not a secret.
6. **Bounded seed values** (`F4.170`, ruling 3). The simulator RTU code and
   display name are bounded to their columns by a code-point cut, the code with a
   hash of the full location code; a value that fits is byte-identical.

## Consequences

- An admin edit of a canonical ESKOM location's slug, code, name, type or
  coordinates is reverted on the next boot; an admin's own rows are never
  overwritten, moved or deleted by a free-text match.
- The first boot after this change adopts and keys the existing rows. An admin
  state created before that boot that splits a canonical location's slug and
  code across two rows makes the identity ambiguous: the seed writes nothing for
  it and logs the candidates until an admin resolves the rows.
- Residuals are recorded in backlog row `F4.172`: the L1 ladder-code collision,
  a renamed seeded rule code, stale rows after a catalog re-key, an ambiguous
  identity whose name was also changed (the asset seed then stops, loudly), and
  the `ESK-MANUAL-01` fixture hosted at the ESKOM location with the lowest code.
- `pnpm --filter @bms/db verify:hierarchy` run alone cannot see the seed's
  collision skips and fails closed on a live collision.
- Amends sentences in ADR 0051, ADR 0070 and ADR 0076 (see their amendment
  notes).
