# ADR 0039 — Template version lifecycle: how a republished template reaches assets already built from it

## Status

**Accepted** — 2026-08-22, by the repository owner, who ruled all six questions
the draft left open on the day it was drafted for `F2.6`.

**Five were answered as drafted; Q4 was not.** The draft deferred per-asset
overrides as speculative. The owner put them **in scope**, which widens `F2.6`,
amends ADR 0037 decision 4, and pulls in a schema change the drafted answers
did not need. The ruling is recorded in *Questions ruled at the gate* below,
with the draft's reasoning kept so a later reader can see what was overruled
and why it no longer applies.

This ADR amends standing decisions in **ADR 0015** and **ADR 0037**.

## Context

`F2.6`'s backlog row was titled "Template calc-tags wired into calc engine".
**That work already shipped.** ADR 0037 decision 4 put the calc configuration
columns on `bms.template_points`, and the engine resolves
`asset → assets.templateId → template_points` at runtime, so `F2.4` was
demonstrable against the running stack the day it landed. The row's title
described `F2.4`.

What is actually left for `F2.6` is named identically by the two ADRs that
handed it over:

- ADR 0037 *Consequences*: "What stays for `F2.6` is the authoring and
  lifecycle half: how a new template version's formula changes reach assets
  already built from the old one, per-asset overrides, and whatever backfill
  that implies."
- ADR 0038 *Not in this ADR*: "**How a new version's formula changes reach
  assets built from the old one.** ADR 0037 left the lifecycle half to `F2.6`
  explicitly. This UI can *create* the next draft and publish it; what that
  means for already-instantiated assets is unchanged and unaddressed."

So `F2.5` shipped the surface that creates version N+1, and nothing consumes
it. An author can edit a published template today, and the edit reaches no
asset, by construction and on purpose.

### The invariant this ADR touches

`asset_templates` identity is `(organization_id, code, version)` — one row per
version. `assets.template_id` points at that row. The schema comment states the
rule and its reason:

> Published rows are immutable except `status -> archived`: editing one creates
> a new draft at `max(version) + 1`. That is not ceremony — instantiated
> `asset_points` are physical wiring that `apps/ingest` and the rule engine
> read, so a template edit must never reach assets already built from it.

`asset-templates.service.ts` enforces it in three places: `createDraftFrom`
seeds the next draft at `max(version) + 1`, `publish` freezes the row, and
archive refuses to break resolvability because "an asset's pin must stay
resolvable forever".

**Any answer to `F2.6` weakens or qualifies that sentence.** That is why this
ADR exists rather than the work starting under ADR 0015.

### The asymmetry that makes this tractable

`template_points.kind` splits the problem, and the two halves carry very
different risk:

- **`measured` points are physical.** Instantiation writes an `asset_points`
  row per measured point, with a NOT NULL `source_data_key`. `apps/ingest`
  and the rule engine read those rows. Reaching them means reconciling live
  wiring — adding, removing or re-keying a tag under a running plant.
- **`derived` points are not instantiated at all.** ADR 0037 records that the
  `asset_points` row is created on **first value**, not at instantiation, which
  is why ADR 0037 could also record that `F2.2` is untouched. A derived point's
  formula, trigger, interval and staleness are read **at evaluation time** from
  the pinned template version.

So for derived points there is nothing to copy and nothing to migrate: changing
which version an asset resolves against changes the formula on the next
evaluation. The expensive reconciliation is confined to measured points.

## Decision

1. **Migration is an explicit action, never a side effect of publishing.**
   Publishing version N+1 continues to touch no asset. A separate operation
   moves a named set of assets from version N to N+1 by updating
   `assets.template_id`. ADR 0015's invariant survives with one word added:
   a template *edit* never reaches existing assets — a template *migration*
   does, and it is a distinct, audited, opt-in act.

2. **A migration is previewed before it is applied.** The operation computes a
   version delta — points added, removed, re-keyed, formulas changed, trigger
   or staleness changed — and returns it for confirmation. No blind apply.

