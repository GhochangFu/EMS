# ADR 0049 — Section dashboard templates: a second template table, a role on the membership, and a stock catalog outside the tenant

## Status

**Accepted** — 2026-08-30, by the repository owner, at the `F3.36` §10 gate and
**before any implementation code**.

Six decisions were put one at a time, each with alternatives and a
recommendation. All six were ruled as recommended. **Two of them declined a
markedly cheaper option**, and both are recorded with the reason rather than the
preference, because the cheap option will look attractive again to the next
reader.

**This ADR creates two rows**, on the ADR 0047 precedent where one gate produced
`F3.1a`–`F3.1e`:

- **`F3.36`** — section dashboard templates.
- **`F3.37`** — the asset role vocabulary, split out because it is master data
  that three rows want, not a dashboard concern.

Both enter the board on this acceptance: `F3.36` as `🟡`, `F3.37` as `🟡`. Never
`🔵` — `docs/BACKLOG.md` uses `🟡` for ADR/planned and no row in this repository
has ever been marked `🔵`.

## Context

The owner raised this on 2026-08-30: administrators compose dashboards **and
dashboard templates** for **sections** — Sheet 02's six domain instances,
Electrical · Water · STP · ETP · HVAC · Sustainability — and the system ships
default templates that are easy to modify and publish.
`docs/ion-exchange-nexus-dashboard-2026-08-29.html` Sheet 02 states the design
claim: each domain screen is *"the same canvas bound to a different asset
group"*, and *"adding a seventh is configuration, not a release."*

### Most of this exists, and must be reused rather than reinvented

`bms.asset_templates` already carries `code` + `version`, `status` with
draft → published → archived, `published_at`/`archived_at`, publish-time
validation and `createDraftFrom` ([ADR 0019](0019-template-content-model.md),
[ADR 0038](0038-template-authoring-ui.md),
[ADR 0039](0039-template-version-lifecycle.md)). Its `content.dashboards` is
already `Record<viewName, TemplateDashboardView>` — named views of
grid-positioned widgets with their configs. `F3.1e` gave it the sixth authoring
tab; `F3.1d` shipped the copy action that is the natural instantiate gesture;
`F3.2` will instantiate template content into `bms.dashboard_widgets`.

### The one fact that closes the cheap options

**A template widget references point *keys*, and a point key resolves against
one asset's points at instantiation.** A section dashboard spans many assets of
different types, so there is no single asset whose keys resolve. That is a
property of the content model, not a preference, and it is why an
`assetType: 'section'` row cannot work and why a `kind` discriminator would put
two incompatible binding shapes inside a table that has one meaning today.

### The second constraint: there is no free global row

`bms.dashboards.organization_id` is `NOT NULL` and every tenant table carries
`FORCE ROW LEVEL SECURITY` ([ADR 0043](0043-multi-tenant-architecture.md),
[ADR 0045](0045-non-superuser-table-owner.md)). `E7.1c` spent a row on what an
org-less row costs: it needs a superuser to seed, and a policy disjunct for
`NULL` is the containment hole ADR 0043 Amendment 5 had to close. Any design in
which a "system default" is a `NULL`-organization row re-opens that.

## Decision

### 1. A standalone `bms.dashboard_templates` table

Tenant-scoped from its creating migration per ADR 0043/0045, carrying the
`asset_templates` lifecycle columns — `code`, `version`, `status`,
`published_at`, `archived_at`, `content` — plus the section it belongs to.

**Ruled as recommended, and it declined the far cheaper option.** A `is_template`
flag plus a status on `bms.dashboards` would have reused the builder *and* the
duplicate dialog `F3.1d` already shipped, needing no new authoring surface at
all. It was declined **for versioning**: a published template and the dashboards
copied from it would drift with no record of which version a copy came from, and
`asset_templates` already solves that properly. Putting a section template
inside `asset_templates` was declined on the point-key fact above.

### 2. Full lifecycle parity with ADR 0039, including a version stamp on the instance

Draft → published → archived, `createDraftFrom` off a published version,
publish-time validation, and **every dashboard instantiated from a template
records the template version it came from**.

**Ruled as recommended over two narrower lifecycles** — versioned but
publish-only, and versioned-and-immutable. The version stamp is the point:
revising the Electrical template must not disturb the plants already running the
previous one, and without the stamp nobody can tell which those are.

**Drift between two lifecycles is the risk this creates, and it is answered with
an executable rule rather than a convention** — the shape this repository
already uses for `dashboard_widgets_grid_bounds_check`
(`tests/f3.1d-grid-bounds-single-source.test.ts`) and for the tab count
(ADR 0038). The status vocabulary and the legal transitions are declared **once**
and both tables read that declaration; a source scan fails a second copy. A
convention that the two "stay in step" is not a gate.

### 3. A stock catalog outside the tenant tables, imported per organization

The six defaults ship as repository data carrying no `organization_id`.
Provisioning, or an administrator on demand, **imports** one into a real
`bms.dashboard_templates` row the organization then owns and edits freely.

**Ruled as recommended.** Seeding six real rows per organization was declined
because improving a default would then reach only organizations provisioned
afterwards, and the seed and the defaults would drift apart. A nullable
`organization_id` with `NULL` meaning global was declined outright, on `E7.1c`
and ADR 0043 Amendment 5.

**An import records which stock version it came from**, the same discipline
decision 2 applies to an instantiated dashboard. **A plant onboarded later
receives the stock current at its import**, not whatever the first customer
edited — that is the property the stock catalog exists to provide, and it is
stated here so it is not lost to an implementation that copies from a peer
organization instead.

### 4. A section template's widget binds an **asset-group role plus a point key**

