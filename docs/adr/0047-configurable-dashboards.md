# ADR 0047 — Configurable dashboards: the widget vocabulary is closed, the layout is relational, and `F3.1` splits

## Status

**Accepted** — 2026-08-28, by the repository owner, at the `F3.1` §10 gate and
**before any implementation code**.

Six decisions were put one at a time, each with alternatives and a
recommendation. Four were accepted as recommended. **Two changed the draft**,
and both changes came out of the owner's questions rather than out of review:

- **Decision 4 widened.** The fourth widget type was drafted as a fixed
  24-hour area chart and is now a **generic chart** whose series is chosen by
  configuration. This came from the owner asking how an administrator adds
  widgets to the shared palette. The honest answer is that a new *kind* is
  always a release, and the generic type is the one lever that converts future
  developer time into administrator time.
- **The effort moved `14–18` → `15–20`**, re-derived from the five children
  after the rulings rather than carried over from the row.

**One misconception is recorded here deliberately, because the next reader will
arrive at it too.** The owner asked which option was *the most dynamic*, given
that organization administrators configure their own widgets from the UI. The
answer is that **all three options are identical for that requirement**.
Composing a dashboard — placing tiles, choosing types, binding points, setting
ranges, sizing and arranging — is `F3.1d`, and no vocabulary choice restricts
it. Decision 2 gates one thing only: whether somebody can declare a *kind* of
widget that no component draws. See decision 2's second half, which exists to
keep "closed vocabulary" from being read as "rigid product".

This ADR **promotes** the `dashboards` bullet out of `AGENTS.md` §6 and moves
[ADR 0019](0019-template-content-model.md)'s `dashboards` section up a tier. It
does **not** resolve the `docs/BACKLOG.md` §5 *Reference layout language* ⚠
decision, which stays open and stays the owner's.

`F3.1` moves `⬜` → `🟡` on this acceptance. Never `🔵` — `docs/BACKLOG.md` uses
`🟡` for ADR/planned and no row in this repository has ever been marked `🔵`.

## Context

`F3.1` — *configurable dashboard schema + builder UI (core widgets)* — is `P0`,
Wave 1, `Depends: —`, and was sized at **14–18 person-weeks**. That figure was
current rather than stale: [ADR 0038](0038-template-authoring-ui.md)
§Consequences calibrates `F2.5`'s revised `16–20` against it explicitly.

It has been eligible on the board for the whole life of the backlog and has
never been started. Five rows wait on it — `F3.2`, `F3.5`, `E4.2`, `F3.28`,
`F3.32` — and three accepted ADRs defer to it by name rather than merely
mentioning it:

- **[ADR 0019](0019-template-content-model.md)** contracted
  `content.dashboards` as **ordered point keys only**. `TemplateDashboardView`
  is `{ featured: string[] }` and
  `packages/shared/src/asset-template-content.ts:124` says why in a docblock:
  *"No widget types, no layout, no sizes — that is `F3.1`'s vocabulary."* ADR
  0019 §Alternatives records the reason it was not guessed: a reserved key that
  is silently accepted *"lets `E5.1` author a shape `F3.1` will contradict a
  year later, with packs already in the field."*
- **[ADR 0038](0038-template-authoring-ui.md)** decision 3 gives the closed
  content sections **no tab**, and pins **exactly five** tabs by a source scan
  in `tests/adr-0038-template-authoring-ui.test.ts` — deliberately a scan,
  because *"a type cannot stop a sixth being added and a behavioural test would
  simply agree with whatever it found."* ADR 0038:124 states the condition
  directly: *"It becomes a tab when `F3.1` gives it widgets."*
- **[ADR 0037](0037-calc-execution-engine.md):268** assigns the KPI *rendering*
  half to `F2.5`/`F3.1` rather than to the calc engine.

`AGENTS.md` §6 carries the matching out-of-scope bullet. It is one of three,
one per unbuilt consumer, and this ADR closes one of them:

> - `dashboards` — **ordered point keys only**; no widget types, no layout, no
>   sizes. Needs `F3.1` to define the widget vocabulary

