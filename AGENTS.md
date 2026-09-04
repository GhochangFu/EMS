# AGENTS.md — TRINETRA Enterprise EMS (Ion Exchange line) (Part 2 / Phase 5 Location and Access + Onboarding & PHE Ingest)

> **Status:** ACTIVE — **SOW-driven backlog delivery** (`docs/BACKLOG.md`,
> Wave 0/1), running on the loop in `docs/build-operating-model.md`. Phase 5
> Sprint J/K/L/M/N Location and Access hardening remains open alongside it.
> Merged and in scope: the hierarchical master-data admin, the scoped AI
> onboarding wizard, and the PHE MQTT real-ingestion pilot (ADR 0007–0012);
> the Vitest gate (ADR 0014), asset templates and instantiation
> (ADR 0015), the ingest adapter framework **and its host, now the sole ingest
> entry point** (ADR 0016, §6 complete through commit 4), the
> operations write matrix (ADR 0017), the asset source-axis separation
> (ADR 0018), the template content model (ADR 0019), the audit read API
> (ADR 0021), onboarding credential capture off the chat transcript
> (ADR 0022), the telemetry continuous aggregates (**ADR 0023**), their
> compression and retention policies (**ADR 0024**), the conversion of every
> remaining rollup read onto them (**ADR 0025**), one shared CSV escaping
> rule for both exports (**ADR 0026** and its Amendments 1 and 2), the staleness
> gate in front of every
> derived status and rendered value in the web client (**ADR 0027**) and the
> provenance rule that decides which of those values is a reading at all
> (**ADR 0028**), and the OpenAPI document generated from the Zod schemas that
> validate each request (**ADR 0029**, with amendments for the refinements the
> conversion drops, for the docs being absent rather than guarded, and for
> `.strict()` on mutating bodies — whose Errata 1 records that the emitted
> document never changes, because a plain `z.object` already says
> `additionalProperties: false`), and the
> **response** contracts that are now schemas rather than types, validated at
> the web client's boundary (**ADR 0030**, with amendments for the conversion
> spike, for what building it changed, and for the real drift its validator
> found on its first run), and the separation of a rule's **concern** from its
> plant **domain**, with both vocabularies moved out of code into
> `bms.rule_categories` / `bms.asset_domains` (**ADR 0031** and its Amendment 1,
> `F4.45`; **seven** codes since `E5.2` seeded `mechanical` and `E5.3` seeded
> `facility` at `sort_order 70` through the same `asset-domains-seed.ts` rather
> than a migration, **ADR 0053** and **ADR 0054**), and the alarm **severity** ladder following them into
> `bms.alarm_severities` — carrying its own `rank` and `tone`, so a level the
> client asks for is an `INSERT` rather than a migration (**ADR 0032**,
> `F4.46`), and the alarm **enrichment** schema — root cause, corrective
> actions and a fourth open vocabulary, `bms.alarm_skills`, behind
> `GET`/`PUT /api/v1/alarms/:id/(details|enrichment)` (**ADR 0034**, `E2.1`),
> and a **fifth and sixth** reached through the same ADR 0032 test —
> `bms.asset_roles`, the part a member plays in its group (**ADR 0049**
> decision 5, `F3.37`; **28 codes** since migration `0060`, and editable at
> runtime through `POST`/`PATCH /api/v1/admin/vocabularies/asset-roles` gated to
> the global `admin` — **ADR 0051** decision 5, `F3.40`), and
> `bms.dashboard_sections`, the screen a template
> belongs to (**ADR 0049 Amendment 2** decision 5, `F3.36`); both are **global**
> rather than tenant-scoped, because a role or section code must mean the same
> thing in every organization for the stock catalog to resolve at all —
> and, since **ADR 0051** (`F3.38`, `F3.39`, `F3.42`), so is the **oldest**
> catalog of the three: migration `0057` dropped `bms.point_keys.organization_id`
> and made `code` globally unique, `0057`/`0058` hold both
> `asset_points.point_key` and `template_points.point_key` to it by foreign key,
> onboarding may extend it but never edit it (Amendment 1), `0059` revokes
> `UPDATE`/`DELETE` from `bms_tenant` so the grants say so too (Amendment 4),
> and since `F2.11` (Amendment 6, 2026-09-02) and `F2.12` (Amendment 7,
> 2026-09-03) it holds the **145 electrical class keys** of
> `docs/electrical-derived-taglist-v1.md`, six of them derived codes with
> `bms-calc-v1` formulas — 193 rows on a cold start, seeded from
> `ELECTRICAL_CLASS_POINT_KEYS` with no migration — and
> since `F2.13` (**ADR 0052**, 2026-09-02) an organization receives a class
> template by **importing it from a stock catalog** in `apps/api`, stamped
> `stock_code`/`stock_version` on `bms.asset_templates` by `0061`;
> all six electrical classes ship at v1 (`F2.12`), with alarms that carry a
> meaning and no number (**ADR 0019 Amendment 2**), and since `E5.1`
> (**ADR 0040**, 2026-09-03) the six water-treatment plant classes — STP, ETP,
> cooling tower, WTP, RO, softener — ship the same way, provisional from a
> derived tag list, with every alarm carrying a `philosophy` and the 98-code
> `WATER_CLASS_POINT_KEYS` filed under the `water` domain, and since `E5.2`
> (**ADR 0053**, 2026-09-03) six machine classes — pump set, VFD, air
> compressor, chiller, AHU, boiler — under two domains, `hvac` and the seeded
> `mechanical`, with the 107-code `MECHANICAL_CLASS_POINT_KEYS` /
> `HVAC_CLASS_POINT_KEYS` pair, and since `E5.3` (**ADR 0054**, 2026-09-04)
> nine building classes — lighting zone, fire alarm panel, access door,
> occupancy zone, parking level, indoor-air-quality node, BAS gateway, lift,
> escalator — under three domains, the newly seeded `facility`, `environment`
> (its first stock entry) and `mechanical`, with the 206-code
> `FACILITY_CLASS_POINT_KEYS` (91) / `ENVIRONMENT_CLASS_POINT_KEYS` (13) /
> `VERTICAL_TRANSPORT_CLASS_POINT_KEYS` (102) trio in a **second** vocabulary
> file, `packages/shared/src/facility-point-keys.ts`, because `constants.ts`
> stood at 927 lines against §4.5's 1000-line cap — and `bms.point_keys` at 604 —
> and the calculation formula DSL — a hand-rolled `bms-calc-v1`
> scalar-arithmetic grammar validating `template_points.formula`/
> `.formulaDialect` and `kpis[].expression`/`.dialect`
> (**ADR 0036**, `F2.3`), and the calc execution engine that evaluates it —
> a streaming host on `TelemetryBroadcastHub` and a self-scheduling
> `for (;;)` loop (never `setInterval`), writing derived values through a
> `computed` `asset_points` row created on demand, no audit-log entry per
> decision 10 (**ADR 0037**, `F2.4`) — whose frozen grammar was **reopened for
> cross-asset work on 2026-09-04**, ADR 0036 decision 7 repealed rather than
> narrowed, so a `bms-calc-v2` formula may aggregate over a site, domain or
> asset group *and* name another asset directly, may read a derived point, and
> pays for it with a topological ordering pass and cycle detection at both save
> and evaluation time (**ADR 0055**, accepted for `F2.9`, unblocking `F2.8`;
> **not yet implemented** — every guard it repeals is still in the code) — and
> the **template authoring UI** that
> finally gives all of the above a screen — six tabs over one template
> version, both authored-formula surfaces on a lazily loaded CodeMirror 6
> editor with a pure in-browser preview, and a published version that renders
> read-only (**ADR 0038** and its Amendments 1–4, `F2.5`), and the
> **template version lifecycle** that finally lets a published edit reach the
> assets built from the old version — an explicit, previewed and audited
> re-pin of `assets.template_id` that refuses rather than reconciles a
> `measured` removal, re-key or domain change, plus per-asset calc overrides
> resolved as `coalesce(asset_points.<col>, template_points.<col>)` per column
> (**ADR 0039**, amending ADR 0015's identity invariant and ADR 0037
> decision 4, `F2.6`), and the **MQTT fleet** — ADR 0007 decision 4's one-RTU
> limit superseded by five RTUs *measured* publishing readable values, with
> `bms.rtus.ingest_enabled` asserted once by the seed and owned by the operator
> thereafter (**ADR 0007 Amendment 1**, `F1.7`), and the **notification
> service** — one `NotificationTransport` seam with log, email and webhook
> implementations, dispatched inline and fire-and-forget with no queue and no
> Redis, a delivery row written for every attempt *including the ones that send
> nothing*, an egress guard in front of every webhook, and the channel admin
> screens shipping inside the row rather than after it (**ADR 0041**, `F3.8`),
> which brings `nodemailer` and a Mailpit `mail` Compose profile in under §9.4
> — and, ruled mid-build once that row found the repository could not render a
> component in a test at all, **component testing for `apps/web`**: jsdom and
> Testing Library, opt-in per file, with the coverage denominator deliberately
> unchanged (**ADR 0042** and its Amendment 1, which pins the Node floor), and
> **multi-tenant row-level security** — `bms.organizations` as the tenant
> boundary, `organization_id` and a `tenant_isolation` policy under `FORCE` on
> every decision-5 table, reads and writes routed through `withTenant`
> (`SET LOCAL app.current_organization` inside a transaction) or a
> named-reason `fleetDb`, and org-scoped notification channels and rule
> identity gated by `canManageNotificationChannel` (**ADR 0043** and its
> Amendments 1–6, `E7.1a`–`E7.1d` and `E7.1g`), with the `bms.audit_log` reader
> organization-scoped for `organization_admin`, which sees `actorEmail` but
> never the acting operator's `oidcSubject` — and a rule execution trace no
> longer naming its evaluator to anyone below `admin` (**ADR 0046** and its
> three amendments, `E7.1e`, `E7.1h` and `E8.6`) — real rather than theatre
> only because of
> two prerequisites landed beside it: an unprovisioned `admin` JWT claim now
> refuses outright instead of resolving unrestricted (**ADR 0044**), and the
> schema owner is no longer a superuser, so `FORCE ROW LEVEL SECURITY` actually
> binds it (**ADR 0045** and its three amendments, `F4.16`/`E7.1a`), and the
> **configurable dashboard vocabulary** — `radial_gauge`, `tank_level`,
> `value_tile`, one generic `chart` and, since **ADR 0048** (`F3.35`), `table`,
> declared as a `z.enum` and a `CHECK`
> rather than a lookup table, over four tenant-scoped tables
> (`bms.dashboards`, `bms.dashboard_widgets`, `bms.dashboard_widget_points`,
> `bms.dashboard_widget_sources`),
> which also opens ADR 0019's `dashboards` section past ordered point keys
> (**ADR 0047**, `F3.1a`). **A widget now binds one of two kinds** — a live
> `bms.asset_points` row, or a **named catalog entry** resolving to one number or
> to rows and declared columns — never both and never neither, because half of
> the client mock's numbers are not telemetry at all (an alarm count, a work-order
> count, a health roll-up). The catalog is a **second closed vocabulary**, closed
> by the same §4.8 test for a sharper reason: a widget type's behaviour is a React
> component and a catalog entry's is a **SQL query**, and no column holds either.
> **All five children are built and the `F3.1` umbrella
> closed** (2026-08-30) — the schema (`F3.1a`), the read/write API (`F3.1b`), the
> four renderers (`F3.1c`), the template *Dashboards* tab (`F3.1e`) and the
> builder surface together with the read-only viewer route beside it (`F3.1d`,
> **ADR 0047** Amendment 4). A dashboard row now has a reader: `/dashboards`
> lists what a viewer may open and `/dashboards/:slug` lays the widgets on the
> grid and binds each to its points over the same telemetry socket the
> control-room pages already use. **No drag or grid library was gated** — the
> canvas runs on Pointer Events, so ADR 0047's one open §9.4 question closed as
> *not needed*.
> **The asset health score is in** (**ADR 0050** with Amendments 1, 2 and 3,
> `E1.3`, 2026-08-30) — a tag's share of samples inside every published threshold
> rule, materialized by a scheduled job into four counter relations, one per ADR
> 0023 level, and read as an asset score, a plant donut and an enterprise donut.
> `bms-calc-v1` is untouched: aggregation resolves outside the formula. Two
> things a reader should know before trusting a number it shows. **An unruled
> tag is excluded, never scored 1.0**, so a low `scoredTags` count is the honest
> answer and not a fault. **That sentence used to end "and on the shipped seed
> data *every* tag is unruled", and it no longer does** (2026-08-31):
> `packages/db/src/ruled-point-catalog-seed.ts` writes a `bms.asset_points` row
> for each of the 239 points a published threshold rule names, and the simulator
> writes to them again — it had written nothing since migration `0047` until
> `F4.73` gave it a tenant context. Measured on merge: 239 counter pairs where
> there had been one. **`F4.69` is closed** — it shipped in PR #237 and was
> recorded closed in #243, alongside `F4.74`. This paragraph still called it open
> until the `F4.72` sweep re-read it; that is a live-claim correction rather than
> a promotion.
> **Amendment 2 (2026-08-31) rules the read, and `F4.72` built it the same day**
> (PR #246): both responses now carry `coveredBuckets` and `expectedBuckets`, on
> the shared `windowFields` block, because `computedAt` is the *newest* instant
> read and so cannot disclose a hole in the middle of a window. Two integers and
> never a ratio, and coverage counts buckets **across the scope, never per tag** —
> one sweep pass writes every ruled tag in a bucket, so a per-tag count reports an
> idle sensor as a roll-up outage. The other half of Amendment 2 is settled the
> other way: **the read is not clamped to the sweep's trailing window**, because
> the counter tables carry no retention and a clamp collapses at `1h` and `1d`.
> **Amendment 3 is the one to read before touching either window.** `F4.72`'s own
> review found that `complete` was structurally unreachable: `alignedWindow` ends
> the sweep at the newest COMPLETE bucket (decision 5), while the read ended at
> `now` and `bucket < to` then admitted the in-flight bucket the writer is
> forbidden to write. `coveredBuckets` could never equal `expectedBuckets` at any
> rung, so the partial-window banner would have been permanently on for every
> healthy deployment. **The read now floors its `to` with `floorToBucket`, which
> lives in `point-aggregate-window.ts` and is the writer's rule too** — do not
> add a second copy, because two copies of a boundary rule is exactly how a
> writer and a reader come to disagree about which bucket is the newest. `levelFor`
> is still chosen from the *unaligned* window, so the retention guard is unchanged
> and this is not a second ladder. One consequence worth knowing: **`windowTo` is
> no longer `now`**, so a consumer comparing it against its own clock sees a lag
> of up to one bucket. And **`health` is the fourth of ADR 0019's five content
> tiers to reopen**; only `optimisation` is still closed.
> **Section dashboard templates are in** (**ADR 0049** with Amendments 1 and 2,
> `F3.37` 2026-08-30 and `F3.36` 2026-09-01) — a **second** template table,
> `bms.dashboard_templates`, tenant-scoped from migration `0056`, running ADR
> 0039's lifecycle: draft → published → archived, `createDraftFrom`, publish-time
> validation. A template flag on `bms.dashboards` would have reused the builder
> and the duplicate dialog and was declined **for versioning**; putting it inside
> `asset_templates` was declined on a fact rather than a preference — a template
> widget references point *keys*, and a point key resolves against ONE asset's
> points, so a canvas spanning many assets of different types has no single asset
> whose keys resolve. **A widget therefore binds an asset-group ROLE plus a point
> key**, never an asset id: `bms.asset_group_members.role` into the global
> `bms.asset_roles` (`F3.37`, migration `0051`; `F3.40`, migration `0060`), on
> the membership and not on the asset, because the same pump is the raw-water
> pump in one group and a monitored load in another. **That vocabulary is no
> longer release-bound**: `0051`'s 26 codes named a substation train and named
> none of the shapes the estate holds, so `0060` added `meter` and `pump` and
> `F3.40` added the write path that stops the next shape needing a migration at
> all. Retirement is `PATCH { active: false }` and never a `DELETE` — the
> junction's foreign key carries no `ON DELETE` by design. **Seven** defaults ship as a **stock catalog in the repository**,
> imported per organization and never seeded — improving a default must reach
> plants provisioned earlier, and a `NULL`-organization row is the containment
> hole ADR 0043 Amendment 5 closed. **The catalog is keyed by section × plant
> shape, not section alone** (ADR 0051 decision 6, `F3.41` 2026-09-02): two
> entries share the `electrical` section, because a 100 kVA substation and a
> village pumping station are different trains and not different clients. A new
> shape is a catalog entry, never a per-tenant fork. **Instantiation never succeeds silently**
> (Amendment 2): it returns a per-widget report — `bound`, `truncated`, `partial`
> or `unresolved`, with `matchedMembers` and `boundPoints` — and an unresolved
> role is a widget with zero bindings, never a failed import, so a plant with
> five of six sections still gets five. **Two migrations, two different rulings,
> and the pair is the thing to read**: `bms.dashboard_templates` is tenant-scoped,
> while `bms.asset_roles` and `bms.dashboard_sections` are **global** — a stock
> catalog only works if a role code and a section code mean the same thing in
> every organization (Amendment 1 decision 2b, Amendment 2 decision 5).
> `bms.dashboard_sections` is deliberately **not** `bms.asset_domains`: extending
> that vocabulary was the recommendation and the owner declined it, so no
> plant-domain picker moved, at the accepted cost that the two overlap and will
> drift.
> General
> site-wide AI copilot, EMQX, and the **non-MQTT**
> protocol adapters remain deferred — the framework, the host and the MQTT
> adapter are promoted; each further protocol still needs its own ADR (§9.4).
> **Product brand:** TRINETRA. Powered by Euphoria Infotech India Limited.
> **Product line:** Enterprise EMS for Ion Exchange (India) Ltd. per
> **ADR 0013** — forked from the Eskom SMOC engagement (earlier branding:
> Eskom SMOC / InfraPulse). Eskom-era internal identifiers, seed demo data,
> and the `ESKOM_SMOC.html` mockups are intentionally retained; the pending
> SOW-driven scope is tracked in `docs/BACKLOG.md`.
> **North star:** see `docs/AGENTS.production.md` for the full production
> rules we will promote from as the system grows.
> **Recent scope changes:** see `docs/adr/` and `git log`. ADRs are the live
> record of what is in scope; where this file conflicts with a newer ADR, the
> **ADR is authoritative** and this file is the thing to fix. Scope moves via
> §10, and edits here move via a `chore(agents):` PR (§9.10) — which is why
> this file lags and the ADRs do not.

This file is the rulebook humans and AI agents must follow **right now**.
The seven-screen prototype is complete. Phase 1 Sprint A added
container foundations and CI. Sprint B added Redis-backed Socket.IO
fan-out. Sprint C added Keycloak/OIDC authentication for the web app and
protected API routes. Sprint D added an optional observability baseline
for local/pilot diagnostics. Phase 2 Sprint 0 selected Path B because no
real device/source information is available yet. Real protocol adapters
and brokers remain out of scope until a future Phase 2 implementation
sprint promotes one confirmed source/protocol. Phase 5 Sprint A added the
work order foundation: schema, seed/demo data, and protected API endpoints
for listing, creating, and transitioning work orders. Phase 5 Sprint B
added the web UI for operators to create, track, reorder, and close work
orders. Phase 5 Sprint C added maintenance schedule templates, recurring
schedules, asset-linked history, and conversion into work orders from a
dedicated Schedule Centre companion screen. Phase 5 Sprint D added the
basic rule engine: simple threshold/time-window rules, execution history,
and enable/disable UI without a complex visual builder. Phase 5 Sprint E
added Energy report previews plus CSV export only. Phase 5 Sprint F report
storage is skipped for now and can be revisited later. Phase 5 Sprint G
added the first 2D IBMS Control Room foundation screens: CR Main Dashboard,
CR Electrical SLD, and CR IT & Rack Load. Phase 5 Sprint H added a guided
IF/THEN visual rule builder for the existing simple
threshold/time-window rule model. The Phase 5 Control Room extension added
the previously deferred UPS Monitoring, Battery Bank, HVAC System,
Environment, and CR Dashboard integration screens before Sprint I.
Phase 5 Sprint I aligned completed pages to the `ESKOM_SMOC.html` shell,
headers, cards, status pills, disabled command affordances, and demo flow
without changing backend contracts. The later Location and Access work
introduced canonical locations, scoped users, location dashboards,
asset-group UI guards, focused simulator settings, telemetry dashboard
indexing, and shell/sidebar refinements. Phase 5 Sprint J/K/L/M/N is now
open for focused Location and Access hardening, demo inventory cleanup,
clean migration/seed verification, Keycloak checks, automated access tests,
and role-walkthrough hardening.

Beyond the Location and Access sprint, three feature streams have since been
merged to `main` and are in scope. The **hierarchical master-data admin**
(ADR 0008–0010) introduced the `Organization → Location → RTU → Asset → Point
Key` catalog with scoped `admin`, `organization_admin`, and `location_admin`
roles and CRUD screens under `/admin/*`. The **scoped AI onboarding wizard**
(ADR 0011) adds an admin-only conversational ingestion flow backed by OpenAI
chat completions with a deterministic rule-based fallback. The **PHE MQTT
real-ingestion pilot** (ADR 0007, 0012) added `apps/ingest`, an MQTT TLS
subscriber for West Bengal PHE pump houses, plus AES-256-GCM encrypted RTU
connection credentials. **ADR 0007 Amendment 1 (accepted 2026-08-22, `F1.7`)
superseded decision 4's one-RTU limit: live ingest now covers five of the twelve
catalogued RTUs**, measured rather than chosen. These promotions are partial and scoped: general
site-wide AI copilot, EMQX, and non-MQTT protocol adapters remain out of scope.

---

## 1. Goal

The prototype has completed the seven-screen end-to-end pipeline:

`simulated device → Postgres/Timescale → NestJS API → WebSocket → React UI → user`

The current planning direction is:

1. Keep the simulator as the active source until real access is available.
2. Treat Phase 5 Sprint A work order foundation as complete.
3. Treat Phase 5 Sprint B work order UI as complete.
4. Treat Phase 5 Sprint C Maintenance Schedule Centre as complete.
5. Treat Phase 5 Sprint D basic rule engine as complete.
6. Treat Phase 5 Sprint E Energy report previews and CSV export as
   complete.
7. Skip Phase 5 Sprint F report storage for now; revisit only if persisted
   report files/history are needed.
8. Treat Phase 5 Sprint G Control Room foundation as complete: 2D React
   screens backed by seeded assets, simulator telemetry, and rule-driven
   status where current data exists.
9. Treat Phase 5 Sprint H guided visual rule builder as complete without
   two-way commanding, free-form node graphs, schedulers, or real-ingestion
   rules.
10. Treat the Phase 5 Control Room extension as complete for CR UPS
   Monitoring, Battery Bank, HVAC System, Environment, and CR Dashboard
   integration.
11. Treat Phase 5 Sprint I completed-page UI/UX alignment as complete.
12. Treat Phase 5 Sprint J/K/L/M/N Location and Access hardening as open:
   keep the implemented migrations, scoped API/WebSocket reads, scoped UI
   guards, location dashboard work, simulator focus settings, telemetry
   index, and collapsible shell, and do not call the sprint complete until
   a clean migration/seed run, Keycloak realm verification, automated access
   tests, and page-wise role walkthrough are done.
13. Defer MinIO/object storage until persisted report files are actually
   needed.
14. Plan Phase 6 as Three.js Control Room only.
15. Keep general AI Copilot / chatbot out of scope for site navigation. The
   **scoped AI onboarding wizard** (admin ingestion only, ADR 0011) is merged
   to `main` and in scope.
16. Treat the **hierarchical master-data admin** (ADR 0008–0010) as in scope:
   Organization → Location → RTU → Asset CRUD under `/admin/*`
   with `admin`, `organization_admin`, and `location_admin` roles. Org-level
   read RBAC and hard deletes remain out of scope (deactivate/reactivate only).
   **The point-key catalog left that chain in ADR 0051 / migration `0057`** and
   is no longer a child of Organization: it is one fleet-wide list. Reads stay
   open to the master-data role set; **every write is global `admin` only** —
   `PointKeysAdminService` gates all four mutations on `isGlobalAdmin` and
   throws *"The point key catalog is fleet-wide master data — only a global
   administrator may change it"*. The one exception is the onboarding commit
   path, which may *create* a code at `organization_admin` under ADR 0051
   Amendment 1, and may never edit one.
17. Treat the **PHE MQTT real-ingestion pilot** (ADR 0007, 0012) as in scope
   via `apps/ingest` for **the five RTUs named in
   `packages/db/src/ingest-enabled-set.ts`** — ADR 0007 Amendment 1 (2026-08-22,
   `F1.7`) superseded the one-RTU limit. **Widening that set is an owner
   decision, not an agent's**: it is a measurement about pump houses, and
   enabling a station that does not publish a readable value takes its assets
   from simulated to dead, because decision 5 makes `apps/sim` skip anything
   marked `telemetrySource='mqtt'`. Re-measure with
   `apps/ingest/scripts/fleet-probe.mjs` before proposing a change. EMQX and
   non-MQTT protocol adapters remain deferred; the simulator stays the source
   for all other assets.

The completed prototype screens are:

1. **Login** — simple JWT
2. **Executive Dashboard** — live KPIs + trend chart
3. **Alarm Centre** — live alarms + ack
4. **World Map** — Eskom stations + SMOC campuses on Leaflet
5. **Electrical SLD** — animated single-line diagram with live power flow
6. **CRAC / Cooling** — animated HVAC schematic, supply/return temps,
   chilled-water loop, fan speeds
7. **Energy Centre** — energy KPIs, source mix, peak demand, top
   consumers (charts only, no schematic)

Everything else from the mockup or production north star is out of scope
until the corresponding add-on phase begins (see §6).

Rationale for the seven-screen scope is captured in `docs/decisions.md`
entry **D-0001**.

---

## 2. Stack (active)

| Layer        | Technology |
|--------------|------------|
| Frontend     | React 18, TypeScript 5, Vite, Tailwind CSS, TanStack Query, Zustand, React Router, Leaflet, ECharts, and — since `F2.5` (ADR 0038 Amendment 2) — **CodeMirror 6** on the two authored-formula surfaces only. Five declared packages (`codemirror`, `@codemirror/{state,view,autocomplete,lint}`), composed from `minimalSetup` and never `basicSetup`, reached solely through `components/asset-templates/formula-editor-lazy.tsx` so the library ships in its own chunk. Measured: the entry chunk contains no CodeMirror at all, and `@codemirror/search` tree-shakes out of both chunks. `tests/adr-0038-formula-editor.test.ts` holds all of that statically — it is the only module allowed to import `codemirror` or `@codemirror/*`, in any import form. **Whether an asset is live is decided in exactly one place since `F4.37` (2026-08-14): `apps/web/src/lib/schematic-telemetry.ts`.** `FRESH_MS`, the arrival clamp and `isStale` live there, extracted from the context component so they can be tested at all — the context imports React, TanStack Query and socket.io-client, and `vitest.config.ts` only counts `apps/web/src/lib/**` toward coverage, so anything above it is untestable *and* invisible to the gate. Put new pure logic there, not in the component. **Freshness is computed at render, so it needs something to force one**: the provider's `staleTick` is the only periodic re-render in the app, and a `refetchInterval` is not a substitute — TanStack v5 tracks accessed properties and structurally shares results, so an unchanged response notifies nobody. **Since `F4.38` (2026-08-15, ADR 0027) the gate reaches everything on screen**, not just the SVG schematics: all seven control-room pages derive their tiles through `isStale`, a stale tile renders `—` rather than its last numbers, `offline` outranks `critical` in every page banner, and aggregates (`ctx.totalKw`, the KPI averages) exclude stale slices and show the count they excluded. Two rules follow for anyone adding to these pages. **Status renderers are `if`/ternary chains whose default is the healthy branch, so a new status member compiles silently and draws as `normal`** — test `offline` first in every chain; the compiler will not find them for you. And **read the clock at render**, taking the re-render from the provider's `staleTick`: a page that starts its own interval or caches the status re-freezes the tiles. `tests/repo-invariants.test.ts` holds both, plus the live-critical count that stops a dead sensor masking a live alarm. **`F4.39` (2026-08-15, ADR 0028) closed the assumption underneath all of this — that the thing on screen is a reading at all.** Every value on a control-room page is now one of: *measured* / *derived* (gated by ADR 0027), or *nameplate* / *configuration* / *simulated*, which render through `StaticValue` / `StaticTspan` (`components/static-value.tsx`) and are visibly marked `NP` / `SET` / `SIM`. The rule that decides which: **a value may be labelled a measurement of X only if it comes from telemetry that measures X** — `kVA` from `kW` and `pf` is fine, "Voltage Y" from Voltage R is not, and 32 cell voltages from one string voltage is not. Markers qualify *values*, not headings, hints or `x / y` denominators, whose form already says they are not readings. Three more traps this drew out: **each value takes the clock of the asset it came from** — `freshValue(own ?? fallback, ownStale)` reads naturally and is wrong, because the `??` resolves before the gate, so use `ownElse`; **absent is not zero** — `(fanSpeedPct ?? 0) > 20` renders a unit that publishes no fan speed as `IDLE`, which for a standby unit is its normal reading, so use `isHvacRunning`, which returns `null`; and a box holding a gated value must be able to **render offline**, or an em-dash inside a confident green outline is the only signal. Checks live in `tests/repo-invariants-provenance.test.ts`. **Since `F4.23` (2026-08-15, ADR 0030) every response this client reads is checked against a schema before any of the above sees it** — see the *API contracts* row and §4.8; a `fetch` in `src/api/` that does not go through `checkResponse` is the gap that row exists to close |
| Backend API  | NestJS (Node 20 LTS, TypeScript) |
| Realtime     | NestJS WebSocket gateway over Socket.IO with Redis adapter when `REDIS_URL` is set. The source is `LISTEN bms_telemetry` on a dedicated `pg` connection (`telemetry-notify.service.ts` → `telemetry-listener.ts`), fanned out through `TelemetryBroadcastHub`. **That listener supervises itself since `F4.34` (2026-08-14)** — error handler, reconnect with the ADR 0016 §5 backoff, and a re-`LISTEN` on every reconnect. Before it, the listener connected once with no `error` handler, and because `pg.Client` is an `EventEmitter` an unhandled `error` event **threw**: with no `uncaughtException` handler in `apps/api` and no `restart:` on the compose service, any dropped connection took the whole API down and left it down. Watch `bms_api_telemetry_listener_connected` on `/metrics` — 0 means realtime is dead while REST still serves. **`NOTIFY` has no replay**, so readings published during an outage never reach the live push; they are still in the hypertable, and clients recover history through `GET /telemetry/points/:pointRef/recent`. **The payload is validated since `F4.36` (2026-08-14)** — `telemetry-reading.schema.ts` checks every reading, drops the invalid ones individually and delivers the rest, because one `null` entry used to throw inside `AlarmThresholdService.collapseLatest` *before any rule ran* and silently suppress alarms for the whole batch. Watch `bms_api_telemetry_readings_dropped_total` beside the gauge: non-zero means something is publishing in a shape the contract does not allow, and `NOTIFY` needs **no table privilege**, so any role that can connect can write to that channel. It counts rejected *readings* — a broken envelope (non-JSON, `readings` not an array) is log-only. The payload is capped at 500 readings because validating is far dearer than the cast it replaced and the 8000-byte `NOTIFY` limit bounds bytes, not entries. **A future-dated `time` still passes validation here, deliberately, and that is not an oversight**: `resolveSamples` trusts `sample.at`, and the PHE pilot was measured writing 33 minutes ahead of `now()` (`F4.28`), so rejecting it server-side would delete real telemetry. Verified 2026-08-14 by publishing a reading 33 minutes ahead — accepted and broadcast, `dropped_total` unchanged. **The sink is what was fixed instead (`F4.37`, PR #39)**: the web client clamps on arrival, so a skewed producer costs at most `FRESH_MS` of delayed offline detection rather than pinning a dead asset `running` forever |
| Auth         | Keycloak/OIDC for pilot compose; local JWT fallback only for native WSL development |
| Observability | Optional Prometheus, Grafana, Loki, Promtail, and OpenTelemetry baseline |
| OLTP DB      | PostgreSQL 16 |
| Database roles | **Six, and which one a process connects as is a security decision, not a configuration detail** (**ADR 0043** decision 8 + Amendment 1, `F4.16`; **ADR 0045** and its Amendments 2–3, `E7.1a`). `bms_owner` owns both schemas and every table, view and sequence in them (`0042` moved the four continuous aggregates on to `bms_rollup`, below). It is deliberately **not** a superuser, because `FORCE ROW LEVEL SECURITY` binds a table's owner and **does not bind a superuser** — the `FORCE` clauses were decorative until `E7.1a` demoted the owner, and a superuser here makes every tenant policy in the repo a no-op with nothing failing to say so. `bms_app` survives as a **provisioning identity only**: `CREATE EXTENSION timescaledb`, `CREATE ROLE`, `ALTER ROLE … BYPASSRLS`, and replaying migration `0039:33` on a fresh database. It reaches the API through nothing: its connection string is `DATABASE_URL_SUPERUSER`, and **that variable** appears in exactly one compose service (`migrate`) and one `apps/api/src` file (the integration-test gate, which is not shipped). `tests/adr-0045-owner-and-superuser-url.test.ts` fails if either widens. The API itself never connects as an owner: `bms_tenant` (policy-filtered to `app.current_organization`), `bms_fleet` (`BYPASSRLS`, for reads that already carry their own scope filter) and `bms_auth` (the small unscoped set login needs before an organization is known). **`bms_rollup` owns the four ADR 0023 continuous aggregates and nothing else**, because `refresh_continuous_aggregate` requires *ownership* and no `GRANT` substitutes for it — a `SECURITY DEFINER` wrapper is impossible, TimescaleDB refuses to run it from a function. It holds `LOGIN` with **no password** (Timescale background workers connect as the job owner; without `LOGIN` all four refresh policies die with a `FATAL` that `job_errors` reports only generically). **`bms_owner` needs `LOGIN` for the same reason, and this is easy to miss:** `ALTER … OWNER TO` rewrites `_timescaledb_config.bgw_job.owner`, so ten of the twelve ADR 0024 compression and retention jobs moved off `bms_app` too (measured — ADR 0045 Amendment 3). Provision `bms_owner` without a password and raw compression and the 730-day retention stop, silently, for days. **The one privilege widening in ADR 0045 is its membership, and the clause is the whole boundary:** `GRANT bms_rollup TO bms_owner, bms_tenant, bms_fleet WITH INHERIT FALSE, SET TRUE`. `INHERIT FALSE` is not tidiness — PostgreSQL defaults an omitted `INHERIT` clause to the *member's* `rolinherit`, and a plain `GRANT` measurably let `bms_tenant` `DROP MATERIALIZED VIEW` with no `SET ROLE` at all. Write the clause on any future grant of it. Passwords live in the environment and in no committed file, so **`pnpm --filter @bms/db roles` runs *before* `pnpm db:migrate`** — it creates the roles the migrations then grant to. Tenancy *semantics* (what a tenant is, the `SET LOCAL`-in-a-transaction rule, `withTenant` vs `fleetDb`) are ADR 0043's and live in the *Tenancy* row below — this row is the role inventory only. |
| Tenancy | `bms.organizations` is the tenant (**ADR 0043** decision 1 — one row is one end customer of Ion Exchange; Ion Exchange itself holds the global `admin` role and is not a tenant). `F4.16`'s original five plus the ~14 more tables decision 5 names — **roughly nineteen `bms.*` tables in total** ("FORCE extends to the full set", `E7.1b`) — carry `organization_id` and a `tenant_isolation` policy under `FORCE` (decision 5, extended by `E7.1b`/`E7.1c`); the platform vocabulary tables (`asset_domains`, `rule_categories`, `alarm_severities`, `protocol_catalog`, `notification_channel_kinds`, `map_locations`) get neither, and **`telemetry.*` is a stated, permanent exception** (decision 9) — no `organization_id` column, no policy; isolation stays at the application layer through `readableAssetIds`, because a per-row join to `bms.assets` would collide with the ADR 0023/0024 aggregate and retention jobs, and revisiting it needs its own ADR. **The tenant is set with `SET LOCAL`, inside a transaction, once per request** (decision 10): `withTenant(db, organizationId, fn)` (`apps/api/src/database/tenant-context.ts`) opens a Drizzle transaction and issues `select set_config('app.current_organization', $1, true)` as a bind parameter, never a concatenated `SET LOCAL` — `DatabaseModule`'s pool reuses connections across requests, so a plain `SET` would leak one caller's tenant into the next. A read that cannot be wrapped in a transaction may not touch a tenant table. **`withTenant` is the default for a tenant-data table's reads; `fleetDb` needs a named reason at the call site** (Amendment 3) — a genuinely fleet-wide `admin` view under decision 12, or a master-data surface resolving across organizations ("it is how `F4.16` did it" is not a reason). A multi-organization actor on a `withTenant`-classified path falls back to `fleetDb` at run time and trusts the `WHERE` filter instead — ruled **against** the drafting recommendation to refuse, and pinned by a test so a future change to it is a decision, not a drift; today's deployment seeds exactly one such actor. **Amendment 5** role-scopes the `NULL`-organization branch of `0047`'s `WITH CHECK` `TO bms_fleet` on `bms.users`, `bms.audit_log` and `bms.notification_channels` (each has a legitimate fleet-managed `NULL`) and removes the branch outright on `bms.notification_deliveries`, which took `SET NOT NULL` instead — the blanket `bms_tenant` DML grant on `ALL TABLES IN SCHEMA bms` (`0039`) stands unchanged; the disjunct, not the grant, was the hole. See the *Database roles* row above for the `bms_tenant`/`bms_fleet`/`bms_auth` split this row assumes |
| Telemetry DB | TimescaleDB extension on the same Postgres |
| Telemetry aggregates | Four hierarchical continuous aggregates over `telemetry.point_values` — `point_values_1m` ← raw, `_5m` ← `_1m`, `_1h` ← `_5m`, `_1d` ← `_1h` (**ADR 0023**, `F4.1`, migration `0027`). **There is no `avg_value` column at any level and there must never be one**: `avg` does not compose, and building an hourly figure as `avg(avg_value)` over minute buckets was wrong in **151 of 169** buckets on real pilot data because samples per minute range 1–60. Store `sum_value`/`sample_count`/`min_value`/`max_value`; divide at read time. A total-level test does **not** catch the error — summed over the window both forms agree. **`timescaledb.materialized_only = false` is set explicitly on all four**, which on 2.29.1 is the *opposite* of the default: leave it and every live view's right edge silently disappears. Real-time aggregation has been deprecated upstream since 2.13, which is why the compose image is **pinned**. Reads go through `apps/api/src/telemetry/point-aggregates.ts`, never inline SQL — **all seven rollup reads are converted** (**ADR 0025**, `F4.28`): four in `dashboard.service.ts` (`loadTrend`, `energySummary`, `energySourceMix`, `energyTopConsumers`) and three in `reports.service.ts`. The raw reads in `map.service.ts`, `telemetry.service.ts` and `rules.service.ts` stay on raw **by decision** — they serve individual samples, which is what a hypertable is good at. **Level choice comes from `levelForRange`, never an inline ternary**, and it is keyed on how far *back* a range reaches, never on its duration: a duration-keyed selector sends a 24-hour range dated three years ago to `_1m`, which is dropped at 735 days and reads as **empty**. `end` plays no part — it is routinely in the future, both because `reports.service.ts` sets it to `endDate T23:59:59.999Z` and because the MQTT ingest writes ahead of `now()`. **Two guarantees here are static tests, not behavioural ones, and that is deliberate**: no behavioural test can catch a read reverting to `date_trunc` over raw, because every parity test compares against the raw query it replaced and a revert compares that query with itself (measured: a fully reverted `loadTrend` leaves the suite green); and no test can catch a missing `bucketHours` factor while every converted level makes it `1`. Both live in `tests/repo-invariants.test.ts` and `tests/adr-0025-level-selector.test.ts`. Backfill is `pnpm db:refresh-aggregates`, **not** a migration: `refresh_continuous_aggregate()` cannot run in a transaction and Drizzle's migrator wraps the run in one. **Compression and retention (ADR 0024, `F4.2`, migration `0028`):** raw compresses at 7 d and drops at **730 d**; `_1m`/`_5m` compress at 7 d and drop at **735 d**; `_1h`/`_1d` are **never dropped and not compressed** — after raw's 730 days they are the only record, at hourly resolution. The 735-vs-730 gap is an invariant, not rounding: `retention(aggregate)` must be **strictly greater** than its source's, because dropping an aggregate's old chunks leaves the watermark high, so that range reads as **empty** while raw still holds the rows — and **no refresh rebuilds it**. `pnpm db:refresh-aggregates` is therefore lower-bounded at **each level's own source's** oldest surviving chunk, never at raw's for all four: only `_1m` reads raw, and using raw's floor for the levels above it deletes `_1h`/`_1d` whenever raw's retention runs ahead of `_1m`'s |
| Migrations   | Drizzle ORM for tables; raw SQL for the Timescale hypertable **and its four continuous aggregates** (ADR 0016 predates them; ADR 0023 adds them). Drizzle cannot manage a continuous aggregate: it is `relkind = 'v'`, and declaring one with `.table()` makes `pnpm db:generate` emit `CREATE TABLE` for it. They are declared `.view().existing()` in `packages/db/src/schema/telemetry-schema.ts` so generate leaves them alone — verified by running it. Their **compression and retention policies** are raw SQL too (`0028`, ADR 0024) and *can* live in a migration: the `ALTER … SET (timescaledb.compress …)` and both `add_*_policy()` functions are transaction-safe, verified by `BEGIN`/`ROLLBACK` leaving zero jobs. Use `add_compression_policy`, **not** `add_columnstore_policy` — the newer name is a *procedure* needing `CALL`, which is not what drizzle emits. `0028` also opens with `SET LOCAL lock_timeout` and **resets it before ending**: the compress `ALTER` takes an ACCESS EXCLUSIVE lock on `point_values`, and drizzle wraps **the whole run** in one transaction, so an unreset `SET LOCAL` reaches every later migration in that run |
| Simulator    | Node script in `apps/sim` generating fake meter + sensor values. **It reads `bms.assets` inside a tenant context, once per organization** (`F4.73`, 2026-08-31) — `select set_config('app.current_organization', $1, true)` inside a transaction, a bind parameter, never a concatenated `SET LOCAL`, which is ADR 0043 decision 10's own mechanism rather than a departure from it. **Before that it read with no context**, and since migration `0047` policied the table it matched **zero rows rather than raising**: the process wrote no telemetry at all and reported `No assets in bms.assets — run pnpm db:seed`, the one remedy that could not help. Nothing failed — not `tsc`, not a test, not CI — which is why the gate is `tests/f4.73-simulator-tenant-context.test.ts` and why that gate is **static**: `apps/sim` is not a Vitest project, so the only behavioural proof is running it against a policied database. **Only the read needs a context**; the tick writes `telemetry.point_values`, which ADR 0043 decision 9 makes a permanent policy exception, and `bms.organizations` carries no policy because it is the tenant table. `SIM_ASSET_COUNT` caps **across** organizations — inside the per-tenant query it would silently mean N per tenant |
| Real ingestion | `apps/ingest` MQTT TLS subscriber for the PHE pilot; writes `telemetry.point_values` and `pg_notify('bms_telemetry', …)` like the simulator (ADR 0007). **Five RTUs since ADR 0007 Amendment 1** (2026-08-22, `F1.7`) — the set is `packages/db/src/ingest-enabled-set.ts`, measured not chosen, and the seed asserts it **once** then leaves `ingest_enabled` to the operator, stamping `rtus.meta.enabledSetVersion` to record that it did. **Enabling or disabling an RTU needs an ingest restart**: the reload swaps point mappings only, and MQTT groups a whole broker into one endpoint, so the "new endpoint" warning cannot fire for a device change — the host logs `endpoint device set changed; restart required to apply` instead. A payload is accepted only on the topic its device is bound to, so a station cannot publish another's `dev_id`. No EMQX. **One entry point since the ADR 0016 §6 strangler migration finished**: `pnpm start` → `node dist/main.js` is the adapter host, and it is what compose and the pilot run. Commit 3 cut the *deployment* over on 2026-08-06; **commit 4 on 2026-08-14 deleted `src/index.js`**, removed the compose `command:` override and the `start:host` script, so there is no longer a legacy path one line away — reverting means reverting the commit. The host needs a build before it runs and does **not** fall back to JavaScript if you skip it; the image compiles before `CMD`. **`pg_notify` is unconditional and `INGEST_NOTIFY` no longer exists** — do not add it back to `docker-compose.yml`, which a repo invariant now fails on: it would do nothing, because the flag is gone from the code. If dashboards are dead while ingest is healthy, the cause is downstream, not a missing compose line; watch `written=` on the health body, since `notify=on` there is a literal and reports intent rather than delivery. **The downstream half was `F4.34` and it is fixed (2026-08-14, PR #33)** — the API's `LISTEN` now reconnects rather than dying, so the check is `bms_api_telemetry_listener_connected` on the API's `/metrics`: ingest `written=` climbing with that gauge at 0 localises the fault to the API side in one step. See [`docs/ingest-host.md`](./docs/ingest-host.md) |
| Master data  | Organization → Location → RTU → Asset + `/admin/*` CRUD with `admin`/`organization_admin`/`location_admin` roles (ADR 0008–0010). **Two catalogs are no longer in that chain, and both are `/admin/*` routes that answer to a different gate.** `bms.point_keys` — ADR 0051 decision 2 / migration `0057` made it one fleet-wide list with no `organization_id`, so it is platform vocabulary (§4.4) rather than a child of Organization; since `F2.11` (ADR 0051 Amendment 6) it carries the 139 electrical class keys as well, 187 rows on a cold start, and **a seed re-run rewrites every row's `name` and `domain` outright** while `PATCH /admin/point-keys/:id` admits both — the revert of an administrator's rename is `F4.76`, an open owner decision. `bms.asset_roles` was never in the chain at all, and since `F3.40` it has `/admin/*` writes of its own: `POST`/`PATCH /api/v1/admin/vocabularies/asset-roles` (ADR 0051 decision 5). For both, reads stay open to the roles above and **every write is global `admin` only** — see §4.7. The single exception is the onboarding commit path, which may *create* a point-key code at `organization_admin` (ADR 0051 Amendment 1) and never edit one — a boundary migration `0059` now enforces in the grants, not only in the service. **`bms.asset_roles` has no such exception and therefore no revoke**: nothing writes it on the tenant pool, which is the trigger §4.4 states. **ADR 0018** separates the axes: an asset must have a `location_id` (`NOT NULL`) and need not have an `rtu_id` (nullable); telemetry provenance binds at `asset_points.source_kind` (`measured`/`manual`/`computed`/`unmapped`), not at the asset |
| Asset templates | `bms.asset_templates` + `bms.template_points`, where a row **is** a version and `assets.template_id` pins it (ADR 0015). Published versions are immutable; editing one creates the next draft. `POST /admin/asset-templates/:id/instantiate` builds assets from a published version — target is `rtuId` **xor** `locationId`. A `template_points.kind = 'derived'` point is still re-validated against the active catalog, but **instantiation** never creates an `asset_points` row for it. Since `F2.4` and `F2.6` two other paths do, both writing the same synthesised `computed:<pointKey>` from one shared formatter: `CalcWriteService` on the point's first computed value, and the ADR 0039 override endpoint, which creates the row **eagerly** because waiting for a first value is circular when the override may be the very thing that lets one be produced. **A version is no longer a one-way pin**: `POST /admin/asset-templates/:id/migrate` moves an asset between published versions of the same code, previewed and audited (ADR 0039) — see *Template versions & overrides* below |
| Template content | `asset_templates.content` carries the `E1.7` overlay under **ADR 0019**, tiered by whether a consumer exists on `main`. **Bound** (`alarms`, `maintenance`) import their vocabularies from `rules.schema.ts` / `maintenance.schema.ts` — never restate them. **Since `F4.45` two of them are no longer enums**: `alarms[].category` is a *code* into `bms.rule_categories` (ADR 0031 A1) and, since **ADR 0032**, `alarms[].severity` is a code into `bms.alarm_severities`. The schema bounds their shape only; the check that each names a live value lives in `AssetTemplatesAdminService.assertTemplateAlarmVocabularies`, called on create, update **and publish** — publish was added by ADR 0032 and is not optional, because it used to get the check for free from the enums and a pre-ADR row could otherwise be published carrying an alarm the rule engine cannot run. **That method deliberately does not call `assertRuleCategory`/`assertAlarmSeverity`**: those echo the rejected code back, which is right for a value a caller just typed and wrong over *stored* content, where pre-ADR rows hold arbitrary JSON and the echo becomes a disclosure channel. `operator` is still an enum — but **since ADR 0019 Amendment 2 (`F2.13`, 2026-09-02) `operator` and `thresholdValue` are a paired optional group**: both present or both absent, enforced by `superRefine` in `asset-templates-content.schema.ts`, so a stock alarm can carry a meaning and no number and the Alarms tab renders "value set per site at commissioning" for it. A half pair is refused on create, update and publish, and nothing seeds a number for a pair-absent row (decision 4). The guard was **relocated, not dropped** — a template is an authoring surface, so a category that does not exist is a defect authored now and found whenever template alarms become rules. **`alarms.philosophy.skill` joined the Bound list under ADR 0034** (`E2.1`) — not via the enum-to-code route `category`/`severity` took, since `skill` was plain free text rather than a `z.enum`, but the same destination: a code into `bms.alarm_skills`, checked by a third non-echoing branch of the same `assertTemplateAlarmVocabularies` call. `cause`/`impact`/`action` stay ordinary free text, as they always were. The other three enrichment fields named by `E2.1` — affected assets, energy/water/production impact, ETR — are properties of a *live alarm instance*, not an asset class; ADR 0034 records that no `automation_rules` row links back to the `TemplateAlarm` it may have come from, so a template cannot carry them, permanently, not merely until a consumer exists. **Anchored** (`kpis`, `dashboards`) check point-key references — though `dashboards` left the *thin* end of that tier on `F3.1a`; see below. `kpis.expression` is **no longer always opaque**: `dialect` widened from a locked `"unvalidated"` literal to `z.enum(["unvalidated", "bms-calc-v1"])` (**ADR 0036**, `F2.3`), and `"bms-calc-v1"` triggers real parsing — grammar, whitelisted functions, and a `{pointKey}` cross-check against `pointKeys` — through the parser in `packages/shared/src/calc-dsl/` (see the *Calc DSL* row below). Existing `"unvalidated"` rows keep validating as bounded strings, unchanged; nothing forces a re-save. **A dashboard view is no longer ordered point keys only — `F3.1a` opened it** (**ADR 0047**). `TemplateDashboardView` now carries an optional `widgets[]` beside `featured[]`, each widget typed by the closed `widgetType` vocabulary and each carrying its own `pointKeys`. **It is no longer the SAME vocabulary the runtime tables use, and that sentence was true until `F3.35`**: `table` requires exactly one catalog source, a template binds point-key *strings* and has no way to express a `bms.dashboard_widget_sources` row (which is keyed by `widget_id`, and a template widget is not a widget row), so a template `table` would carry no binding of either kind and `F3.2` would instantiate a card that can never render. Excluded by ADR 0048 Amendment 1, and the rule ruled is narrower than "no tables in templates" — **a widget type is template-authorable when it can be fully bound by point keys** — so a sixth type with a required source is excluded with no new ruling. The exclusion is one `Exclude` in `packages/shared/src/asset-template-content.ts` and lifts on its own if templates ever carry a catalog binding; the compile-time type and the runtime list in `apps/web/src/lib/widget-config-form.ts` are held together by a test, because a `Record<WidgetType, {min: number}>` cannot be read at the type level. The two halves are validated the same way, and that is the part worth knowing: `collectContentPointRefs` walks `widgets[].pointKeys` as well as `featured`, so a widget naming a point the template does not declare is refused on create, update **and** publish exactly as a `featured` entry is. A template widget is a **strict discriminated union** — unknown keys are refused, because this is an authoring surface, the opposite direction from the response contract in `packages/shared/src/contracts/` (§4.8). **Reserved** (`optimisation`) is **rejected**, naming its blocking item — though `health` left that tier on `E1.3` (ADR 0050, 2026-08-30), the fourth of ADR 0019's five reopenings; it carries `weights` and ordered band cut-points, and its blocking item `E1.1` was retired by the client rather than delivered. Every referenced point key must be one the template declares — checked on create, update and publish, because `content` and `points` are patched independently and a points patch can orphan content the request never mentioned. `POST :id/draft` is deliberately **exempt**: it byte-copies stored content, and validating it would strand a pre-ADR template behind its own immutable published version. Nothing converts this into a running rule or a maintenance row; it is the authoring surface only |
| Calc DSL     | Small hand-rolled scalar-arithmetic grammar, dialect `bms-calc-v1` (**ADR 0036**, `F2.3`) — arithmetic over `{pointKey}` brace references, numeric literals, and a whitelisted function set (`min`/`max`/`abs`/`round`/`clamp`); no assignment, no control flow, no string ops. Lives in `packages/shared/src/calc-dsl/` (tokenizer, recursive-descent parser, AST types, a pure `validateFormula(expression, knownRefs)`) so both the API (write-time validation) and the authoring UI (`F2.5`, shipped) share one grammar rather than each guessing at one. **`F2.5` widened this surface** (ADR 0038 decision 6): `tokenize`, `Token`, `TokenKind` and `CalcTokenizeError` are now exported too, so the editor colours a formula from the same lexer that validates it instead of carrying a second grammar. That makes `TokenKind` a **third frozen contract** in `packages/shared` — adding a token kind is a cross-package change from here on, because the editor's theme reads it — the situation ADR 0019 left open for `kpis[]`. **`eval`/`new Function`/`vm` are never used**, checked by a source scan over the directory rather than a hardcoded file/token list, so a future `evaluator.ts` cannot slip past it. Bounds mirror the existing KPI caps: `expression`/`formula` ≤1000 chars, ≤20 distinct point references, parser recursion depth ≤64, and a numeric literal long enough to overflow to `Infinity` is rejected lexically rather than passing silently. Errors carry the parser's own `code`/`position`, rendered through `formatCalcError` and wired into both the `template_points.formula` and `kpis[].expression` validation messages. `template_points` gained two nullable columns, `formula`/`formula_dialect`, enforced at the Zod layer — `kind: "derived"` requires both, `kind: "measured"` requires neither — not a DB `CHECK`, mirroring the `rtuId`/`locationId` exclusivity precedent in the same schema file. **A derived point's formula may reference measured points only, never another derived point, including itself** — chained/derived-to-derived formulas need dependency ordering and cycle detection, deliberately left to `F2.4` rather than decided here, and **decided at last by ADR 0055 on 2026-09-04** — for a new `bms-calc-v2` dialect, which repeals ADR 0036 decision 7 and accepts the ordering and cycle-detection cost. That does not loosen this sentence: ADR 0055 decision 3 freezes `bms-calc-v1` at today's meaning permanently, and the ADR is accepted but not implemented (`F2.9` builds it), so the rule above is the live behaviour of this parser and the permanent behaviour of `v1`. **No evaluator lives here** — nothing computes a value from a parsed expression against live telemetry, including what "the current value of `{X}`" means (latest sample vs. rolling window) and null/stale-input/divide-by-zero handling; see the *Calc engine* row below |
| Calc engine  | Evaluates `bms-calc-v1` formulas against live telemetry and writes the result (**ADR 0037**, `F2.4`). `packages/shared/src/calc-dsl/evaluate.ts` is the pure evaluator — no clock, no I/O — refusing a non-finite result **at the node that produced it**, not only the root (`min({A}*{B}, 5)` refuses at the multiply, not the `min`), and normalising `-0` to `0`. `apps/api/src/calc/` resolves what "the current value of `{X}`" means: **trigger mode is per formula**, `template_points.calc_trigger` is `streaming` or `scheduled` (interval `calc_interval_seconds`, both new nullable columns, migration `0036`), never a property of the engine. **Streaming** mirrors `AlarmEngineService` — `CalcStreamingService.onModuleInit` subscribes `hub.on("readings")`, a 60s-cached definition loader (`CalcDefinitionsService`), one `try`/`catch` per formula so one failure never costs the batch, and every candidate `(assetId, templatePointId)` pair deduped before evaluating — a formula with more than one ref must not double-evaluate when a batch happens to carry fresh readings for more than one of them. **Scheduled** is one self-scheduling `for (;;) { sweep; await sleep(...); }` loop (`CalcSchedulerService`/`runSchedulerLoop`) — **never `setInterval`**, the same shape `apps/ingest`'s `runPollLoop` already uses, so §9.4 is not triggered by adding a scheduling library. `lastRunMs` is keyed on `(assetId, templatePointId)`, **never `templatePointId` alone** — one published template instantiated on several assets shares a `templatePointId`, and keying on the bare id lets the first asset processed each sweep mark every other one as "just ran", starving it silently forever; the stored value is the formula's own **bucketed** tick time (`bucketTimeMs`), not raw wall-clock `now()`, so sweep-cost drift self-corrects rather than compounding. Staleness is per formula too — `max_input_age_seconds`, defaulting to a deliberately loose 300s — and "missing" vs. "stale" stay distinguishable inputs, never conflated. **Every skip is counted, none silent** (`bms_api_calc_skipped_total{reason}`) — an unusable stored definition, a missing/stale input, and a non-finite result are all distinct labelled reasons, alongside `bms_api_calc_values_written_total` and the `bms_api_calc_active_formulas` gauge. Writes go through `CalcWriteService`, **not** `TelemetryWriteService`: no JWT, no `MasterDataAuditService`/`bms.audit_log` row — auditing every machine-generated sample would flood `F4.14`'s read API — computed provenance (`source_kind: 'computed'`, `rtu_id: null`, `source_data_key` synthesised as `computed:` plus the point key, length-checked against the column before the insert since a point key alone can be valid up to 128 chars while the composite cannot, on-demand `asset_points` mapping creation SAVEPOINT-isolated per pair so one pair's DB failure never aborts the batch), and `onConflictDoNothing`-only value writes: a recompute of the same `(time, assetId, pointKey)` is a database no-op, never an overwrite (decision 8's idempotency guarantee). Re-entrancy is closed twice over — the streaming host's own input filter, resolved on `(assetId, pointKey)`, can never match the engine's own output because ADR 0036 decision 7 forbids a derived point referencing another derived point, and a same-instant recompute is a no-op regardless. `tests/adr-0037-calc-engine-invariants.test.ts` statically scans every file under `apps/api/src/calc/` for `setInterval` and for the forbidden audit-path imports, plus wiring checks that `CalcModule` is still in `app.module.ts` and both hosts' `onModuleInit` still call their real entry point — deleting any of those three one-line wiring points fails a test rather than leaving a green, fully-covered suite with an engine that never runs. **Since `F2.6` the definition loader no longer reads `template_points` alone** — see *Template versions & overrides* below. Anything that queries calc configuration must go through `CalcDefinitionsService`; a template-only `SELECT` written here would silently ignore every per-asset override, which is the failure ADR 0039 names as its highest risk. **Still not owned here**: no chained/derived-to-derived formulas and no `F2.8` wiring — but the *reason* changed on 2026-09-04 and the distinction matters. It is no longer "deliberately undecided": **ADR 0055 decided it**, repealing ADR 0036 decision 7 rather than narrowing it, so a `bms-calc-v2` formula may aggregate over `@site`/`@domain`/`@group`, may name another asset directly, and may read a derived point — at the cost of a topological ordering pass ahead of the sweep and a cycle detector running at save time *and* every tick, since an aggregate resolves its members at evaluation time and an asset joining a site can make a saved formula cyclic with no formula edit. **None of that is implemented, and nothing here has changed**: `F2.9` is the item that changes this engine, `F2.8` follows it, and until then this row describes the code exactly. `bms-calc-v1` is frozen at today's meaning permanently (ADR 0055 decision 3), so the re-entrancy argument above — the streaming host's input filter can never match its own output — stays sound for every `v1` formula and must be re-derived, not assumed, for the first `v2` one, which is `scheduled` only for that family of reasons |
| Template authoring | The screen for everything the three rows above define (**ADR 0038**, `F2.5`). **Exactly six tabs** over one template version — Details, Points, Calculations, KPIs, Alarms, Dashboards — because a type cannot stop a seventh being added and a behavioural test would simply agree with whatever it found. **The count is held in three executable places, not one**, and an agent that finds only the first will meet the other two as unexplained red: `tests/adr-0038-template-authoring-ui.test.ts` (the source scan), `apps/web/src/lib/template-tabs.spec.ts` (the count, the id string, a reserved-section list **and** the resolver's fallback list), and `apps/web/src/lib/template-tab-guard.spec.ts` — which holds it **arithmetically**, as a count of ordered tab pairs (`n(n-1)`, so six tabs give thirty). That third file never contains the word "five", so a search for the tab count does not find it. This paragraph said "a source scan", singular, until `F3.1e`; the third gate was found by a compliance review, and the singular is corrected here rather than left to be rediscovered. The `content` sections with no tab are `health`, `optimisation` and `maintenance`, and **they are tab-less for two different reasons that must not be collapsed**: `optimisation` is held closed by §6 and would error if authored, while `health` (since `E1.3`, ADR 0050 Amendment 1 decision 5) and `maintenance` are accepted by the API and simply have no editor — a stored value survives `mergeTemplateContent` untouched. A tab for `optimisation` would be worse than none; a tab for `health` is merely an ADR 0038 amendment nobody has asked for. **`dashboards` became the sixth tab in `F3.1e`** — `F3.1a` gave it widgets, discharging ADR 0038:124's condition (*"it becomes a tab when `F3.1` gives it widgets"*), and **[ADR 0038](docs/adr/0038-template-authoring-ui.md) Amendment 4** moved the count five → six. **The number still moves only by amendment, never by editing a gate**: an agent that edits one to make a seventh tab pass has defeated the mechanism instead of changing the decision. **A published version renders read-only** — decision 3, and the single failure mode it exists to prevent is an editable formula field on a published template, so both formula surfaces derive `readOnly` from `formulaFieldsAreReadOnly(status)` rather than restating the statuses. **Authoring is role-hidden and scope-refused** (decision 10): the role half is `templateFormsAreEditable(role, versionIsEditable)`, which gates the *forms* and not merely the lifecycle buttons — gating only the buttons shipped a page that looked correct while every field stayed editable for a `location_admin`, who could then author a whole form and lose it to a 403. The organization half is not derivable in the browser and falls through to the API 403, which **renders inline the way decision 10 assumes since `F4.52`** (2026-08-22, PR #136) — before that fix `clearSessionOnAuthFailure` cleared the session on 403 as well as 401, so the refusal logged the user out of a valid session instead of explaining itself. It clears on **401 only** now, and that narrowing is correct only while no 403 in this API is repairable by signing in again; `tests/f4.52-auth-failure-status.test.ts` gates the premise, so read it before letting a guard or an exception filter answer a token problem with a 403. **Every rule lives in `apps/web/src/lib/` with a spec**, never in a `.tsx`: `apps/web`'s Vitest project defaults to `environment: "node"` and the coverage `include` stops at `src/lib/**`. **A component is no longer unreachable** — since `F3.8` (ADR 0042) the project also collects `src/**/*.test.tsx` and a file opts into jsdom with its own docblock; see §3's `web/` entry. It is still invisible to the *coverage* gate, which is what this rule turns on. Logic left in a component is invisible to both gates, which is why nineteen `lib/` modules carry this feature's decisions — `F3.1e` added the nineteenth, `template-dashboard-form.ts`, and put only wiring in its three `.tsx` files |
| Template versions & overrides | How a published version's changes reach assets already built from the old one, and how one asset departs from its version (**ADR 0039**, `F2.6`). **Two mechanisms, deliberately separate.** *Migration* re-pins `assets.template_id` between published versions of the same code — explicit, previewed as a version delta, audited, never follow-the-latest, because a publish must not silently change what a live plant computes. It **refuses** rather than reconciles: a delta that removes or re-keys a `measured` point (that `asset_points` row is physical wiring `apps/ingest` and the rule engine read), a *required* measured addition whose `source_data_key_pattern` uses any token beyond `{asset_code}` (instantiation takes the rest per request and never stores them, so there is nothing to recover for an asset built months ago), a domain change (`assets_domain_fk` would not catch it — both values are valid codes — and re-pinning alone would make the pin and the asset disagree), and a measured addition onto a point key the asset already has a row for. **No backfill; nothing recomputes history** (ADR 0037, unchanged) — a series whose formula changed midway is an accepted, recorded hazard. *Overrides* are five nullable columns on `bms.asset_points` (migration `0037`) mirroring the same five on `template_points`. **The resolution is `coalesce(asset_points.<col>, template_points.<col>)`, per column, asset-first, over a LEFT JOIN on `(asset_id, point_key)` — and it is the highest-risk line in the feature.** It sits in the hot path of every scheduled and streaming evaluation, and each way of getting it wrong computes a wrong number *silently*: an INNER join drops every derived point with no `asset_points` row, which is the normal state; a reversed coalesce makes every override inert; a whole-row coalesce lets one override blank four inherited values. None of them throws, and every calc unit test constructs its dependencies directly, so reverting the query to a template-only `SELECT` leaves the entire suite green — which is why `tests/adr-0039-resolution-merge.test.ts` scans the source for the join, both halves of its condition, all five per-column coalesces in order, and the two things that must **not** be there. Three columns are deliberately not treated alike: `kind` is **never** coalesced (an asset cannot turn a measured point derived), `active` is **not** filtered (deactivating a telemetry *mapping* must not silently stop a formula), and `source_kind` **is** filtered to `computed` (`AssetPointsAdminService.create` resolves a point key against the catalog alone with no template awareness, so an operator can map a mapping row onto a key the pinned version declares `derived`; such a row is all-NULL today, so omitting the filter happens to give the same answer — by accident, one write away from resolving a formula out of ingest wiring). `null` means **inherit**, which makes one mistake structural rather than careless: an override cannot *clear* an inherited value, so a scheduled template point can never be overridden to streaming, and changing the trigger while leaving the interval alone is a counted skip. Both the API and the browser say that in the same sentence. **An override formula may reference measured points only** — the same rule `assetTemplatePointsBodySchema` applies to a template author, restated here because this endpoint is a second author for the same engine: on a `scheduled` trigger a self-reference compounds every interval until it is non-finite, since the scheduler stamps a fresh wall-clock bucket each tick and `ON CONFLICT DO NOTHING` never dedupes it |
| Ingest adapters | `IngestAdapter` interface frozen by **ADR 0016**: the host owns *supervision and cadence* (poll loop, overlap guard, backoff, jitter, bounded queue, process lifetime); adapters own the protocol connection and parse, implementing `connect` / `disconnect` / `health`. **The host is now built** (§6 commit 2): `apps/ingest/src/host/` supplies the supervisor, bounded queue, binding plan, normaliser and health endpoint, `src/main.ts` is wiring only, and **the §5 backoff table itself moved to `packages/shared/src/ingest.ts` on 2026-08-14 (`F4.34`)** because the API's telemetry listener became its second consumer — the ADR states those numbers precisely "so five agents do not invent five policies", so a second copy would have defeated the point of writing them down; change them in one place and both the ingest supervisor and the API listener follow, and `src/adapters/mqtt.ts` ports the pilot's MQTT connection onto the interface behind `src/adapter/registry.ts` — a port that **deliberately diverges** from the ADR 0007 pilot's parser in three ways, listed in `docs/ingest-host.md`. That happened because `index.js` was frozen while it served the pilot, so a defect found in the shared parse logic could only be fixed on the host side; §6 commit 4 has since deleted it, and the divergence list is kept as the record of what the host does differently from the behaviour that ran in the field — it is what explains the step change in the pilot's data on 2026-08-06. **MQTT is the only implementation, and it is not new scope** — ADR 0007 promoted it, this moves it onto the frozen interface. Modbus, BACnet, OPC-UA, SNMP, REST polling and DCS each still need **their own ADR** under §10 — unconditionally, not only where a protocol library has to be settled under §9.4; see §6. Adapters never read `process.env` (ADR 0016 §4); the host reads it in `host/config.ts`, **plus** the pilot-era `MQTT_*` and `CREDENTIAL_ENCRYPTION_KEY` reads in the unmodified `rtu-config.js`. That `MQTT_USERNAME`/`MQTT_PASSWORD` fallback is the *only* working credential path, and ADR 0016 Resolved decision 5 expected it to **survive cutover**. **It did, and the expectation is no longer a prediction:** the pilot has run on that path since 2026-08-06, `bms.rtu_connection_configs` held no rows when the cutover ran, and the decision's own caveat — that the emptiness was measured on a local seeded database and needed confirming against the production pilot — is discharged by that database *being* the pilot's. Treat the emptiness as a **measurement with a date, not a standing fact**: the onboarding wizard writes that table, so re-query before relying on it. **ADR 0016 Amendment 3 (2026-08-14) now records this**, and it re-measured rather than restating: `bms.rtu_connection_configs` still held **0 rows**, so the fallback survives, and `CREDENTIAL_ENCRYPTION_KEY` *is* set — the ADR 0012 path is blocked on **data, not configuration**. Amendment 3 also names the repository owner as §6 commit 4's owner, closing Resolved decision 4. Writing an `rtu_connection_configs` row is still prerequisite work for anyone who wants the ADR 0012 path. Amendment 1 widens the schema fields to `ZodType<T, ZodTypeDef, unknown>` so `.default()`/`.transform()` schemas compile; Amendment 2 adds `@types/pg`. **§6 commits 3 and 4 are both discharged** — the parallel run and the cutover ran against the live PHE feed on 2026-08-06, and commit 4 landed 2026-08-14 (PR #30): `src/index.js` and the `INGEST_NOTIFY` flag are deleted, `pnpm start` is the host, and `pg_notify` is unconditional. That was not tidying up — post-cutover the flag's off-default was the only reachable state in which telemetry lands while every dashboard is dead, with no error and no alarm. **Four of commit 4's five actions landed. The fifth did not, and that is §6 being followed rather than amended**: it conditioned retiring the `MQTT_USERNAME`/`MQTT_PASSWORD` fallback on the pilot RTU having an `rtu_connection_configs` row, and it has none. Reassigned to **`E8.4`** |
| AI onboarding | Scoped admin ingestion wizard using OpenAI chat completions with structured JSON, and a deterministic rule-based fallback when `OPENAI_API_KEY` is unset (ADR 0011). **Credentials never transit the chat** (**ADR 0022**, `E8.3`): they arrive through `POST /api/v1/admin/onboarding/sessions/:id/credentials`, and a chat turn that appears to carry one is **refused — not parsed, not stored, not forwarded to the model**. The wizard used to *prompt* for them and parse them out of the turn, which left plaintext in `onboarding_sessions.messages`; migration `0026` purges that column on every existing row (session rows are kept — `audit_log` references them by id). The detector that spots a credential-bearing turn is a **nudge, not the control** — six review rounds found it simultaneously too narrow and too broad, and its documented misses are asserted as tests. The control is that credentials have a typed home. Do not "improve" that detector without reading ADR 0022's amendments first |
| Secrets      | AES-256-GCM encrypted RTU connection credentials via `CREDENTIAL_ENCRYPTION_KEY`; never returned decrypted by the API (ADR 0012). Writers into that store: the master-data RTU admin, and the onboarding credentials endpoint above (**ADR 0022**), which **fails closed** with 503 when the key is unset rather than reporting a success that stored nothing. In an onboarding draft the blob is keyed by **RTU `code`, never by array position** — the draft's `rtus` array is replaced wholesale by any patch, so a positional key delivered one broker's password into a different broker's connection config. A code claimed by no RTU, or by more than one, drops rather than guesses. **SMTP stays platform-owned in the environment** (**ADR 0043** decision 13, reaffirming ADR 0041 decision 8): `SMTP_HOST`/`PORT`/`USER`/`PASSWORD`/`SECURE`/`FROM` are read once in `notifications.config.ts`, no service body reads `process.env` directly, and none of them appears in any UI. An organization owns presentation and routing only — from-name, reply-to, recipient lists, webhook URL, webhook HMAC secret and the per-channel rate limit, all in `notification_channels.config` and the encrypted secret columns above — never the transport itself. Per-organization SMTP relays stay deferred; the mechanism above (`secret_ciphertext`/`secret_iv`/`secret_key_version` plus `CredentialCryptoService`) is what a future per-org relay password would use, not what runs today |
| Operations   | Work orders, maintenance schedules, basic rules, Energy CSV reports, completed 2D Control Room foundation screens, completed guided rule builder, and completed Control Room extension. Every mutating endpoint across these four domains is gated by the **operations write matrix** (ADR 0017) — see §4.7. On the **read** side, `GET /rules/executions` is the one route here with no role gate of its own — it scopes on `readableAssetIds` alone, so `operator`, `viewer`, `location_admin` and `asset_group_admin` all reach it. Since **ADR 0046 Amendment 3** (`E8.6`) its `trace.evaluatedBy` — the evaluating operator's IdP subject — is removed for every non-`admin` reader, in SQL and keyed on the database role; the writers still record it, because the global admin's view is the forensic record. The Energy CSV export escapes through the shared serialiser, **not** its own rule — see the *CSV exports* row (ADR 0026) |
| Audit read   | `bms.audit_log` becomes readable under **ADR 0021** (`F4.14`): `GET /api/v1/admin/audit` and `/audit/export` (CSV + XLSX), in `apps/api/src/admin/audit/`. **Organization-scoped since ADR 0046** (`E7.1e`), global-admin-only before it. The table gained `organization_id` under ADR 0043 decision 5 (**nullable**, the one stated exception: a platform event belongs to no tenant), and every write call site is required to stamp it, real org or explicit `null`, since `E7.1c`'s `MasterDataAuditService.write` funnel — for a year that column had a writer and no reader, which is the defect `E7.1e` closed. The global `admin` still reads every organization unfiltered; an `organization_admin` reads its own organizations' rows and **never a `NULL`-organization row**, neither pre-`0048` un-attributed history nor a platform event (decision 2 — deliberately blunt, because a date bound that reclassifies the same `NULL` on either side of a migration is a rule nobody can hold in their head at 3 a.m.). `location_admin` and `asset_group_admin` stay refused, and ADR 0021's deferral stands **for them alone**. Both reads stay on `fleetDb` with the ADR 0043 Amendment 3 named reason: the tenant filter is explicit in the `WHERE`, and a GUC-bound `tenantDb` read would add a second, invisible filter that could only ever disagree with it — and cannot express a multi-organization actor at all. Purely additive throughout: no DDL, no trigger, no migration, no new package (`xlsx` was already an api dependency). **The projection is the other half of the gate, and it is no longer verbatim for a tenant** (`E7.1h`, ADR 0046 Amendment 2): `actorEmail` stays — an email answers *"who changed this"* and a tenant is entitled to it for actions on its own data — while the acting operator's `oidcSubject`, which sixteen write sites put at the top level of `payload`, is removed in SQL for every non-`admin` reader. The rest of `payload` **is** still returned verbatim, which keeps every `payload: body` call site a security surface, and one whose audience is now wider than the global admin — see §4.7. **The scoped read has a composite index since `E7.1i`** (migration `0049`): `audit_log_organization_created_idx` on `(organization_id, created_at DESC, id DESC)`, matching the `WHERE` and the `ORDER BY` tie-break, with the original `audit_log_created_idx` kept for the global admin's unscoped read. **Measured, and the measurement is the part worth carrying**: at current volume the planner still prefers the old index plus an incremental sort, and chooses the new one only when incremental sort is disabled. The index is therefore write cost now for a read benefit that arrives with growth — do not cite it as evidence that scoped audit reads are fast today. Export requires a `from`/`to` window of ≤366 days and is capped at 50,000 rows, **refusing rather than truncating**; the cap was measured, not assumed, and is a *row* bound with **no byte bound** — that gap is recorded in ADR 0021, not fixed. Append-only storage and hash-chaining are `F4.15` and stay out of scope (§6) |
| Notifications | **ADR 0041** (`F3.8`): one `NotificationTransport` interface in `apps/api/src/notifications/`, with `log`, `email` (`nodemailer`) and `webhook` implementations. **Dispatch is inline and fire-and-forget — no queue, no Redis** — and `dispatch()` **never rejects**: a failure is a `failed` delivery row, not an exception thrown back into the alarm path that raised it. **A row is written for every attempt, including the ones that send nothing.** The five statuses are `sent`, `failed`, `skipped_unconfigured`, `skipped_deduped` and `skipped_rate_limited`, because *"no notification arrived"* and *"no notification was attempted"* are different answers to an operator and only the ledger can tell them apart. Storm control is two-sided: a transition dedupe (an unchanged plant sends nothing) and an hourly ceiling that counts `sent` **only**, so throttling cannot throttle itself. **A channel's secret never touches `config`** — `config` is returned by the API and appears in logs (§9.6), so the credential lives in three columns holding ADR 0012 ciphertext, IV and key version, made all-or-nothing by a CHECK; the DTO carries `hasSecret: boolean` and never the value. **The kind vocabulary is a lookup table, not an enum** (ADR 0031 A1), so `F3.9`'s `sms` is an `INSERT` — but it is **not yet open end-to-end**: the admin UI hardcodes two `<option>`s and the transport lookup is a `switch`, so a new row still needs code. `notification_deliveries` FKs are `NO ACTION` on purpose — history outlives configuration, and deleting a channel with history returns a **409 telling the operator to disable it instead**, found by clicking the button rather than by the compiler. **Webhook egress is restricted at the transport**: loopback, private, link-local and this-network destinations are refused *before* `fetch`, with `redirect: "manual"` and a 5 s timeout. The IPv4-mapped IPv6 form (`https://[::ffff:7f00:1]/`) reached the Compose network until the security review caught it — the unit tests had asserted the dotted form, which `new URL()` never produces, so they were exercising an unreachable branch. The residual DNS-rebinding window is documented in the file header, not implied. Both `/rules/:id/notifications` routes carry **role AND scope** checks per §4.7; the role gate alone admits `location_admin`, which let a scoped admin redirect or silence another site's alarms until review found it |
| Configurable dashboards | **ADR 0047** (`F3.1`), and **all five children are on `main` since 2026-08-30**. Three tenant-scoped tables — `bms.dashboards`, `bms.dashboard_widgets`, `bms.dashboard_widget_points` — created by migration `0050` with `organization_id NOT NULL`, a `tenant_isolation` policy and `FORCE ROW LEVEL SECURITY` from the first migration, per ADR 0043/0045. **The third table is the point of the design**: a widget binds live `bms.asset_points` rows through a real foreign key rather than through keys in a `jsonb` blob, which is what ADR 0019 had to hand-build an orphan check for. **Each policy checks its org-bearing parents, not only its own `organization_id` column** — Postgres runs a referential-integrity check with row security **off**, so a foreign key never consults the parent's policy, and a correctly-stamped row could otherwise bind another tenant's point (proved on the running stack during `F3.1a`'s review, and closed the way `bms.asset_group_members` in migration `0047` §3c already did it). **`widgetType` is a closed `z.enum` + `CHECK`, deliberately the opposite of ADR 0031/0032** — see §4.8, which carries the reasoning. The vocabulary and the per-type `config` discriminated union live in `packages/shared/src/contracts/dashboard-builder.ts`; the drizzle declarations in `packages/db/src/schema/dashboard-schema.ts` (its own file because `bms-schema.ts` was near the §4.5 line limit). **All three tables now have a writer and a reader**: `F3.1b` owns the API in `apps/api/src/dashboard-builder/`, `F3.1c` the four renderers, and `F3.1d` the builder surface plus the read-only viewer route beside it (Amendment 4). This sentence read *"nothing reads or writes these three tables yet"* until 2026-08-30; the `F3.1b`/`F3.1c` sweep did not correct it, which is worth recording, because a §2 row that lags by two rows reads as current rather than as stale. **Two rules `F3.1d` established that a later change must not lose.** (1) **`update()` authorizes the *stored* scope before the destination scope, and both run ahead of the "both scope columns set" 400.** Reverse the two authorizations and a `location_admin` re-homes an organization-wide dashboard under its own site and then deletes it, because `remove()` reads the scope the PATCH just wrote; move either behind the 400 and that 400 becomes a cross-tenant existence oracle. (2) **The 12-column canvas is `DASHBOARD_GRID` in `packages/shared`, never restated in TypeScript.** Seven TypeScript modules import it and migration `0050`'s `dashboard_widgets_grid_bounds_check` is the only legitimate restatement, because SQL has no imports; `tests/f3.1d-grid-bounds-single-source.test.ts` scans `packages/shared/src`, `apps/api/src` and `apps/web/src` and fails **any** line that pairs a grid-axis token with a bare `11`, `12` or `24`. The count that rule guards was undercounted **three times** before the scan existed — three sites in the brief, a fourth in the plan, a fifth and sixth in the build, a seventh on the scan's first run — so treat a new grid literal as a defect, not a convenience. **`F3.1e` is done** (2026-08-29), and it touched the *template* side rather than these tables: it added the sixth authoring tab (ADR 0038 Amendment 4) and tightened the template widget arms so **each takes `WIDGET_POINT_CARDINALITY[type]` instead of one shared cap** ([ADR 0047](docs/adr/0047-configurable-dashboards.md) Amendment 3) — a gauge, tank and tile bind exactly one point, a chart up to `MAX_WIDGET_POINTS`. **Read the numbers from `@bms/shared`; never restate one.** The `MAX_WIDGET_POINT_KEYS` alias is deleted, so `noUnusedLocals` fails a re-introduction. Amendment 3 also records that **no stored content needed migrating** and why, and keeps that finding falsifiable: a widget failing a tightened arm **in stored `asset_templates.content`** returns the ruling to the owner rather than licensing a wider bound. **`F3.35` closed 2026-08-31 under [ADR 0048](docs/adr/0048-dashboard-metric-catalog-and-table-widget.md)** and added the fourth table, the fifth widget type and a second binding kind. `bms.dashboard_widget_sources` holds a widget's **catalog** bindings; `bms.dashboard_widget_points` is untouched, because **a catalog key is a foreign key to nothing** — the catalog is code — and a fourth table says so rather than making `point_id` nullable, which would leave a `NULL` meaning either "a catalog binding" or "a bug". A widget binds **exactly one kind**, enforced on the write path as a cross-field rule between the two arrays, never by a per-type count. **Two records decide which pairing is legal and both are read by the builder AND the API**: `WIDGET_SOURCE_CARDINALITY` counts and `WIDGET_SOURCE_SHAPES` types, and the count alone was not enough — a `value_tile` accepts one source, which a *dataset* satisfies exactly as well as a *metric*, so `alarms.active` passed every bound onto a tile and rendered blank with nothing thrown. **Migration `0055` widened `dashboard_widgets_widget_type_check` with `DROP` plus `ADD`, not an `IF NOT EXISTS` guard**: the constraint already existed carrying `0050`'s four values, so an existence check finds it and skips the widening while reporting success. Its journal `when` is hand-stamped above `0054`'s, which itself runs ahead of the wall clock — a real-clock stamp sorts before it and is silently skipped wherever `0054` is applied. **No npm dependency**: ADR 0048's one open §9.4 gate, a grid library, closed as *not needed* — a six-row card with a column picker is a `<table>`, the way `F3.1d`'s canvas turned out to be Pointer Events |
| Section dashboard templates | **ADR 0049** with Amendments 1 and 2 (`F3.37` 2026-08-30, `F3.36` 2026-09-01). A **second** template table, `bms.dashboard_templates`, tenant-scoped from migration `0056` and running ADR 0039's lifecycle whole — draft → published → archived, `createDraftFrom`, publish-time re-validation of the *stored* object. It is a second table rather than an `is_template` flag on `bms.dashboards` **for versioning**: a published template and the dashboards copied from it would otherwise drift with no record of which version a copy came from. It is not inside `asset_templates` for a reason that is a fact rather than a preference — a template widget references point **keys**, and a point key resolves against ONE asset's points, so a canvas spanning many assets of different types has no single asset whose keys resolve. **A widget binds an asset-group ROLE plus a point key** (decision 4), never an asset id, resolved at instantiation against the target group's members through `bms.asset_group_members.role` → the global `bms.asset_roles`. The role lives on the **membership** and not on the asset: the same pump is the raw-water pump in the water group and a monitored load in the electrical one. **Two version stamps, two columns, two reasons**: `version` is the row's own tenant-local lifecycle version, `stock_version` is which release of the repository catalog an imported row came from — collapsing them loses the distinction the moment an organization edits an imported default. **Seven** defaults ship as a **stock catalog in `apps/api`**, a typechecked TS module rather than JSON because the reader is the API and it runs from `dist/` in a container; it is **imported** per organization, never seeded, so improving a default reaches plants provisioned earlier. **`F3.41` (2026-09-02) made the catalog keyed by section × plant shape rather than by section alone** — ADR 0051 decision 6 — so `electrical-overview` and `electrical-metered-pumping` both carry `section: "electrical"`: a substation train and a metered pumping station are different plant, not different clients, and a new shape is a catalog entry rather than the per-tenant import copy (decision 7 keeps that as an escape hatch for a genuinely unique site). **Nothing asserts one entry per section and nothing should.** The catalog is **two files** since the same row — `stock-catalog-electrical.ts` holds the electrical entries and the shared canvas literals, `stock-catalog.ts` the other five and the file-level reasoning — because it crossed §4.5's 1000-line cap; `tests/f3.38-stock-catalog-vocabulary.test.ts` scans the catalog as **text**, so a third file must be added to its `STOCK_RELS` or that half's bindings are checked against no vocabulary at all. **Instantiation never succeeds silently** (Amendment 2 decision 1): it returns a per-widget report — `bound`, `truncated`, `partial`, `unresolved` — with `matchedMembers` and `boundPoints`, and the detail page lists exactly the widgets that came up short. An unresolved role is a widget with zero bindings, **never a failed import** (decision 6): refusing would give a plant with five of six sections nothing at all. An over-match into a one-point widget binds the first member by `assets.code`, which is a total order because `code` is `NOT NULL UNIQUE`. **The section column is closed by the global `bms.dashboard_sections`, deliberately not by `bms.asset_domains`** — extending that vocabulary was the recommendation and the owner declined it, so no plant-domain picker moved; the accepted cost is that the two overlap and will drift, and a future row that needs them reconciled must do so explicitly. **Migration `0056` also re-creates the `bms.dashboards` `tenant_isolation` policy** with a `template_id` parent leg in both halves — `0050` proved on the running stack that a foreign key never consults the parent's policy, so a stamp column without a leg re-opens that hole one column over |
| Stock asset templates | **ADR 0052** (`F2.13`, 2026-09-02). `bms.asset_templates` carries `stock_code` / `stock_version` (migration `0061`, both-or-neither by `asset_templates_stock_stamp_check`), the same two-stamp discipline the row above records and for the same reason. The catalog is a typechecked TS module under `apps/api/src/admin/asset-templates/stock-catalog/`, **one index per pack** — `electrical.ts` re-exports one module per class plus `point-fields.ts` (the tier spreads and the `derived()` helper) since `F2.12`, and `water.ts` re-exports six plant modules since `E5.1` (2026-09-03 — STP, ETP, cooling tower, WTP, RO, softener: 103 points over the 98-code `WATER_CLASS_POINT_KEYS`, 8 derived points with `bms-calc-v1` formulas, 40 pair-absent alarms every one carrying a populated `philosophy`, 23 provisional maintenance plans, no KPIs; `bms.point_keys` at 291), and `mechanical.ts` re-exports six machine modules since `E5.2` (2026-09-03 — pump set, VFD, air compressor, chiller, AHU, boiler, two of them `hvac-*.ts` under the mechanical index because the code prefix says the domain: 141 points over the 107-code `MECHANICAL_CLASS_POINT_KEYS` / `HVAC_CLASS_POINT_KEYS` pair, 13 derived points with `bms-calc-v1` formulas, 52 pair-absent alarms every one carrying a populated `philosophy`, 24 provisional maintenance plans, no KPIs; `bms.point_keys` at 398, `bms.asset_domains` at six with the `mechanical` row seeded by `asset-domains-seed.ts` — the first domain since `0029` — and the seed verifier's count derived from that module's own list; eighteen entries in the catalog), and `facility.ts` re-exports **nine** building modules since `E5.3` (2026-09-04, two pull requests on one ADR — lighting zone, fire panel, access door, occupancy zone, parking level, IAQ node, BAS gateway, lift, escalator, in the tag list's document order and **not** prefix order, so `environment-iaq-node.ts`, `mechanical-lift.ts` and `mechanical-escalator.ts` sit under the facility index because the code prefix says the domain and the index says the pack: 235 points over the 206-code `FACILITY_CLASS_POINT_KEYS` / `ENVIRONMENT_CLASS_POINT_KEYS` / `VERTICAL_TRANSPORT_CLASS_POINT_KEYS` trio, 9 derived points with `bms-calc-v1` formulas over 8 promoted codes, 78 pair-absent alarms every one carrying a populated `philosophy` and 16 of them deliberately carrying no `skill`, 33 provisional maintenance plans of which 10 are `safetyCritical`, no KPIs; `bms.point_keys` at 604, `bms.asset_domains` at **seven** with the `facility` row seeded by `asset-domains-seed.ts` at `sort_order 70` — the second domain the seed adds, and the array's own length is what the boot gate counts; twenty-seven entries in the catalog) — aggregated by `stock-catalog.ts` and provided through `STOCK_ASSET_TEMPLATE_CATALOG_TOKEN`; an entry is a create body minus `organizationId` plus its own `stockVersion`, parsed at build time under both `createAssetTemplateBodySchema` and its listed DTO **with key-set equality in both directions** — the DTO is a non-strict `z.object`, so a count check alone lets `list()` silently strip a field the import writes. **Import is `create` with a stamp, never a second insert path** (decision 5): `POST /admin/asset-templates/stock/:code/import` runs every authoring guard a typed draft runs, lands a stamped **draft** at `max(version) + 1`, audits `master.asset_template.import`, and inherits the one-open-draft rule — a re-import with a draft open is a 409, not a new version. `createDraftFrom` copies the stamp forward. **The content comes from the catalog and never from a peer organization's row**; the property test mutates a peer's row of the same code and asserts the import still yields the catalog's (the dashboard side's is `F4.77`'s). A new pack module must join `STOCK_ASSET_RELS` in `tests/f2.13-asset-stock-catalog-vocabulary.test.ts` with the bounds moved to the new actuals (897 / 592 / 602 and `STOCK_ASSET_RELS` at 27 since `E5.3`; `tests/f3.38` and `tests/f3.39` move to 602 with it, and `f3.39`'s array count to 14), or that half's keys are checked against no vocabulary at all; and since `E5.1` every entry's `description` must cite the source document its pack declares in `stock-catalog.spec.ts` — **and since `E5.3` the map is two, not one**: `sourceDocOf` is `ENTRY_SOURCE_DOC[code] ?? PACK_SOURCE_DOC[packOf(code)]`, a per-entry override read first over the per-prefix default, because `mechanical-lift` and `mechanical-escalator` ship in the facility pack under a prefix that already maps to the `E5.2` document. **Do not "fix" that by re-prefixing the two codes** — the prefix is the domain, and the domain is what the picker, the seed and the vocabulary all key on. An entry with neither an override nor a declared pack fails the build rather than skipping the citation — the directory cross-check fails the build for an unlisted module, and the scanner covers both `pointKey:` and `pointKeys: [...]`. A new `*.spec.ts` beside the catalog needs its own name-sibling `*.test.ts`, or `tests/repo-invariants` goes red while the catalog suite stays green. Listing needs a master-data role, importing needs author rights on the target organization, and both stock controllers' source scans prove the guard call from the handler text — **anchored to a line start** (`apps/api/src/testing/source-scan.ts`), because a class docblock that quotes the decorators in the right order once satisfied a bare `indexOf` and the `F3.36` route-order check passed either way. **Six entries ship, all v1** (`electrical-feeder` from `F2.13`; transformer, DG set, UPS, solar PV and APFC from `F2.12`, 2026-09-03): 172 points from the derived tag list, 64 alarms with a meaning and no number, 5 KPIs and 21 maintenance plans, the plans and KPIs the tag list does not spell out marked PROVISIONAL by ruling; six derived codes promoted with formulas — the one the tag list never named under **ADR 0051 Amendment 7** — and 30 deferred with a reason each, never placeholdered (Amendment 6 decision 8). A `manual`-tier point has no source pattern and gets no asset point at instantiation — `F1.16`. **An entry can be read before it is imported** (`F2.14`, 2026-09-03): a View link per entry on the stock card opens `/admin/asset-templates/stock/:code`, which renders the entry through the authoring tabs with `editable={false}` — six of them at `F2.14`, **seven since `F2.19` (2026-09-04)** added Maintenance under ADR 0038 Amendment 5 Part B, which is what finally made the 101 authored maintenance plans readable without the API. The page does not narrow the tabs' prop — every tab mutates by `template.id` and two gate their formula editors on `template.status` — it adapts the entry in `apps/web/src/lib/stock-template-view.ts`: `status: "published"` so `formulaFieldsAreReadOnly` holds (a `draft` would leave the formula editors writable behind a disabled page), id `stock:<code>` so it is a sentinel `idParamSchema` refuses **and** a per-entry reseed key (the tabs reseed on `[template.id, template.status]`; one id for the catalog showed entry A's points under entry B's header). The route is declared **before** `/:templateId/versions` — both paths rank the same under React Router v7, so order decides — and `tests/f2.14-stock-viewer-reachable.test.ts` holds the registration, the order and the card link, anchored on the JSX `to={` so a comment cannot keep it green — **and a fourth thing since `F4.92` (2026-09-04)**: the stock tab's own entry in `ASSET_TEMPLATES_PAGE_TABS`, because `F2.21` put the card on a tab and the card link therefore renders only while that tab is selected, which left the link assertion proving the link EXISTS rather than that a person can reach it. That entry is searched **inside the array literal**, sliced between the declaration and its close, not file-wide: the module's own docblock already writes an `id:` line in prose, so a file-wide scan would stay green on a deleted entry that a later note happened to name. One link in the chain is still held behaviourally rather than statically, and is named in the file rather than papered over — the page derives its strip from `visibleAssetTemplatesPageTabs`, and hardcoding that prop would empty the strip with every case in that file green. The catalog is never editable from the screen (decision 1); the dashboard-template card's twin is `F3.44`, a row and not a build |
| CSV exports  | **Both** CSV downloads escape through one module, `apps/api/src/serialise/csv.ts` (**ADR 0026** and its **Amendment 1**; `F4.29`, `F4.31`, `F4.50`): the audit export (ADR 0021) and the Energy Consumption report. Before it they disagreed — the audit one neutralised spreadsheet formula leaders and the reports one only quoted, so an asset `code` beginning `=` was delivered as a **live formula**. `csvTextCell` prefixes an apostrophe when a value starts with `=` `+` `-` `@` TAB or CR, **then** tests the quote trigger `/["\n\r,\t;\|]/` — that order is load-bearing, since the guarded form of a CR-led value still contains a CR and must be quoted or the record splits. **TAB, `;` and `\|` joined the trigger in Amendment 1 (`F4.50`)**, and the reason is not RFC 4180 — it is that Excel 2013 was measured evaluating `=1+1` out of an unquoted cell in **four** consumers that do not read the file as comma-delimited: two clipboard pastes, a comma+TAB file open, and a `;`-list-separator locale double-click. All six are formula-*initiating* characters, **not** "characters a spreadsheet strips as whitespace": `\r` must stay in the leader list *and* the trigger, and deleting it from either reopens a hole every test would still pass. **Numeric cells are exempt and take `csvNumberCell`**, because the guard neutralises cells whose Excel formula reading differs from their literal text and for a number it does not (`=-5` is `-5`) — guarding one would import the client's figures as text and break their arithmetic. The split is enforced by the two functions' **parameter types**, never by a regex that re-parses output, and escaped cells carry a branded `CsvField` so a raw string in a row is a **compile error**. The audit call site is still blanket because all nine of its columns are string-shaped: the two exports are **consistent, not identical**. `toSheetRows` (XLSX) is correctly unguarded — SheetJS writes `t="str"`, ECMA-376's *cached formula result* type, and the safety is the **absence of any `<f>` element**, not the cell type. **`energySheetRows` joins it** since Amendment 2, unguarded for the same measured reason, with one difference that is load-bearing: it keeps numeric cells as `number` rather than returning `string[][]`, because every numeric column in that report is one the client computes on and text would set `t="str"` and break their arithmetic — the same harm decision 2 forbids the apostrophe guard from causing, arriving by a different route. **Whether a leading U+0020/U+00A0/U+FEFF is stripped-then-evaluated is no longer an open question, and the answer was yes.** `F4.31` ran it: **Google Sheets evaluated a cell led by a single U+0020 space**, shipped in both exports since `73a9fd2`. `csvTextCell` therefore tests the value **with leading whitespace stripped** as well as raw — the class, not the one character that was measured. **Know what the quoting does and does not buy.** Excel honours the `"` text qualifier only when the quote **opens a field**, so the deciding variable is whether the **comma** is still among the consumer's delimiters. Where it is, the cell arrives intact and the vector is closed. Where it is not, two separators in one cell put the closing quote on a later fragment and the formula evaluates anyway — **both guards are positional, and a re-split moves the position**, so the apostrophe fails the same way. `F4.51` **answered that residual by changing format, not by escaping** (Amendment 2): `GET /api/v1/reports/energy/export.xlsx` ships beside the CSV, both rendered from one table so they cannot drift, and the CSV bytes are unchanged. **The CSV residual itself is still open and must not be written up as closed** — for a consumer whose delimiters exclude the comma, two separators in one cell still evaluate, and nothing in `csv.ts` can repair it, because the apostrophe protects the first fragment only. Rejecting the separators at the **write** path was considered and rejected as **impossible to complete**: the exported columns take input at 13+ Zod validation points across five modules, and the audit export's `actor_email` comes from `users.email`, which has no write path in this codebase at all. Anyone reopening that idea must answer `users.email` first. The standing instruction is unchanged, and two separate measurements have now proved it right: **do not add — or remove — characters on reasoning alone.** Measure it with `pnpm csv:formula-probe`, and read the control that matches your delimiter, because the wrong control cannot fire and a vacuous run looks exactly like a clean one |
| API contracts | **Every API *response* type is `z.infer` of a schema in `packages/shared/src/contracts/`, never written twice** (**ADR 0030**, `F4.23`). The contract was never missing — `packages/shared` already exported 100 types imported at 148 sites — what was missing was a **runtime**: every export was a `type`, and `apps/web` imported `zod` zero times, so no response was checked anywhere. 88 schemas now cover them, and `apps/web` calls `checkResponse(schema, payload, endpoint)` (`src/api/validate.ts`) on 33 direct reads plus all 42 `adminFetch` calls, whose `schema` parameter is **required** so the compiler finds every site. **It validates and does not transform** — Zod strips unknown keys, so returning `result.data` would silently delete a field the server has newly added; `checkResponse` returns the original payload either way. **Failure direction is asymmetric on purpose**: throw in dev/test, log-and-pass in production, because a blank Control Room during an incident is worse than one drifted field — the same asymmetry ADR 0029 Amendment 2 applied to `API_DOCS_ENABLED`. Issues are logged as **`path` and `code` only** (§9.6): a Zod issue embeds the *received value*, so logging `message` publishes server data to a shared operations console. **Three findings worth carrying:** `@bms/shared/contracts` **does not typecheck from `apps/api`**, which compiles `moduleResolution: "node"` (node10) and ignores the `exports` map while Node's *runtime* resolution honours it — the dangerous half — so `index.ts` re-exports the schemas and the subpath is an `apps/web` convenience only; a **required `unknown` property is not expressible in Zod** (`z.unknown()` yields an *optional* key, and `z.any()`/`z.custom<unknown>()` behave identically), which is why `AuditLogEntryDto.payload` is the one contract this migration changed; and the validator **found real drift on its first run against the deployment** — `GET /rules` had never conformed, 48 of 89 rows carrying an undeclared `category`, fixed in `F4.43`. That is the argument for the 89 routes the spike did not measure. **`RuleListItem` gained `assetDomain` in `F4.45`** (ADR 0031), read from `bms.assets.domain` on the join that already served `assetCode`/`siteName` — a rule's plant domain is the *asset's* fact and is never stored on the rule. **Three contract fields are deliberately no longer enums**: `category`, `assetDomain` and `severity` are `z.string()` codes, because ADR 0031 Amendment 1 moved the first two vocabularies into `bms.rule_categories` / `bms.asset_domains` and **ADR 0032** moved the third into `bms.alarm_severities`, so a domain pack ships a sector — or the client's `B9` answer ships a severity level — with an `INSERT`. The cost is stated rather than hidden — this validator can no longer report an unknown category the way it reported `electrical`; that check moved to two foreign keys, where it is absolute rather than advisory, and to `VocabulariesService` at each write boundary so an unknown code stays a **400** rather than becoming a 500. See §4.8 |
| Containers   | Dockerfiles and Docker Compose profiles for API, web, simulator, **ingest** and DB |
| CI/CD        | GitHub Actions: install, build/typecheck, `typecheck:tests`, **the `apps/ingest` image build**, migration validation, **`db:seed` against a fresh schema**, **`db:refresh-aggregates`** (ADR 0023 — a no-op on a fresh database, since `db:seed` writes zero telemetry rows; it runs so the backfill path cannot rot unexercised), and `test:coverage` (ADR 0014). The Postgres service image is **pinned** to the same tag as `docker-compose.yml`, because the aggregate suite asserts behaviour measured on TimescaleDB 2.29.1. The image build is there because no workflow built one, so `apps/ingest/Dockerfile` sat broken on `main` while CI stayed green — it is the only ingest image gated, being the only one that installs before COPYing sources |
| Testing      | Vitest, one project per app + a repo-wide `repo` project; coverage gate on a ratcheting baseline (ADR 0014). See §4.6 |
| Cache / pub-sub | Redis 7 for Socket.IO adapter fan-out |
| Local dev    | WSL2 Ubuntu 22.04; native Postgres remains supported, Docker Compose is optional |

No new dependencies may be added without an ADR in `docs/adr/`.

---

## 3. Repository Layout

```
bms/
├── AGENTS.md                  ← this file (active)
├── CLAUDE.md                  ← pointer to this file for AI agents
├── README.md
├── ESKOM_SMOC.html            ← UX reference (do not edit)
├── TRINETRA.html              ← UX reference, current branding (do not edit)
├── package.json               ← pnpm workspace root
├── pnpm-workspace.yaml
├── vitest.config.ts           ← root test config + coverage ratchet (ADR 0014)
├── docker-compose.yml         ← Phase 1 local/pilot compose entrypoint
├── .github/
│   └── workflows/             ← GitHub Actions CI
├── .claude/
│   ├── agents/                ← review subagents (security, migration, compliance)
│   ├── hooks/                 ← tool-time guards on Edit/Write/MultiEdit (§9.11)
│   └── skills/                ← repo workflows (new-adr, backlog-cycle, verify)
├── .githooks/                 ← commit-time backstop for the same rules (§9.11);
│                                installed by `pnpm hooks:install`, which
│                                postinstall runs — core.hooksPath is per-clone
│                                configuration and cannot be committed
├── scripts/
│   └── checks/                ← the predicates BOTH hook entry points import.
│                                Not under .claude/: a non-Claude caller uses
│                                them, and a second copy could be weakened on
│                                one path while the other still passed (§9.11)
├── tests/                     ← repo-wide invariants; see the §4.6 carve-out
│                                repo-invariants.test.ts is the general file;
│                                repo-invariants-provenance.test.ts holds
│                                ADR 0028's (F4.39). They are split because the
│                                pair exceeds the §4.5 1000-line cap, so put a
│                                new value-honesty check in the second and
│                                anything else in the first — but the first is
│                                now 911 lines, so the NEXT check that does not
│                                belong to an existing ADR file needs a third
│                                file, not another append (F4.40). A check that
│                                does belong to one goes there instead:
│                                adr-0024-retention-bounds.test.ts took F4.40's
│                                compressed-delete rule for that reason, and
│                                F4.23 opened adr-0030-contract-derivation.test.ts
│                                rather than appending. F4.43's checks are in
│                                rule-vocabulary.test.ts — named for the SUBJECT,
│                                not an ADR, because it belongs to no ADR of its
│                                own (ADR 0030 Amendment 3 records it). Both
│                                conventions are live: adr-00NN-*.test.ts where a
│                                file tracks one ADR, a subject name where it
│                                does not. A new file here must ALSO be added to
│                                the typecheck:tests script — see §4.6
├── exports/                   ← PHE MQTT reference + point-mapping CSVs (ADR 0007/0011)
├── infra/
│   ├── keycloak/              ← Phase 1 Sprint C realm export
│   └── observability/         ← Phase 1 Sprint D Prometheus/Grafana/Loki config
├── apps/
│   ├── web/                   ← React SPA (incl. /admin master-data + onboarding wizard)
│   │                            src/lib/ is the ONLY part of this app any test
│   │                            or the coverage gate can see: the Vitest project
│   │                            runs environment:"node" over src/**/*.test.ts
│   │                            AND src/**/*.test.tsx, and vitest.config.ts
│   │                            includes apps/web/src/lib/** and nothing above.
│   │                            A component is NO LONGER unreachable — ADR 0042
│   │                            decision 2 makes jsdom opt-in per file, with a
│   │                            // @vitest-environment jsdom docblock on the
│   │                            .test.tsx wrapper. Shipped by F3.8 (ADR 0041 +
│   │                            0042, 2026-08-23); F3.1c and F3.1d are later
│   │                            users, not its origin. A component stays outside
│   │                            the coverage denominator either way, so the rule
│   │                            below is unchanged.
│   │                            Put pure logic there and keep components to
│   │                            wiring. ADR 0038 (F2.5) is the worked example:
│   │                            nineteen lib/ modules behind six tab .tsx files.
│   │                            src/components/asset-templates/formula-editor.tsx
│   │                            is the only module allowed to import CodeMirror
│   │                            — reach it through formula-editor-lazy.tsx.
│   ├── api/                   ← NestJS REST + WebSocket (incl. src/admin, src/security)
│   │                            src/admin/asset-templates/ holds ADR 0015's
│   │                            lifecycle + instantiation services, and
│   │                            ADR 0019's content contract.
│   │                            src/vocabularies/ serves AND enforces the FOUR
│   │                            open vocabularies — rule concerns and plant
│   │                            domains (ADR 0031 A1), alarm severities
│   │                            (ADR 0032), and alarm skills (ADR 0034). Its
│   │                            service is not a convenience:
│   │                            with the value set in a table rather than a
│   │                            z.enum, it is the only thing keeping an unknown
│   │                            code a 400 instead of a 500 from a foreign key.
│   │                            validateRuleDraft calls it, covering rule
│   │                            create, update, preview and publish.
│   │                            duplicateRule does NOT — it inlines its own
│   │                            insert copying current.category AND (since
│   │                            ADR 0032) current.severity, which the FK still
│   │                            accepts because the source row is valid, but
│   │                            which does NOT re-check `active`, so
│   │                            duplicating a rule whose category or severity
│   │                            was since retired propagates the retired code.
│   │                            The mirror of that gap: a rule already holding
│   │                            a retired severity becomes UNEDITABLE, because
│   │                            updateRule funnels through the same assertion
│   │                            even on an edit that never touches severity
│   │                            src/testing/ is test-only helpers (ADR 0025) —
│   │                            the one src/ directory excluded from
│   │                            tsconfig.build.json, so it is NOT runtime code.
│   │                            A runtime import of it fails
│   │                            tests/repo-invariants.test.ts (the tsconfig
│   │                            exclusion alone does not stop one: tsc
│   │                            re-admits an excluded-but-imported file)
│   │                            src/serialise/ is the ONE CSV escaping rule
│   │                            both exports share (ADR 0026) — a hand-rolled
│   │                            escaper anywhere else under src/, or a CSV
│   │                            producer outside apps/api/src, fails
│   │                            tests/repo-invariants.test.ts
│   │                            src/openapi/ generates the API document from
│   │                            the Zod schemas (ADR 0029) — openapi-registry.ts
│   │                            is the ONE place a route is joined to its
│   │                            schema, and there is deliberately no controller
│   │                            there: Amendment 2 deleted the guarded endpoint
│   │                            rather than leave a second, unreachable way to
│   │                            publish the route inventory
│   │                            src/calc/ is the ADR 0037 calc execution
│   │                            engine (F2.4) — five services (definitions,
│   │                            inputs, write, streaming, scheduled), no
│   │                            controller, wired via CalcModule with no
│   │                            HTTP surface of its own. See §2 *Calc engine*
│   ├── sim/                   ← telemetry simulator (Node script)
│   └── ingest/                ← PHE MQTT TLS subscriber (ADR 0007), five RTUs.
│                                ONE entry point since §6 commit 4 (2026-08-14):
│                                src/host/ + src/adapters/ + src/main.ts →
│                                dist/main.js, run by `pnpm start`. src/index.js
│                                was the frozen legacy path and is deleted;
│                                src/rtu-config.js stays — ADR 0012 seam
├── packages/
│   ├── shared/                ← cross-cutting TS types & constants, plus the ONE
│   │                            runtime policy both apps share: the ADR 0016 §5
│   │                            reconnect backoff in src/ingest.ts, used by the
│   │                            ingest supervisor AND the API telemetry listener.
│   │                            NOT in the coverage denominator — vitest.config.ts
│   │                            includes apps/* only, so moving covered code here
│   │                            silently removes it from the numerator.
│   │                            src/contracts/ holds the RESPONSE schemas
│   │                            (ADR 0030) and src/constants.ts the point-key
│   │                            catalogues that index.ts grew too large to hold.
│   │                            src/contracts/dashboard-builder.ts holds the
│   │                            ADR 0047 widget vocabulary and the per-type
│   │                            config union (F3.1a); src/asset-template-content.ts
│   │                            carries the template-side widget shape, which is
│   │                            STRICT where the contract is tolerant (§4.8).
│   │                            src/calc-dsl/ holds the bms-calc-v1 tokenizer,
│   │                            recursive-descent parser, AST types and
│   │                            validateFormula() (ADR 0036), plus since ADR 0037
│   │                            (F2.4) the pure evaluate() function apps/api/src/calc/
│   │                            calls — see §2 Calc DSL and Calc engine rows.
│   │                            ADR 0038 (F2.5) widened its index.ts to export
│   │                            tokenize/Token/TokenKind/CalcTokenizeError so the
│   │                            editor highlights from the same lexer that
│   │                            validates. TokenKind is now a FROZEN contract:
│   │                            adding a kind is a cross-package change.
│   │                            The package is no longer type-only: it depends
│   │                            on zod, and the ./contracts export entry in its
│   │                            manifest is what makes the subpath resolve at
│   │                            all under pnpm. Import it as @bms/shared/contracts
│   │                            from apps/web ONLY — apps/api compiles
│   │                            moduleResolution:"node" (node10), which ignores
│   │                            the exports map, so there the subpath fails tsc
│   │                            while WORKING at runtime; index.ts re-exports
│   │                            everything for that reason, as ./ingest already
│   │                            documents. REQUEST schemas stay in apps/api
│   │                            (ADR 0030 decision 3) — moving them would break
│   │                            ADR 0029's registry and its guard
│   └── db/                    ← Drizzle schema, migrations, seeds (incl. phe-catalog.json).
│                                src/schema/ splits the drizzle declarations:
│                                bms-schema.ts, telemetry-schema.ts, and since
│                                F3.1a dashboard-schema.ts (ADR 0047), which is
│                                its own file because bms-schema.ts was NEAR
│                                the §4.5 line limit (975 of 1000) — not because
│                                the tables are a separate concern
└── docs/
    ├── adr/                   ← Phase 1+ architecture decisions (the live scope record)
    ├── archive/               ← superseded planning docs, kept for provenance
    ├── scripts/               ← docx/report build helpers (not app code)
    ├── security/              ← encryption-at-rest boundary and security notes
    ├── AGENTS.production.md   ← future-state rulebook (reference)
    ├── BACKLOG.md             ← the single managed pending-feature backlog
    ├── build-operating-model.md ← how we build: the per-feature loop and gates
    ├── decisions.md           ← lightweight ADR log for prototype
    ├── env-inventory.md       ← committed environment variable inventory
    ├── observability-runbook.md ← Sprint D local/pilot health checks
    ├── phase-2-ingestion-readiness.md ← Sprint 0 source readiness workbook
    ├── roadmap.md             ← phase plan (prototype + add-ons)
    ├── windows-vm-docker-deploy.md ← Windows VM + Docker Desktop pilot
    └── local-setup.md         ← WSL + Postgres setup steps
```

Do not add top-level folders without updating this section.

---

## 4. Code Rules (lightweight)

### 4.1 TypeScript
- `strict: true`. No `any`. Use `unknown` and narrow.
- Exported functions get a one-line JSDoc.

### 4.2 React
- Functional components only. One component per file. **One standing exception,
  granted by ADR 0028:** `apps/web/src/components/static-value.tsx` holds
  `StaticValue` and `StaticTspan` together — the HTML and SVG renderings of one
  concept, which always change together, and splitting them would put the two
  halves of a single decision in different files.
- Data fetching via TanStack Query hooks in `apps/web/src/api/`.
- UI state via Zustand stores. No Redux.
- Styling via Tailwind utilities. Inline `style` only for dynamic values.

### 4.3 NestJS
- Module-per-domain: `auth`, `assets`, `alarms`, `telemetry`, `audit`.
- Controllers thin → services do work → repositories touch the DB.
- **A read on a tenant table defaults to `withTenant`; a `fleetDb` read needs a
  named reason recorded at the call site** (ADR 0043 Amendment 3). Inject both
  `TENANT_DRIZZLE` and `FLEET_DRIZZLE` deliberately rather than reaching for
  `fleetDb` by habit, the way the first master-data reads were wired — the
  reason must say what makes a single tenant GUC insufficient for that
  specific read (a genuinely fleet-wide `admin` view, a master-data surface
  resolving across organizations), and "it is how an earlier item did it" is
  not one. A multi-organization actor still falls back to `fleetDb` at run
  time on a `withTenant`-classified path; that fallback lives in
  `AccessControlService`, not in the service you are writing.
- Validate every DTO with Zod. Never trust input.
- **"Input" is not only HTTP, and that reading is what `F4.36` cost us.** The
  rule above was applied to every controller body and to none of the inputs that
  do not look like a DTO. The `bms_telemetry` `NOTIFY` payload was `JSON.parse`d
  and cast straight to `TelemetryReading[]`, and it reaches browsers over
  Socket.IO — so an unvalidated non-HTTP input had a shorter path to a client
  than any endpoint. It also stopped alarm evaluation: one `null` reading threw
  inside `AlarmThresholdService.collapseLatest`, which runs before any rule, and
  the throw is caught as a *warning*, so a single bad entry silently suppressed
  alarms for every good reading beside it. **The privilege boundary is the part
  worth remembering** — `NOTIFY` requires no table privilege at all, so a role
  with bare `CONNECT` and zero read access can publish to that channel. When
  validating a non-HTTP input, two things follow that a DTO does not need: bound
  the work (validation is dearer than a cast, and a size limit on the *payload*
  may not bound the number of *items*), and log rejections by **field path
  only** — a rejected payload is data of unknown provenance, so echoing it turns
  a validation failure into a log-injection surface.
- **Every CSV response goes through `src/serialise/csv.ts`** (ADR 0026). Never
  hand-roll cell escaping, even for "just two columns" — the repo had two exports
  with two rules and one of them omitted the formula guard, which is how an asset
  code beginning `=` reached a client's spreadsheet as a live formula. Text takes
  `csvTextCell`, **numbers take `csvNumberCell` and are deliberately unguarded**:
  Excel's formula reading of a numeric literal is the number itself, and prefixing
  an apostrophe would import the client's figures as text. Do not decide the split
  with a regex over the produced string — the two functions' parameter types decide
  it, and a raw string in a row is a compile error because `CsvField` is branded.
- **Build the rows where they can be tested without a `Pool`.** `energyCsv` had its
  rows inline in the service and was therefore never executed by a test at all,
  even after `F4.28` gave the rest of that file coverage. Serialisation lives in a
  pure `*.serialise.ts` beside the service — `admin/audit/audit.serialise.ts` and
  `reports/reports.serialise.ts` are the two models.
- **The API description is generated from the Zod schemas, never written
  alongside them** (ADR 0029). `@nestjs/swagger`'s decorators do not work here
  and it is worth knowing why before reaching for them: they derive schemas from
  TypeScript metadata on DTO classes, this codebase has none — `class-validator`
  and `class-transformer` are absent and 13 controllers declare
  `@Body() body: unknown` — so the generated document would describe every
  payload as an untyped object while looking complete. A new route is joined to
  its schema in `src/openapi/openapi-registry.ts`, keyed by Nest's
  `operationId`, and its schema must live in a `*.schema.ts`: one declared inside
  a controller is invisible to the registry and its payload silently vanishes
  from the document.
- **Follow every `.refine`/`.superRefine` with a `.describe()`, in that order**
  (ADR 0029 Amendment 1). `zod-to-json-schema` emits **nothing** for a
  refinement — no marker, no warning — so the document is strictly *more
  permissive* than the validator wherever one is unexplained, and a caller who
  trusts it receives a `400` the document says is impossible. Measured: 63
  schemas convert with zero failures while 11 refinement sites vanish. The
  message cannot be recovered from the schema (`.refine` captures it in a
  closure; `_def.message` is `null`), which is why the prose is authored rather
  than extracted. Order matters and fails silently:
  `z.string().describe("x").refine(…)` yields **no** description, because
  `.refine` wraps the described schema in a new `ZodEffects`.
  `tests/adr-0029-openapi-contract.test.ts` fails the build on both.
- **`.strict()` on a request body is a per-schema judgement, and the first
  question is how many producers share the schema object** (ADR 0029
  Amendment 3, `E7.1f`). Without it an unknown key is dropped and the write
  answers `200`, which every caller that is not `apps/web` reads as "accepted"
  — that is a contract defect even where containment is sound, and it is how
  `PATCH {"name":"x","organizationId":"<other-tenant>"}` reported a tenancy
  move that never happened. So decide it per node and **record the decision**:
  `apps/api/src/openapi/strict-body-ledger.spec.ts` walks every object
  reachable from the registry and fails the build on one that carries none, or
  on a permissive one with no reason given. A blanket sweep is explicitly not
  the rule.
  **The judgement is not "is an unknown key a caller error?" — that assumes
  there is one caller.** `E7.1f` made the onboarding draft strict and broke two
  things, because those same schema objects also validate the **stored** draft
  (it carries `_secrets` once a credential is set, so `readyToCommit` could
  never become true again and the ADR 0022 pilot deadlocked) and the **model's**
  `draftPatch` (read as `.data ?? {}`, so one invented key discarded the
  operator's whole turn while the assistant still reported success). Count the
  producers first; strictness is only right where every one of them is a caller.
  Neither failure was visible to `pnpm test` — `_secrets` needs
  `CREDENTIAL_ENCRYPTION_KEY`, which CI does not set.
  Two traps: `.strict()` must precede `.refine()`, because a `ZodEffects` has
  no `.strict()`; and `.catchall()` leaves `_def.unknownKeys` reading
  `"strict"` while the object **accepts** unknown keys, so never conclude
  strictness from that field alone. What does **not** change is the emitted
  document — Errata 1 measured 73 `additionalProperties: false` and 0 `true`
  either way, so nothing about `.strict()` is visible there and no fixture is
  ever regenerated for it.
- **Where the OpenAPI docs are served they are unauthenticated, so they are
  absent by default** (ADR 0029 Amendment 2). There is no guarded state and
  attempting one is wasted work: Swagger UI does not send an `Authorization`
  header when it fetches the spec, so a guarded document renders as "No
  operations defined in spec!" and nothing in the page can recover it.
  `API_DOCS_ENABLED` gates the whole route — unset means on everywhere except
  `NODE_ENV=production`, and the API image sets `NODE_ENV=production`, so the
  compose stack serves nothing until a developer opts in through their own
  `.env`. Turning it on publishes the complete route inventory, including the
  §4.7 operations matrix and the ADR 0012 credential endpoints, to anyone who
  can reach the port. **Do not describe an enabled instance as protected.**

### 4.4 SQL (Postgres / TimescaleDB)
- Schema-qualified (`bms.assets`, `telemetry.point_values`).
- Snake_case columns. `TIMESTAMPTZ` everywhere.
- Parameterised queries only.
- **A tenant-scoped read runs inside a transaction, never on a bare
  connection** (ADR 0043 decision 10). `SET LOCAL app.current_organization` is
  discarded at `COMMIT`/`ROLLBACK`, and `DatabaseModule`'s pool reuses
  connections across requests, so a read outside `withTenant`'s transaction
  either sees no tenant at all (the policy refuses everything) or, on a plain
  `SET`, leaks the previous caller's tenant to the next one on the same
  connection. If a read path cannot be wrapped in a transaction, it is not
  permitted to touch a tenant table.
- Migrations are forward-only. Never edit a merged migration.
- **No new `bms.*` table ships without `organization_id` and a
  `tenant_isolation` policy under `FORCE`** (ADR 0043 decision 5), unless it is
  platform vocabulary with no tenant data (`asset_domains`, `rule_categories`,
  `alarm_severities`, `alarm_skills`, and — since ADR 0049 — `asset_roles` and
  `dashboard_sections`, and — since **ADR 0051** decision 2, `F3.39` —
  `point_keys`) or the stated `telemetry.*` exception (decision 9).
  **The ruling is not only about a NEW table.** `bms.point_keys` was tenant
  data for the whole of its life until migration `0057` dropped its
  `organization_id`, its unique index, its policy and its FORCE flag together —
  so an existing table can be re-ruled into platform vocabulary, and the same
  §10 gate applies.
- **A platform-vocabulary table has no policy, so its GRANTS are its only
  containment — and they must be narrowed the moment it grows a tenant-pool
  writer.** `0041:112` grants `SELECT, INSERT, UPDATE, DELETE` on every `bms`
  table to `bms_tenant` by default privilege. That is harmless while nothing
  writes the table on that connection, and it is the entire control once
  something does. `bms.point_keys` is the first: `OnboardingCommitService`
  inserts inside `withTenant`, which **ADR 0051 Amendment 1** authorises, and
  migration `0059` (**Amendment 4**) revokes `UPDATE` and `DELETE` so the
  database draws the line the ADR draws. The other six still hold all four
  verbs, deliberately, because none of them has such a writer. Adding one is
  what makes a matching revoke owed.
  **`bms.asset_roles` grew a writer in `F3.40` and still owes no revoke** —
  which is the rule working, not an exception to it. `AssetRolesAdminService`
  writes on `FLEET_DRIZZLE`, so `bms_tenant` never reaches the table and its
  `0041:112` grant stays as latent as it was before that service existed. **The
  trigger is the POOL, not the existence of a write path**, and the service
  header says so where the next author will read it.
  **Nothing machine-checks this.** `0059` was written by hand because a review
  asked for it, and a future row that adds a tenant-pool writer and forgets the
  revoke fails no gate. An invariant over the seven tables is owed and unfiled.
  **"Platform vocabulary" is a ruling each time, not a shape you may recognise**:
  ADR 0049's own Consequences said both of its tables were tenant-scoped, and
  Amendment 1 exists because that was false for `asset_roles` and a review
  predicted an implementer would follow the sentence as written. A junction
  table inherits through its parent and takes a policy that follows the
  parent's column — no policy joins another table to discover the tenant.
- **Since ADR 0045 a migration declares which role it runs as, and the default
  is `bms_owner`.** The migrator always *connects* as `bms_app` — a fresh
  database replays the whole chain and `0039:33` needs `SUPERUSER` — so the
  choice is made per file, not per connection.
  - **Default: take the role.** A file that creates or alters objects
    `bms_owner` owns opens with `SET ROLE bms_owner` and closes with
    `RESET ROLE`. `0041` is the model.
  - **Exception: say so in the header.** Some statements cannot be run by
    `bms_owner` at all — a cross-role `ALTER … OWNER TO`, a role-membership
    `GRANT` (needs `ADMIN OPTION` or `SUPERUSER`), a `GRANT` on objects another
    role owns. Those files run as `bms_app` with **no** `SET ROLE`, and each one
    states the reason in its header. `0042`–`0045` are the shipped examples;
    do not "fix" them by adding a `SET ROLE`, which fails with
    `permission denied`.
  - **Never widen the provisioning surface.** If a file needs `CREATE ROLE`,
    `ALTER ROLE … BYPASSRLS` or `CREATE EXTENSION`, it does not belong in a
    migration — it belongs in `packages/db/src/roles.ts`, which runs before
    `db:migrate` as the provisioning identity.
  **Only the `RESET ROLE` half is gated**
  (`tests/adr-0045-owner-and-superuser-url.test.ts` asserts the conditional: a
  file ≥ `0041` that issues `SET ROLE` must also issue `RESET ROLE`). Nothing
  machine-checks which branch you picked, so the header sentence is the record.
  **`RESET ROLE` is the half that bites**: a forgotten one leaks past `COMMIT`
  into the session, so drizzle's own journal `INSERT` and every later file in
  the same run execute as `bms_owner`, which holds no grant on the `drizzle`
  schema. Measured, not predicted.
- **`CREATE INDEX CONCURRENTLY` cannot be used in a migration here, and the
  reason is structural rather than stylistic.** `packages/db/src/migrate.ts`
  calls drizzle's `migrate`, which wraps the whole run in one transaction
  (`pg-core/dialect.js`: `await session.transaction(...)`) — verified in the
  pinned `drizzle-orm@0.38.4` rather than assumed — and Postgres refuses
  `CONCURRENTLY` inside a transaction block. So an index migration takes a plain
  `CREATE INDEX ... IF NOT EXISTS` and holds a write lock for its duration.
  `0049` (`E7.1i`) is the model and
  `tests/e7.1i-audit-log-index.test.ts` asserts the absence. On a large table
  that lock is a real deployment consideration; the answer is to schedule the
  migration, not to reach for `CONCURRENTLY` and discover it at deploy time.
- **Objects created by a new owner need their own default privileges.**
  `ALTER DEFAULT PRIVILEGES` applies only to objects created by the role it
  names, so `0039`'s four `FOR ROLE bms_app` statements stopped covering
  anything once `bms_owner` began creating tables; `0041` mirrors all four
  (TABLES *and* SEQUENCES, both schemas). A new grantee role, or a third schema,
  needs the mirror too — the failure is a new table reaching **no pool role at
  all**, which surfaces one endpoint at a time rather than as a migration error.
- Telemetry table is a Timescale hypertable; `chunk_time_interval = 1 day`.
- **The retention ladder (ADR 0024, migration `0028`)** — raw `point_values`
  compresses at **7 d**, drops at **730 d**; `_1m`/`_5m` compress at 7 d, drop at
  **735 d**; `_1h`/`_1d` are **never dropped and never compressed**. Do not
  "tidy" 735 to 730: an aggregate must outlive its source **strictly**, or the two
  independent policy schedules can leave raw holding a period its aggregate does
  not — which reads as **empty**, not as an error, and which no refresh repairs.
- **Read telemetry rollups through `apps/api/src/telemetry/point-aggregates.ts`,
  not with your own `date_trunc`/`time_bucket` SQL** (ADR 0023). The mean is
  `sum(sum_value) / sum(sample_count)` — **never** an average of averages, which
  was wrong in 151 of 169 buckets on real data and which a total-level test does
  not catch. Never add an `avg_value` column to an aggregate.
- **Pick the level with `levelForRange`, never an inline ternary, and never from
  the window's duration alone** (ADR 0025). Retention is about how far *back* a
  range reaches: a duration-keyed selector routes a 24-hour range dated three
  years ago to `_1m`, which drops at 735 days and then reads as **empty**, not as
  an error. The range's `end` is not an input — it is routinely in the *future*,
  because `reports.service.ts` sets it to `endDate T23:59:59.999Z` and because the
  ingest writes ahead of `now()`.
- **Use `bucketHours()` for every kWh figure, including where the factor is 1, and
  for *every* energy term in a query rather than just the total.** Two reports
  queries treated `SUM(kw)` as kWh directly — right only because the buckets were
  hours, and written down nowhere. No test can catch either mistake while the
  level makes the factor `1`, so both are asserted statically in
  `tests/adr-0025-level-selector.test.ts`.
- **When a guarantee cannot be expressed as a behavioural test, write a static one
  — and say which it is.** ADR 0025 has two: a rollup read reverting to
  `date_trunc` over raw is invisible to every parity test, because those compare
  against the raw query being replaced and a revert compares it with itself
  (measured — a fully reverted `loadTrend` left the suite green); and a dropped
  `bucketHours` factor is invisible while the factor is 1. `tests/` is where these
  live, beside the ADR 0017 write-gate check. **ADR 0026 adds a third, and a
  cheaper mechanism worth reaching for first:** a second copy of the CSV escaping
  rule is caught statically, because a new export with its own escaping passes its
  own tests perfectly — but the guarantee that an *unescaped* cell cannot enter a
  row is a **branded type**, so it is a compile error rather than any kind of test.
  When a type can carry the invariant, prefer it; a static test is the fallback,
  not the goal.
  **ADR 0016 §6 commit 4 adds a fourth, and it is the clearest case of why the
  mechanism has to be static:** nothing fails when a *second* ingest entry point
  merely appears — a resurrected `src/index.js` beside `main.ts` reads as an
  addition, not a regression, and every existing test still passes. Same for a
  reintroduced `INGEST_NOTIFY`. Both are pinned in `tests/repo-invariants.test.ts`.
  A test that is *invariant under the change it guards* is the recurring trap here
  — `F4.1` shipped one, `F4.28` shipped two more, and `F4.29` shipped a third, each
  caught in review. Assume your new guard has this defect and **mutate the code to
  prove it fails**; six of the seven instances looked convincing until someone did.
  **And mutate against the shapes you did not write, not only the one you did**:
  `F1.1`'s invariant matched `env.INGEST_NOTIFY`, which looks tight and is weak —
  `env["INGEST_NOTIFY"]`, `const { INGEST_NOTIFY } = env`, a `getEnv("…")` helper
  and compose's list form `- KEY=value` all walked through it, and the compliance
  review found all four. Strip comments and match the name.
  **`F4.34` adds a fifth instance with a different mechanism, and it is the one
  to watch for next**: the guard was not weak, it was **unreachable**. A new
  reconnect stability window keyed off `connectedAt`, using `0` for "never
  connected" — and the injected test clock legitimately read `0`, so the two
  aliased, the reset never fired, and the mutation deleting the window
  *survived*. A sentinel that collides with a legal value silently kills the code
  it guards, and no assertion about behaviour can see it because the behaviour
  never runs. The same round also had a test that asserted on Node's
  `MaxListenersExceededWarning` to prove an abort-listener leak; that warning is
  never emitted for an `AbortSignal`, so the test passed either way. **Assert on a
  count you can read** (`getEventListeners(signal, "abort").length`), never on a
  diagnostic you hope the runtime emits.
  **`F4.37` adds a sixth instance, and its mechanism is neither weakness nor a
  sentinel collision: the guard was correct and simply never ran again.**
  Staleness is computed during render, so it is only re-evaluated when something
  re-renders — and the only thing that reliably did was an incoming reading. The
  guard exists to detect readings *stopping*, so in exactly the case it was
  written for, nothing re-invoked it and every tile froze on its last verdict.
  The clamp underneath it was fully unit-tested and would have shipped doing
  nothing. **Ask what re-invokes a guard, not only whether it is right** — a
  guard whose trigger is the signal it watches for the absence of can never
  fire. This class does not appear in a unit test, because the test calls the
  function itself; here it took a static invariant to hold the wiring, and both
  deletions that disable it (removing the timer, dropping it from the context
  memo) left 53 of 54 test files passing.
  **`F4.38` adds a seventh, and it is the one to watch whenever you write a
  static invariant**: the guard was defeated by an **unrelated legitimate call to
  the same function in the same file**. The invariant asserted that each
  control-room page calls `isStale(` — searching the whole file. Two pages call
  it a second time for an unrelated header value, so deleting the *status guard*
  outright, restoring the very defect the item fixed, left every test green.
  Reproduced before fixing: the same deletion on a page with one call was caught;
  on a page with two it was not. **Scope a static check to the construct it is
  about** — the function body, the dependency array, that specific call — never
  to "does this token appear anywhere in the file". A file-wide search is
  satisfied by a decoy, and the decoy is usually code you wrote yourself for a
  good reason. The same round produced two more invariant defects deserving the
  same suspicion: one regex **failed on clean code**, so its "kill" was spurious;
  another passed on clean code and still let the mutation through, because it
  matched a different call site. **Run every new invariant against the unmutated
  tree first** — a check that fails on clean code proves nothing when it fails on
  mutated code.

  **`F4.39` adds an eighth, and it is about how you *choose* mutations rather
  than how you write the check.** Its invariants were mutation-tested and passed
  — against the shapes their author had just written. Two review rounds then
  killed **nine** more, three of which mattered: restoring the two literal
  battery voltages, *verbatim the defect the item existed to fix*, passed
  everything; gutting both marker components so they rendered `{children}` left
  every call site correctly wrapped, the unit spec green, and **no marker
  visible anywhere in the application**; and hoisting an offset one line up
  (`const voltageY = q1.voltage + 0.7`) moved it outside the construct the scan
  reads. **Mutate against the shapes you did not write** — the original defect
  restored verbatim, the guard rendering nothing, the expression hoisted out of
  the construct. And note the second of those is the `F4.37` class arriving from
  a new direction: every check asserted that *call sites use* the guard and none
  asserted the guard *does* anything, so write the check that the thing you are
  enforcing with is itself alive.

  **`F4.23`/`F4.43` add the other end of this, and it is the one that makes you
  delete work you are proud of.** The bullet above says to prefer a type over a
  static test. Prefer **construction** over both: `F4.43` built its read
  vocabulary as `[...authorableRuleCategorySchema.options, "electrical"]`, so
  "the read vocabulary contains the write vocabulary" was true by the way it was
  written and there was nothing left to check. **The corollary is that the guard
  you would have written must then be deleted, not kept** — a tautology that was
  meaningful when it was written is the hardest dead guard to notice later,
  because its history argues for it. Two instances in two items: `F4.23` proved
  the schema migration with **81** assertions of strict type identity between
  each schema and the type it replaced, then deleted all 81 — after the switch
  they compare `z.infer<typeof S>` with itself; and `F4.43` did not write the
  containment test at all, for the same reason one line later. Neither deletion
  loses a guarantee. What survives is the part that is *not* structural, which
  for `F4.43` is "nobody restates a vocabulary" — a **source scan**, deliberately,
  because comparing the two enums' values passes just as happily when someone
  re-inlines the literal and keeps it in sync today.

  **`F4.45` is what this rule looks like when it comes due, and it is worth
  reading before you argue for keeping something.** `F4.44` had built a lock so
  the rule builder could show a category no operator may author; it was correct,
  load-bearing, and the only thing protecting 48 rules while the vocabulary
  question was open. ADR 0031 then made a non-authorable category *structurally
  impossible*, so the lock could never fire again — and it was **deleted**, along
  with its module. Two things made that happen rather than drift: the lock's own
  spec carried an assertion saying *if these two vocabularies are ever equal,
  this module should be deleted rather than left passing*, and it **fired**; and
  the ADR named the exact symbols to remove in its Consequences. **Write the
  tripwire that tells the next person your guard is dead**, because by then its
  history will argue for it and the code will still be green.

  The same item is also the cautionary half. A guard is only as good as its
  ability to match its own subject: `F4.45`'s first attempt at a
  "nobody re-inlines the enum" scan searched for `assetDomainSchema`, a symbol
  that **has never existed in this repo** and is not even a substring of the
  live `assetDomainCodeSchema` — so a real revert would have walked through it
  reporting success. If you write a source scan, add a case that proves the
  pattern still matches a violation, or you have written a comment.

  The same item produced a corollary worth its own sentence: **fixing the
  instance is not fixing the class.** Two findings from one review round were
  each "the same defect one call site over" from a fix made in the round before
  — a helper applied to a detail card but not the summary table beside it, a
  threshold extracted and adopted on one page while the page that named the
  concept kept both its copies. Both fixes then survived mutation themselves
  until a check was added for the class. When a review hands you an instance,
  grep for its shape before calling it closed.
- **A `DELETE` from `telemetry.point_values` does not remove the aggregate rows,
  and no scheduled policy repairs it.** Follow any such delete with
  `refresh_continuous_aggregate` over the deleted range for all four levels,
  finest first. Migrations `0014` and `0021` are precedents that predate the
  aggregates; the next one of that shape must do this. `F4.1`'s own test suite
  violated this rule and orphaned aggregate rows on every run — fixed in `F4.2`.
  **Copy what those two migrations do about aggregates, not how they write the
  delete** (`F4.40`) — see the next bullet, which they would now fail.
- **A `DELETE` from `telemetry.point_values` must filter `asset_id` or
  `point_key` with a *constant*, and must not reach the table through a
  subquery, CTE or join.** Migration `0028` segments the table by those two
  columns, so a constant filter on either is evaluated against compressed
  batches without opening them. Anything the planner cannot fold to a constant
  makes TimescaleDB decompress **every** batch to evaluate the predicate, and
  past `max_tuples_decompressed_per_dml_transaction` (100000) that is a hard
  error, not a slow query. Measured in `F4.40` on a dev database with 4 of 15
  chunks compressed: **186706 tuples decompressed while matching zero rows** —
  the cost is set by what the statement must *examine*, not by what it deletes,
  which is why no amount of scoping the target helps. Resolve ids in a prior
  statement and filter on them directly. A time bound also avoids it and is the
  weaker fix: it holds only while no compressed chunk falls inside the bound,
  which silently couples the caller to this file's 7-day threshold.
  `tests/adr-0024-retention-bounds.test.ts` holds this for `.ts`. It cannot hold
  it for `.sql`: `0014` and `0021` both use `DELETE ... USING <temp table>`,
  they were correct when written, and they are merged and forward-only — so the
  rule for the next migration lives here and nowhere else.
- **But that rule is conditional, and ADR 0024 is what made it so: refresh only
  where raw still holds the range.** Since retention exists, a refresh over a
  range raw has *dropped* is the opposite of a repair — it recomputes from an
  empty source and **deletes** the rows, and where that range is older than raw's
  730 days those `_1h`/`_1d` rows are the only surviving record of the period.
  Measured: 34,596 aggregate rows to 7,068. Nothing rebuilds them. So: raw still
  covers the range → refresh it; raw no longer does → the aggregate **is** the
  archive, leave it alone.
- **And there is a third case, which ADR 0025 added: nothing was ever
  materialised, so there is nothing to repair and a refresh would be the harmful
  act.** `F4.28`'s suite dates its fixture **ahead of `now()`**, and no refresh
  policy or script in this repo passes an upper bound later than `now()` — every
  policy stops at `now() - end_offset`. So its rows never enter an aggregate, and
  its `DELETE` cannot orphan anything. Refreshing over that range instead would
  push a watermark into the future and degrade the database permanently, which is
  the failure ADR 0023 warned about. **This exemption is only available if you
  prove it**, not if you assume it: that suite asserts the fixture is visible only
  through the live branch, asserts every policy's `end_offset` is strictly
  positive, and asserts after the delete that all four views hold **zero** rows for
  its assets. Without those three, follow the rule above.
- **Never refresh a level over a range its own source cannot supply**, and note
  that only `_1m`'s source is raw — `_5m` reads `_1m`, `_1h` reads `_5m`, `_1d`
  reads `_1h`. `pnpm db:refresh-aggregates` derives a per-level floor for exactly
  this reason. A single floor taken from raw and applied to all four is correct
  only for `_1m` and silently destroys `_1h`/`_1d` whenever raw's retention runs
  ahead of `_1m`'s.

### 4.5 Style hygiene
- File names: `kebab-case` for files, `PascalCase` for React components.
- No abbreviated domain words (`asset`, not `as`; `alarm`, not `alm`).
- Max **1000 lines per file** in the current phase.
- No `console.log` in committed code; use the shared logger (Pino).
- No emoji in code or commits unless explicitly requested.
- **These four are machine-checked twice** — as a Claude tool guard and again at
  commit time (§9.11). Both read **added lines only**, never the whole file, so
  a pre-existing violation in a legacy module never blocks a commit that merely
  touches it. The 1000-line cap is the exception and is read whole-file: a file
  only crosses it because of the edit in hand.

### 4.6 Testing (ADR 0014)
- **Runner: Vitest.** `pnpm test` runs everything; `pnpm test:coverage` is what
  CI enforces. Never add a second runner without an ADR (§9.4).
- **Assertions live in `*.spec.ts`; `*.test.ts` is the wrapper that runs them.**
  A `.spec` without its sibling `.test` is dead code — `tests/repo-invariants.test.ts`
  fails the build if you add one. Do not delete the spec to make it pass.
- **Carve-out: the split applies to `apps/**` and `packages/**` only.** Files in
  the top-level `tests/` directory are repo-wide invariants and hold their
  assertions **inline**, with no `.spec` sibling. Giving `repo-invariants.test.ts`
  a `.spec` partner would mean the file enforcing the convention is the one file
  that cannot follow it. Do not "fix" these into the split.
- **Integration suites gate on `DATABASE_URL`, and the gate is asymmetric.** An
  unset `DATABASE_URL` skips locally but **throws under `CI`** — a green CI run
  that silently skipped the database tests asserts nothing. A *set* one is a
  claim that a database exists, so a failed connection fails everywhere rather
  than skipping. Coverage thresholds assume these suites ran.
- **CI's database is created per run, so it has no history — and the asymmetry
  runs the other way too** (`F4.40`). Everything that accrues over a database's
  life is absent there by construction: compressed chunks, retention having
  fired, watermarks, and every lifetime counter in
  `timescaledb_information.job_stats`. A suite can therefore be **permanently
  green in CI and structurally red on every real database**, which is worse than
  the reverse, because the pipeline reports success while the people who run the
  suite learn to ignore it. Two instances, both found on `main` with CI green:
  a fixture cleanup that failed on any database older than the 7-day compression
  threshold — every developer's, after the first week — and an assertion that
  `job_stats.total_failures = 0`, a cumulative counter that never resets, so one
  transient failure reddened the suite for the life of that database (measured:
  1 failure against 432 successes, `last_run_status = Success`, the aggregate
  current). **Never assert on a lifetime counter**; assert the thing that
  describes now, which for a policy is `last_run_status`. And when a check can
  only ever fail outside CI, say so where it is written — that is a static
  invariant's job, not a suite's. Held in `tests/repo-invariants.test.ts`.
- New behaviour ships with its test in the same PR. Bug fixes ship with the
  test that would have caught the bug.
- **Coverage is a ratchet, not a target.** Thresholds in `vitest.config.ts` sit
  just below the current measurement; raise them as coverage rises. Never lower
  a threshold to make a build pass, and never use `thresholds.autoUpdate` —
  that converts the gate into a rubber stamp. `docs/AGENTS.production.md` §10's
  80% lines / 70% branches remain the destination, not the current rule.
- A check that CI does not execute is not a gate. When you add a test suite,
  script, or invariant, wire it into `.github/workflows/ci.yml` in the same
  change — this repo has shipped orphaned specs and orphaned migrations before.
- **A new file in `tests/` must be added to the root `typecheck:tests` script by
  hand.** That script names each file explicitly rather than globbing, because
  `tests/` has no `tsconfig.json` of its own and the flags are passed on the
  command line. So a new invariant file is type-checked by nothing until it is
  listed, and `pnpm test` passing tells you only that it *ran* — vitest strips
  types with esbuild and never checks them. `F4.23` and `F4.43` each added a file
  and each had to edit that line.
- **You cannot instantiate a Nest module in a test here, and it is not worth
  discovering that twice** (`F4.20`). Vitest transforms TypeScript with esbuild,
  which does **not** emit `design:paramtypes`, so Nest's constructor injection
  resolves every dependency to `undefined`: building `AppModule` dies in
  `TelemetryGateway.afterInit` with `this.hub` undefined, and no websocket
  adapter fixes it because the cause is missing metadata. That is why every
  integration suite here constructs services directly — `new
  DashboardService(pool)` — and it is a constraint rather than a style. Changing
  it means an swc transform, which is a §9.4 dependency ADR. Until then, a
  guarantee that needs the running application is either a static check over the
  source or a documented manual verification — **and if it is manual, say so in
  the test that stands in for it**, so the substitute is never mistaken for the
  gate.
- **A static check is not a substitute for reading what is served.** `F4.20`
  shipped a green suite, `pnpm typecheck`, `pnpm typecheck:tests` and a static
  invariant, and the served document still (a) published every route
  unauthenticated through `swagger-ui-init.js`, (b) dropped every cross-field
  rule from its query schemas, and (c) could not be read at all from the UI it
  shipped with. All three were found by fetching the document from the running
  container. §4.6's deployment rule is not a formality for UI work.

**Green tests are not a deployment. Verify every item against the running
Docker stack before calling it done** — the database, the API and the browser,
whichever of the three the change touches. State the result in the closure
record, and name the layers that were **N/A** rather than omitting them, so a
reader can tell "not applicable" from "not checked".

This is not ceremony. Every item that has done it found something the suite
could not:

- `F4.28` — the running API container was still serving *compiled* code from
  before the change. Proved stale by grepping `dist/` for the old query, then
  rebuilt. A passing suite says nothing about what is deployed.
- `F4.34` — the pre-fix crash was reproduced against a live Postgres by
  terminating the connection server-side, which is what established it was an
  API-wide outage rather than a stale-dashboard defect.
- `F4.36` — publishing one malformed payload showed the real damage was
  **alarm suppression**, not a cosmetic cast. That reframed the item and settled
  its open design question on evidence.
- `F4.38` — the deployed page rendered four leak sensors as `DRY` and four smoke
  sensors as `NORMAL` after three hours of silence. It also exposed a bug no test
  could reach (one tile read "4 sensors · 8 stale") and raised `F4.39`.

**Prove the artifact is not stale before you read anything from it.** A rebuilt
image and a reloaded page are different things:

- Containers serve the image they were started with. `docker compose build` does
  not restart anything — `up -d <service>` does. Confirm the new code is really
  in there (grep the compiled output, or check the served bundle hash).
- **The browser caches the bundle, and a cached read looks exactly like a failed
  fix.** In `F4.38` the first page read after a correct rebuild showed the
  pre-fix output; a hard reload showed the fix working. Had that been taken at
  face value it would have sent someone debugging code that was already right.
  Hard-reload, and confirm the served asset hash changed.

**Check both directions.** That the defect is gone is half of it; the other half
is that the fix does not fire when it should not. `F4.38` stopped the simulator
to watch tiles go stale, *and* ran it to confirm live assets still render
normally — a staleness gate that marks healthy plant offline is its own defect.

### 4.7 Authorization (ADR 0009/0010 master data · ADR 0017 operations)

Five role gates exist and they are **not** interchangeable — this section
already documented four before `E7.1c` added the fifth, and the opening line
had fallen behind that count before this sweep corrected it. All five
resolve the role from **`bms.users`, never from the JWT claim** — a token outlives a
demotion by up to `JWT_TTL`, and in OIDC mode `roleFromClaims` falls back to
`viewer` when realm roles are missing, so reading the claim fails *open* on
demotion and *closed* on a claimless admin token.

**Master data** (`/admin/*`) — scope predicates on `AccessControlService`:
`writableOrganizationIds` / `writableLocationIds` return `null` for the
unrestricted global admin, and an **empty array is a real user with no grants**
who must see nothing. Never treat the two as equivalent.

**TWO global vocabularies are carved out of that gate and use no scope
predicate at all** — `bms.point_keys` (**ADR 0051** decisions 2 and 3, `F3.39`)
and, since `F3.40`, `bms.asset_roles` (**ADR 0051** decision 5). Neither is a
sixth gate: it is the master-data gate answering a different question. A scope
predicate asks *which organizations may this user write*, and a global
vocabulary belongs to none of them, so both services gate every mutation on
**`isGlobalAdmin`** instead. `PointKeysAdminService` gates all four of its
mutations that way, and `AssetRolesAdminService` both of its two —
`POST`/`PATCH /api/v1/admin/vocabularies/asset-roles`.

**Expect a third, and gate it the same way.** The carve-out is not a property of
these two tables; it follows from a table having no `organization_id`, which is
§4.4's platform-vocabulary class. `bms.point_keys` was tenant data until
migration `0057` and `bms.asset_roles` was global from `0051`, so the two
arrived from opposite directions at the same rule. The test is the column, not
the history.

**READS ARE A DIFFERENT QUESTION FROM WRITES, and both tables split them the
same way.** `requireMasterDataUser` guards the reads; only the writes reach
`isGlobalAdmin`. `AssetRolesAdminService.list` is deliberately a
master-data-role read even though its siblings are `admin`-only, because
`GET /api/v1/vocabularies` serves **active codes only** — without an admin read
that shows retired ones, `PATCH { active: false }` would be one-way and no
picker could ever offer the code again. Which codes exist reveals nothing about
any tenant's estate.
`canManagePointKey` still exists on `AccessControlService` and **no longer
governs point keys** — it is kept deliberately as the documentation template for
two live methods and says so in its own comment; do not delete it, and do not
call it from the point-key service. Reads stay open to the master-data role set,
so the split is real: `canReadPointKeyCatalog` and `canWritePointKeys` in
`apps/web/src/lib/admin-access.ts` are the front-end half of the same rule.

**The one write that is not global `admin`** is the onboarding commit path,
which may *create* a code at `organization_admin` under **ADR 0051 Amendment
1** — extend, never edit. Since **Amendment 4** the database enforces that half
too: migration `0059` revokes `UPDATE` and `DELETE` on `bms.point_keys` from
`bms_tenant`, leaving `INSERT` and `SELECT`. A tenant-pool `UPDATE` would
otherwise retire a code for the whole fleet, and only a global admin could undo
it.

**Operations write matrix** (ADR 0017) — mutating endpoints across rules,
alarms, work orders and maintenance carry
`assertOperationsWriteRole(jwt, class)` at the top of the handler, **before**
the scope check, so a role rejection never depends on scope resolution. The
class literals are exactly `OperationsWriteClass` in
`apps/api/src/auth/operations-write.ts`:

| Class | What it means | `operator` | `viewer` |
|---|---|:-:|:-:|
| `configuration` | changes what the system *will* do, indefinitely — rule authoring, schedule definition, `rules/evaluate`, `rules/preview` | ❌ | ❌ |
| `operational` | records what *did* happen — alarm ack, work-order lifecycle, converting a due schedule | ✅ | ❌ |

The four admin roles keep exactly what they had; this gate regressed nobody.
`rules/preview` is `configuration` despite looking read-only — it inserts a
`rule_preview` row into `bms.audit_log` on every call. **The gate is additive:
callers must pass this AND the existing scope check.**

Instantiating an asset template is the one place the two systems meet: it needs
template *readability* plus `canManageLocation` on the target, so a location
admin may deploy a published org template without being able to author one
(ADR 0015 §7 as amended). Do not require `canManageTemplate` there — it means
"may author" and is false for exactly that role.

**Audit read** (ADR 0021, `F4.14`; widened by **ADR 0046**, `E7.1e`) — a
**third** gate, reusing neither of the two above. `bms.audit_log` gained
`organization_id` under ADR 0043 (nullable — decision 5's platform-event
exception) and, since `E7.1e`, that column finally has a reader:
`AuditAdminService.resolveReadScope` runs **three** checks in order.

1. A matching **`bms.users` row must exist** — the provisioned-account probe.
2. `requireMasterDataUser`, which refuses `asset_group_admin`.
3. The role must be `admin` or `organization_admin`. Only then is
   `writableOrganizationIds` consulted, and **only for the scope**: `null`
   reads every organization, an array becomes
   `inArray(auditLog.organizationId, ids)`.

**Check 3 is keyed on the role resolved from `bms.users`, never on the shape of
the scope array**, and ADR 0046 Amendment 1 exists because decision 3's original
wording said otherwise. `writableOrganizationIds` resolves a `location_admin`
through `locationDerivedOrganizationIds` — its **whole organization**, not its
granted locations — so a gate keyed on "a non-empty array means a scoped read"
admits the role decision 4 refuses and hands it every audit row its organization
owns. That is this section's own read-gate-wider-than-write-gate lesson, on a
more sensitive endpoint. Nor is it keyed on `jwt.role`: a token outlives a
demotion by up to `JWT_TTL`.

**`organization_id IS NULL` is never in a scoped reader's result set** (decision
2) — not pre-`0048` un-attributed history, not a genuine platform event.
`inArray` never matches `NULL`, so the ruling costs no clause, which is exactly
why the integration suite asserts it directly rather than leaving it to fall out
of an implementation detail. `location_admin` and `asset_group_admin` stay
refused (decision 4): their scope is *sub*-organizational, an audit row carries
an organization and nothing finer, so returning their organization's rows would
silently widen them to `organization_admin`.

**A scoped reader sees `actorEmail` but never the acting operator's
`oidcSubject`** — ADR 0046 Amendment 2, the same projection rule as Amendment 6
below. `E7.1e` moved no column; it moved the audience, and sixteen write sites
across six services put `oidcSubject` at the top level of the audit `payload`,
which ADR 0021 returns verbatim. **`E7.1h` shipped it** (PR #191, `a62e707`);
the writers keep recording it, because the global admin's view is the forensic
record and narrowing them would destroy evidence to solve a disclosure a
projection solves.

Two implementation choices are recorded here rather than only in the ADR, the
same way `E7.1g`'s are, because both are invisible from the endpoint's output
and a later refactor would undo them without failing anything:

- **Redacted in SQL, never in the `.map()`.** `payload - 'oidcSubject'` runs in
  `selectRows`. A JS-side scrub returns identical bytes, so the response cannot
  tell you which one you have — what it loses is that the value never leaves
  Postgres for a tenant, and a row that crosses the wire can reach a query log
  or an error dump. Guarded by
  `tests/e7.1h-audit-subject-redaction-guard.test.ts`, which is **static and
  says so** (§4.4).
- **Keyed on the DB role, never on `scope === null`.** Inside the set of
  principals that reach the projection, `admin` resolves to a null scope and
  `organization_admin` to an array, so the two keyings select the same callers
  *today* and no fixture can separate them. The rule is a claim about the next
  change: a future role resolving to a null scope would silently stop a
  scope-keyed redaction.

**The `-` operator removes a top-level key only, and that is a claim about the
writers, not the reader.** `tests/e7.1h-audit-subject-writer-shape.test.ts`
(`E8.6`'s sibling, PR #192) holds it: a seventeenth write site nesting
`oidcSubject` one level deeper would defeat the scrub in silence — no test
failing, no type breaking, and the reader's own guard blind to it, because that
guard inspects `audit.service.ts` while the writers live in six other services.
A site that genuinely needs nesting is an owner decision, because the fix is a
recursive scrub and that is an ADR 0046 amendment.

**The first check is not redundant — ADR 0021 Amendment 1 exists because it was
missing**, and `E7.1e` widened what it protects. Before ADR 0044, `resolveDbUser` deliberately fell back to the JWT
claim when no row matched, so in OIDC mode (what compose and the pilot run) an
*unprovisioned* Keycloak principal holding realm role `admin` resolved to
`role: "admin"` and a `null`, unrestricted scope. Every other `/admin/*`
endpoint constrains that with a second scope check; on audit read the `null`
**is** the whole control. Without the provisioning check the endpoint served
the entire log — every organisation, every verbatim `payload`, every actor
email — to anyone the IdP called an admin, and deleting a user's row would
have **escalated** them rather than revoked them. Reproduced against a real
database before the fix. **ADR 0044 (2026-08-24) closed the `admin` branch
specifically**: `resolveDbUser` now refuses an unprovisioned `admin` claim
outright (`ForbiddenException`), so this endpoint's own control gap is gone.
Every other role's claim-fallback is unchanged, on purpose —
`organization_admin`/`location_admin`/`operator`/`viewer`/`asset_group_admin`
all already fail closed via a grant-table lookup keyed by user id, never the
unrestricted `null` sentinel. If you add an endpoint whose only control is an
unrestricted scope for a non-`admin` role, check that role's fallback
behaviour before trusting it.

**`E7.1e` made that check load-bearing again, and its own review proved the
test for it was vacuous.** ADR 0044 closed the `admin` branch, so once
`organization_admin` became a reader the probe is the *only* thing refusing an
unprovisioned principal claiming that role — without it, such a caller resolves
to an empty scope and receives `200 {"items":[],"total":0}` instead of a 403,
losing the refusal contract in silence. The suite had asserted both
unprovisioned cases against a shared `/provisioned account/i` substring, which
also matches ADR 0044's *different* message, so deleting the probe outright left
it green. **When two gates can refuse the same caller, assert the exact wording
of the one you mean to test** — a substring that matches both proves neither.

**Onboarding** (ADR 0022, `E8.3`) — a **fourth** gate. Every onboarding entry
point requires role `admin` or `organization_admin` **plus**
`canManageOrganization` on the session's organisation, and both checks live in
**one place**: `OnboardingService.loadSession` → `assertOnboardingAccess`.

Because it sits there rather than on individual handlers, it covers
`getSession`, `chat`, `patchDraft`, `uploadExcel`, `validate` **and**
`setCredentials` together. That placement is the fix, not an implementation
detail: the read gate was once `canManageOrganization` alone while the write
gate also required the role, so a `location_admin` could read a session they
could never create — and `uploadExcel`, sitting on the weaker gate, let them
write credentials by workbook. **Do not re-narrow this to `getSession`.** If you
add an onboarding handler, route it through `loadSession`; a handler that reads
the session any other way is outside the gate.

**Notification channels** (ADR 0043 decision 7 + Amendment 5, `E7.1c`) — a
**fifth** gate. `AccessControlService.canManageNotificationChannel(jwt,
organizationId)` mirrors `canManagePointKey`: `admin` is unconditionally
`true`, **including for a `null` organizationId** — a fleet-managed global
channel is Ion Exchange's to manage; `organization_admin` delegates to
`canManageOrganization` and is **`false` for a `null` organizationId**,
because a global channel belongs to no tenant, not to the caller's own
organization; every other role is `false`. A role outside the master-data set
never reaches the `false` branch at all — `resolveDbUser` → `assertMasterDataRole`
runs first and **throws**.

**The read and write gates must admit the same roles, and this is the
reusable lesson `E7.1c`'s review left behind.** `ChannelsService.list()` and
`.listDeliveries()` originally filtered on the *wider* `writableOrganizationIds`
— which resolves for `location_admin` too — while the corresponding writes
(`update`, `remove`, and `loadById`, which gates `testChannel`) gated on
`canManageNotificationChannel`, which does not. A `location_admin` could
therefore list a channel and read its `config`, and only discover on the next
request that `loadById` refused it with a 403 — the read leaked past a gate
the write already enforced. Fixed by matching the read to the write: `list`
and `listDeliveries` now return nothing for any role that is not `admin` or
`organization_admin`, before `writableOrganizationIds` is even resolved.
**The general rule, for the next gate that gets replaced rather than added:**
enumerate every role the old predicate admits and every role the new one
admits, and diff the two sets — do not assume a wider read gate is merely
more permissive in ways that do not matter.

**A row in a tenant's scope can still join to a fleet-managed parent, and the
projection is a second gate** (ADR 0043 Amendment 6, `E7.1g`, PR #185).
`listDeliveries` filtered on `notification_deliveries.organization_id` and
never tested the joined channel's *own* organization. Decision 7 keeps a
fleet-managed global **shareable**, so `setRuleChannels` may wire one onto a
tenant's rule and `record()` then stamps the **rule's** organization — the
delivery is legitimately the tenant's while the channel is fleet business.
An `organization_admin` was therefore reading a fleet channel's code beside
whatever `webhook-guard.ts` had written into `error`, a resolved internal
hostname included. **The ruling is redact the detail, keep the code:** for a
non-`admin` caller `error` is blanked when the joined
`notification_channels.organization_id IS NULL`, `channelCode` is returned
intact, and a global admin's view is unchanged. Withholding both was
considered and **rejected** — ADR 0041 decision 10 needs a failed delivery to
stay identifiable, and a row the operator cannot name collapses "no
notification arrived" back into "no notification was attempted". The
redaction is keyed on the caller's **role**, not on `writableOrganizationIds
=== null`, because `list()` deliberately treats unrestricted scope as
equivalent to `admin` while the amendment says non-`admin`; it is done in SQL
so the detail never leaves Postgres for a tenant. **The general rule:** when a
scoped read joins a table that has a legitimate `NULL`-organization row, the
`WHERE` clause is not the whole gate — the `SELECT` list is the other half.
This does not settle redaction generally; only `error` on a `NULL`-org
channel is ruled. **There are now three instances of this rule — read them
together.** Each fired on a different trigger, which is why none of them
generalises on its own:

- **ADR 0043 Amendment 6** (`E7.1g`) — a *column* carried fleet detail into a
  tenant's view. `error` on a `NULL`-org channel is redacted; `channelCode` is
  not.
- **ADR 0046 Amendment 2** (`E7.1h`) — the *audience* widened under a projection
  nobody re-read. A scoped audit reader keeps `actorEmail` and loses the acting
  operator's `oidcSubject`.
- **ADR 0046 Amendment 3** (`E8.6`) — the *same value, found in a second table*
  after the first was ruled. `rule_executions.trace.evaluatedBy` is removed for
  any non-`admin` reader of `GET /rules/executions`, an endpoint with **no role
  gate at all**, so its audience is wider than the audit log's.

What generalises is the question, not any of the three answers: **when a scoped
read's audience or join changes, the `SELECT` list is reviewed with the
`WHERE`** — and when a value is ruled disclosing in one table, grep for it in
the others before closing the item. Amendment 3 exists because `E7.1h`'s review
did exactly that.

**Amendment 3 removes without replacing, and that asymmetry is deliberate.** The
audit log keeps `actorEmail` because a ledger that cannot answer *"who changed
this"* fails at its purpose; a trace answers *what the rule saw*, so a scoped
reader gets no evaluator at all. Do not "fix" the inconsistency by adding the
email here — `F3.6` chose the subject *instead of* the address precisely to keep
plaintext emails away from scoped readers, and this endpoint's audience includes
`operator` and `viewer`. That would be a new ruling, not a tidy-up.

**Standing obligation (ADR 0021 decision 6).** `audit_log.payload` stores the
verbatim request body at **twelve** call sites — assets, asset-points,
locations, organizations, point-keys and RTUs, create and update each — and the
read API returns it verbatim **apart from one key**: `E7.1h` removes the acting
operator's `oidcSubject` for a non-`admin` reader (ADR 0046 Amendment 2, above).
That is an identity redaction and it narrows nothing else, so this obligation is
unchanged in force — a secret added to an audited body is still returned in
full. None of those Zod schemas admitted a credential,
password, secret or token field when checked on 2026-08-09. **Adding a
secret-bearing field to any audited request body, or to a schema behind one,
creates an audit-read exposure**, so re-run that check whenever one changes.
The obligation is on the call sites, not on one writer: there are 15
`insert(auditLog)` sites in total and 14 do not go through
`MasterDataAuditService`.

**`E7.1e` widened who this exposes to, and re-ran the check.** The reader is no
longer global-admin-only (ADR 0046), so a `payload` written against a tenant's
organization is now readable by that tenant's `organization_admin`. Re-measured
2026-08-28 across **all ~40** audit write sites, up from the twelve above:
**no site passes a secret today.** Every site added since 2026-08-09 passes
named fields rather than a body, `channels.service.ts` refuses explicitly and
records `hasSecret` instead of the secret, onboarding audits ids only, and RTU
credentials go to `rtu_connection_configs.credentials_ciphertext` under ADR 0012.

**One shape survives that check and a field-name check cannot clear it**:
`createRtuBodySchema.meta` is `z.record(z.unknown())`, an unbounded value space
recorded verbatim — tracked as `E8.5`, on the precedent that
`onboarding-redaction.ts` already scrubs `meta` "like `config`". When you re-run
this obligation, enumerate the *value spaces* as well as the field names; a
`z.record(z.unknown())` behind an audited body is a standing hole no name list
closes.

### 4.8 Shared API contracts (ADR 0030)

A response type and its schema are **one declaration**. `packages/shared/src/`
holds the type as `z.infer<typeof …Schema>`; the schema lives in
`contracts/`. Writing both by hand is how they drift, and the drift is
invisible because the hand-written type is what the compiler believes.
`tests/adr-0030-contract-derivation.test.ts` fails the build on a hand-written
response type in `index.ts`.

**Three encodings preserve type identity and their obvious siblings do not.**
Measured on **9** conversions in the ADR's spike, each asserted against *two*
bars — strict conditional-type identity and mutual assignability — for **14
measurements** in total. They produced **3 strict
failures and 0 assignability failures**, so the strict bar is the only one that
discriminates: under assignability alone all three wrong encodings pass
silently and the package starts flattening intersections with no signal
anywhere.

- `A & B` → **`z.intersection(a, b)`**. `a.merge(b)` flattens the two into one
  object type, which is assignable to the intersection and is not it.
- `Omit<A, k> & B` → **`z.intersection(a.omit({…}), b)`**. `.omit().extend()`
  flattens the same way.
- An all-`readonly` object → **`.readonly()`**. The modifier is the thing that
  is lost, not the property types; `Date` converts fine via `z.date()`.

The check on those is a source scan for the flattening combinators in
`contracts/`, not a type test, because a flattened schema still typechecks
everywhere it is used.

**A required `unknown` property cannot be expressed.** `z.unknown()` produces an
*optional* key — Zod marks any key whose output includes `undefined` — and
there is no passing sibling: `z.any()` and `z.custom<unknown>()` behave
identically. Do not spend an afternoon on it as this repo already has. Record
the gap where the schema is, as `auditLogEntryDtoSchema.payload` does.

**Validate at the boundary; never transform there.** `checkResponse` returns the
**original payload**, not `result.data`. Zod strips unknown keys, so returning
the parsed value silently deletes any field the server has added since the
schema was written — a validator that quietly edits the data it validates is
worse than none. And **the failure direction is not symmetric**: throw in
dev/test so drift is impossible to ignore, log-and-pass in production because a
blank Control Room during an incident is a bigger outage than one wrong field.
Log **`path` and `code` only** — a Zod issue carries the received value, and
§9.6 applies to a console on a shared operations workstation exactly as it
applies to a log file.

**A vocabulary is declared once and everything else is derived from it.**
Re-export rather than restate across package boundaries:
`apps/api/src/rules/rules.schema.ts` exports the shared schema under its own
name, which is that file's own rule — *a copied enum is a copy that drifts* —
finally applied to itself.

**Where a read vocabulary genuinely must be wider than a write vocabulary,
build the wide one from the narrow one's `.options`** so the containment holds
by construction rather than by a test (§4.4). `F4.43` did exactly that —
`automationRuleCategorySchema` was `[...authorableRuleCategorySchema.options,
"electrical"]`, because migration `0022` wrote `electrical` directly and no
operator could author it. **That asymmetry is gone**, and the rule is kept here
as history rather than deleted, because the shape recurs: `F4.45` ended it not
by narrowing or widening either union but by noticing the two vocabularies were
*different axes*. So before you build one union out of another, check that the
wider one is genuinely the same kind of thing — an asymmetry that will not
resolve is often two vocabularies wearing one name.

**Before you declare a vocabulary, decide whether it is closed or open, because
they want opposite mechanisms.** ADR 0031 is the worked example, and it got this
wrong first.

- A **closed** vocabulary is one the business cannot extend without a code
  change anyway: a badge's *tone*, an operator — things the engine itself must
  understand **and cannot be told at runtime**. Declare it as a `z.enum`, back it
  with a `CHECK` if it is stored, and lean on exhaustive `switch`.
- An **open** vocabulary names *what a thing is* in the customer's world, and it
  grows with the business: a plant **domain**, a rule's **concern**, and an alarm
  **severity**. Put it in a table with a foreign key. A foreign key is
  **stronger** than a `CHECK`, not weaker — the column still cannot hold an
  undeclared value — and adding one becomes an `INSERT` a domain pack ships in
  its own seed rather than a migration and a deploy.

  A concern looks closed and is not, which is why it is listed here rather than
  above: four values have covered every rule so far, but the owner's ruling was
  *"categories should be configurable"*, and nothing in the engine branches on
  one — it is a badge, a filter and a sort key. **Whether the engine must
  understand a value is the test, not how stable the list looks.**

  **That test has a third answer, and severity is it (ADR 0032).** Severity was
  listed as *closed* above until `F4.46`, and by the test as stated it belonged
  there: the engine really does rank it, colour it, and will escalate on it. So
  the row asked for a `z.enum` and a `CHECK`, cited ADR 0031, and was building on
  a premise nobody had ruled — ADR 0031 does not mention severity at all.

  What the test misses is that *"the engine must understand it"* is a statement
  about **what the engine needs**, not about **where that has to live**. A value
  arrives unusable only if it arrives with nothing the engine can act on. Give
  the table the columns the behaviour needs — `bms.alarm_severities` carries
  `rank` for ordering and `tone` for colour — and a level declared by an `INSERT`
  arrives sortable and styled. **A vocabulary is only closed if the behaviour
  cannot be carried as data.** So before reaching for a `z.enum`, ask what the
  engine actually needs to know, and whether that is one more column.

  The practical difference is the whole point: client ask **B9** may add a fourth
  severity. Under the `CHECK` that costs a forward-only migration and a deploy;
  under the table it is one row, and the ranks are seeded 10/20/30 precisely so a
  fourth fits between two existing ones without renumbering live rows.

  **Two traps come with taking this route**, both paid for in `F4.46`. The
  *presentation* half stays closed and keeps its `CHECK` — `tone` is owned by the
  frontend and a value outside `StatusPill`'s palette renders nothing. And every
  **hand-written list** that reads the column silently goes stale: severity's
  `normalizeSeverity` was an `if` over three string literals that rewrote a newly
  seeded level to `warning` on every alarm it raised, and four SQL predicates
  matched severity codes rather than tones. Nothing in the type system pointed at
  any of them. **Opening a vocabulary invalidates every closed list that reads
  it, not only the ones the compiler can find** — grep for the *values*, not just
  the type.

  **The test's other answer is *closed*, and `widgetType` is it (ADR 0047,
  `F3.1a`).** Every example above moves a vocabulary from closed to open, so a
  reader could reasonably conclude that open is the destination and closed is the
  mistake. It is not. Run the same question — *what does the engine need to know,
  and is that one more column?* — against a dashboard widget type and the answer
  comes back differently: **what the engine needs is a React component, and no
  column holds one.** `rank` and `tone` are data; `<RadialGauge />` is code. So
  `widgetType` is a `z.enum` in `packages/shared/src/contracts/`, a
  `dashboard_widgets_widget_type_check`, and an exhaustive `switch` at the
  renderer — the mechanism this section prescribes for a closed vocabulary,
  reached through the open-vocabulary test rather than around it.

  **The metric catalog is the second closed answer, and it is the sharper one
  (ADR 0048 decision 1, `F3.35`).** A dashboard widget may bind a *named catalog
  entry* — `alarms.active.count`, `workorders.open`, `assets.health.score` —
  beside a telemetry point, because half the client mock's numbers are row counts
  and roll-ups rather than points. Run the same question against it and the
  answer is not "a component" but **a SQL query**, which no column holds either.
  An entry declared by an `INSERT` would satisfy every foreign key, the API and
  the save, and then **return nothing**, in front of an operator, with a green
  console — the blank rectangle one field over, and harder to notice, because a
  number that is absent looks like a number that is zero.

  This one also shows the *bound* that keeps a closed vocabulary small, which the
  `widgetType` example does not need. A **derived point** (`asset_points.kind`,
  ADR 0036/0037) already lets an administrator declare a new scalar by formula
  with no release. So the catalog carries only what a point cannot be — row counts
  over operational tables, and roll-ups across assets — and **a reviewer should
  refuse a catalog entry that could have been a derived point.** Closed does not
  mean "add freely by code change"; it means the release is the *only* path, so
  the list has to earn each member.

  **The discriminator, in one line: ask whether the thing the engine needs is a
  column or a component.** Since ADR 0048, a third answer sits beside
  *component*: **a query**. Both are code, and both close the vocabulary.

  What a lookup table would have bought is worth naming, because it is what makes
  this look like the ADR 0031/0032 shape: a type declared by an `INSERT` passes
  the foreign key, the API and the save, and then draws a **blank rectangle** in
  front of an operator with nothing in the console, the log or the network tab.
  That is `F4.43`'s failure through the opposite door, and worse — an unstyled
  badge is at least legible.

  **This does not make the product rigid, and the distinction is easy to lose.**
  A closed vocabulary restricts exactly one act: declaring a *kind* nobody has
  written code for. Composition stays unbounded — any number of widgets, any
  types, any points the tenant can see, every range, threshold, title, unit,
  colour, size and position. Where a request is *chart-shaped*, absorb it into
  `config` rather than into a new kind: ADR 0047's generic `chart` exists for
  exactly that, and it is the only lever that lowers the rate at which new
  widgets need a release. And **one shared palette, not one per tenant** — a
  per-organization catalog was offered at the §10 gate and declined, with ADR
  0031/0032 standing as the precedent that opening it later costs one forward
  migration.

The tell is not the current data. `assets.domain` held exactly four values
across all 148 rows, which is what a census showed and what a four-value `CHECK`
was ruled on; the roadmap had already scheduled **three domain packs**
(`E5.1`/`E5.2`/`E5.3`), so that list was known-wrong on a shorter timescale than
the roadmap itself. **Ask what the roadmap intends to add, not what the table
currently holds** — and migrations here are forward-only, so guessing wrong
costs a second one.

**Two consequences that are easy to miss when a vocabulary opens up.** An
exhaustive `switch` over it cannot stay exhaustive, so move the exhaustiveness
onto something that *is* closed — `rules-panel.tsx`'s `categoryStyle` became
`toneClass` (the unrelated `categoryStyle` in `maintenance-schedules-panel.tsx`
is still live and still correctly an enum switch), switching
on `rule_categories.tone`, so a newly seeded category arrives styled instead of
rendering the literal class `"undefined"` the way `F4.43`'s 48 badges did. And
the request schema stops rejecting unknown values, so an unknown code reaches
the database and returns a **500 where Zod gave a 400 naming the options** —
put the check back at each write boundary (`VocabulariesService`) rather than
letting the constraint be the error message.

**A vocabulary describing what a thing *is* belongs on the thing.**
`automation_rules.category` carried `electrical` for as long as migration `0022`
had been deployed, and that was never a concern — it was the *asset's* plant
domain, copied onto rows that reference it. One column holding two axes forces a
false choice, and it produced three items' worth of defects. `bms.assets.domain`
already held the fact, correctly, and unused.

**Widening a response union to make a validator pass is a scope decision, not a
fix.** `F4.43` widened one only after establishing from the migration that the
value was legitimate; the alternative reading was bad seed data, and the two
have opposite fixes. Ask which it is before editing the schema — and note that
what the database will tell you has changed: since `F4.45`,
`automation_rules.category` and `assets.domain` both carry foreign keys, but
`automation_rules.source` still has **no** constraint at all.

---

## 5. Visual Reference

`ESKOM_SMOC.html` is the UX spec. Match it as strictly as the current
React architecture allows:

- Dark top bar, green nav, left module sidebar, KPI ribbon, dark status bar.
- IBM Plex font family.
- Green accent `#00A651`, status colour palette as defined in the file.
- For every new module, identify the closest original route / renderer
  before implementation (for example `R.mt` for Maintenance Kanban · Work
  Orders, `R.rl` for Rule Engine, `R.rp` for Reports).
- Match the original screen's information architecture first: sidebar
  section, page title, actions, card/table/Kanban layout, status pills,
  counts, and empty/loading/error states.
- If backend scope is smaller than the mockup, keep the same layout
  language and clearly omit only the unavailable controls/data.

Do **not** copy its string-concatenation render style. Build proper typed
React components in `apps/web/src/components/`.

Phase 5 Sprint I completed the dedicated UI/UX revisit pass. Future
completed pages should continue using the shared shell, page header,
card, status pill, and disabled command affordance language introduced in
that sprint. The current shell also includes a collapsible left module
sidebar; keep scoped visibility and active-state behaviour consistent with
`AppShell` when adding new navigation items.

---

## 6. Out of Scope for the Current Sprint

These are intentionally deferred. Do not implement them yet:

- **Multi-tenancy and row-level security are delivered** (**ADR 0043**,
  `E7.1a`–`E7.1d` and `E7.1g`) — organization-scoped RLS under `FORCE` on the decision-5
  table set, a `bms_tenant`/`bms_fleet`/`bms_auth` role split, org-scoped
  notification channels and rule identity gated by
  `canManageNotificationChannel`, and (`E7.1d`, PR #180) the `F3.8` admin UI
  split: both notification screens gate on `canManageNotificationChannels`
  rather than on `isMasterDataAdmin`, the create form carries an organization
  picker, and both tables name the owning tenant. `E7.1g` (Amendment 6, PR
  #185) closed what that screen exposed: a fleet-managed channel's `error` is
  redacted in a tenant's delivery ledger while its `channelCode` is not — see
  §4.7. `E7.1e` (**ADR 0046**, PR #188) widened the third gate: an
  `organization_admin` reads its own organizations' `bms.audit_log` rows, and
  never a `NULL`-organization row — neither pre-`0048` un-attributed history
  nor a platform event. `E7.1h` (Amendment 2, PR #191) closed what that
  widening exposed, on the Amendment 6 pattern: the same projection nobody
  re-read carried the acting operator's `oidcSubject` to the tenant, so a scoped
  reader now sees `actorEmail` and never the subject. `E8.6` (Amendment 3, PR
  #194) then followed that value into a second table — `rule_executions.trace`
  named its evaluator to every reader of `GET /rules/executions`, a route with
  no role gate at all — and removed it for anyone below `admin`. All three are
  one rule on three triggers; see §4.7. **Still deferred:** org-level **read**
  RBAC on
  `bms.audit_log` **for `location_admin` and `asset_group_admin`** — ADR 0046
  lifted ADR 0021's deferral for `organization_admin` alone, and decision 4
  keeps those two refused permanently rather than pending, because their scope
  is *sub*-organizational while an audit row carries an organization and
  nothing finer; attributing pre-`0048` history is a backfill with its own row
  and its own ADR (decision 2's consequence); per-organization SMTP relays
  (decision 13 — the
  ADR 0012 credential-store mechanism already exists, not wired to it),
  white-label branding per tenant, a `platform_admin` rung above `admin`
  (decision 2 — two named `admin` accounts express the distinction instead
  of a new role), and `telemetry.*`
  row-level security (decision 9 — no `organization_id` column, no policy;
  isolation stays application-layer through `readableAssetIds`, deliberately
  and permanently, not merely "not yet")
- **Clamping a device timestamp at ingest, and widening the enabled RTU set.**
  `F1.7` left both open on purpose. `parsePayload` takes the envelope's `ts`
  verbatim and nothing bounds it; measured 2026-08-22, the twelve PHE devices
  span **−3:02:36 to +34:31** against the server, and all five *enabled* ones
  run ahead — so each reads online for as long as its clock leads after it dies.
  `F4.37` closed the sink-side half and named `F1.7` as where the ingest-side
  clamp belongs, then called the trade a **product call**: clamping forward only,
  substituting receive time past a bound, and recording both times are three
  different answers with different costs, and choosing is the owner's under §10
  (see `F4.57`). Likewise the four RTUs held out of the set are held for measured
  reasons — two with dark meters (`F4.58`), two whose rows land outside every
  dashboard window — and enabling one takes its assets from simulated to dead.
  Re-measure with `apps/ingest/scripts/fleet-probe.mjs`; do not widen the set
  unprompted.
- MFA / SSO / AD federation
- Real protocol adapters for BACnet, Modbus, SNMP, OPC-UA, REST polling, DCS.
  The **MQTT PHE ingest pilot is promoted for five RTUs** (ADR 0007 as amended
  2026-08-22), and **ADR
  0016 is promoted in full, §6 commit 4 included** (2026-08-14): the
  `IngestAdapter` interface, the host that supervises it, and the MQTT adapter
  ported onto it are all on `main`, and the legacy entry point is deleted.
  **That is the whole of what is in scope** — the boundary moved from commit 2
  to commit 4, and it did not widen: commit 4 removed a second entry point
  rather than adding capability. Each *further* protocol
  implementation stays deferred until it has **its own ADR**, which settles the
  protocol library where one is needed (licence, maintenance, transitive
  footprint) under §9.4. A protocol that happens to need no library — a REST
  poller on Node 20's global `fetch`, say — is **not** thereby ungated: the ADR
  is required unconditionally **under §10**, which is what moves scope, with
  §9.4 additionally applying wherever a dependency is involved. The dependency
  question is only one of the things the ADR answers. Nor is a new adapter cheap: it is an
  `apps/ingest/src/adapters/` file, a `registry.ts` key, an `INGEST_PROTOCOLS`
  entry where one is missing, a spec/test pair passing `runAdapterContractTests`
  (ADR 0016 §7) — **and that ADR**. Mechanical ease is not permission
- **ADR 0016 §6 commits 3 and 4 stay human-gated.** Commit 3 was the parallel
  run against the **live PHE pilot** and the cutover that followed it; running
  the host against a production deployment is not made in-scope by the ADR
  having been accepted. Both are done, on 2026-08-06 — the gate being satisfied,
  not removed, and it does not generalise to commit 4. **The record is uneven and
  should be read as it is:** the repository owner explicitly instructed *the
  cutover* (PR #19). The *parallel run* was performed inside a broader "bring the
  pilot up" request that never named §6 commit 3, so nothing in git authorises it
  specifically. It was read-only against a database the same request had just
  populated, which is why it did not read as the gated act — but the gate names
  the whole of commit 3, and an agent should treat "it was part of what I was
  already asked to do" as a weaker warrant than an instruction. **Commit 4 is now
  also done — 2026-08-14, PR #30 — and its gate was satisfied the way the gate
  asks.** ADR 0016 Resolved decision 4 required a *named owner*, not merely an
  instruction: the repository owner named themselves, and **ADR 0016 Amendment 3
  records it**. Worth keeping as the worked example of the distinction, because
  it nearly went the other way here: an agent asked to "start `F1.1`" has cleared
  *unprompted*, which is the weaker of the two things this bullet requires, and
  the owner still had to be asked for separately. Both gates are **satisfied, not
  removed** — a future §6-shaped step against a production deployment is gated
  again from scratch
- Template content sections whose consumer does not exist yet. **ADR 0019
  promoted the content model, and it is deliberately partial** — a section is
  contracted only as far as something on `main` can consume it. **One** thing
  stays closed, and it reopens when its consumer lands:
  - `optimisation` — **rejected** by the validator, not accepted untyped.
    Needs `E1.6`

  **`dashboards` left this list on `F3.1a` (ADR 0047)** — it was *"ordered point
  keys only; no widget types, no layout, no sizes"*, and the widget vocabulary
  that was missing now exists. `TemplateDashboardView` carries `widgets[]`, each
  typed and each carrying `pointKeys` the same content cross-check walks. **This
  is the third of the five reopenings ADR 0019 predicted**, after `kpis` (`F2.3`)
  and `alarms.philosophy` (`E2.1`).

  **`health` left this list on `E1.3` (ADR 0050, 2026-08-30)** — the fourth of
  the five, and the one whose blocking item turned out to be wrong rather than
  merely unbuilt. This entry said *"Needs `E1.1`"*; the client's 2026-08-22
  answer retired that edge, because the go-live score needs no model. The
  five-input SOW §4.3 score that does still need `E1.1` took its own row,
  `E1.8`. The section carries `weights` and `bands` and nothing that computes —
  ADR 0050 decision 1 keeps aggregation outside the formula, so `bms-calc-v1`
  is untouched.

  **It reopened at the schema only, and has no tab.** ADR 0050 Amendment 1
  decision 5 scoped `E1.3` to the score surfaces rather than to a tab of its
  own, so `health` is writable by the API, carried through
  `mergeTemplateContent` byte for byte, and edited by nothing in the authoring
  UI. **`health` used to share that class with `maintenance`, and no longer
  does.** ADR 0038's count moved five → six on `F3.1e` and **six → seven on
  `F2.19` (2026-09-04, Amendment 5 Part B)**, which gave `maintenance` a tab —
  so `health` is now alone in the writable-but-tabless class, and the sentence
  that used to describe it by analogy has nothing left to point at.
  `optimisation` is the one section still refused outright. An **eighth** tab
  remains an ADR 0038 amendment, not a side effect.

  What is **not** open, and is the more useful half of this entry. **`F3.1b`,
  `F3.1c` and `F3.1e` are all done** (2026-08-29): `dashboards` has a tab in the
  template authoring screen and the count is six, under ADR 0038 Amendment 4 —
  so this bullet no longer holds `dashboards` out of the tab strip; the API
  reads and writes the three tables; and all four widget types draw — **five
  since `F3.35`, and the fifth is the exception to this sentence**: `table`
  requires a catalog source, a template cannot express one, so it draws on a live
  dashboard and is deliberately not template-authorable (ADR 0048 Amendment 1).
  The count
  is still changed by amending ADR 0038, never by editing a gate, and there are
  **three** gates rather than the one this bullet used to name; see §2
  *Template authoring*.

  **`F3.1d` closed 2026-08-30 and the `F3.1` umbrella with it**, which discharges
  the last sentence this bullet held open — *"no route assembles a stored
  dashboard into a page"*. One does: `/dashboards` lists what a viewer may open
  and `/dashboards/:slug` lays the widgets on the grid and binds each to its
  points. **Only one of the two consequences this bullet warned about is
  discharged, and the distinction matters**: a `bms.dashboards` row created
  through the API now has a viewer, but **an authored *template* widget still
  reaches no screen**. The viewer renders rows that already exist in
  `bms.dashboard_widgets`; nothing converts
  `asset_templates.content.dashboards[].widgets[]` into one, and that conversion
  is `F3.2`, which is `⬜`. ADR 0047 Amendment 4 says so in as many words —
  *"It is not `F3.2`. … The viewer renders rows that already exist."*
  **Nothing in the ADR 0019 tier list is held open by `F3.1` any longer**;
  `optimisation` is the one that remains, blocked on its own row. (`health` was
  the other until `E1.3` reopened it on 2026-08-30 — see above.) ADR 0047 decision 6's boundary is unchanged by the closure: `F3.2`,
  `F3.28`, `F3.32`, `F4.41` and the §5 dark canvas all stay out. **Three of
  those are not §6 items and must not become ones** — `F3.2`, `F3.28` and
  `F3.32` are deferred backlog rows whose `F3.1` blocker this closure clears,
  and `F4.41` waits on a second frontend rather than on `F3.1` at all

  `alarms.philosophy` **left this list under ADR 0034** (`E2.1`): `skill` is
  now checked against `bms.alarm_skills` rather than accepted as free text,
  and `cause`/`impact`/`action` were never closed to begin with. Its
  remaining three enrichment fields (affected assets,
  energy/water/production impact, ETR) are **not** newly opened by this —
  they describe a *live alarm instance*, not an asset class, and stay off the
  template contract permanently, not merely until a consumer exists (ADR 0034
  §Context: no `automation_rules` row links back to the `TemplateAlarm` it
  may have come from). Do not add them.

  `kpis.expression` **left this list under ADR 0036** (`F2.3`): `dialect`
  widened from a locked `"unvalidated"` literal to `z.enum(["unvalidated",
  "bms-calc-v1"])`, and `"bms-calc-v1"` triggers real parsing — grammar,
  whitelisted functions, and a `{pointKey}` cross-check against `pointKeys`
  (`packages/shared/src/calc-dsl/`, see §2 *Calc DSL*). Existing
  `"unvalidated"` rows keep validating exactly as before; nothing forces a
  re-save.

  **`F2.4` (ADR 0037) landed the evaluator** this paragraph used to defer:
  `packages/shared/src/calc-dsl/evaluate.ts` computes a value from a parsed
  expression against resolved inputs, and `apps/api/src/calc/` (see §2 *Calc
  engine*) decides what "the current value of `{X}`" means per formula —
  latest fresh sample within `max_input_age_seconds` on a NOTIFY batch
  (streaming) or on a self-scheduling interval (scheduled) — with
  null/stale-input and divide-by-zero both refusing rather than writing.
  **Still true of the code, and permanently true of `bms-calc-v1`**: a
  derived `template_points.formula` may reference measured points only, never
  another derived point. **What changed on 2026-09-04 is why.** ADR 0037 had
  declined to decide chaining, and `F2.8` was blocked on that same undecided
  question. **ADR 0055 decided it** — for a *new* dialect, `bms-calc-v2`,
  repealing ADR 0036 decision 7 rather than narrowing it, and taking on the
  dependency ordering and cycle detection that repeal costs. `v1` keeps its
  exact meaning forever (ADR 0055 decision 3): a `v1` formula never gains a
  cross-asset reference and never loses a refusal, so every rule in this
  paragraph is the live specification of `v1` and not a temporary state.
  **ADR 0055 is accepted and not implemented** — `F2.9` changes the code,
  `F2.8` follows it, and every guard the ADR repeals is still in place and
  still refusing what it refuses.

  Do not widen either of the two that remain to make a domain pack easier to
  author. That is exactly how `E5.1` ends up encoding a shape its consumer
  contradicts a year later, with packs already in the field. **`dashboards` is
  the worked example of the rule paying off, not of it being relaxed**: the
  section stayed at ordered point keys from ADR 0019 until `F3.1a` defined the
  widget vocabulary, and the template shape was then written *against* it
  — which is the sequence this bullet exists to protect, and the reason a pack
  authored today cannot contradict `F3.1b`–`F3.1e`
- Deploying template content into running objects. ADR 0019 is an **authoring**
  surface. A template alarm does not become a `bms.automation_rules` row (that
  needs `ruleType`/`condition`/`action`, which a template does not carry) and a
  maintenance plan does not become a `bms.maintenance_task_templates` row (its
  `asset_id` is `NOT NULL`). Those wirings are `E2.x`/`F3.x` and `E3.x` work
  respectively, each needing its own ADR
- EMQX broker (PHE pilot connects directly over MQTT TLS; no broker)
- MinIO / object storage
- Two-way commanding with approval workflows
- Audit **hash-chaining and append-only storage** (`F4.15`). `bms.audit_log` is
  now *readable* under ADR 0021, but it is not tamper-evident: nothing prevents
  an in-place update or delete. Whether audit **reads** are themselves audited
  is deliberately left open by ADR 0021 for `F4.15`/`F4.19` — do not settle it
  as a side effect of other work
- Energy reports (**PDF**). **XLSX is in scope** since ADR 0026 *Amendment 2*
  (`F4.51`) — `GET /api/v1/reports/energy/export.xlsx`
- Complex drag-and-drop node graph rule builders
- Three.js Control Room 3D
- General site-wide AI Copilot / chatbot (the **scoped admin onboarding
  wizard is promoted** via ADR 0011; general copilot remains out of scope)
- NERSA / ISO compliance reports
- Kubernetes production manifests

Docker Compose, Dockerfiles, GitHub Actions CI, Redis-backed Socket.IO
pub/sub, Keycloak/OIDC authentication, and the observability baseline are
now in scope for Phase 1 only. Phase 2 Sprint 0 promoted documentation
and readiness analysis only, then selected Path B because real access is
not available. Redis must not be used for unrelated caching or job queues
until a later promotion. Keycloak is limited to local/pilot OIDC
authentication; MFA, SSO federation, and advanced identity governance
remain out of scope. Observability is limited to optional local/pilot
diagnostics. Protocol *brokers* remain out of scope; protocol *adapters* are
governed by the bullet above (ADR 0016 interface, host and MQTT adapter
promoted; each further implementation still ADR-gated) — that bullet supersedes
this sentence. Work-order UI is
complete for Phase 5 Sprint B. Phase 5
Sprint C Maintenance Schedule Centre is complete. Phase 5 Sprint D basic
rule-engine UI is complete for simple threshold/time-window rules,
enable/disable controls, manual evaluation, and execution history. Phase 5
Sprint E Energy report preview and its CSV **and XLSX** exports are complete
(the XLSX since ADR 0026 *Amendment 2*). Phase 5 Sprint
G 2D Control Room foundation is complete for CR Main Dashboard, CR
Electrical SLD, and CR IT & Rack Load. Phase 5 Sprint H guided visual rule
builder is complete for simple threshold/time-window rule creation, draft
preview, publish, archive, duplicate, enable/disable, preview, and audit
history. The Phase 5 Control Room extension is complete for CR UPS
Monitoring, Battery Bank, HVAC System, Environment, and Dashboard
integration only. Phase 5 Sprint I UI/UX alignment is complete for all
completed pages and did not add backend contracts. Phase 5 Sprint J/K/L/M/N
Location and Access hardening is open: canonical locations, scoped users,
scoped REST/WebSocket reads, live-location dashboard markers, schematic
guards, Control Room asset-group UI gating, simulator focus settings, and
the telemetry dashboard index may remain, but the sprint is not complete
until the hardening checklist in `docs/roadmap.md` is finished. Report **PDF**
output (reports-domain **XLSX** is in scope since ADR 0026 *Amendment 2*,
`F4.51`; audit-log CSV/XLSX has been in scope since ADR 0021, and this line
used to draw that contrast the other way), persisted report storage, CR
Security, CR Alarm Management, CR Trends, Phase 6 3D, two-way commands,
setpoint changes, manual bypass, battery tests, equalize charge, HVAC
force-changeover, sensor calibration/test execution, real-ingestion rules,
scheduler/job queues, and complex node graph builders remain out of scope
until their specific sprint is promoted. General site-wide AI Copilot /
chatbot remains deferred, but the scoped admin onboarding wizard (ADR 0011),
the hierarchical master-data admin (ADR 0008–0010), and the PHE MQTT ingest
pilot (ADR 0007, 0012 — five RTUs since Amendment 1) are promoted and in
scope.

**Also promoted since, and in scope now** — the SOW-driven backlog
(`docs/BACKLOG.md`) delivered against `docs/build-operating-model.md`:
the Vitest runner and ratcheting coverage gate (ADR 0014, §4.6); asset
templates, versioning and instantiation (ADR 0015, §4.7); the `IngestAdapter`
interface, **its host, and the MQTT adapter** (ADR 0016, §6 complete through
commit 4 — no further protocol); the operations write matrix (ADR 0017, §4.7);
the asset source-axis separation making `assets.rtu_id` nullable while
`location_id` is `NOT NULL` (ADR 0018); the template content model
(ADR 0019, §2); and the template authoring UI with its formula editor
(ADR 0038 + Amendments 1–4, §2 *Template authoring*, `F2.5`) — which brings
CodeMirror 6 in as five §9.4-gated packages, and is the first `React.lazy`
boundary in this app; and the **notification service** with its channel admin
screens (ADR 0041, §2 *Notifications*, `F3.8`) — `nodemailer` and a Mailpit
`mail` Compose profile under §9.4, plus **ADR 0042**'s four test-only
devDependencies for `apps/web` component tests. **§6 was searched for a line
gating notifications, email, webhooks, escalation, `F3.7` or rule actions, and
there was none to soften** — the row was gated by §9.4 dependencies and by
`docs/BACKLOG.md`, never by an out-of-scope line here. **It promotes no further
channel**: `F3.9`'s SMS and push stay out of scope and behind their own row,
and the transport `switch` is what holds them there. **It promotes no
escalation policy either** — `F3.10`'s profiles and auto-clear are a separate
row, and `F3.7` (making a rule's stored `notify` actually fire) is unblocked
but unbuilt. **It promotes no closed content section**: `health`,
`optimisation` and `dashboards` stay out of scope in §6 and out of the tab
registry, held there by a source scan rather than by convention. **That was
true when ADR 0041 shipped, and the `dashboards` third of it has since gone in
two steps.** ADR 0047 (`F3.1a`) took `dashboards` out of §6's closed list — it
carries widgets — and **ADR 0038 Amendment 4 (`F3.1e`, 2026-08-29) put it in
the tab registry as the sixth tab**. The count is now six and is held by
**three** gates, not the single source scan this paragraph names. **And the
`health` third has since gone the same way, in one step rather than two:** ADR
0050 (`E1.3`, 2026-08-30) took it out of §6's closed list, and it did **not**
enter the tab registry — Amendment 1 decision 5 scoped `E1.3` to the score
surfaces, so `health` is writable by the API and has no tab. **That used to be
described as `maintenance`'s shape rather than `dashboards`'; since `F2.19`
(2026-09-04) it is neither.** `maintenance` took the `dashboards` route and got
a tab under ADR 0038 Amendment 5 Part B, so `health` is the only section left
that the API accepts and the UI does not author. `optimisation` alone is
unchanged in both halves and is the one closed section left.
Application-layer encryption at rest
is in scope (ADR 0012); **full-disk / volume / KMS encryption is a deployer
action and not implementable in this repo**. Object-storage bucket encryption
(`F3.3`, ADR required) and automated encrypted backups (`E8.2`) remain **live
backlog scope** — they are deferred, not cancelled. The boundary itself is
still an open human decision; see `docs/security/encryption-at-rest.md` and
`docs/BACKLOG.md` §5.

When any other item above is needed, follow §10 (Promotion Process).

---

## 7. Definition of Done (Phase 5 Sprint I)

Phase 5 Sprint I is done:

1. Native WSL development and the Phase 1 compose path remain unchanged.
2. `AppShell` uses the completed mockup chrome: dark top bar, green route
   nav, grouped module sidebar, KPI ribbon, and dark status bar.
3. Core prototype pages use consistent headers, KPI/card framing, status
   pills, tables, loading/empty/error states, and route labels.
4. Operations pages for work orders, schedules, rules, and reports align
   with `R.mt`, `R.rl`, and `R.rp` without changing API payloads.
5. Completed Control Room routes align with `R.crOv`, `R.crSld`,
   `R.crIT`, `R.crUps`, `R.crBat`, `R.crHvac`, and `R.crEnv`, including
   `/cr-ups` for CR UPS Monitoring and `/cr-battery` for CR Battery Bank.
6. Disabled/non-commanding controls stay visibly disabled for commands
   that remain out of scope.
7. `docs/demo-script.md` reflects the completed shell, Operations, and
   Control Room demo flow.
8. `pnpm --filter @bms/shared build`, `pnpm --filter web smoke:cr`,
   `pnpm --filter web build`, `pnpm --filter @bms/db build`,
   `pnpm --filter api build`, and `node --check apps/sim/src/index.js`
   pass.

---

## 8. Local Dev Setup

Single source of truth lives in `docs/local-setup.md`. Summary:

1. Windows 11 + WSL2 + Ubuntu 22.04.
2. Inside Ubuntu: install Node 20, pnpm 9, Postgres 16, TimescaleDB.
3. Clone repo into the WSL filesystem (not `/mnt/c/...`).
4. `pnpm install` — which also runs `pnpm hooks:install`, pointing git at
   `.githooks/` (§9.11). `core.hooksPath` is per-clone configuration and
   cannot be committed, so **every checkout needs this once** or the
   commit-time rule checks are simply absent.
5. `pnpm --filter @bms/db roles && pnpm db:migrate && pnpm db:seed` —
   **`roles` runs FIRST.** Since **ADR 0045** it creates the five database
   roles, and the migrations grant privileges to them, so `db:migrate` on a
   fresh database dies at `0041` with `role "bms_owner" does not exist` if it
   runs first. `roles` and `migrate` connect as `DATABASE_URL_SUPERUSER`;
   `seed` connects as `DATABASE_URL`, which names `bms_owner` — a
   non-superuser, so `FORCE ROW LEVEL SECURITY` binds it.
6. Three native terminals:
   - `pnpm --filter api dev`
   - `pnpm --filter web dev`
   - `pnpm --filter sim start`
7. Optional Phase 1 compose profiles, including Keycloak and
   observability, are documented in `README.md`. Windows VM Docker-only
   deployment steps live in `docs/windows-vm-docker-deploy.md`.

No protocol broker yet. Just Postgres, Redis for realtime fan-out,
Keycloak for local/pilot OIDC, optional observability services, Node, and
Docker Compose for reproducible development. Phase 2 is **no longer paused**:
the PHE MQTT pilot ships in `apps/ingest` (ADR 0007, 0012) across five RTUs,
and
ADR 0016 froze the adapter interface and — §6 complete through commit 4 — shipped
the host that runs it with MQTT ported onto it, as the sole entry point. What remains gated is each *further
protocol implementation*, per §2 and §6 — not Phase 2 as a whole. Phase 5 Sprint A used the existing API and
database stack only; Sprint B added the Maintenance Kanban UI and
`sort_order` persistence for drag/drop. Sprint C added the Maintenance
Schedule Centre, schedule metadata, history, and work-order conversion.
Phase 5 Sprint J/K/L/M/N Location and Access hardening is open; use
`docs/roadmap.md` as the source for its hardening checklist before adding
new scope-sensitive features.

---

## 9. AI Agent Operating Rules (Current Sprint)

1. **Read this file and the affected source files before editing.**
2. Read `docs/AGENTS.production.md` for context on where the system is
   heading — but do **not** implement later-phase concerns yet.
3. Match the style of existing modules and the closest matching
   `ESKOM_SMOC.html` screen. If these conflict, preserve React/codebase
   architecture but prefer the mockup's user-facing layout and labels.
4. Never add a dependency without an ADR in `docs/adr/`.
5. Never invent file paths or library APIs.
6. Never log secrets, tokens, or full PII payloads. **This includes the
   onboarding chat transcript** (`onboarding_sessions.messages`) — it is user
   free text that once carried pasted broker passwords, and it is scrubbed on
   the way out to the client as well as refused on the way in (ADR 0022).
7. Do not introduce EMQX, MinIO, or any item from §6 without a Promotion
   PR (see §10). Redis is only approved for Socket.IO fan-out; Keycloak is
   only approved for local/pilot OIDC; observability is only approved for
   optional local/pilot diagnostics. Phase 2 may document real-ingestion
   candidates, but it must not implement adapters or brokers until real
   access exists. Phase 5 Sprint A is limited to work order foundation.
   Later Phase 5 and Phase 6 feature work requires sprint promotion before
   implementation.
8. Do not bypass the audit middleware.
9. Do not mass-rename or mass-format unrelated code.
10. Update this file only via a PR prefixed `chore(agents): ...`.
11. **Four of these rules are machine-enforced at two points. Never disable
    either, and never route a write around one.**

    | Rule | Where it is written |
    |---|---|
    | a committed `packages/db/drizzle/*.sql` is never edited | §4.4, forward-only |
    | a dependency needs an ADR | §9.4 above, promotion §10 |
    | the drizzle journal stays consistent with its `.sql` files | §4.4 |
    | style hygiene on added lines | §4.5 |

    **Point 1 — `.claude/hooks/`, wired in `.claude/settings.json`.** Two are
    `PreToolUse` **deny**, so they stop the edit *before* the file is written;
    two are `PostToolUse` and feed the violation back mid-turn to self-correct.
    This point is strictly better than the second, because nothing is on disk
    yet and nothing has been built on top of the bad edit.

    **Point 2 — `.githooks/pre-commit`.** The same four rules over the staged
    tree. It exists because point 1 matches `Edit|Write|MultiEdit` — Claude's
    own file-writing tools — and therefore sees **nothing** when a file is
    written any other way. Two such paths already exist: a `Bash` heredoc or
    `sed` (the matcher does not list `Bash`), and any external agent invoked as
    a tool, which writes through its own process. Every one of them still
    reaches `main` through a commit.

    **It is a backstop, not a relocation.** Do not "simplify" this by deleting
    the `.claude/` half; that trades an early block for a late one.

    Two pass conditions differ between the points **on purpose**, because the
    two stages know different things:
    - The dependency gate at commit time passes when a `docs/adr/*.md` is
      staged in the same commit. The tool-time hook cannot see a future commit,
      so it blocks outright.
    - The journal check at commit time reads the **index**, not the working
      tree. Staging a `.sql` without its journal entry is exactly the
      commit-time mistake, and a working-tree read would miss it.

    The predicates live in `scripts/checks/` and are imported by both, so a
    rule cannot be weakened on one path while the other still passes.
    `tests/pre-commit-gate.test.ts` drives both entry points.

    **`git commit --no-verify` is the human's, never an agent's.** This is the
    same line the two `deny` hooks already carry: an agent that finds its
    commit blocked fixes the cause. A check that throws warns loudly and is
    skipped while the other three still run, so a crash degrades the gate
    visibly rather than disabling it silently.

---

## 10. Promotion Process (prototype → production rules)

When an add-on phase begins (e.g. "introduce Keycloak", "wire MQTT
ingestion"):

1. Open a PR titled `chore(agents): promote <section> from production`.
2. Copy the relevant section from `docs/AGENTS.production.md` into this
   file (replacing or extending the current rules).
3. Remove the same item from §6 (Out of Scope).
4. Update `docs/roadmap.md` to mark the phase as active.
5. Land the PR before any feature code for that phase is merged.

This keeps the active rules in lockstep with the codebase and ensures AI
agents are never asked to enforce rules that do not yet apply.

### 10.1 ADR-sourced promotion (how this actually works now)

The five steps above describe promotion from `docs/AGENTS.production.md`.
Most scope now moves a different way — an **ADR** in `docs/adr/` decides it,
and the ADR lands with the feature that motivated it. Two consequences, both
recorded here because the practice had diverged from the written process
silently:

- **A promotion may originate from an ADR** rather than from
  `docs/AGENTS.production.md`. Step 2 is then "summarise the ADR's decision
  here and link it", not a copy. The ADR remains the authoritative record;
  this file is the index.
- **Step 5 is inverted for ADR-sourced promotion, by construction.** The ADR
  is written and accepted *before* the feature (that is the §9.4/§10 gate),
  but the `chore(agents):` edit to this file cannot ride along in the feature
  PR — §9.10 forbids it. So the rulebook edit necessarily lands *after* the
  feature. It is discharged by a catch-up `chore(agents):` sweep, and what
  is owed is tracked in `docs/BACKLOG.md` §5 until it lands.

Step 5 still holds for `AGENTS.production.md`-sourced promotions, where no
ADR gate precedes the feature. **The gate that must never be skipped is the
ADR itself, not the bookkeeping in this file.**

**One owed promotion per `chore(agents):` PR.** Batching several into one
sweep makes the diff harder to review precisely when it is the rulebook being
changed, and §9.10's wording does not clearly permit it. If a batch is ever
warranted, ask first — it is not the default and not an agent's call.

---

## 11. Glossary (short)

- **SMOC** — Smart Metering Operating Centre (RSMOC / CSMOC: regional /
  central variants used in seeded location names).
- **BMS** — Building Management System.
- **SLD** — Single-Line (electrical) Diagram.
- **CRAC** — Computer Room Air Conditioner.
- **PUE** — Power Usage Effectiveness.
- **RTU** — Remote Terminal Unit; ingestion source under a location
  (`bms.rtus`). PHE RTUs are physical; Eskom RTUs are synthetic per-domain.
- **PHE / PHEWB** — West Bengal Public Health Engineering; the real MQTT
  ingest pilot source (pump houses via ThinkIoT).

Full glossary lives in `docs/AGENTS.production.md`.

---

## 12. Living Document

This file evolves with the system. Every sprint exit reviews `AGENTS.md`
for accuracy. Every promotion PR updates it.