A widget says *"the incoming-supply meter's `kW`"*, never *"asset `7f3a`'s
`kW`"*. Instantiation resolves the role against the target asset group's members
and binds the matching point.

**Ruled as recommended.** Binding an **asset type** plus a point key was
declined because the widget count would not be known until instantiation, so a
template could not state its own grid layout — which is most of what a dashboard
template *is*. **Named slots the administrator maps at import** was declined as
manual work per plant, the opposite of a default that works on arrival; it stays
the fallback for a role that cannot be resolved (decision 6).

### 5. The role lives on `bms.asset_group_members`, as an **open** vocabulary

A `role` column on the membership, holding a **code into a lookup table** — not
a `z.enum` and not a `CHECK`.

**On the membership, not on the asset.** A transformer is "the incoming supply"
**of** the electrical group; the same pump is the raw-water pump in the water
group and a monitored load in the electrical one. A column on `bms.assets` would
assert one role everywhere and break on the mock's own STP and ETP trains, which
share equipment classes. Deriving it from `assets.template_id` was declined on a
sharper case: `template_id` says what an asset **is**, not what part it
**plays**, and two identical pumps from one template fill different roles in one
train.

**Open, not closed, and §4.8's own test as ADR 0032 rewrote it is what decides
it.** Ask whether the behaviour can be carried as data. A widget type's
behaviour is a React component and a metric's is a SQL query (ADR 0047 decision
2, [ADR 0048](0048-dashboard-metric-catalog-and-table-widget.md) decision 1), so
both are closed. **A role's behaviour is "match this member" — which is the code
itself.** A role declared by an `INSERT` arrives fully functional, so it is a
lookup table, exactly as ADR 0031 and ADR 0032 ruled for rule categories and
alarm severities.

### 6. An unresolved role is a widget with no bindings, not a failed import

Importing a stock template into an organization that has no matching asset —
no STP, or an electrical group with nothing marked as the incoming supply —
**succeeds**, and the widgets whose roles did not resolve arrive with zero
bindings.

**Ruled by applying precedent rather than as a fresh choice, and flagged as such
so the owner can object.** ADR 0047 already decided this exact shape one level
down: `dashboard_widget_points.point_id` cascades, so retiring a sensor can take
a live gauge to zero bindings, and `WIDGET_POINT_CARDINALITY`'s `min` is *"an
authoring rule and never a stored invariant"* because a read path that refuses a
widget with too few bindings turns a retired sensor into a missing dashboard.
The same reasoning applies here: refusing the import would give a plant with
five of six sections nothing at all. `F3.1c` renders zero bindings as **"no data
bound"**, which is a state the schema can report (`count(*) = 0`) and a person
can fix.

**The unmapped widget is where decision 4's rejected option returns as a
fallback**: an administrator maps that one widget by hand, on a page that can
list exactly which ones need it.

## Dependencies

**None.** No npm package is added, so §9.4 opens no gate.

## Consequences

- **`F3.37` is split out and `F3.36` depends on it.** The role vocabulary is
  master data that three rows want: `F3.36` resolves templates through it,
  `F3.28`'s per-class health strip needs to know which asset is which part of a
  train, and `F3.32`'s mimic nodes must bind to a named position rather than a
  `uuid`. Carrying it inside `F3.36` was offered and declined — a master-data
  vocabulary designed inside a dashboard row gets shaped for one consumer, and
  the other two then work around it. **The cost accepted with that split is a
  serial dependency where there was none**: `F3.36` cannot start until `F3.37`
  lands.
- **`F3.37` can start before `F3.35` finishes.** It touches master data, not
  dashboards, and its own dependency (`bms.asset_groups`) shipped long ago.
- **Two migrations.** `F3.37` adds `bms.asset_group_members.role` and its lookup
  table; `F3.36` adds `bms.dashboard_templates`. Both forward-only and both
  tenant-scoped in the migration that creates them — ADR 0043/0045, with
  `E7.1b`'s `0046`/`0047` as the recorded cost of retrofitting.
- **A second authoring surface.** A section template is composed on the same
  canvas as a dashboard but binds roles rather than points, so the builder needs
  a mode or the templates need their own screen. That choice belongs to
  `F3.36`'s step-3 plan, not here.
- **The stock catalog is repository data reviewed like code.** Its format, and
  whether it lives as JSON beside `packages/db/src/phe-catalog.json` or as a
  non-tenant table, is `F3.36`'s to decide; this ADR fixes only that it is
  **outside the tenant tables** and **imported**, never seeded per organization
  and never a `NULL`-organization row.
- **`F3.2` is untouched.** That row is the per-asset-type axis and is fully
  specified. This is the section axis, and the two share only the idea of
  instantiation.
- **`AGENTS.md` and `docs/roadmap.md` follow-ups belong to a separate
  `chore(agents):` PR** (§9.10), after the rows close — never to this record and
  never to a feature branch. Targets: the status line, a §2 row for section
  templates, §4.8's open-vocabulary examples (the role is a third one reached
  through ADR 0032's test, beside rule categories and alarm severities), and a
  roadmap section. **Per §10.1 this is ADR 0049 alone** — do not batch its sweep.
- **This ADR's follow-up list was built by grep, not from the draft**, on the
  practice ADR 0047 recorded after its own first sweep missed a target the ADR
  itself named. Run the searches again at sweep time: `F3.36`, `F3.37`, `0049`,
  `asset_group_members`, `role`, `dashboard_templates`, across `AGENTS.md`,
  `docs/adr/`, `docs/roadmap.md` and `docs/BACKLOG.md`.
- **One decision here was ruled by precedent rather than by the owner**
  (decision 6, the unresolved role). It is marked in place. If the owner wants
  an import to refuse instead, that is an amendment and not a re-reading.