**What exists today is fixed dashboards, not configurable ones.** `apps/api/src/
dashboard/` serves hard-coded reads (`loadTrend`, `energySummary`,
`energySourceMix`, `energyTopConsumers`); `apps/web/src/pages/` holds twenty
hand-written pages, of which `dashboard-page.tsx`, `location-dashboard-page.tsx`
and the seven `control-room-*` pages are dashboards in everything but
configurability. `apps/web/src/components/` holds the widget-shaped components
already written by hand — `kpi-tile.tsx`, `load-trend-chart.tsx`,
`energy-source-stack-chart.tsx`, `energy-top-bar-chart.tsx`,
`alarm-summary-card.tsx`, `location-kpi-card.tsx`. There is **no dashboard
table, no widget vocabulary and no layout persistence anywhere in the
repository** — grepped in `packages/db/src/schema/bms-schema.ts` rather than
inferred from a directory listing, since `F3.1a` builds on the claim. The file's
only hit for `dashboard`, `widget` or `layout` is `:390`, a comment on
`asset_templates.content` naming ADR 0019's *"dashboard point ordering"*. This
is greenfield inside a mature codebase, which is the reason the scope boundary
in decision 6 is written as tightly as it is.

**`docs/BACKLOG.md` §7 is what makes "core widgets" a list rather than a
gesture.** Before the 2026-08-16 client-reference comparison the phrase had no
referent. §7's *Key Parameters* strip puts three widget types **side by side in
one row** — a radial gauge, a tank level (fill illustration plus a percentage),
and a plain value-and-unit tile — with 24-hour area charts for energy and water
below. That is the first set, and it is measured off the client's own reference
rather than invented. Decision 4 widens the fourth of them and takes the other
three verbatim.

**§8 was checked and is clean.** `F3.1` appears in the IONSiTE NEXUS feature
sheet only as coverage — row 5 *"Configurable dashboards"* and row 11
*"Self-service configuration for non-programmers"* — and in no client question
set. This matters because `E5.1` is this repository's standing proof that an
all-`✅` `Depends` cell does not mean startable: it is blocked on an unanswered
client mail that no dependency column can express. `F3.1` has no such blocker.
It is genuinely startable, and the only gate in front of it was this file.

**Row 11 is the one client sentence this ADR has to be read against.**
*"Self-service configuration for non-programmers"* is satisfied by `F3.1d` —
an organization administrator composes dashboards without a developer. It is
**not** a promise that an administrator can author a new widget *kind*, and
decision 2 is written on that reading. If the client ever means the stronger
thing, it does not become possible by opening the vocabulary; it becomes a
different product with a plugin runtime, and that is a new ADR.

## Decision

### 1. `F3.1` becomes an umbrella row and splits into five children

**Ruled as drafted.** 14–18 person-weeks is not a cycle, and the
`backlog-cycle` loop has no way to close a row that large: it would sit `🟡` for
a quarter while its dependants stayed blocked on a status that never flips.

This follows **`E7.1` → `E7.1a`–`E7.1i`**, split at the §10 gate on 2026-08-24.
Match that record's mechanics exactly: the umbrella row keeps `🟡` and carries
the record, its Feature cell says **"Do not implement against this row"**, and
the children carry the work and the wave cells.

| Child | What it owns | ⭐ | Effort |
|---|---|---|---|
| **`F3.1a`** | The widget vocabulary, the three tables, the migration and the contract — including the generic chart's discriminated-union config. Opens `TemplateDashboardView` past `featured[]`. | ⭐ | 4–5 |
| **`F3.1b`** | The dashboard read/write API — tenant-scoped, RLS, audit, the ADR 0017 write matrix. | | 3–4 |
| **`F3.1c`** | The four core widget renderers in `apps/web`, one of them generic. | | 3–4 |
| **`F3.1d`** | The builder surface — compose, arrange, bind points, pick the chart series, save. | | 4–5 |
| **`F3.1e`** | The template *Dashboards* tab. Amends ADR 0038's five-tab scan. | | 1–2 |

`F3.1a` is **⭐**: it defines the vocabulary five rows and two accepted ADRs are
waiting on, so it is built serially and hands-on, never dispatched to a cold
subagent (`build-operating-model.md` §3). The other four are ordinary rows.
`F3.1b` and `F3.1c` touch disjoint packages and are parallel-safe once `F3.1a`
lands; `F3.1d` needs both; `F3.1e` needs `F3.1a` only.

**The effort is `15–20`, and the row moves with it.** Three increments, each
traceable to a ruling rather than to padding: the split makes `F3.1e`'s ADR 0038
amendment visible where one row absorbed it, and makes each child pay its own
closure — `verify`, four review agents and the §4.6 live-stack pass, five times
instead of once; decision 4's generic chart widens `F3.1a`'s contract and adds
the series picker to `F3.1d`; decision 3's third table touches both `F3.1a` and
`F3.1b`. The arithmetic was put to the owner as `14–18` (row) → `14–19` (split
alone) → `15–20` (after the rulings), and the last was chosen.

