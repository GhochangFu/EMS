# ADR 0015 — Asset template schema (`asset_templates` + `template_points`)

## Status

Accepted (2026-08-04). Backlog item `F2.1` (Wave 0, P0, ⭐ enabler).

**Amended 2026-08-05** while building `F2.2` — see
[Amendment 1](#amendment-1--the-instantiation-contract-2026-08-05) at the end.
Two clauses of §6/§7 were unbuildable as written. §1–§5 (the schema, which
shipped in `F2.1`) are unchanged.

All four open questions raised during drafting are resolved — see
**Resolved decisions** at the end. No open questions remain; this ADR is
buildable as written.

Like ADR 0013 and 0014, the §10 promotion is **deliberately deferred**. This ADR
proposes a schema; it does not edit `AGENTS.md` §2/§3/§6. Per AGENTS.md §9.10
that edit may not ride along in a feature PR — it is owed as a separate
`chore(agents):` commit (see Consequences).

## Context

`F2.1` is the head of the critical path. `docs/BACKLOG.md` §1 names three chains
that all originate here:

- `F2.1 → E1.7 → E5.1` — the Ion Exchange overlay surface and the
  water-treatment domain pack (STP/ETP/RO/UF/softeners/DM/cooling water/dosing),
  which is the client's core business.
- `F2.1 → F2.2 → F3.22` — model-once-deploy-many, then conversational template
  onboarding by the agent.
- `F2.1 → F2.7` (tag-mapping bulk editor), `F2.1 → F3.2` (per-asset-type default
  dashboards), `F2.1 + F2.4 → F2.6` (template calc-tags into the calc engine).

Six committed dependents means the shape is expensive to get wrong and cheap to
get late. This ADR fixes the shape.

### What already exists

The hierarchy from ADR 0008/0010 is `organizations → locations → rtus → assets →
asset_points`, with an org-scoped `bms.point_keys` catalog. Three properties of
the existing code constrain any template design and are load-bearing below:

1. **`bms.asset_points.point_key` is a `varchar(128)`, not a FK.** Validity is
   enforced in the service layer:
   `AssetPointsAdminService.resolveCatalogPointKey` (`apps/api/src/admin/asset-points/asset-points.service.ts`)
   resolves `asset → location → organization`, then requires a row in
   `bms.point_keys` with matching `organization_id`, matching `code`, **and
   `active = true`**. It also returns the catalog `unit` as the fallback when the
   caller does not supply one. This is ADR 0010 §5 in code.
2. **`bms.asset_points.source_data_key` is `NOT NULL`.** There is no way to
   create an asset point without a source key.
3. **`bms.assets.code` is globally unique**, not unique per location
   (`packages/db/src/schema/bms-schema.ts`).

There is no `asset_type` concept anywhere in the repository today — assets carry
only `domain varchar(64)` (`electrical`, `hvac`, `it`, `environment`). The
template is where asset *type* first appears.

Note the name collision risk: `bms.maintenance_task_templates` already exists and
is unrelated (it templates work-order tasks per asset). `asset_templates` templates
the asset itself.

## Options considered

### Fork 1 — what happens when a template changes after instantiation

This is the highest-risk question in the item.

**A. Mutable template; instantiated assets follow the latest.** Editing a
template silently adds, removes, or re-units `asset_points` across every asset
built from it. In a BMS those rows are physical wiring: `apps/ingest` and the
rule engine read them. Forty chillers changing ingest behaviour because someone
fixed a typo in a template, with no operator action and no approval step, is not
acceptable. Rejected.

**B. Copy on instantiate, no link retained.** Safe, and trivial to build — but it
throws away the only thing that makes domain packs worth having. `E1.7` (KPIs,
alarm philosophies, default dashboards, health/maintenance hooks) and `F3.2`
(per-asset-type default dashboards) both need to answer "which assets are
RO skids, and by which template version?" With no link, that question is
unanswerable and every later overlay must be re-attached by hand. Rejected.

**C. Immutable published versions; assets pin a version; re-sync is explicit.**
— **recommended.** Editing a published template does not mutate it: it creates a
new *draft* version. Publishing v2 changes nothing about assets already built
from v1. Re-sync is a separate, operator-confirmed diff-and-apply operation
(later work, not `F2.1`). `F2.1`'s only obligation is to make that diff
*computable*, which pinning does.

### Fork 2 — one table with version rows, or `asset_templates` + `template_versions`

Recommended: **one table**, where a row *is* a version, identified by
`(organization_id, code, version)`. `bms.automation_rules` already uses exactly
this collapsed pattern in this repository — `lifecycle_status`, `published_at`,
`archived_at`, `duplicated_from_rule_id` all on one row — so the vocabulary is
consistent with code a reviewer has already read. A split parent/child table buys
a natural home for template-level identity, but the only query it makes cheaper
("all assets from RO-SKID, any version") is one extra join either way, and it
doubles the number of rows an authoring UI, the onboarding agent, and every
domain-pack import must create.

## Decision

### 1. `bms.asset_templates` — one row per template *version*

```sql
CREATE TABLE IF NOT EXISTS bms.asset_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  code            varchar(64) NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  name            varchar(255) NOT NULL,
  asset_type      varchar(64) NOT NULL,
  domain          varchar(64) NOT NULL,
  description     text,
  status          varchar(32) NOT NULL DEFAULT 'draft',
  content         jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at    timestamptz,
  archived_at     timestamptz,
  created_by      uuid REFERENCES bms.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_templates_org_code_version_unique
  ON bms.asset_templates (organization_id, code, version);

-- At most one editable draft per logical template.
CREATE UNIQUE INDEX IF NOT EXISTS asset_templates_org_code_draft_unique
  ON bms.asset_templates (organization_id, code) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS asset_templates_org_status_idx
  ON bms.asset_templates (organization_id, status);

CREATE INDEX IF NOT EXISTS asset_templates_org_asset_type_idx
  ON bms.asset_templates (organization_id, asset_type);
```

- `status` is `draft | published | archived`, matching
  `bms.automation_rules.lifecycle_status`. A two-state `active` boolean (the
  ADR 0009 convention) cannot express "drafted, not yet publishable", which is
  precisely what an authoring UI and `F3.22`'s agent both need.
- `content jsonb` is the reserved **`E1.7` overlay surface** — KPIs, alarm
  philosophies, default dashboards, health/maintenance/optimisation hooks. It is
  `{}` in `F2.1`. Its shape is contracted by a Zod schema in `packages/shared`
  that `E1.7` tightens; no relational modelling of content that is not yet
  specified.
- No GIN index on `content` yet. Add one when a query needs it; it is a
  one-statement additive migration.
- `asset_type` is the axis `F3.2` and `E5.1` group by (`ro_skid`, `chiller`,
  `dosing_pump`). `domain` stays aligned with `bms.assets.domain`.

### 2. `bms.template_points`

```sql
CREATE TABLE IF NOT EXISTS bms.template_points (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id             uuid NOT NULL
                            REFERENCES bms.asset_templates(id) ON DELETE CASCADE,
  point_key               varchar(128) NOT NULL,
  label                   varchar(255),
  unit                    varchar(32),
  kind                    varchar(32) NOT NULL DEFAULT 'measured',
  source_data_key_pattern varchar(128),
  required                boolean NOT NULL DEFAULT true,
  sort_order              integer NOT NULL DEFAULT 0,
  meta                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS template_points_template_point_key_unique
  ON bms.template_points (template_id, point_key);

CREATE INDEX IF NOT EXISTS template_points_template_sort_idx
  ON bms.template_points (template_id, sort_order);
```

- `ON DELETE CASCADE` mirrors `bms.rtu_connection_configs.rtu_id` (ADR 0012). It
  only ever fires for a discarded draft — published versions are never deleted.
- `kind` is `measured | derived`. This is **not** speculative: it changes
  instantiation semantics. A derived point is computed by the calc engine
  (`F2.6`), not ingest-mapped, so `F2.2` must not emit an `asset_points` row for
  it — there is no honest `source_data_key` for a derived tag. Without `kind`,
  `F2.2` would have to invent one.
- **No calc-reference column.** `F2.3` has not frozen its formula identifier
  shape. A nullable `varchar` added later is a trivial additive migration; a
  column guessed now that `F2.3` contradicts is not.
- `unit` is an *override*, not a copy. Null means "use the catalog unit", which
  is already what `resolveCatalogPointKey` returns as the fallback.

### 3. Templates reference the point-key catalog by code, and do not duplicate it

`template_points.point_key` is a `varchar(128)` resolved against the org's
`bms.point_keys` by code — deliberately identical to `asset_points.point_key`.
Three reasons:

1. **Instantiation becomes a copy, not a translation.** `template_points.point_key`
   → `asset_points.point_key` with no lookup and no chance of the two tables
   disagreeing about what a point key is.
2. **A composite FK would need a denormalized `organization_id` on
   `template_points`.** `bms.point_keys` is unique on `(organization_id, code)`,
   so the FK is technically possible — but only by carrying the org on the child
   row as well as on `asset_templates`, creating a second source of truth that
   can drift. Rejected on those grounds, not on FK dogma.
3. **Domain packs must be authorable as data.** `E5.1` and `F3.22` need a
   template to be expressible as a JSON/YAML pack that imports into any org.
   Code references survive that round trip; uuids do not.

The template stores **no copy** of the catalog's `name`/`description`/`domain`.
Only `label` and `unit` overrides.

**Validity is checked twice, and this is required, not belt-and-braces.**
ADR 0010 §5 requires `asset_points.point_key` to resolve to an *active* catalog
row at creation time, and instantiation creates `asset_points`. So a v2 published
six months ago, whose point key was deactivated last week, will fail mid-transaction
today. Therefore:

- **At authoring** (create/update a draft's points, and at publish): reject any
  `point_key` absent from the org's active catalog, with the offending codes named.
- **At instantiation**: re-validate through the same path
  `AssetPointsAdminService.resolveCatalogPointKey` already uses, and fail the whole
  transaction listing every inactive code. Never silently skip a point.

### 4. `bms.assets` gains a nullable version pin

```sql
ALTER TABLE bms.assets
  ADD COLUMN IF NOT EXISTS template_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assets_template_id_asset_templates_id_fk'
  ) THEN
    ALTER TABLE bms.assets
      ADD CONSTRAINT assets_template_id_asset_templates_id_fk
      FOREIGN KEY (template_id) REFERENCES bms.asset_templates(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assets_template_id_idx ON bms.assets (template_id);
```

Because a row **is** a version, one nullable FK pins the exact version — no
separate `template_version` column, and no way for the two to disagree. `NULL`
means hand-created, which every existing seeded asset is.

This column ships in `F2.1`'s migration, not `F2.2`'s, so that `F2.2` adds **no
DDL at all**. Fewer migration-bearing jobs is the point (see Migration safety).

### 5. Version lifecycle

- `draft` rows are freely editable, including their `template_points`.
- **Publish** sets `status = 'published'`, `published_at = now()`. From that
  moment the row and its points are immutable except `status → archived`.
- **Edit a published template** = create a new draft with
  `version = max(version) + 1` for that `(organization_id, code)`, seeded by
  copying the source version's rows. The partial unique index guarantees at most
  one draft exists at a time.
- Version numbers are **monotonic but may have gaps** — an abandoned and deleted
  draft consumes its number permanently. Do not renumber. Deleting a *draft* is
  the sole hard delete permitted anywhere in this design, and it is safe by
  construction: nothing can pin an unpublished version, so a draft has no
  dependents. Everything else follows ADR 0009's no-hard-delete rule.
- **Archive is permitted even while assets pin the version.** This deviates from
  ADR 0009's "block if children remain" table, and intentionally: ADR 0009 blocks
  deactivation to avoid orphaning *live operational rows*. An instantiated asset
  is self-contained — it owns its own `asset_points`, which keep working
  untouched. Archiving orphans nothing; it only removes the version from the
  "instantiate from" picker. Hard delete of a published version is never allowed,
  because the pin must stay resolvable forever.
- Publishing v2 does **not** touch assets pinned to v1. Ever. Re-sync is a later,
  explicitly confirmed diff-and-apply; `F2.1` guarantees only that the diff is
  computable.

### 6. Instantiation walk-through (`F2.2`) — chiller template, 12 points, 40 assets

Given `CHILLER-CENTRIF` v3, `published`, org `IONEX`, 12 `template_points`
(10 `measured`, 2 `derived`), and a target location `Plant-A` with RTU
`PLANTA-HVAC-01`:

`POST /api/v1/admin/asset-templates/{templateId}/instantiate`

```jsonc
{
  "rtuId": "…",                       // target RTU; its location supplies organization + location_id
  "assets": [
    { "code": "PLANTA-CH-01", "name": "Chiller 01", "siteName": "Plant A",
      "sourceDataKeyVars": { "unit": "01" } }
    // … 40 entries
  ]
}
```

In one transaction:

1. Load the template. Require `status = 'published'`. Require
   `template.organization_id` equals the org resolved from
   `rtu → location → organization` — a template may not cross org boundaries,
   and `resolveCatalogPointKey` would reject it downstream anyway.
2. Access check (see §7 below).
3. Re-validate all 12 `point_key`s against the org's **active** catalog. Abort
   listing every inactive code.
4. For each of the 40 entries, insert `bms.assets` with `domain` from the
   template, `location_id` from the RTU's location, `rtu_id`, and
   `template_id = <v3 row id>`.
5. For each asset, insert `asset_points` for the **10 `measured`** points only —
   400 rows, not 480. The 2 `derived` points stay template-side until `F2.6`
   wires them into the calc engine.
6. `source_data_key` (NOT NULL) comes from `source_data_key_pattern` with
   `{asset_code}` / caller-supplied vars substituted, e.g.
   `CH{unit}_CHW_SUPPLY_T` → `CH01_CHW_SUPPLY_T`. If a **required** measured
   point yields no resolvable key, abort — never insert a placeholder.
7. Audit `master.asset.instantiate` once with the template id, version, and the
   40 asset ids, via `MasterDataAuditService` (ADR 0009 §6).

Net: 40 asset rows + 400 asset-point rows from one call.

**Two failure modes the API must surface explicitly:**

- `bms.assets.code` is **globally** unique, not per-location. Callers must
  generate codes, and a collision on asset 39 rolls back all 40. Return the
  colliding code, not a generic constraint error.
- A single unresolved `source_data_key` fails the whole batch. That is correct
  (partial instantiation is worse), but the error must name the asset and point.

### 7. Access control

Templates are **org-scoped**, exactly like `bms.point_keys`. `AccessControlService`
reaches them with the predicates it already has:

| Operation | Predicate |
|---|---|
| List / read | `writableOrganizationIds(jwt)` → `inArray(assetTemplates.organizationId, ids)`; `null` = global admin, unrestricted. Identical to `PointKeysAdminService.list`. |
| Create / edit / publish / archive | new `canManageTemplate(jwt, organizationId)`, delegating to the same rule as `canManagePointKey`: `admin` → true, `organization_admin` → `canManageOrganization`, `location_admin` → **false**. Publish shares the edit permission — see Open question 4. |
| Instantiate | **both** `canManageTemplate` on the template's org (read) **and** `canManageLocation(jwt, targetLocationId)` (write). |

The instantiate split is the important one: a `location_admin` may deploy a
published org template into their own location — that is the whole point of
model-once-deploy-many for a multi-site client — but may not author or edit
templates. That mirrors ADR 0009/0010's split, where location admins manage
mappings but not the org catalog.

`canManageTemplate` is added as its own method rather than reusing
`canManagePointKey` by name, so that a later divergence in template policy does
not silently change point-key policy.

Every mutation is audited via `MasterDataAuditService` under
`master.asset_template.*` and `master.asset.instantiate`.

### 8. Onboarding (ADR 0011) — forward compatibility only, no work in `F2.1`

`F3.22` (agent onboards templates, Wave 3) is where the wizard learns templates.
`F2.1` changes nothing in `apps/api/src/admin/onboarding/**`. The shape is chosen
so that when `F3.22` arrives:

- `OnboardingDraft` gains `templates?: […]` and `assets[].templateCode`, and
- `OnboardingCommitService` resolves a template by `(organization_id, code,
  version)` using the same get-or-create-by-code loop it already runs for
  `pointKeys` — a code-keyed reference, not a uuid, is exactly what that loop
  needs.

## Dependencies

**None.** No new npm package, so AGENTS.md:160 / §9.4 is not engaged. Everything
proposed is `drizzle-orm/pg-core` primitives already imported by
`packages/db/src/schema/bms-schema.ts` (`uuid`, `varchar`, `integer`, `boolean`,
`text`, `jsonb`, `timestamp`), plus stock Postgres 16 DDL. `jsonb` is native. The
Zod contract for `content` uses the `zod` already present for DTO validation
(AGENTS.md §4.3).

## Consequences

**Positive.** The critical path unblocks: `E1.7` has its overlay surface
(`content` + a Zod contract), `E5.1`/`E5.2`/`E5.3` have a pack format that
imports per org, `F2.2` has a deterministic instantiation contract with no DDL of
its own, `F3.2` has `asset_type` to group by, `F2.7` has
`source_data_key_pattern` as the seed column for the bulk mapping sheet, and
`F2.6` has `kind = 'derived'` already carved out. Provenance ("which assets came
from RO-SKID v3") is a single indexed join.

**Negative.** Immutable versions mean a typo fix in a published template costs a
new version — correct for a BMS, mildly annoying for authors; the authoring UI
should make "edit → new draft v(n+1)" one click. Template drift is now *visible*
rather than absent, which means someone must eventually build the re-sync diff
UI; that is deliberate deferral, not an oversight. `bms.assets` grows a column
that is `NULL` for every currently seeded row.

**Neutral.** Two new tables, one new nullable column, one migration. No
dependency, no new module boundary — `apps/api/src/admin/asset-templates/`
follows the existing `point-keys/` controller-schema-service triple exactly.

**Owed follow-up (blocking nothing, but do not lose it).** Per AGENTS.md §9.10
and the precedent of ADR 0013 and 0014, a separate `chore(agents):` commit must:

1. Add templates to `AGENTS.md` §2's stack table (the "Master data" row stops at
   the point-key catalog).
2. Note `apps/api/src/admin/asset-templates/` in §3 if the layout listing is
   extended to that depth.
3. Mirror `F2.1` into `docs/roadmap.md` on promotion, per `docs/BACKLOG.md`'s
   scope law.

### Migration safety

- **One migration: `0023_asset_templates.sql`.** Next free index. The journal
  currently ends at `idx: 22` (`0022_phe_alarm_threshold_rules`, `when:
  1778976000000`); `0020` was never used and the gap is expected. The new entry
  is `idx: 23` with `when` **strictly greater than** `1778976000000`. A back-dated
  `when` would look correct in the journal and still be silently skipped on every
  dev, CI, and pilot database — drizzle only applies migrations newer than the
  newest already applied.
- **Forward-only** (AGENTS.md §4.4). Nothing above edits a merged migration.
- **Idempotent.** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, and the `pg_constraint` guard around
  `ADD CONSTRAINT` — bare `ADD CONSTRAINT` has no `IF NOT EXISTS` and fails on
  re-run.
- **Non-destructive.** Two new tables plus one nullable column. No `DROP`, no
  `NOT NULL` on an existing populated column, no backfill.
- **Journal entry lands in the same commit as the `.sql`.** `0018`/`0021`/`0022`
  reached `main` without journal entries; `bms.point_keys` was consequently never
  created and `pnpm db:seed` failed on every fresh database.
  `.claude/hooks/check-drizzle-journal.mjs` now guards this — do not bypass it.
- **Seed compatibility.** Additive only, so `packages/db/src/seed.ts` and the
  `*-seed.ts` modules are unaffected and need no change to keep passing. CI's
  `db:seed`-against-a-fresh-schema step (ADR 0014) is the gate that proves the
  journal entry is real; a red run there is a finding about the journal, not
  about CI.
- **Schema exports.** `packages/db/src/schema/bms-schema.ts` gains
  `assetTemplates` and `templatePoints`, and `assets` gains `templateId`.
  `pnpm --filter @bms/db build` must pass before the API compiles.
- **Only one migration-bearing job may be in flight at a time.** Every migration
  appends to a single `packages/db/drizzle/meta/_journal.json`. Two branches each
  appending an entry produce a merge conflict whose "obvious" resolution silently
  drops one — the exact failure mode above. `docs/BACKLOG.md` §1b slot 2 runs
  `F1.1`, `F2.1`, `F3.8` in parallel: **`F2.1` takes the migration lock for that
  slot.** Any other slot-2 job needing DDL either waits for `F2.1` to land or
  rebases its journal entry afterwards — it must not author one concurrently.

### Testing (ADR 0014)

Assertions in `*.spec.ts` with a sibling `*.test.ts` wrapper, or
`tests/repo-invariants.test.ts` fails the build. Minimum for `F2.1`: the Zod
schemas for template/point create-update, the version-bump rule, the
one-draft-per-code invariant, and the published-row-immutability guard. Coverage
thresholds ratchet up, never down.

## Resolved decisions

Four questions were left open at drafting. All are now settled; each records the
answer and the cheap escape hatch if it turns out wrong.

1. **`asset_type` is a free `varchar(64)`** — no separate catalog table in
   `F2.1`. The set of types in an org is the distinct set across its templates,
   which is what `F3.2` groups by. *Escape hatch:* if `E5.1` needs per-type
   metadata (icons, default schematic, engineering-unit system), it adds
   `bms.asset_types` and backfills from the distinct values already present.
2. **`E1.7`'s overlay lives in one `content jsonb` column**, contracted by a Zod
   schema in `packages/shared` that `E1.7` tightens. Modelling KPIs, alarm
   philosophies and dashboards relationally before `E1.7` and `F3.1` have
   specified them is the expensive mistake. *Escape hatch:* if `E1.7` needs a
   real FK from a template to a dashboard definition, that is a small join
   table, not a reshape.
3. **Domain packs are per-organization.** `organization_id` stays `NOT NULL`;
   `E5.1` ships as a pack file that **copies into an org on import**. A nullable
   `organization_id` meaning "system template" would break every
   `inArray(organizationId, writableOrgIds)` predicate in `AccessControlService`
   and need a special case in each — that is cross-tenant shared master data,
   which is `E7.1`'s territory and separately ADR-gated. Copy-on-import costs
   one authoring pass per pack plus a mechanical copy per org, and keeps the
   access-control model untouched.
4. **Publish uses the same permission as edit** (`organization_admin`+), exactly
   as `point_keys` works today. No separate approver. *Escape hatch:* a distinct
   approval step is a `status` value plus a role check — retrofittable without
   touching the schema, which is why it was safe to defer.

### Still deferred by design (not open questions)

- **Re-sync.** `F2.1` guarantees only that the diff between an asset's pinned
  version and a newer one is *computable*. The diff-and-apply UI is later work
  and must be operator-confirmed; it is never automatic.
- **Calc references on `template_points`.** `F2.3` has not frozen its formula
  identifier shape. A nullable column added later is trivial; one guessed now
  that `F2.3` contradicts is not.
- **GIN index on `content`.** Add when a query needs it — a one-statement
  additive migration.

---

## Amendment 1 — the instantiation contract (2026-08-05)

Building `F2.2` surfaced two clauses that cannot be implemented as written. Both
are in the parts of this ADR that describe *instantiation* (§6 and §7); neither
touches the schema, so nothing shipped in `F2.1` changes and there is no
migration. `F2.2` still adds **no DDL**.

### A. The instantiation target is `rtuId` **or** `locationId`, exclusively

§6's payload takes an `rtuId` and derives `location_id` from that RTU. That was
written on 2026-08-04, before **ADR 0018** made `bms.assets.rtu_id` nullable and
`location_id` `NOT NULL`, moving telemetry provenance onto `asset_points`.

So §6 now contradicts the schema it writes into. A gateway-less asset is legal —
`F1.8`/`F1.9` exist to create them, and ADR 0018's whole point is that an asset
must be *somewhere* and need not be *wired* — but an RTU-only payload gives no
way to instantiate one. Templates would be usable for exactly the subset of
assets that happen to have a gateway, which is not what model-once-deploy-many
promises a multi-site client.

**Decision.** The payload accepts exactly one of `rtuId` or `locationId`.
Supplying both, or neither, is a `400` — never a silent precedence rule, because
the two would disagree the moment an RTU is moved between locations.

| Target | `assets.location_id` | `assets.rtu_id` | `asset_points.rtu_id` | `asset_points.source_kind` |
|---|---|---|---|---|
| `rtuId` | the RTU's location | the RTU | the RTU | `measured` |
| `locationId` | as given | `NULL` | `NULL` | `unmapped` |

`unmapped` rather than `manual` is deliberate and follows the precedent
`AssetPointsAdminService.create` already set under ADR 0018: nobody has claimed
these points are hand-entered, only that no source is known yet. `manual` is a
positive assertion an operator makes later. The `asset_points_source_ref_check`
constraint permits both rows exactly as written; neither path needs new DDL.

*Escape hatch:* if a caller ever needs to instantiate into a location and wire a
gateway in the same call, that is an additive optional field, not a reshape.

### B. §7's instantiate predicate is wrong and denies the role it describes

§7's table requires **both** `canManageTemplate(jwt, template.organization_id)`
**and** `canManageLocation(jwt, targetLocationId)`. But `canManageTemplate`
returns `false` for `location_admin` by §7's own design — authoring is an
organization-wide act. The conjunction is therefore **always false** for a
location admin, contradicting the sentence immediately below the table:

> a `location_admin` may deploy a published org template into their own
> location — that is the whole point of model-once-deploy-many for a
> multi-site client

As written, that is unimplementable. The prose states the intent; the table
picked the wrong predicate for the read half.

**Decision.** Instantiation requires:

1. **Template readability** — `canManageOrganization(jwt, template.organization_id)`,
   the same predicate `list` and `getById` already use. For a location admin,
   `writableOrganizationIds` derives the org from their location grants, so this
   is true for their own org and false for anyone else's.
2. **Target write** — `canManageLocation(jwt, targetLocationId)`, unchanged.

`canManageTemplate` keeps its meaning exactly: *may author*. It stays required
for create/edit/publish/archive and is **not** consulted by instantiate. The
asymmetry §7 wanted is preserved — a location admin deploys but cannot author —
it is just expressed with a predicate that can actually be satisfied.

This is a **narrowing correction, not a widening one**: no role gains access
that §7's prose did not already grant it. A location admin still cannot reach a
template outside their own organization, because `canManageOrganization` is
false there.

### C. Consequential detail settled while building

- **Batched catalog re-validation.** §3 requires re-validating every point key
  against the org's *active* catalog at instantiation, "through the same path
  `resolveCatalogPointKey` already uses". Applied literally to 40 assets × 12
  points that is 480 identical single-row queries. `F2.2` issues **one** query
  with the same three predicates (`organization_id`, `code`, `active = true`)
  and the same fallback (`template_points.unit ?? point_keys.unit`). Same rule,
  same failure, one round trip.
- **`siteName` is optional**, defaulting to the resolved location's name.
  `bms.assets.site_name` is `NOT NULL`, and requiring 40 repetitions of one
  string is a transcription error waiting to happen.
- **Unresolved `source_data_key`.** §6 step 6 says abort when a *required*
  measured point yields no key. The complement was unstated: a **non-required**
  measured point with no pattern, or with an unsubstituted `{token}`, is
  **skipped** — no row. `source_data_key` is `NOT NULL`, so the only
  alternatives are a placeholder (§6 forbids it) or failing the batch on an
  explicitly optional point.
- **`meta` stays `NULL`.** Provenance is `template_id`, which pins the exact
  version. Instantiated gateway-less assets deliberately do **not** get
  `meta.sourceKind = 'manual'` — that marker is what
  `assignEskomAssetRtus` reads to skip re-wiring a seed fixture, and overloading
  it here would couple instantiation to seed behaviour.

### Owed follow-up

Unchanged from the main Consequences, plus: the `canManageTemplate` JSDoc in
`apps/api/src/auth/access-control.service.ts` restated §7's contradictory rule
verbatim and is corrected in the same PR as this amendment — it is a comment on
behaviour, not a rulebook edit, so §9.10 does not apply to it.
