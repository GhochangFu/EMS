# ADR 0019 — Template content model (`asset_templates.content`)

## Status

**Accepted (2026-08-05).** Backlog item `E1.7` (Wave 1, P0). Extends ADR 0015,
which reserved `bms.asset_templates.content jsonb` for exactly this and
contracted it as `z.record(z.unknown())` until now.

Approved as drafted, which settles the two questions below the fold: `dashboards`
stays closed to `featured[]` until `F3.1`, and maintenance materialisation stays
out of scope for `E3.x`. Both are recorded in "Open questions" as answered rather
than deleted — a gate decision is worth more as a record than as an absence.

No DDL. No new npm dependency. The change is a Zod contract, its validator, and
a reference check that rides alongside the one already there.

**Amended 2026-08-05** during implementation review — see
[Amendment 1](#amendment-1--hardening-found-in-review-2026-08-05) at the end.
Input hardening only; the tiering, the sections and the reference rule below are
unchanged. §7's byte-cap rationale is corrected there.

> **Numbering note — `0019` has three claimants.** It is the next free number in
> `docs/adr/` on `main`, but two other documents already reserve it:
>
> 1. `docs/BACKLOG.md` §5 reserves it **on `main`** for the retro
>    `0019-encryption-at-rest-boundary.md` (`E8.1`), an open human decision.
> 2. An unmerged, unpushed draft on the local branch
>    `claude/interesting-rhodes-33a8a3` (`0019-unprovisioned-principal-privilege-clamp.md`,
>    commit `041c190`).
>
> **Resolved at the gate (2026-08-05):** this ADR takes `0019`;
> `docs/BACKLOG.md` §5's reservation for the `E8.1` retro moves to `0020`. The
> branch draft renumbers whenever it is resumed. A stale number in §5 is what
> produced this collision, so the §5 correction ships with this change rather
> than being left for the next reader to trip over.

## Context

`E1.7` is the last item between `main` and `E5.1`, the water-treatment domain
pack that is Ion Exchange's core business. Five backlog items name it as a
dependency (`E5.1`, `E5.2`, `E5.3`, `E2.2`, `E1.3`), and the SOW row it answers
is §4.1 *"rich engineering templates"* — today's coverage is `F2.1`, which is
tag-level only.

ADR 0015 deliberately did not model this. Resolved-decision 2 reads:

> `E1.7`'s overlay lives in one `content jsonb` column, contracted by a Zod
> schema **in `packages/shared`** that `E1.7` tightens. Modelling KPIs, alarm
> philosophies and dashboards relationally before `E1.7` and `F3.1` have
> specified them is the expensive mistake.

(Quoted in full including the `packages/shared` clause, which §8 overrides — an
ADR that trims the phrase it is about to contradict is not quoting.)

That was right, and it is still right — which is the whole problem this ADR has
to solve.

### The problem: the consumers do not exist yet

`E1.7`'s scope is six things. Here is what each would actually be consumed by,
checked against `main` rather than against the backlog's prose:

| Content section | Consumer | State on `main` |
|---|---|---|
| KPIs | `F2.3` formula DSL ⭐ → `F2.4` calc engine | **Not started.** `F2.3` has no ADR and has explicitly not frozen its formula identifier shape (ADR 0015, "Still deferred by design"). |
| Alarm thresholds | `bms.automation_rules` + the rules engine | **Live.** `apps/api/src/rules/` runs today. |
| Alarm *philosophies* (the enrichment) | `E2.1` enrichment schema → `E2.2` | **Not started.** `E2.1` is `⬜` (`docs/BACKLOG.md:332`) and owns the field vocabulary. Split from the row above because they are one backlog phrase and two different answers. |
| Default dashboards | `F3.1` configurable dashboard schema → `F3.2` | **Not started.** `F3.1` is P0, 14–18 **person-**weeks (`docs/BACKLOG.md:27`), and owns the widget vocabulary. |
| Health-model hooks | `E1.1` ML serving foundation ⭐ | **Not started, and ADR-gated on a stack choice.** |
| Maintenance-rule hooks | `bms.maintenance_task_templates` + `maintenance_schedules` | **Live.** Both tables come from `packages/db/drizzle/0005_phase5_maintenance_tasks.sql` (Phase 5 Sprint C, `AGENTS.md` §6) — *not* ADR 0006, which at `0006:32` explicitly disclaims maintenance schedules. `apps/api/src/maintenance/` has the full category/generation-mode vocabulary. |
| Optimisation hooks | `E1.6` advisories | **Not started** (Wave 5, P2). |

Split that way it is seven rows, and `E1.7` is authoring-ahead-of-consumers for
five of them. Writing a schema for all seven now means guessing five unbuilt
vocabularies — the `F2.1` mistake, five times over. Writing none of them means
`E5.1` authors the flagship pack
against no contract at all, and every future consumer parses defensively
forever.

### What makes this tractable

Two observations narrowed it:

1. **Two sections have live consumers with published vocabularies.** Alarms map
   onto columns that exist and enums that are already enforced —
   `apps/api/src/rules/rules.schema.ts:5` (`operator`), `:44` (`severity`).
   Maintenance maps onto `createMaintenanceScheduleBodySchema`
   (`apps/api/src/maintenance/maintenance.schema.ts:40`). These can be
   contracted *strictly*, today, with no guessing, because the target already
   shipped.
2. **References are checkable even when bodies are not.** A KPI whose formula
   dialect is unknown still names point keys. Whether those point keys exist on
   the template is decidable right now, and it is the failure that actually
   hurts: a pack that references a tag the template does not declare is broken
   on every asset instantiated from it, and nothing on `main` would notice.

The second is where most of `E1.7`'s value is. It is the direct analogue of
`F2.2`'s `assertCatalogActive` — the check that turns a template from a
document into something the system can vouch for.

## Options considered

**A. Model every section now.** Rejected. `F2.3`, `F3.1`, `E1.1`, `E1.6` and
`E2.1` each own a vocabulary this ADR would be inventing on their behalf — five
items, two of them (`F2.3`, `E1.1`) ⭐ enablers. When they land, the
packs authored against the guess need rewriting — and by then `E5.1`, `E5.2`
and `E5.3` will have been written against it.

**B. Leave `z.record(z.unknown())`; let `E5.1` establish the shape by use.**
Rejected. It defers nothing — it just moves the schema decision into a pack file
where it is not reviewed, not validated, and not versioned. And it forgoes the
reference checking, which is the part that is buildable today and is what stops
a broken pack reaching an operator.

**C. Tier the contract by whether a consumer exists.** Chosen. Strict where the
target shipped, reference-checked-but-body-opaque where it has not, and
*rejected* where there is nothing to anchor to at all.

The third tier is the load-bearing one. A reserved key that is silently accepted
is worse than one that errors: it lets `E5.1` author dashboards in a shape
`F3.1` will contradict, and the contradiction surfaces a year later with packs
in the field. Erroring costs an author one message that names the blocking item.

## Decision

### 1. Three tiers, by consumer state

- **Bound** — the consumer is on `main`. Fully typed, `.strict()`, enums
  imported from the live schema rather than restated. → `alarms`, `maintenance`.
  (`alarms.philosophy` is one Anchored sub-object inside a Bound section; §3
  says why, because the heading alone would imply otherwise.)
- **Anchored** — the consumer is unbuilt, but the section's *references* are
  checkable today. Typed shell, opaque body carrying a dialect discriminator.
  → `kpis`, `dashboards`.
- **Reserved** — no consumer and nothing checkable. The key is **rejected**, with
  a message naming the backlog item that will open it. → `health`,
  `optimisation`.

The tier of a section is a fact about the repository, not a preference. When
`F3.1` lands, `dashboards` moves up a tier; when `E1.1` lands, `health` opens.
Each is an additive schema change with no migration.

### 2. The envelope

```jsonc
{
  "contentVersion": 1,        // integer literal, .default(1)
  "kpis":        [ … ],       // optional
  "alarms":      [ … ],       // optional
  "maintenance": [ … ],       // optional
  "dashboards":  { … }        // optional
}
```

- `.strict()` at the top level. Unknown keys are rejected.
- `health` and `optimisation` each get their **own** `superRefine` message
  naming their own blocking item — `health` → `E1.1`, `optimisation` → `E1.6` —
  rather than the generic unrecognised-key error, because the author needs to
  know it is *coming*, and from where. One shared message would point an author
  blocked on `optimisation` at an item three waves earlier and a priority band
  off.
- `{}` stays valid, and no migration rewrites anything — a row gains
  `contentVersion` only when someone next writes it. So **absent means 1** on
  read, and consumers must treat it that way rather than requiring the field.
- **`{}` is not guaranteed, only typical.** No seed or fixture in the repo sets
  `content`, so every row in a freshly built database is `{}`. But the live
  contract has been `z.record(z.unknown())` since `F2.1`
  (`asset-templates.schema.ts:16`), so a running deployment may hold arbitrary
  JSON that the `.strict()` envelope rejects. Those rows keep serving reads and
  keep instantiating — `content` is read by nothing (§8) — and fail at the two
  points that must parse them: the next `PATCH`, and `publish` (§6). Both errors
  name the offending key. That is the intended behaviour, not an oversight, and
  it is why the tightening needs no migration.
- `contentVersion` is how a future incompatible reshape stays cheap. It is not
  the template `version` (ADR 0015 §1) and does not interact with it.

### 3. `alarms` — bound to the live rules vocabulary

```ts
{
  code:           string(1..64),      // unique within the template
  pointKey:       string(1..128),     // must be a template point — see §6
  operator:       "gt" | "gte" | "lt" | "lte" | "eq",
  thresholdValue: number,
  severity:       "info" | "warning" | "critical",
  message:        string(1..500),
  category?:      "comfort" | "energy" | "safety" | "operations",
  philosophy?: {                      // ANCHORED, not bound — see below
    cause?:  string(..2000),
    impact?: string(..2000),
    action?: string(..2000),
    skill?:  string(..255),
  }
}
```

The enums are the live ones, verified rather than assumed —
`AutomationRuleOperator` (`packages/shared/src/index.ts:380`) has **no `neq`**,
and severity is three values, not five. Any richer set here would be a template
that authors alarms the rule engine cannot run.

**`philosophy` is Anchored, not Bound, and it sits inside a Bound section — say
so rather than let the section heading imply otherwise.** Its vocabulary is
owned by `E2.1` (`docs/BACKLOG.md:332`), which is `⬜` not started. `E2.1` names
seven fields; four appear here. The other three — *affected assets*,
*energy/water/production impact*, *ETR* — are properties of a **live alarm
instance**, not of an asset class, so a template cannot carry them and their
absence is a boundary rather than a subset. `E2.1` may still rename or restructure
the four that are here; when it does, this is the section that moves.

It is `E2.2`'s payload (*"template-driven alarm philosophy KB per asset class"*)
sitting inside the row it enriches rather than in a parallel structure. Content,
not behaviour — nothing on `main` reads it, and nothing needs to for it to be
worth capturing while the domain author is in the room.

**Nothing wires these alarms up either.** `ruleDraftBodySchema`
(`apps/api/src/rules/rules.schema.ts:34`) *requires* `ruleType`, `condition` and
`action`; a template alarm carries none of the three, so it cannot become a
`bms.automation_rules` row without inventing them. "Bound to the live
vocabulary" means the enums and columns are the real ones — **not** that a path
from template to running rule exists. Building that path is `E2.x`/`F3.x` work
with its own ADR, exactly as with `maintenance` in §4. This paragraph exists
because §4 disclaims its wiring and an asymmetry here would read as a promise.

### 4. `maintenance` — bound to the live schedule vocabulary

Each entry is `createMaintenanceScheduleBodySchema`
(`apps/api/src/maintenance/maintenance.schema.ts:40`) **minus the two fields
only an instance can know** (`assetId`, `firstDueAt`):

```ts
{
  title:            string(3..255),
  description?:     string(..4000),
  category:         maintenanceCategorySchema = "preventive",  // 14 values, imported
  generationMode:   maintenanceGenerationModeSchema = "calendar", // 5, imported
  ownerTeam?:       string(..128),
  vendorName?:      string(..128),
  complianceRef?:   string(..128),
  triggerSummary?:  string(..2000),
  safetyCritical:   boolean = false,
  priority:         "low" | "medium" | "high" | "critical" = "medium",
  estimatedMinutes: integer(5..1440) = 60,
  intervalDays:     integer(1..730),
}
```

Imported, not restated — a copied enum is a copy that drifts.

**This ADR does not wire it up.** `bms.maintenance_task_templates.asset_id` is
`NOT NULL`, so a plan only becomes a row once an asset exists. Materialising
these at instantiation time is a change to `F2.2`'s contract and belongs to
`E3.x`, with its own ADR. `E1.7` authors the plans; something later deploys
them. Said plainly here because "templates carry maintenance hooks" reads as if
the hook is connected, and it is not.

### 5. `kpis` and `dashboards` — anchored, bodies deliberately thin

```ts
// kpis[]
{
  code:        string(1..64),          // unique within the template
  name:        string(1..255),
  unit?:       string(..32),
  pointKeys:   string[](1..20),        // each must be a template point — §6
  expression:  string(1..1000),
  dialect:     "unvalidated",          // literal; F2.3 adds its own value
  higherIsBetter?: boolean,
}
```

`expression` is an opaque string. `F2.3` owns formula syntax and has not frozen
it; `dialect` is the discriminator that lets `F2.3` add `"bms-calc-v1"` beside
this one and migrate on its own schedule instead of on ours. `pointKeys` is
separate from `expression` on purpose — it is what makes the reference check
possible without a parser.

```ts
// dashboards
{
  [viewName: string(1..64)]: {
    featured: string[](1..50)          // ordered point keys — §6
  }
}
```

Ordering, and nothing else. No widget types, no layout, no sizes — that is
`F3.1`'s vocabulary and this ADR will not pre-empt it. "Which points matter for
this asset type, in what order" is information `F3.2` needs, is knowledge the
domain author has and nobody else does, and is not a shape `F3.1` can
contradict. Any other key under a view is rejected.

At most 20 views.

### 6. Reference validation — the part that has teeth

Every `pointKey` / `pointKeys[]` / `featured[]` entry must match a
`template_points.point_key` **on the same template**.

Not the org catalog. A KPI referencing a catalogued point the template does not
declare produces an asset with no such point on it — broken on every instance.
The template's own point list is the correct scope, and it is already loaded.
*Escape hatch:* if `E5.1` needs cross-template references, widening to the
active `bms.point_keys` catalog (the `resolveCatalogPointKey` path, ADR 0010 §5)
is a predicate change, not a reshape.

**When: on every write, *and* again on publish.** Both, not either — and that is
copied from the existing behaviour rather than invented.

`assertPointKeysActive`
(`apps/api/src/admin/asset-templates/asset-templates.service.ts:421`) is already
called from **three** places: `create` at `:121`, `update` at `:183`, and
`publish` at `:237`. So the house rule is not "drafts may be broken" — a draft
with an unknown point key is rejected on save today. Content references follow
the same rule:

- **On `POST /` and `PATCH :id`** — the two routes carrying a `content` body —
  resolve against the effective point set, which is `body.points` when the
  request supplies it and the stored `template_points` when it does not
  (`points` is `.optional()` on update, `asset-templates.schema.ts:79`).
- **On `POST :id/publish`** — parse the **stored** `content` under the strict
  envelope, then re-resolve its references against the stored point set. If the
  stored value does not parse — the pre-ADR legacy case from §2 — publish is
  **rejected**, with a message saying to `PATCH` `content` into conformance
  first. Publishing content the system cannot read would put an unparseable
  blob behind an immutable version, which is the one state with no cheap way
  out.

The publish re-check is **not** redundant, and this is the hole that makes it
necessary: `content` and `points` can be patched *independently*. A `PATCH` that
replaces `points` and says nothing about `content` silently orphans every
content reference to a removed key. Nothing at that write would notice, because
the write only validates what it carries. Publish is the last moment before
`F2.2` can instantiate forty assets from the template, so publish is where the
whole object must be re-proved consistent — the same argument
`assertPointKeysActive`'s own doc comment makes for re-checking at `:237` what
it already checked at `:183`.

Either check rejects by listing **every** unresolved key rather than the first —
an author fixing a pack should get one round trip, not twenty.

`POST :id/draft` is the exception: it takes **no body**
(`asset-templates.controller.ts:130`) and copies the stored value verbatim at
`asset-templates.service.ts:328`. It stays a byte copy and is deliberately not
re-validated — a template authored before this ADR may hold content the
tightened envelope rejects, and a fork that refuses to copy what is already
persisted would leave that template with nowhere to go: its published version is
immutable, and forking is the only route to an editable copy. So the fork is
exactly the way forward — fork, `PATCH` the content into conformance on the new
draft, publish. The copy is where the old value survives; the `PATCH` is where
the new contract bites.

(Distinct from `assertCatalogActive`, `F2.2`'s *instantiate*-time check cited
above in "What makes this tractable" — different lifecycle point, different
function, easy to conflate.)

### 7. Limits

| Bound | Value | Why |
|---|---|---|
| serialized `content` bytes | 256 KiB | Measured on the `content` subtree **after** the JSON body parse and **before** Zod — not a global body limit, which would apply to every route on the API. A `jsonb` column with no ceiling is a request body with no ceiling. |
| `kpis`, `alarms`, `maintenance` | 200 each | Generous for any real asset type; a bound is a bound. |
| dashboard views × featured | 20 × 50 | |

Same reasoning as `F2.2`'s `MAX_POINT_ROWS` — a limit chosen so an import cannot
turn authoring into a denial of service, set well above any plausible template.

### 8. What is unchanged

- **No DDL.** `content jsonb NOT NULL DEFAULT '{}'` already exists.
- **No GIN index.** ADR 0015 deferred it; nothing here queries into `content`.
  Still a one-statement additive migration when something does.
- **Permissions.** `organization_admin`+ on the template's org, exactly as
  template edit and publish work today (ADR 0015 resolved-decision 4). Content
  is a field on a template, not a new resource.
- **Immutability.** Content lives on a version. Editing published content means
  `POST :id/draft` → edit → publish, same as every other field. The existing
  draft-fork already copies `content`
  (`apps/api/src/admin/asset-templates/asset-templates.service.ts:328`).
- **Instantiation.** `content` is **not** copied onto assets or asset points.
  `assets.template_id` is the join, which is the provenance argument ADR 0015
  chose copy-with-link for. `asset-templates-instantiate.service.ts` reads
  `content` nowhere today and must continue not to.
- **Where the schema lives.** `apps/api/src/admin/asset-templates/asset-templates.schema.ts`,
  tightening `templateContentSchema` in place. Not `packages/shared` —
  ADR 0015 §Resolved-decision-2 said `packages/shared`, but `@bms/shared` is
  types-only with `typescript` as its sole devDependency, so a Zod schema there
  is a runtime dependency on a package that has none, which is the manifest
  change AGENTS.md §9.4 gates. The `F2.1` build already recorded this deviation
  in the file header; this ADR ratifies it. DTO *types* still go in
  `@bms/shared`.

## Dependencies

**None.** `zod` is already a dependency of `apps/api`. AGENTS.md §9.4 is not
engaged.

## Consequences

**Positive.** `E5.1` gets a pack format it can author against with the parts
that can be validated actually validated. Alarm philosophy (`E2.2`) and
maintenance plans (`E3.x`) get their authoring surface without waiting on their
engines. The reference check makes a broken pack fail at authoring time instead
of at an operator's screen, and closes the independent-patch hole that would
otherwise let a `points` edit silently orphan content. Five unbuilt vocabularies
stay unbuilt.

**Negative.** Two sections are deliberately thinner than `E1.7`'s backlog row
implies, and two are closed outright. A domain author who wants to ship a
dashboard layout with the pack cannot, until `F3.1`. That is the cost of not
inventing `F3.1`'s schema in a pack file, and it is the right trade — but it
should be stated to the client as a sequencing fact, not discovered by them.

`E1.7` will therefore be *revisited* rather than finished: `F2.3` promotes
`kpis`, `F3.1` promotes `dashboards`, `E1.1` opens `health`, `E1.6` opens
`optimisation`, and `E2.1` promotes `alarms.philosophy`. Five reopenings, one
per unbuilt consumer. That is intended. The alternative is one big guess.

**Neutral.** No migration, no dependency, no new module. The endpoints, the
service, the permission model and the tests all already exist; this widens a
validator and adds one reference check at the three call sites
`assertPointKeysActive` already occupies.

## Open questions for the gate — both answered 2026-08-05

1. **Is closing `dashboards` to `featured[]` acceptable to the client?**
   **Answered: yes, closed as drafted.** It is
   the one place this ADR visibly under-delivers against the SOW §4.1 reading.
   The alternative is `F3.1` first — 14–18 **person-**weeks, so the calendar cost
   depends on how many people are on it, but either way it reorders the board and
   pushes `E5.1` behind a dashboard builder.
2. **Should the maintenance materialisation be pulled into scope?**
   **Answered: no — it stays `E3.x` work with its own ADR.** It would have made
   `E1.7` genuinely end-to-end for one section, at the cost of amending `F2.2`'s
   instantiation contract in the same breath as defining content.

**Numbering, also settled:** this ADR takes `0019`; `docs/BACKLOG.md` §5's
reservation for the `E8.1` encryption-at-rest retro moves to `0020`.

## Promotion follow-ups (AGENTS.md §10, owed separately)

**§9.10-bound — one `chore(agents):` PR, separate from the feature:**

- `AGENTS.md` §2 — the Asset templates row gains the content model. §9.10
  (`AGENTS.md:513`) governs *that file only*: "update **this file** only via a
  PR prefixed `chore(agents): ...`". §10.1 takes one owed promotion per such PR,
  and this is one promotion.

**Not §9.10-bound** — these ship as ordinary `docs(...)` commits, which is how
`914569d` and `6d678ea` already did it, and §10.1 explicitly says the owed work
"is tracked in `docs/BACKLOG.md` §5 until it lands":

- `docs/BACKLOG.md` — `E1.7` status, the `E5.1`/`E5.2`/`E5.3`/`E2.2`/`E1.3`
  cascade check, and whichever side of the §5 ADR-number collision the gate
  decides (numbering note above).
- `docs/roadmap.md` — mirror the promotion.

**Also owed, and easy to lose:** `packages/db/src/schema/bms-schema.ts:234-237`
still carries the pre-`F2.1` comment *"contracted by a Zod schema in `@bms/shared`
that `E1.7` tightens."* §8 ratifies the opposite. Fix it in the feature PR — it
is a code comment about code, not a rulebook edit.

---

## Amendment 1 — hardening found in review (2026-08-05)

Recorded as an amendment rather than edited into the decision text above,
following ADR 0015's precedent. An Accepted ADR that is quietly rewritten to
match the code inverts the gate it exists to be.

Nothing here changes the tiering, the sections, or the reference rule. All of it
is input handling, and all of it came out of the security and compliance reviews
run against the implementation.

### A. Depth cap — `MAX_CONTENT_DEPTH = 12`

`JSON.parse` is iterative in V8. `JSON.stringify` is **not**. So JSON nested a
few thousand levels deep parses cleanly and then overflows the stack inside §7's
byte check — throwing a `RangeError`, which is not a `ZodError`, which the
controller's `instanceof ZodError` guard rethrows into a **500**. Reproduced at
5,000 levels in a **10 KB** body: well under the framework's own limit, from any
authenticated caller, on `POST /admin/asset-templates` — a route whose
authorization check lives in the service and therefore has not run yet.

Depth is now checked first, by an iterative walk, and nothing recursive touches
the value until it passes. Real content nests about five deep
(`kpis` → entry → `pointKeys` → string); twelve is room to spare.

The general lesson is worth more than the fix: **a validator that can throw is
not a validator.** Every guard in §7 was written as a size bound, and the one
that mattered was a shape bound.

### B. Unsafe key names rejected — `__proto__`, `constructor`, `prototype`

There is no prototype pollution here — verified — because `zod` skips
`__proto__` when merging parsed pairs. But that is a transitive implementation
detail under a `^3.24.1` caret range, and relying on it silently produced a real
defect: a `dashboards` view named `__proto__` **validated**, contributed no
point keys to the reference check, and then vanished on the `jsonb` write. The
author got a 200 for a dashboard that no longer existed. `constructor` survived
instead, waiting for the first consumer that iterates view names.

Rejected explicitly now, on the **key** schema of both records. That placement is
load-bearing and was got wrong once: `zod` validates key schemas against the
input's own keys but strips `__proto__` before building its output, so a
refinement reading the output never sees it.

### C. §7's byte-cap rationale was wrong about what binds

§7 justified 256 KiB as *"a jsonb column with no ceiling is a request body with
no ceiling."* Over HTTP that is not what happens: `main.ts` sets no body-parser
options, so `@nestjs/platform-express` applies `bodyParser.json()` defaults and a
body over **100 KB** is rejected with 413 before any of this schema runs.

The cap is therefore a backstop over HTTP, and binding only in
`parseStoredContent` — a row written under `F2.1`'s permissive contract has never
passed through any size check at all. Kept at 256 KiB for exactly that reason.
The framework default is deliberately not pinned in `main.ts` here; doing so
would change every route on the API and belongs to its own change.

### D. Errors report structure, never values

`parseStoredContent` joined `zod`'s own issue messages into the exception. For
`invalid_enum_value` that text echoes the **received value** back to the caller,
and stored content on a pre-ADR row is arbitrary JSON. It now reports paths,
unexpected key names and issue codes; our own `custom` messages are kept, because
we wrote them, they interpolate only a key name and a byte count, and they are
the only place a reserved section explains which item it is waiting for.

Not a scope crossing — every caller who can publish can already `GET` the whole
`content` object — but the narrow version costs nothing and survives a future
relaxation of `canManageTemplate`.

### E. The audit payload summarises content instead of copying it

`update`'s audit row spread the whole body, so a 256 KiB content edit wrote 256
KiB into `bms.audit_log` on every save. It now records which sections changed.
The content itself lives on the version row, which is immutable once published.

### F. One §7 row was missing, not new

The limits table omitted **20 point references per KPI**, which §5 already
specified as `pointKeys: string[](1..20)`. Documenting, not deciding.

---

## Amendment 2 — `thresholdValue` becomes conditional (B7: setpoints are per-site) — PROPOSED

**Status: Proposed — drafted 2026-08-22, awaiting the owner's gate.** Unlike
Amendment 1, which recorded hardening already reviewed into the
implementation, this amendment is a **contract change** and nothing may be
built against it until it is Accepted. It is the prerequisite for ADR 0040
(`E5.1` provisional authoring) decision 4.

*Note on numbering: the 2026-08-17 clarification annex and two 2026-08-22
client documents refer to this change as "Amendment 1" — written before
noticing Amendment 1 above already existed. This is that change, renumbered.*

### Context

§3 requires `thresholdValue: number` on every template alarm. That was correct
against the assumption it encoded: that a template alarm is a proto-rule, and
the rule engine's `condition` needs a number.

The client's position — stated in `B7` of the 2026-08-17 clarification set,
unanswered since, and now adopted as our working position (Part 1 of
`docs/ion-exchange-response-form-2026-08-22.md`, on ISA-18.2 grounds) — is that
**limit values are set per site at commissioning**. A template can know *which*
parameter alarms and *what it means*; it cannot honestly know the number.
Under the current contract the water pack (`E5.1`, authored from
`docs/e5.1-derived-taglist-v1.md`, whose alarm rows deliberately carry meanings
and no numbers) cannot be authored without inventing placeholder thresholds —
which is precisely the class of guessing this ADR exists to prevent.

### Decision

1. **`thresholdValue` and `operator` become a paired optional group** in §3's
   alarm entry: both present, or both absent. One without the other is
   rejected by a `superRefine` whose message says so. An operator with no
   number (or a number with no comparator) is not a philosophy — it is half a
   rule, and half a rule is an authoring error.
2. **Semantics of the absent pair:** the entry is an **alarm philosophy row** —
   parameter, meaning (`message`), `severity`, `category`, `philosophy` —
   the ISA-18.2 rationalization record for the asset class. With the pair
   present, the entry is (as today) a site-independent proto-rule.
3. **Everything else in §3 is unchanged**: `code`, `pointKey`, `severity`,
   `message` stay required; the reference check (§6), the vocabularies bound
   to the rules engine, and the limits (§7) are untouched. No DDL — `content`
   is `jsonb`.
4. **`E2.4` (seeding rules on instantiate) must skip pair-absent entries** —
   or, better, surface them at commissioning as "set the site value now"
   prompts. That choice belongs to `E2.4`'s own ADR (per §3's original
   disclaimer); this amendment only requires that seeding **never invents a
   number** for a pair-absent row.
5. **Surface changes owed in the feature PR:** the content schema in
   `apps/api/src/admin/asset-templates/asset-templates.schema.ts`; the `F2.5`
   Alarms tab, whose form currently requires the threshold field
   (`apps/web/src/components/asset-templates/alarms-tab.tsx`) and must allow
   the pair to be empty together — with copy saying "value set per site at
   commissioning", not an empty box.

### Consequences

- `E5.1` packs become authorable with honest content: meanings now, numbers at
  commissioning — and if `B7`'s answer eventually says "standard setpoints
  exist", filling the pair in a v2 is additive, while the reverse (deleting
  invented numbers already seeded into live rules) would not have been.
- A consumer can no longer assume every template alarm is runnable. The pair's
  presence is the discriminator, and `E2.4` inherits the rule in decision 4.

### Open question for the gate

Whether decision 1's pairing is right, or `operator` should stay required
(reading "gt" with no number as still-useful philosophy). Drafted as paired
because a comparator without a value adds nothing ISA-18.2 rationalization
needs — the `message` carries the meaning.