The children inherit `F3.1`'s dependants: `F3.2`, `F3.5`, `E4.2`, `F3.28` and
`F3.32` unblock when the **umbrella** closes, not when `F3.1a` does. A row that
depends on `F3.1` depends on all five children.

### 2. `widgetType` is a **closed** `z.enum` with a SQL `CHECK`, not a lookup table

**Ruled as drafted**, and it is deliberately the *opposite* of the last two
vocabulary rulings, so the reasoning is written out rather than asserted.

`AGENTS.md` §4.8 as **[ADR 0032](0032-alarm-severity-vocabulary.md)** rewrote it
gives the test: *"A vocabulary is only closed if the behaviour cannot be carried
as data. So before reaching for a `z.enum`, ask what the engine actually needs
to know, and whether that is one more column."*

Asked of a widget type, the answer is **a React component**. `bms.alarm_severities`
works because a level's whole behaviour is ordering and colour, and those are two
columns — `rank` and `tone` — so a level declared by an `INSERT` arrives sortable
and styled. A widget type declared by an `INSERT` arrives with a label, an icon
and a default size, and **nothing to draw it**. That is the `F4.43` failure
(*"a new category renders unstyled"*) arriving through the opposite door, and it
is worse: an unstyled badge is legible, an unrenderable widget is a hole in the
page — a blank rectangle that passes the foreign key, the API and the save, and
fails only in front of an operator, with nothing in the console, the log or the
network tab.

The roadmap test — *"Ask what the roadmap intends to add, not what the table
currently holds"* — was applied and does not change the answer. The roadmap does
intend to add widget types: `F3.28` wants the reference's gauge set, `F3.32`
wants process mimics, `F4.41` extracts `packages/ui`. **Every one of those
additions ships a component**, which is a code change, which is exactly §4.8's
definition of closed: *"one the business cannot extend without a code change
anyway."*

So: `widgetTypeSchema` is a `z.enum` in `packages/shared/src/contracts/`,
`bms.dashboard_widgets.widget_type` carries a
`dashboard_widgets_widget_type_check`, and the renderer dispatch is an
**exhaustive `switch`** — the one place in this repository where §4.8's closed
branch is the right answer since ADR 0031.

**The catalog metadata is a separate question and gets a separate answer.**
Label, icon, default size, and how many point references a type accepts are
data, and they belong in a **frontend registry keyed by the enum**
(`apps/web/src/lib/widget-catalog.ts`), not in a table. This is the `tone`
precedent applied one level up: ADR 0031 and ADR 0032 both keep the
*presentation* half closed with a `CHECK` while opening the vocabulary, because
presentation is owned by the frontend and a value outside its palette renders
nothing. Here the whole vocabulary is presentation.

**One shared palette, not one per organization.** A table-backed catalog would
buy something real — a platform administrator choosing which types each
organization sees, and renaming them per tenant — and it was offered and
declined. No row on the board asks for it, and ADR 0031 and ADR 0032 are the
standing precedent that opening a closed vocabulary later is one forward
migration. Choosing the enum now does not lock that door.

**What the closed vocabulary does *not* restrict.** Recorded because "closed"
reads as "rigid product" and this one is not. An organization administrator, with
no developer and no deploy, can:

- place as many widget **instances** as they want, on as many dashboards as
  they want;
- pick any of the four types for each one;
- bind any point their organization can see;
- set the gauge minimum, maximum and thresholds, the tank's full-scale value,
  the chart's series and window, and every title, unit and colour;
- size each tile and arrange the grid;
- scope a dashboard to a location or an asset group.

The vocabulary restricts exactly one act: declaring a *kind* nobody has written
code for. That act is a release under every option considered, and decision 4 is
what reduces how often it is needed.

**The trap this decision must not walk into** is the mirror of `F4.46`'s. An
open vocabulary invalidates every closed list that reads it; a closed one
invalidates nothing, but it costs a forward-only migration per widget type
added. Both prices were compared and the migration is the cheaper one, because
the component that migration accompanies is a week of work and the migration is
an hour of it. Record it here so the next agent does not re-litigate it: **the
cost is known and accepted, not overlooked.**

### 3. A dashboard is three relational tables, not one `layout jsonb`

**Ruled as drafted, with the count corrected to three** — the third table is
what makes a point binding an actual foreign key, and the draft's "two tables"
undersold the decision it was making.

- **`bms.dashboards`** — identity, ownership, scope, slug, timestamps.
- **`bms.dashboard_widgets`** — one row per widget: `widget_type`, grid position
  and size, and a bounded `config jsonb`.
- **`bms.dashboard_widget_points`** — `widget_id` and `point_id` as foreign
  keys, plus `role` and `sort_order` for widgets that bind more than one series.