3. **A delta that removes or re-keys a measured point is refused.** The
   operation rejects it, naming the point and how many assets carry it.
   Derived-point changes in any combination, and measured-point *additions*,
   migrate freely. Renaming a measured tag therefore still means rebuilding the
   asset; decision 3 buys safety at the cost of that workflow, knowingly.

4. **Measured additions create their `asset_points` rows on migration**, by the
   same path instantiation uses, so `source_data_key` is derived from
   `source_data_key_pattern` exactly as at instantiation. Derived additions
   create nothing by migration — see decision 7 for the one case that does.

5. **No backfill, and no marker on history.** ADR 0037's "Nothing recomputes
   history" stands unamended. A migrated asset computes the new formula from
   the moment it migrates; values already stored under the old formula stay as
   they are and are **not** marked. A series whose formula changed midway is a
   real reporting hazard, and this ADR records it as accepted rather than
   solved.

6. **Per-asset overrides are in scope.** One asset may override its template's
   `formula`, `formula_dialect`, `calc_trigger`, `calc_interval_seconds` and
   `max_input_age_seconds`. This **amends ADR 0037 decision 4**: the template
   is no longer the only unit of configuration, it is the *default* one.
   Resolution becomes `coalesce(asset_points.<col>, template_points.<col>)`
   per column, so a null override inherits and an override never has to restate
   the whole point.

7. **Overrides live in nullable columns on `bms.asset_points`**, mirroring
   `template_points`, and **setting an override creates the row eagerly** with
   `source_kind = 'computed'` rather than waiting for first value. This
   **amends ADR 0037's** "the `asset_points` row is created on first value":
   first value remains the rule for an unoverridden derived point, and an
   override is a second, explicit creator. `F2.2` is still untouched —
   instantiation continues to emit no row for a derived point.

8. **Two surfaces, each where its subject is.** Migration lives on the template
   detail page `F2.5` built: a Versions view listing which assets sit on which
   version, with a migrate action over a selected set. Overrides live on the
   **asset** detail page, per point, showing the inherited template value and
   an action to override it.

9. **Audit.** A migration and an override each write an audit action alongside
   the existing `master.asset_template.*` family. A migration carries template
   code, from-version, to-version and the affected asset ids. An override
   carries asset id, point key, and the columns changed.

## Questions ruled at the gate

**Q1 — explicit migration, or follow-the-latest?** *Ruled: explicit migration
(decisions 1–2).* The alternative was that derived-point resolution reads the
latest published version rather than the pinned row, so publishing propagates
automatically. Substantially less code, and probably what an author expects
when publishing a fix to a wrong formula. Rejected because a publish would then
silently change what a live plant computes, and `assets.template_id` would stop
describing how the asset behaves. A per-point flag choosing between the two was
also considered and rejected as two resolution paths to maintain forever.

**Q2 — what happens to a delta that removes or re-keys a measured point?**
*Ruled: refuse (decision 3).* Deactivating the `asset_points` row and prompting
per point were both considered. Refusing is the safe default; the unserved
retag workflow is accepted.

**Q3 — does a mid-history formula change need a marker?** *Ruled: no marker
(decision 5).* Recording the migration instant in one additive nullable column
was the cheapest honest alternative and was declined. Blocking migration on any
derived point that already has stored values was rejected as making migration
useless in practice.

**Q4 — does anyone want per-asset overrides?** *Ruled: build them in `F2.6`
(decisions 6–7).* **This overrules the draft**, which deferred them on the
grounds that ADR 0037 and ADR 0038 both qualify them as "if anyone asks" and
nobody had asked. The owner asked. The case is real: one pump on a site
instrumented differently from its siblings should not need its own template
version. The costs are accepted and recorded in *Consequences* — ADR 0037
decision 4 amended, a schema migration this ADR would otherwise not have
needed, and `F2.6` past its 3–4 week estimate.

