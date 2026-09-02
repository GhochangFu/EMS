# ADR 0052 — Stock asset-template catalog: how authored class and pack content reaches every organization

## Status

**Accepted — 2026-09-02, by the repository owner, at the
`build-operating-model.md` step 2 gate, the same day it was drafted.** The
shape was ruled first, at the sitting that accepted ADR 0040, ADR 0019
Amendment 2 and ADR 0051 Amendment 6: of three options put to the owner — the
`F3.36` shape, a per-organization seed, or NULL-organization rows — **the
`F3.36` shape was chosen**. This document records that ruling as decisions
and adds the consequences the ruling did not spell out. Its three open
questions were then ruled as drafted — see the foot of this document. The
build is `F2.13`.

**One decision for four rows.** `F2.12` (the electrical class templates),
`E5.1` (water), `E5.2` (mechanical) and `E5.3` (facility) each author asset
templates that must reach every organization, existing and future. None of
them can, today. This ADR is what each of their own ADRs cites instead of
re-deciding delivery; the build is `F2.13`, and the four rows list it in
`Depends`.

## Context

An asset template (`bms.asset_templates` + `bms.template_points`, ADR 0015)
is **per-organization**: `organization_id` is `NOT NULL`, the unique key is
`(organization_id, code, version)`, and every access-control predicate reads
`inArray(assetTemplates.organizationId, writableOrgIds)`. ADR 0015 resolved
decision 3 declined a NULL organization meaning "system template" for exactly
that reason, and ADR 0043 Amendment 5 and `E7.1c` later put the same rule on
every tenant table.

A section dashboard template (`bms.dashboard_templates`, ADR 0049) is
per-organization too, and it has a delivery path: the six defaults ship as
**repository data** in `apps/api/src/admin/dashboard-templates/stock-catalog*.ts`,
`GET /admin/dashboard-templates/stock` lists them, and
`POST /admin/dashboard-templates/stock/:code/import` copies one into a real
row the organization then owns. ADR 0049 decision 3 fixed the property that
path exists to provide — *"a plant onboarded later receives the stock current
at its import, not whatever the first customer edited"* — and the row records
which release it came from in `stock_code` / `stock_version`, held together by
`dashboard_templates_stock_stamp_check`.

**The asset-template side has none of this.** Measured on 2026-09-02:
`asset-templates.controller.ts` declares `GET`, `GET :id`, `POST`, `PATCH :id`,
`publish`, `archive`, `instantiate`, `versions`, `migration-preview`,
`migrate`, `draft` and `DELETE :id` — no `stock`, no `import`.
`bms.asset_templates` carries no stock stamp. The only templates that reach an
organization without an administrator typing them are the `BASELINE-*` rows
`asset-template-health-seed.ts` writes per seeded organization, and those are
built from whatever points the demo assets already carry: they exist to hold
health bands, and they are not a class definition of anything.

So the situation the four rows walk into is this: a transformer template, an
STP template, a chiller template — each authored once, from a cited tag list,
under a content contract that already shipped (ADR 0019) on an authoring
surface that already shipped (`F2.5`) — has **no way to exist in more than one
organization** except by an administrator re-typing it. That is the drift ADR
0049 decision 3 named and declined, and it is what ADR 0051 decision 1 forbids
for the dashboard side in the owner's own words: *"template should be such
that they can be used across organizations already have and for the future
orgs as well."*

**ADR 0040 decision 6 reaches for a field that does not exist.** It records
provenance as `meta.provenance = "derived-v1"` on the template. `bms.asset_templates`
has no `meta` column; `content` is contracted by ADR 0019, which rejects keys
it does not know. The question it was answering — *which release of what did
this row come from* — is the stock stamp's question, and decision 6 below
answers it with the stamp.

## Options considered