The alternative, a single `layout jsonb` column, is rejected for the reason ADR
0019 rejected the guessed content shape: **a point key inside a JSON blob is
not a foreign key, and nothing tells you when it is orphaned.** ADR 0019 had to
build a bespoke cross-check (*"Every referenced point key must be one the
template declares — checked on create, update and publish, because `content` and
`points` are patched independently and a points patch can orphan content the
request never mentioned"*), and that check exists precisely because `content` is
`jsonb`. A dashboard binds live `bms.asset_points`, which are deleted by
ordinary master-data operations, so the same defect here is not an authoring
inconvenience but a broken page in front of an operator. A middle option — a
widget row whose point ids sit inside its `config` — was offered and declined
for keeping the half that does not protect the operator.

Per-widget presentation options that the *renderer alone* consumes — a gauge's
minimum and maximum, a tank's fill colour, the chart's series type — stay in the
bounded `config jsonb`, contracted per widget type by a discriminated union in
`packages/shared/src/contracts/`. Point **references** are rows and foreign
keys; **options** are JSON. The line is whether anything but the renderer reads
it.

`F3.1a` settles the columns. This ADR settles that they are columns.

### 4. Three specific widget types and one generic chart

**Widened from the draft at the owner's ruling.** The draft named four specific
types. The set is now:

| Type | Shape |
|---|---|
| `radial_gauge` | Specific. ECharts ships a `gauge` series, so this is configuration rather than drawing. |
| `tank_level` | Specific. SVG fill illustration plus a percentage, like `live-svg/` already is. |
| `value_tile` | Specific. Value and unit, the `kpi-tile.tsx` shape. |
| `chart` | **Generic.** One component whose `config` selects the series — line, area, bar or scatter — from ECharts. |

The first three come from `docs/BACKLOG.md` §7's *Key Parameters* strip
verbatim. The fourth replaces §7's "24-hour area chart", which becomes the
generic type's default configuration rather than its own kind.

**Why the fourth is generic and the other three are not.** A new *kind* is
always a release, because a kind is a component. The only lever against the
release rate is to let one component absorb several asks, and ECharts renders
line, area, bar and scatter from the same component with a different series
option. So *"we want bars"* becomes five minutes of an administrator's time
rather than a backlog row, a component, a migration and a deploy. The radial
gauge is not merged into it despite also being an ECharts series, because its
configuration surface — minimum, maximum, thresholds, bands — is disjoint from a
cartesian chart's, and merging them would produce one form with two unrelated
halves in front of a non-programmer.

**The builder shows plain labels, not ECharts series names.** An organization
administrator picks *Trend*, *Comparison bars*, *Scatter*; the mapping to
ECharts lives in `widget-catalog.ts`. This is the same line decision 2 draws —
the vocabulary is presentation, and the presentation is the frontend's.

A fifth type is a new row, not a widening of `F3.1c`. This is stated because
`F3.28` already lists further widget types and would otherwise be absorbed here
by drift.

**Board correction, raised not fixed:** `F3.28`'s row says the radial gauge and
tank level are widgets *"which neither `F3.1` nor `F4.41` names"*. That was true
when it was written on 2026-08-16 and is false now — `F3.1`'s own row names all
three. The sentence belongs in the `chore(agents):` sweep, not in a feature
commit.

### 5. Every new table is tenant-scoped from the first migration

**Inherited, not ruled.** This was not put to the owner as a choice, because it
is not one: [ADR 0043](0043-multi-tenant-architecture.md) and
[ADR 0045](0045-non-superuser-table-owner.md) already mandate it.

All three tables carry `organization_id uuid NOT NULL REFERENCES
bms.organizations(id)`, RLS enabled, `FORCE ROW LEVEL SECURITY`, and the policy
written in the same migration that creates the table — with reads defaulting to
`withTenant` and any `fleetDb` read carrying a named reason at the call site
(ADR 0043 Amendment 3).

Retrofitting is not an option to weigh: `E7.1b` is the recorded cost of it —
migration `0046` backfilled the columns and `0047` set them `NOT NULL` across
the existing schema. A new table added after ADR 0043 that arrives without a
tenant column is a defect on the day it lands.

`F3.1b` owns the write matrix placement (ADR 0017) and the audit stamping,
which `E7.1c` established at 17 direct `insert(auditLog)` sites and 38
`MasterDataAuditService.write` call sites.

### 6. What `F3.1` does **not** cover

**Ruled as drafted.** Named here because this is greenfield, and greenfield
absorbs adjacent rows.

- **`F3.28`** — parity with the client reference layout: the alarms rail, KPI
  period-delta, breach value composed into alarm text, the status legend, the
  per-class health strip, the Diagram/List toggle. `F3.28` depends on `F3.1`
  and `F3.6`; it is not part of it.
- **`F3.32`** — the plant/network mimic builder. `F3.1` composes *widgets*;
  `F3.32` asks for configurable process diagrams and possibly a drawing
  surface, and its own row records that the scope question is unsettled.
- **`F3.2`** — per-asset-type default dashboards instantiated from a template.
  `F3.1e` opens the template *contract* to widgets and gives it a tab; turning
  a template's dashboard into a live one is `F3.2`. **Folding it in was offered
  and declined**: it would add 3–4 weeks to `F3.1e`, pull a Wave 2 P1 row into a
  Wave 1 item, and spend `F3.2`'s own §10 gate inside this one.
- **`F4.41`** — the `packages/ui` extraction. `F3.1c`'s renderers live in
  `apps/web/src/components/` like every other component until `F4.41` moves
  them. **Building them in `packages/ui` from the start was offered and
  declined**: it starts a row that carries no Wave cell because a scope decision
  created it rather than a schedule, and it needs a new vitest project, a
  coverage-denominator change and ADR 0042's jsdom setup ported.
- **The dark canvas.** `docs/BACKLOG.md` §5's *Reference layout language* ⚠ is
  an open owner decision and this ADR does not touch it. **`F3.1` ships in the
  existing light palette** — `TRINETRA.html:12`'s `--bg:#F2F4F7` — and that §5
  row already records that the reference's *component vocabulary* is achievable
  in the light palette, so nothing here is blocked by it.

## Dependencies

**None, and this was checked rather than assumed.** All four widget renderers
are buildable with what `apps/web` already carries. The chart library is
**ECharts** (`echarts` ^5.6.0 + `echarts-for-react` ^3.0.2), not Recharts —
`load-trend-chart.tsx:1` imports `EChartsOption`, and every chart in the
repository goes through `ReactECharts`. That is what makes decision 4's generic
type cheap: line, area, bar and scatter are one component and a series option,
and ECharts ships a `gauge` series natively, so the radial gauge is
configuration rather than drawing. The tank level is SVG, like `live-svg/`
already is. The value tile is `kpi-tile.tsx`.

`F3.1d`'s builder surface is the one place a dependency is plausible: a
drag-and-drop or grid-layout library. **It is not proposed here.** If `F3.1d`
concludes it needs one, that is §9.4-gated and takes its own ADR, on the ADR
0042 precedent (four test-only devDependencies, ruled mid-build rather than
assumed at the start). Note ADR 0042 Amendment 1 as the reason to check the
Node floor: `jsdom@30` required Node 22 on a Node 20 repository and CI, not the
local machine, is what caught it.

## Consequences

- **`AGENTS.md` §6's `dashboards` bullet softens, and the closed-content list
  drops from three to two** (`health` → `E1.1`, `optimisation` → `E1.6`
  remain). This is a real §6 edit — worth saying, because the last nine
  promotion sweeps searched §6 and correctly found nothing to soften, and an
  agent who has read those rows may expect a tenth. This one has work.
- **A new `AGENTS.md` §2 row** for the dashboard builder, spanning
  `packages/db`, `packages/shared`, `apps/api` and `apps/web`, on the *API
  contracts* row's precedent (ADR 0030's sweep chose a dedicated row over
  sentences bolted onto *Frontend* for exactly this multi-package reason).
