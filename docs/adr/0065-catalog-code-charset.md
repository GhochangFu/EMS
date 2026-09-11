# ADR 0065 — One character class for `bms.point_keys.code` and `bms.assets.code`

## Status

Proposed — drafted 2026-09-11 under `F2.23`. Two scope questions are put to
the owner below (§"Gate questions"); nothing in this record is built until
they are ruled and the record is approved as a whole (AGENTS.md §10,
`backlog-cycle` step 2).

## Context

`F2.23` (Track B, Wave 3, P3 — *"Constrain the catalog charset for
`point_keys.code` and `assets.code`"*) was filed by the `F2.9` closure on
2026-09-05. ADR 0055's Q1 ruling made `bms-calc-v2` split a qualified
reference `{CODE.key}` at the **first** `.` and deferred the charset that makes
that split unambiguous to "a follow-up row". This is that row. It settles
**resolution** — which asset and which point key a reference names — and not
correctness: `F2.9`'s finding 35 already fixed the one live defect
(`crossRefKey` was not injective) structurally, with a kind prefix.

Seven things are true of the repository today, each measured on 2026-09-11
rather than assumed.

**1. Neither column carries a character rule anywhere.** `bms.assets.code` is
`varchar(64) NOT NULL UNIQUE` (`0000_sprint1_foundation.sql`, unique across
every tenant); `bms.point_keys.code` is `varchar(128) NOT NULL` with the unique
index `0057` added when the catalog went fleet-wide. No `CHECK`, no Zod
`.regex()` on any of the five API schemas that admit one, no normalisation in
any producer. The tokenizer admits every character but `{` and `}` inside a
reference, under both dialects (`packages/shared/src/calc-dsl/tokenizer.ts`).

**2. Every code that exists complies with one class, and the class is small.**
The live `compose` database, read as `bms_fleet`:

| table | rows | `^[A-Za-z0-9_-]+$` | contains `.` | case |
|---|---|---|---|---|
| `bms.point_keys` | 613 | 613 | 0 | 607 lower-case; 6 upper-case, all `CALCWRITE_*` integration fixtures |
| `bms.assets` | 150 | 150 | 0 | 150 upper-case; 150 contain `-`, none contain `_` |

The sources agree. The 605 distinct keys across every `*_POINT_KEYS` constant
in `@bms/shared` match `^[a-z][a-z0-9_]*$`; the PHE seed's 22 `bySensor` keys
do too, and its fallback normalises a vendor `DataKey` with
`replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase()`. The 48 `DeviceCode`s in the
frozen `phe-catalog.json`, the 46 literal and 7 templated asset codes in
`eskom-assets-seed.ts`, the 7 in migration `0013`, `ESK-MANUAL-01` in
`access-fixtures-seed.ts`, and every `pointKey` literal in the 33 stock-catalog
files all match `^[A-Za-z0-9_-]+$`. Migration `0057` derives its point keys from
`asset_points.point_key`, which the same constants populated. The integration
fixtures produce `FIXTURE-<label>-<uuid>-<nn>` (lower-case hex in the UUID) and
`CALCWRITE_A`…`CALCWRITE_E_OK`.

**3. Five API schemas admit a code, and one producer can emit an illegal
one.** The write paths, from source:

| site | field | rule today |
|---|---|---|
| `admin/assets/assets.schema.ts` `createAssetBodySchema` (and `updateAssetBodySchema = .partial()`, so `code` is updatable) | `code` | `.min(2).max(64)` |
| `admin/asset-templates/asset-templates.schema.ts` `instantiateAssetBodySchema` | `assets[].code` | `.min(1).max(64)` |
| `admin/point-keys/point-keys.schema.ts` `createPointKeyBodySchema` (update omits `code`) | `code` | `.min(1).max(128)` |
| `admin/onboarding/onboarding.schema.ts` `draftAssetSchema` | `assets[].code` | `.min(2).max(64)` |
| `admin/onboarding/onboarding.schema.ts` `draftPointKeySchema` | `pointKeys[].code` | `.min(1).max(128)` |

The onboarding schema is parsed at `PATCH :id/draft` and again by
`OnboardingValidateService.validate`, which `commit` runs first, so a rule on
those two fields reaches the upload path as a per-field error at
`assets.<i>.code` — the surface `F4.104` ruling 1 chose for everything that is
not a length bound. The Excel importer copies `asset_code` verbatim. The
rule-based chat branch (`onboarding-chat.service.ts:574`) derives an asset code
from the **location name**: `site.replace(/\s+/g, "-").toUpperCase()` +
`-ASSET-1`. A location named `St. Mary's Works` yields `ST.-MARY'S-WORKS-ASSET-1`
— a dot and an apostrophe — and the commit inserts it. That producer is the one
place in the repository that can manufacture a code outside the class from
legal input, and it has to change with this row rather than be refused by it.

**4. A point-key rename is not one statement.** `asset_points.point_key` and
`template_points.point_key` reference `point_keys.code` with `NO ACTION` on
update (`0057`, `0058`), stored formulas name keys as text inside `{…}`, and
`asset_templates.content` names them in JSON. A migration that *rewrote* a
violating code would therefore have to touch four tables and parse formulas,
and would rename an identifier an operator knows by name. That is why decision
5 refuses automatic repair regardless of how question 2 is ruled.

**5. The grammar must not move.** ADR 0055 decision 3 freezes every `v1`
formula's meaning; decision 4 makes `v2` a strict superset of `v1`, a property
the test suite states over keys without a `.`. A tokenizer that refused
characters outside the class would change the meaning of a stored `v1`
formula containing one. Once the catalog cannot contain such a key, a
reference to one is simply unresolvable — which `missing_input` already
reports — and the grammar needs no second rule.

**6. Three docblocks name this row and go stale when it lands.**
`calc-dsl/cross-ref.spec.ts` (§4, ≈75–82 and ≈139–140: "nothing enforces that
charset"), `calc-dsl/dialect-superset.spec.ts` (≈56–58: "no seeded or stock
catalog code has one"), and `onboarding-draft-caps.ts` (≈340–342:
"`assets[].code` carries no regex … and no CHECK on `bms.assets.code`; it is
uppercased by its producer" — the last clause is already false for the Excel
producer, which does not uppercase).

**7. The repository has the precedent for both halves.** Five Zod code fields
already carry a class — `organizations.schema.ts` and `draftLocationSchema`
use `/^[A-Z0-9_-]+$/`, `locations.schema.ts` and the stock code use
`/^[a-z0-9-]+$/`, `asset-roles.schema.ts` uses `/^[a-z][a-z0-9-]*$/` with a
message that names an example. Migration `0061` adds a `CHECK` inside an
idempotent `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint …)` block. This
ADR copies both.

## Decision

1. **One character class, `^[A-Za-z0-9_-]+$`, for both columns** (question 1,
   recommended). Letters of either case, digits, `_` and `-`; nothing else, and
   in particular no `.`, no whitespace, no `{ } ( ) @ '` and no non-ASCII
   character. It admits every row in every source in §2 and refuses every
   character the two dialects give a meaning to. The class is declared once, as
   `CATALOG_CODE_PATTERN` in `packages/shared/src/constants.ts`, with a
   docblock naming this ADR; the five Zod sites in §3 apply it through one
   shared refinement message that names an example
   (`"letters, digits, '_' and '-' only — like TX_01 or kwh_total"`), in the
   `asset-roles.schema.ts` style. Length bounds are untouched.

2. **Migration `0070_catalog_code_charset.sql` adds two `CHECK` constraints**,
   `assets_code_charset_check` and `point_keys_code_charset_check`, each as
   `CHECK (code ~ '^[A-Za-z0-9_-]+$')` inside the `0061` `DO` block shape so a
   re-run is a no-op. A test reads the migration file and asserts the class
   string is byte-identical to `CATALOG_CODE_PATTERN.source`, so the two
   definitions cannot drift apart silently. `asset_points.point_key` and
   `template_points.point_key` need nothing: their foreign keys make the
   catalog's class theirs by construction.

3. **The migration validates existing rows and fails loudly on a violator**
   (question 2, recommended). A plain `ADD CONSTRAINT` scans the table; a row
   outside the class stops the migration with Postgres's own
   `check constraint "…" of relation "…" is violated by some row`, and the
   operator repairs that row by hand before re-running. §2 is the evidence
   that no database built from this repository has such a row, and the
   cold-start replay (`roles` → `migrate` → `seed` on an empty volume) is the
   gate that proves it at the PR. The alternative — `NOT VALID`, which refuses
   new writes and tolerates old rows — is the right ruling **only** if the
   owner knows of a deployed database whose rows this scan did not see; it
   leaves a constraint that says one thing and holds another until someone
   runs `VALIDATE CONSTRAINT`, which no row owns.

4. **The chat producer slugifies to the class.** `onboarding-chat.service.ts`
   replaces every run of characters outside `[A-Za-z0-9_-]` in the location
   name with one `-` (not only whitespace), collapses repeats and trims
   leading/trailing `-` before upper-casing and appending `-ASSET-1`, so the
   code it manufactures is always legal and the hash suffix
   `cutToBoundWithHashSuffix` appends (upper-case hex plus `-`) stays inside
   the class. The Excel importer keeps copying `asset_code` verbatim; an
   illegal cell is refused by `validate` at `assets.<i>.code` with the decision
   1 message, which is where `F4.104` put every non-length refusal.

5. **No automatic repair, ever.** Neither this migration nor any later one
   rewrites a code that violates the class. §4 is the reason: the rename spans
   four tables and the text of stored formulas, and an identifier an operator
   knows by name is theirs to change.

6. **The tokenizer, the parser and the resolver are untouched** (§5). This
   ADR adds no error code to either dialect and does not amend ADR 0055.
   Decision 4's superset property may now be stated over the whole class
   rather than "keys without a dot", and the `F2.9` docblocks in §6 are
   rewritten to say the class is enforced at the boundary and in the schema.

7. **Fixtures comply already and stay as they are.** `CALCWRITE_*` and
   `FIXTURE-<label>-<uuid>-<nn>` are inside the class; no fixture is renamed.

## Dependencies

None. No package is added; `zod` and `pg` already carry everything decided
here.

## Gate questions

### Q1 — One class for both columns, or one per column? — *recommend: one class*

The seeds follow two conventions the API never enforced: point keys are
`lower_snake` (605 of 605 in the constants), asset codes are `UPPER-HYPHEN`
(150 of 150 live, `_` in none, though ADR 0055's own example `{TX_01.kwh}`
assumes an underscore is legal). A per-column ruling would write
`^[a-z][a-z0-9_]*$` for point keys and `^[A-Z0-9][A-Z0-9_-]*$` for assets.

*What the per-column option buys:* the conventions become rules, and a
reference's case tells a reader which half of `{CODE.key}` it is.

*What it costs, measured:* two fixture families are renamed (`CALCWRITE_*`
becomes lower-case; the asset fixture's UUID is upper-cased); the Excel
importer must upper-case `asset_code` or refuse a lower-case cell; the asset
form gains a rule nothing downstream needs (the resolver compares
`bms.assets.code` byte-for-byte either way); and any code an operator has
typed in the other case since the forms shipped is a migration failure under
decision 3. Loosening later is one migration with no data risk; tightening
later is one migration plus a scan — the same scan as today's — so deferring
the convention costs nothing that cannot be recovered.

*Recommendation:* one class. This row is about the `.`; case is a different
question and can be its own row if a client asks.

### Q2 — What happens to a row that already violates the class? — *recommend: the migration fails*

Three options were weighed:

(a) **Plain `ADD CONSTRAINT`** — the scan runs inside the migration; a violator
stops it loudly with the constraint name; the operator repairs the row and
re-runs. The safe failure direction for a deploy, and §2 says the case does
not arise for any database this repository builds.

(b) **`ADD CONSTRAINT … NOT VALID`** — new writes are refused immediately,
existing rows are tolerated, and `VALIDATE CONSTRAINT` is owed later. Right
only if a deployed database exists that §2's scan did not cover; otherwise it
ships a constraint that is half-true with nobody assigned to finish it.

(c) **Rewrite violators in the migration** — refused by decision 5 regardless
(§4).

*Recommendation:* (a). If the owner knows of a database outside the repository
whose `point_keys` or `assets` were never scanned, say so and (b) becomes the
ruling, with the `VALIDATE` step filed as its own row.

## Consequences

- One shared constant, five Zod sites, one producer change, one migration
  with two constraints, one migration-vs-constant parity test, three docblock
  rewrites, and the `F2.9` superset-property docblock widened. No package, no
  new module, nothing in `apps/web` beyond the message the two admin pages
  already surface through `onError`.
- `F2.9`'s finding 8 ("the injectivity argument rested on a charset nothing
  enforces") and finding 27 (a catalog scan with no test-file exemption) close
  with this row. Finding 35 was already closed structurally and is unaffected.
- An operator who tries to create `pump 1` or `feeder.a` now reads one
  sentence naming the class and an example, at the form, at the wizard's
  per-field errors, and at `POST /admin/assets` — instead of a stored code that
  `bms-calc-v2` would split at the wrong place and report as `missing_input`.
- **Not in this ADR:** `bms.asset_groups.code` and `bms.asset_domains.code`
  (the `'…'` string form in `@group('x')` / `@domain('x')` is `'`-terminated,
  so a `.` in either is harmless to the grammar); `bms.locations.code`,
  `bms.rtus.code`, `bms.asset_templates.code`; case-insensitive resolution;
  harmonising `.min(1)` and `.min(2)` across the five sites; a charset rule in
  the tokenizer.
- AGENTS.md §6 lists nothing this promotes; the `chore(agents):` sweep at
  closure records the row and the ADR in §2 and the status line only.