**Q5 — where do the controls live?** *Ruled: split (decision 8).* Putting both
on the template page was rejected because editing one pump's formula from a
template screen inverts the subject. Putting both on the asset page was
rejected because it loses the bulk migration case entirely.

**Q6 — where does an override live in the schema?** *Ruled: nullable columns on
`asset_points`, created eagerly (decision 7).* A separate
`asset_point_overrides` table would have left ADR 0037's "created on first
value" literally true, at the cost of an extra join on every evaluation and two
places describing one point. Deferring the storage shape to the implementation
plan was rejected: it would have let the plan make an architectural call this
ADR exists to make.

## Dependencies

**No new npm package** in any workspace, so AGENTS.md §9.4 is not triggered.

**One additive, forward-only migration** on `bms.asset_points`, required by
decision 7: five nullable columns — `formula`, `formula_dialect`,
`calc_trigger`, `calc_interval_seconds`, `max_input_age_seconds`. No backfill;
no existing row changes meaning; null means "inherit from the template", which
is what every existing row already does implicitly. Its number is taken from
`packages/db/migrations/` when it is written rather than recorded here,
following the lesson `docs/BACKLOG.md` records against `E5.1` — a derived
number in prose does not stay correct.

**Column-level exclusivity is enforced in `apps/api`'s Zod layer, not a DB
CHECK**, matching the precedent `template_points` set for `formula` /
`formula_dialect` (migration 0035) and the calc columns (migration 0036).

## Consequences

- **ADR 0015 is amended, not overturned.** Its invariant becomes: a published
  version stays immutable, and an asset's pin changes only by an explicit,
  audited migration. **Two edits, two different commits.** The schema comment
  on `assetTemplates` in `packages/db/src/schema/bms-schema.ts` states the old
  rule flatly and would otherwise become false in the source — it is code, so
  it is corrected **in the `F2.6` implementation commit**. Only the AGENTS.md
  wording belongs to the separate `chore(agents):` sweep (§9.10).
- **ADR 0037 is amended twice, both by Q4's ruling.** Decision 4's "the unit of
  configuration is the template" becomes "the default unit"; and "the
  `asset_points` row is created on first value" gains a second creator. Neither
  amendment would have been needed under the drafted answer.
- **The evaluation path gains a merge.** The engine today reads
  `template_points` after resolving the pin. It must now left-join
  `asset_points` on `(asset_id, point_key)` and coalesce per column. This is
  the single highest-risk change in `F2.6`: it sits in the hot path of every
  scheduled and streaming evaluation, and a wrong coalesce silently computes
  the wrong number rather than failing.
- **`F2.6` is larger than its board estimate.** The row carries 3–4
  person-weeks, sized before overrides were in scope and before a migration was
  known to be needed. Two API surfaces, two UI surfaces, a schema migration and
  a hot-path resolution change put it nearer **6–9**. The board row is updated
  to say so; the number is planning-grade and is the drafter's estimate, not a
  commitment ruled at the gate.
- **`F2.2` is unchanged.** Instantiation still emits no `asset_points` row for
  a derived point, so ADR 0037's finding that no `F2.2` code path is touched
  survives decision 7.
- **`F2.7` shares the table.** The tag-mapping bulk editor seeds from
  `template_points.source_data_key_pattern`, and decision 4 reads the same
  column. They must not be built in parallel.
- **`F2.8` is untouched.** The PUE path stays unreachable on `bms-calc-v1` for
  the reasons ADR 0037 records, and `F2.9` carries that fork.
- **`E5.1` benefits, and is not unblocked.** A water-treatment pack will be
  republished repeatedly as the client's tag list arrives, so migration is the
  difference between iterating on a live pack and rebuilding assets. `E5.1`
  remains blocked on A1/A3.
- **The `no backfill` hazard is now written down in two places** rather than
  implied by ADR 0037's absence of a backfill mechanism.