- **`AGENTS.md` §4.8 gains its first worked example of the *closed* answer
  reached through ADR 0032's test.** Every §4.8 example since ADR 0031 moves a
  vocabulary from closed to open; a reader could reasonably conclude that open
  is the destination and closed is the mistake. Decision 2 is the counterexample
  and §4.8 should carry it, or the next vocabulary decision inherits a bias
  rather than a test. The sentence worth adding is the discriminator: *ask
  whether the thing the engine needs is a column or a component.*
- **`AGENTS.md` §3** gains tree entries for the new modules.
- **[ADR 0019](0019-template-content-model.md) §3's tier table changes** —
  `dashboards` moves from *Anchored* (ordered point keys, cross-checked against
  declared points) to fully contracted. ADR 0019:140 anticipated this: *"when
  `F3.1` lands, `dashboards` moves up a tier."*
- **[ADR 0038](0038-template-authoring-ui.md) needs an amendment, not a test
  edit.** Its five-tab source scan is deliberate machinery. `F3.1e` must amend
  the ADR and change the scan to six in the same change, with the reason. An
  agent that edits `tests/adr-0038-template-authoring-ui.test.ts` to make a
  sixth tab pass has defeated the only thing holding the tab count.
- **`packages/shared/src/asset-template-content.ts:124`'s docblock becomes
  false** on `F3.1a` — it names `F3.1` as the owner of a vocabulary that will by
  then exist. Not `AGENTS.md`, so not §9.10-gated; it lands with the code.