**A. The `F3.36` shape — a repository catalog, listed and imported per
organization.** Chosen. It is the path the platform already runs for the other
template table, its property is already stated and already tested (the
dashboard import spec mutates a peer organization's row and asserts the import
still yields the catalog's content), and the per-organization copy keeps ADR
0015 resolved decision 3 intact: nothing in access control learns a new case.

**B. Seed per organization at `db:seed`, as `BASELINE-*` are.** Declined.
It reaches the two seeded demo organizations and no other; a customer
provisioned next month gets nothing until someone re-seeds. And the seed
re-runs on every `compose up` — a seed that *imports* would open a new draft
version each boot (decision 4 makes a re-import a version bump on purpose), and
a seed that `ON CONFLICT DO NOTHING`s would never deliver an improved default.
ADR 0049 declined the same option for the same reason.

**C. NULL-organization "system" rows.** Declined. Already declined by ADR 0015
resolved decision 3 and re-declined by ADR 0049 decision 3 on `E7.1c` and ADR
0043 Amendment 5 grounds: every `inArray(organizationId, ids)` predicate would
need a second branch, and the FORCE row-level-security policies on the two
tables would need a NULL escape.

## Decision

1. **A stock asset-template catalog ships as repository data under
   `apps/api`, one module per pack.**
   `apps/api/src/admin/asset-templates/stock-catalog/` holds `electrical.ts`
   (`F2.12`), `water.ts` (`E5.1`), `mechanical.ts` (`E5.2`), `facility.ts`
   (`E5.3`), each under the §4.5 line cap, aggregated by a `stock-catalog.ts`
   that exports the union. TypeScript rather than JSON, and `apps/api` rather
   than `packages/shared`, for the three reasons `stock-catalog.ts` already
   records for dashboards: the reader is the API in a container, a TS module
   is typechecked so a malformed entry is a build error, and a `.ts` diff is
   reviewed as code. The browser reaches it only through the list route, so
   six packs' worth of template content never enters the web bundle.

2. **A catalog entry is a create body without an organization, plus a stock
   version.** `StockAssetTemplateDto` = `createAssetTemplateBodySchema` minus
   `organizationId`, plus `stockVersion: z.number().int().positive()`. So an
   entry carries `code`, `name`, `assetType`, `domain`, `description`,
   `content` (the ADR 0019 contract, alarm rows pair-absent per ADR 0019
   Amendment 2 where the tag list carries no number) and `points` (the
   `template_points` body — `pointKey`, `kind`, `required`, `sortOrder`,
   `meta.tier` per ADR 0040 decision 3, formula and dialect for a derived
   point). **Each entry carries its own `stockVersion`**, never one
   catalog-wide constant, so improving the STP template to release 2 does not
   renumber the transformer. A build-time spec parses every entry with the
   schema and asserts at least one point, because `publish` refuses a template
   with none.

3. **`bms.asset_templates` gains the stock stamp.** Migration `0061` adds
   `stock_code varchar(64)` and `stock_version integer`, both nullable, and
   `asset_templates_stock_stamp_check CHECK ((stock_code IS NULL) = (stock_version IS NULL))`,
   mirroring `0056` column for column. A hand-authored template carries NULLs;
   an imported one carries the entry's `code` and `stockVersion`. The drizzle
   schema and `AdminAssetTemplateDto` gain both fields — the DTO is
   `z.infer`red from the shared contract, so this is an ADR 0030 contract
   change and every consumer sees it.

4. **Two routes, on the pattern of the dashboard pair.**
   `GET /api/v1/admin/asset-templates/stock` lists the catalog and needs a
   master-data role; it is declared **before** `GET :id`, for the reason the
   dashboard controller's docblock spells out in capitals.
   `POST /api/v1/admin/asset-templates/stock/:code/import` with body
   `{ organizationId }` — the same `importStockTemplateBodySchema` — creates a
   **draft** in that organization at `max(version) + 1`, stamped, and writes
   `master.asset_template.import` to the audit log with reason
   `stock <code> v<stockVersion>`. Re-importing a code an organization already
   holds opens the next version, which is the same act taking a newer release
   is; the partial draft index refuses a second concurrent import. The caller
   must pass `canManageTemplate` for that organization — the global `admin` or
   the organization's own administrator — because an import writes into one
   organization only, unlike the role-vocabulary write path decision 5 of ADR
   0051 gated to the global `admin` alone.

5. **The import goes through the same write path a hand-authored draft does,
   and copies from the repository, never from a peer.** The stock service
   does not insert; it calls `AssetTemplatesService.create` with the entry's
   body, the caller's organization and the stamp. So every check that guards
   an authored draft guards an import — `assertPointKeysActive` against
   `bms.point_keys` (which is why `F2.11`'s promotion must precede `F2.12`'s
   content, and a water `*_POINT_KEYS` array must precede `E5.1`'s),
   `assertAssetDomain`, the alarm vocabularies, and the content reference check
   — and nothing the catalog says can bypass a rule the form enforces. The
   content comes from the catalog module and from nowhere else. The test that
   holds this: mutate a peer organization's row of the same `code`, import,
   and assert the result is the catalog's. `F2.13` wrote it for this catalog
   (`asset-templates-stock.integration.spec.ts`); the dashboard stock service
   never had one — an earlier draft of this sentence said it "already
   carries" the test, which was false, and `F4.77` owes it there.

6. **The stamp is the provenance. ADR 0040 decision 6 is discharged by it.**
   `stock_version = 1` on a water row *is* "derived-v1", with the entry's
   `description` naming the tag-list file it was derived from — the citation
   the §5 *Tag-list citation* gate asks for, carried on the row itself. The
   client-confirmed release is the same entry at `stockVersion: 2`, its
   changes recorded in the module's docblock the way `stock-catalog.ts`
   records a version bump. No `meta.provenance`, no `meta` column.

7. **A stock release reaches an instantiated asset the way ADR 0039 already
   says a version does.** Bumping `stockVersion` in the catalog touches no
   organization's row. An organization takes the release by re-importing
   (decision 4: a new draft), publishing it, and migrating pinned assets
   through `migration-preview` and `migrate` — previewed, audited, and never
   as a side effect. `createDraftFrom` copies the stamp forward, exactly as the
   dashboard service does, or "which stock did this come from" becomes
   unanswerable the first time an organization edits an import.

8. **The per-tenant escape hatch stays an escape hatch.** ADR 0051 decision 7,
   applied here: an imported draft is the organization's to edit. A plant
   shape that recurs is a catalog entry, not a per-tenant fork; the test is the
   same — if the same edit is made twice for the same reason, the reason is a
   shape.

9. **Nothing is seeded, and `BASELINE-*` are untouched.** The four seeded
   baselines keep doing their one job (health bands on demo assets). No
   `db:seed` step imports a pack. If a demo ever needs a pack present at boot,
   that is its own row, and it must be idempotent on the stamp — an import
   that runs on every `compose up` would open a new version each time, by
   decision 4.

10. **The web surface ships with the mechanism, not after it.** The asset
    templates admin page gains the same import control
    `dashboard-templates-page.tsx` has — a picker over `GET stock`, one click
    to import into the current organization, landing on the new draft. A row
    closed with its browser layer marked N/A is not closed (ADR 0041 decision
    10), and a catalog no administrator can reach from the screen is decorative.

## Dependencies

None. No npm package. One forward-only migration (`0061`), two nullable
columns and a `CHECK` on a table with live rows — `migration-reviewer` reviews
it. It takes the `SET ROLE bms_owner` / `RESET ROLE` bracket: `0060`'s header
records that the repository default is to take it always, so the `ALTER` and
the `CHECK` land owned by `bms_owner`, and the journal insert that follows the
`RESET` runs as `bms_app`. An earlier draft of this sentence said the bracket
was not needed "because it drops no policy" — permissive, not prohibitive, and
the default branch applies. Do not "fix" `0061` by removing it.

## Consequences

- **The four content rows gain a dependency, and they should.** `F2.12`,
  `E5.1`, `E5.2` and `E5.3` list `F2.13` in `Depends`. Each can still be
  *authored* on the shipped surface before `F2.13` lands — an organization
  administrator can type a template today — but none can *ship* as content
  every organization receives, and a pack that reaches one organization is a
  pack that drifts. The order this forces is the one the owner already chose:
  `F2.11` (vocabulary) → `F2.13` (delivery) → `F2.12` and `E5.1` (content).

- **Vocabulary before content, enforced twice.** `0058`'s foreign key refuses
  a `template_points` row whose key the platform lacks, and decision 5's
  `assertPointKeysActive` refuses the import before the insert is attempted.
  So a pack's `*_POINT_KEYS` array (ADR 0051 Amendment 6's shape) must land
  before its catalog entry, and a build-time guard in the shape of
  `tests/f3.38-stock-catalog-vocabulary.test.ts` should scan every catalog
  entry's `pointKey`s against the arrays, with the same anti-vacuity bounds.
  `KEYS_AWAITING_A_VOCABULARY` gains its analogue for the water keys until
  `E5.1` promotes them.

- **The DTO widens.** `stockCode` and `stockVersion` (both nullable) on
  `AdminAssetTemplateDto`, and a new `StockAssetTemplateDto`, both in
  `@bms/shared/contracts`. `apps/web`'s template list can show the stamp
  beside the version, which is how an administrator tells an import from a
  hand-authored row.

- **The `F2.5` authoring surface is unchanged.** An imported draft is an
  ordinary draft; the tabs, the formula editor and the Alarms tab (with ADR
  0019 Amendment 2's "value set per site at commissioning" copy) all apply to
  it. This ADR adds a way in, not a second editor.

- **`E1.7`'s retro warning is honoured rather than repeated.** The catalog
  authors nothing the content contract does not already validate; a pack
  written against a guessed vocabulary fails the build-time spec and the
  import, in that order, rather than reaching an operator.

- **What the catalog does not decide.** Which asset group an instantiated
  asset joins is ADR 0040's fifth ruling (one asset per plant, grouped at the
  location) and `F2.2`'s instantiation body — not the catalog's. Dashboards
  for an imported class are `F3.2`'s (per-asset-type defaults from the
  template's `dashboards` section) and the section stock catalog's (ADR 0049,
  keyed by section × shape) — not this one's.

## Open questions for the gate — all three answered 2026-09-02

1. **Decision 3 — the stamp as two columns with a `CHECK`, or embedded in
   `content`?** Drafted as columns, mirroring `0056`, because the stamp is
   queried (list "every organization still on stock release 1") and `content`
   is the ADR 0019 contract, which should not carry provenance beside KPIs.
   The cost is one migration. **Ruled: two columns with a `CHECK`.**
   Migration `0061`.

2. **Decision 4 — may an organization administrator import, or the global
   `admin` alone?** Drafted as `canManageTemplate` for the target
   organization (both), because an import writes into one organization only
   and is the same act as creating a draft there. ADR 0051 decision 5's
   global-`admin`-only gate was for a **global** table; this is not one.
   **Ruled: both — the global `admin` or that organization's administrator.**

3. **Decision 10 — the web import control in `F2.13`, or in the first
   content row that needs it (`F2.12`)?** Drafted in `F2.13`, so the mechanism
   row closes with all four §4.6 layers verified and `F2.12` inherits a
   button rather than building one. The alternative leaves `F2.13` closable
   only by `curl`. **Ruled: in `F2.13`, with the mechanism.**