- **The generic chart makes `config` the widest part of `F3.1a`.** A
  discriminated union whose `chart` variant carries a series selector is more
  contract work than four fixed shapes would have been, and §4.8's
  intersection/flattening rules apply to it. That cost was accepted knowingly in
  exchange for the release rate, and it is why `F3.1a` moved 3–4 → 4–5.
- **`docs/roadmap.md`** gains an `F3.1` section, mirrored per §10.
- **`docs/BACKLOG.md`**: the umbrella row plus five children, the effort moved
  to `15–20`, the §1 wave plan line, the §3 Mermaid `F31` node, and the `F3.28`
  sentence corrected under decision 4. ADR 0023's row states the convention —
  when an item flips, **three markers move** (§1 wave line, §3 Mermaid node,
  §1b slot) — so all three get checked per child rather than one assumed from
  another. `F3.1` appears in §1b slot 7, which needs the umbrella treatment too.
- **This ADR's follow-up list was built by grep, not from the draft.** Nine
  consecutive ADRs shipped an incomplete list, which `docs/BACKLOG.md` §5
  records as *"how these lists get written and not bad luck"*. The searches
  behind the list above: `dashboard`, `widget`, `F3.1` and `featured` across
  `AGENTS.md`, `docs/adr/`, `packages/shared/src/` and `docs/BACKLOG.md`. Run
  them again at sweep time rather than trusting this paragraph — the point of
  recording the method is that the *result* goes stale.
- **Per §10.1 this is ADR 0047 alone** — do not batch its sweep.
- **What this ADR deliberately leaves to `F3.1a`**: the column list, the grid
  coordinate system, whether a dashboard's scope is location or asset-group or
  both, and how a dashboard is addressed in a URL. Those are design decisions
  inside an approved boundary, not scope decisions, and pre-deciding them here
  would be inventing a schema before anything has to consume it — which is the
  mistake ADR 0019 was written to avoid.

---

## Amendment 1 — a dashboard's *scope* refuses deletion; its *bindings* cascade (2026-08-29)

**Accepted (2026-08-29).** Settles the one item `F3.1a` left owner-gated, raised
by the migration review as **L2**. **No schema change** — migration `0050`
already behaves this way, and this amendment makes the behaviour intentional and
written down rather than inherited from the SQL default.

### The question

`0050` is asymmetric. `dashboard_widget_points.point_id` and `.widget_id` and
`dashboard_widgets.dashboard_id` are `ON DELETE CASCADE`; `dashboards.location_id`
and `.asset_group_id` are `NO ACTION`. The migration header explains the cascade
and says nothing about the other half, so deleting a location that a dashboard is
scoped to raises a bare `23503` naming a constraint. The review asked whether
`ON DELETE SET NULL` should land in a `0051`, and `F3.1a` recorded that as the
likely answer.

### The ruling: keep `NO ACTION`, and fix the *message* in `F3.1b`

`SET NULL` was **rejected**, and the reason is worth more than the ruling. A
dashboard scoped to one site would survive the delete and silently become
**organization-wide** — built for one plant, now shown to every viewer in the
tenant, with nothing anywhere saying so. That is an audience widening without a
signal, which is the failure class [ADR 0046](0046-organization-scoped-audit-read.md)
and its three amendments exist to prevent. `ON DELETE CASCADE` was rejected too:
it destroys operator-authored dashboards with no warning and no undo.

**`NO ACTION` refuses the delete, and that is already the correct behaviour.**
Nothing is lost, nothing widens, and the operator is told to deal with the
dashboards first. What is wrong is only the *error*, and there is no endpoint to
improve yet — `apps/api/src` has no delete path for `bms.locations` or
`bms.asset_groups`, so nothing can reach this constraint today.

**Owed to `F3.1b`, or to whichever row lands master-data delete first:** refuse
with *"this location has 3 dashboards"* and a way to reach them, not `23503`.

### The asymmetry is principled, and this is the sentence the header lacked

The two halves are not the same act, which is why one answer does not fit both.

- **A point is one binding of many.** Retiring a sensor is ordinary master-data
  work, and `0050`'s header already rules that it must not be blocked by
  somebody else's dashboard: the widget loses a binding, and zero bindings is a
  state the schema can report where a stale JSON id could not.
- **A location or an asset group is the dashboard's *scope* — its identity, not
  one of its parts.** Deleting it does not leave a smaller dashboard; it leaves
  a dashboard whose audience is undefined. There is no correct silent answer, so
  the correct answer is to refuse and ask.

**The test, for the next foreign key on these tables:** does deleting the parent
leave the dashboard *smaller*, or leave it *pointing at nobody*? Cascade the
first. Refuse the second.

`organization_id` is `NO ACTION` on all three tables by the same reading and did
not need a separate ruling — deleting a tenant is not an act this system offers.

### Consequences

- **No `0051`.** `0050` cannot be edited now that it is on `main`, and it does
  not need to be. The cost of this ruling is that the *reason* lives here rather
  than in the migration header where a reader of `0050` will look first — which
  is why this amendment states the test explicitly.
- **`F3.1b` inherits one obligation**, recorded in its `docs/BACKLOG.md` row: a
  refusal that names the dashboards, not the constraint.
- **`F3.1c` inherits the one already in `0050`'s header** and unchanged by this:
  a widget whose bindings have reached zero renders *"no data bound"*, never a
  blank rectangle.

---

## Amendment 2 — cardinality is a validation rule, and publishing to the whole tenant is an organization-level act (2026-08-29)

**Accepted (2026-08-29).** Settles four items raised at `F3.1b`/`F3.1c`
planning, **before either row's first commit**. **No schema change.** Two narrow
a sentence of decision 2 and decision 4. The third records a rule that was never
written down anywhere and would otherwise have been decided by whichever agent
happened to write `canManageDashboard`. The fourth is a label.

### 1. Point cardinality moves into the contract; the rest of the catalog does not

Decision 2 reads: *"Label, icon, default size, and how many point references a
type accepts are data, and they belong in a frontend registry keyed by the
enum."* **Three of those four still do. Cardinality does not, and the reason is
the consumer rather than the data.** (The fifth catalog field, the
plain-label→ECharts series mapping, is decision 4's rather than decision 2's;
it stays in `widget-catalog.ts` and is not in question here.)

`F3.1b` must refuse a two-point radial gauge **on write** — `0050`'s header
already records why the database cannot: cardinality is a per-widget row count
and no row-level `CHECK` can see it. `apps/api` cannot import from `apps/web`.
So the number that decision 2 placed in `apps/web/src/lib/widget-catalog.ts` is
needed by a package that cannot reach it.

**The ruling: `WIDGET_POINT_CARDINALITY` lives in
`packages/shared/src/contracts/dashboard-builder.ts`, beside `MAX_WIDGET_POINTS`.**
`widget-catalog.ts` **imports** those numbers and restates none of them, keeping
label, icon, default size and the plain-label→ECharts series mapping local.

**The split line is now *validation rule versus presentation*, not *contract
versus catalog*.** That is the sentence decision 2 lacked. A cardinality is not
a matter of taste — a dashboard that violates it is refused, and both the write
path and the renderer have to agree about which dashboards exist.

Two alternatives were put to the owner and declined:

- **The API enforces only the global `MAX_WIDGET_POINTS`**, with per-type
  cardinality left to `F3.1d`'s builder UI. Declined: a direct API caller binds
  five points to a gauge, and `F3.1c`'s renderer has to survive a state the
  product says is impossible. A rule enforced only by the surface that happens
  to be convenient is not enforced.
- **`apps/api` keeps its own copy, with a source scan asserting agreement.**
  Declined: two sources of truth held together by a text scan. That is the shape
  of the false greens `F3.1a`'s review found four of, and it buys nothing the
  shared constant does not.

**`min` is an authoring rule and never a stored invariant**, and this must be
written down or a read path will enforce it. `dashboard_widget_points.point_id`
is `ON DELETE CASCADE`, so retiring a sensor can legitimately take a live gauge
to zero bindings. Amendment 1 already ruled that this state stays **readable**
and renders as *"no data bound"*. A read that refuses or hides a widget below
`min` turns a retired sensor into a missing dashboard.

### 2. An organization-wide dashboard may only be created by `admin` or `organization_admin`

`0050`'s header records the three scope cases: *"both NULL is organization-wide,
`location_id` set is a site dashboard, `asset_group_id` set is a plant-area
dashboard."* Nothing said **who may create the first kind**. A dashboard with no
scope column is visible to every user in the tenant, across every location.

**The ruling: `admin` and `organization_admin` only.** A `location_admin` and an
`asset_group_admin` still author freely **inside their own scope**, which they
always could; what is closed to them is the scopeless kind.

The obvious argument for the wider rule is real and was weighed: a site admin
who builds a good dashboard cannot share it with the other plants without asking
somebody, and across an organization with many sites that is a bottleneck.

**It was declined on the second cost, not the first.** An organization-wide
dashboard has **no scope column, and therefore no owner**. Once a site admin
creates one, nothing on the row records which site made it: no other admin can
be stopped from editing it, and it cannot later be revoked by scope, because
there is no scope to revoke by. The permission check is reversible; the
ownerless rows it produces are not. This is the audience-widening class that
[ADR 0046](0046-organization-scoped-audit-read.md) and Amendment 1 above both
turn on, reached through a third door.

**`F3.1b` owns the rule** in `AccessControlService.canManageDashboard`, and its
carrier is the assertion that a `location_admin` is refused an organization-wide
dashboard **inside its own organization** — the case a later refactor is most
likely to lose, because every other assertion about that role is about a foreign
organization.

**Read visibility is *not* narrowed by this and stays as decision 3 implies:** a
scoped user sees the organization-wide dashboards of their tenant. The
alternative — organization-wide dashboards visible only to unscoped users —
would make the third scope case useless and was declined.

### 3. `F3.1d` owes a *duplicate* action

Ruling 2 removes a workflow, so it names the replacement rather than leaving the
gap for someone to close by widening the permission again. **`F3.1d`'s builder
surface owes a "duplicate this dashboard" action** that copies a dashboard into
a scope the caller may already write to.

That is how a site admin's good dashboard reaches other plants: each site admin
takes a copy into their own site, and promoting one to organization-wide stays
an act of the two organization-level roles. Every row keeps an owner, and no
permission widens.

### 4. The fourth series label

Decision 4 names three plain labels — *Trend*, *Comparison bars*, *Scatter* —
for **four** series kinds, because `line` and `area` both read as a trend. The
four labels are:

| Label an administrator picks | ECharts series |
|---|---|
| Trend | `line` |
| Trend (filled) | `line` + `areaStyle` |
| Comparison bars | `bar` |
| Scatter | `scatter` |

`area` is **not** an ECharts series type, which is exactly why decision 4 keeps
the mapping in one place: an author who could type the series name would type
the one that does not exist.

### Consequences

- **The seam lands before both children**, in the same change as this amendment:
  `WIDGET_POINT_CARDINALITY` plus its assertions. `F3.1b` and `F3.1c` are
  parallel-safe (decision 1's *"disjoint packages"*) **only once it is on
  `main`** — both consume it, and two branches inventing it is the drift this
  amendment exists to prevent.
- **`F3.1c` inherits "define no cardinality numbers locally"**, and
  `widget-catalog.ts`'s `points` field is an import.
- **`F3.1d` inherits the duplicate action** from ruling 3.
- **No schema change and no `0051`.** Ruling 2 is an application rule: `0050`
  permits both scope columns to be NULL and must keep doing so, because `admin`
  and `organization_admin` legitimately create such rows.
- **Ruling 1 creates an obligation on a surface that is already on `main`, and
  this amendment defers it rather than leaving it silent.**
  `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts:299`
  bounds a template dashboard widget at `pointKeys: z.array(pointKeyRef).min(1)
  .max(MAX_WIDGET_POINT_KEYS)`, and `templateWidgetIdentityFields` is spread
  into **all four** arms of `templateDashboardWidgetVariants`. So the template
  `radial_gauge` arm accepts **1..8** point keys, and an organization
  administrator can author, save and publish a template dashboard carrying an
  eight-point gauge today. This amendment's own standard is the argument
  against passing over it: *a rule enforced only by the surface that happens to
  be convenient is not enforced.* The template surface enforces the global cap
  only.
  **The obligation:** each arm takes `WIDGET_POINT_CARDINALITY[type]` rather
  than the shared bound. **It falls to whichever of `F3.1e` or `F3.2` lands
  first** — `F3.1e` opens this authoring surface and gives it a tab, `F3.2`
  instantiates a template dashboard into `bms.dashboard_widgets` and is where a
  gauge with eight bindings would otherwise be created or refused.
  **And the deferral has to carry a second question, not only the rule.**
  `asset_templates.content` already stores whatever has been authored, so
  tightening an arm later reddens the author's *next* update or publish of an
  existing template rather than the write that created it. Whichever row takes
  this must decide what happens to content already saved — migrate it, refuse
  it at the next publish with a message naming the widget, or grandfather it —
  and record that answer. Tightening the arm and discovering the consequence
  from a support ticket is the failure mode here.
  Nothing misbehaves today: no code reads or writes the three tables until
  `F3.1b`/`F3.1c`, which is why `F3.1a` closed with API and browser marked N/A.
