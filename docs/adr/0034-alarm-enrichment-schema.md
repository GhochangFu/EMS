# ADR 0034 — Alarm enrichment schema: root cause, impact, affected assets, corrective actions, ETR, skills

## Status

Accepted — 2026-08-19. Ruled by the repository owner while starting `E2.1`.

## Context

`E2.1` (`docs/BACKLOG.md`, Wave 2, P1, 4–6 person-weeks) is the alarm
enrichment schema: root cause, impact, affected assets, corrective actions,
energy/water/production impact, ETR, skills. Its only dependency, `F3.6`
(alarm engine unification, ADR 0033), is done, so it is eligible to start —
but no ADR names its schema yet, and this is new scope under AGENTS.md §10.

Two things already exist that this ADR must not collide with:

- **ADR 0019** (`E1.7`) shipped `TemplateAlarm.philosophy` — four optional
  free-text fields on a template's alarm definition: `cause`, `impact`,
  `action`, `skill` (`packages/shared/src/asset-template-content.ts:34`,
  validated by `alarmPhilosophySchema` in
  `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts:137`).
  This is a **refinement of an already-accepted shape**, not an unlock of a
  rejected one — `philosophy` is not in `RESERVED_SECTIONS`, and no seed data
  populates it yet, so there is no live content to migrate.
- AGENTS.md §6 already names the boundary: template `philosophy` describes an
  *asset class*; `E2.1`'s remaining fields — **affected assets,
  energy/water/production impact, ETR** — describe a *live alarm instance*
  and a template cannot carry them.
- Template instantiation (`AssetTemplateInstantiationService.instantiate`,
  `apps/api/src/admin/asset-templates/asset-templates-instantiate.service.ts:110`)
  creates `assets` and `asset_points` rows only. **Nothing today turns a
  `TemplateAlarm` into a `bms.automation_rules` row** — that wiring is
  explicitly deferred by AGENTS.md §6 ("Deploying template content into
  running objects") to its own `E2.x`/`F3.x` item with its own ADR. So
  `automation_rules` carries no link back to a template alarm, and this ADR
  cannot assume one when deciding how an alarm's enrichment gets populated.

The backlog row also flags a cheap sub-slice: an *Alarm Details* panel
pairing **current value beside its threshold** ("112%" / ">100%") with asset
type, location, triggered-at and state needs no new schema — it is a join
over `bms.alarms`, the linked rule's `threshold_value`/`operator`, the latest
`telemetry.point_values` row, and `bms.assets`. The owner ruled (see
Decisions) to ship the full row rather than slice this out separately.

## Decision

1. **Scope: the full `E2.1` row, in one ADR.** Both the read-only Alarm
   Details panel (value-vs-threshold + context — no new schema) and the
   enrichment-writing schema (new tables below) ship under this ADR. Owner
   ruling, 2026-08-19.

2. **New companion table `bms.alarm_enrichments`, not new columns on
   `bms.alarms`.** One row per alarm, created lazily on first write (not
   eagerly at raise time — see decision 6). `F3.10` already owes
   `bms.alarms.cleared_at`; a companion table keeps that migration and this
   one from touching the same table in parallel. Owner ruling, 2026-08-19.

   ```
   bms.alarm_enrichments
     id             uuid PK default random
     alarm_id       uuid NOT NULL UNIQUE REFERENCES bms.alarms(id) ON DELETE CASCADE
     root_cause     text
     impact         text
     corrective_actions text
     energy_impact  text
     water_impact   text
     production_impact text
     etr_at         timestamptz   -- operator's estimated time of resolution
     skill_code     varchar(64) REFERENCES bms.alarm_skills(code)
     updated_by     uuid REFERENCES bms.users(id)
     created_at     timestamptz NOT NULL default now()
     updated_at     timestamptz NOT NULL default now()
   ```

   `ON DELETE CASCADE` (unlike `bms.alarms.rule_id`'s `NO ACTION`, ADR 0033
   decision 5): an alarm is never deleted today, and if that changes its
   enrichment has no independent meaning to preserve. `alarm_id` is `UNIQUE`
   because there is exactly one enrichment per alarm instance, not a history
   of edits — an edit overwrites the row (`updated_by`/`updated_at` record
   who/when, not a version chain).

3. **`skill` is a coded vocabulary; `impact`/`energy`/`water`/`production
   impact`/`root_cause`/`corrective_actions` stay free text.** Owner ruling,
   2026-08-19, applying AGENTS.md §4.8 as amended by ADR 0032: a vocabulary is
   closed only if the engine's *behaviour* needs to read it, not merely
   because it is enumerable. Nothing today routes a work order by `skill`,
   but that is `E2.1`'s own reason for existing — the enrichment panel is
   meant to tell an operator which trade to call, and a free-text field
   cannot be filtered or reported on trade-wise. Impact/root-cause/corrective-
   action commentary has no such consumer and stays descriptive, matching the
   template's existing free-text shape.

   New table `bms.alarm_skills`, the same shape as `bms.alarm_severities`
   (ADR 0032) and `bms.rule_categories`/`bms.asset_domains` (ADR 0031) — an
   open, `INSERT`-able vocabulary, not an enum:

   ```
   bms.alarm_skills
     code        varchar(64) PK
     label       varchar(128) NOT NULL
     sort_order  integer NOT NULL default 100
     active      boolean NOT NULL default true
     created_at  timestamptz NOT NULL default now()
   ```

   Seeded with a starting set (electrical, mechanical, HVAC, controls,
   civil — final list at implementation time) via migration, editable
   thereafter as data. `GET /api/v1/vocabularies` gains an `alarmSkills`
   array alongside `ruleCategories`/`assetDomains`/`alarmSeverities`.

   **`TemplateAlarmPhilosophy.skill` also moves from free `string` to a
   validated `bms.alarm_skills` code**, tightening
   `alarmPhilosophySchema`'s `skill` field the same way `automationRuleSeverit
   ySchema` tightened severity under ADR 0032. This is safe to do without a
   backfill: no seed data populates `philosophy.skill` today (verified —
   no `philosophy` content exists in any seed file), so there is no free-text
   value that would fail the tightened validator.

4. **Affected assets are a join table, not an array column.**

   ```
   bms.alarm_affected_assets
     id             uuid PK default random
     enrichment_id  uuid NOT NULL REFERENCES bms.alarm_enrichments(id) ON DELETE CASCADE
     asset_id       uuid NOT NULL REFERENCES bms.assets(id)
     created_at     timestamptz NOT NULL default now()
     UNIQUE (enrichment_id, asset_id)
   ```

   Matches the existing join-table convention (`asset_group_members`,
   `user_location_access`) rather than a `jsonb`/array column, so a deleted
   asset cannot leave a dangling reference silently.

5. **The Alarm Details panel is a new read endpoint,
   `GET /api/v1/alarms/:id/details`, computed at read time — nothing about
   current-value-vs-threshold is stored.** It joins: the `bms.alarms` row;
   `bms.assets` for type/location/site; the linked `bms.automation_rules` row
   (via `alarms.rule_id`) for `threshold_value`/`operator`, when present; the
   latest `telemetry.point_values` row for that rule's `point_key`; and the
   `bms.alarm_enrichments` row plus its `bms.alarm_affected_assets`, when
   present. Scoped by the caller's asset access, matching `AlarmsService.list`
   /`acknowledge`.

   For an alarm with no linked rule (`rule_id IS NULL` — a historical alarm
   or one raised outside the rule engine, ADR 0033 decision 5), the panel
   omits the threshold pairing rather than failing the request — the same
   nullable-`rule_id` posture ADR 0033 already established.

   **This does not touch `alarms.message` composition.** `F3.28` owns
   composing the breach value into alarm *text* for the Active Alarms rail
   ("Overload (112%)"); this ADR's value-vs-threshold pairing is a separate
   field pair in the Details response, not a rewrite of `message`. The two
   items must not both start writing to `alarms.message`.

6. **`bms.alarm_enrichments` rows are operator-authored, not auto-populated
   from templates.** Per Context, no automation rule carries a link back to
   the `TemplateAlarm` it may have been inspired by, so there is nothing to
   copy from at raise time. `PUT /api/v1/alarms/:id/enrichment` upserts the
   row (root cause, impact, corrective actions, the three impact-domain
   fields, ETR, skill code, affected asset ids), gated by the same
   operations-write role check as `acknowledge` (ADR 0017,
   `assertOperationsWriteRole`). `E2.3` (AI-assisted root-cause suggestions,
   depends on `E1.2` + `E2.1`) is what later proposes values into this same
   surface — it is not part of this ADR.

## Dependencies

None — no new npm package.

## Consequences

- **AGENTS.md §6 reopens the `alarms.philosophy` deferral bullet** — it
  currently reads "`alarms.philosophy` — four free-text fields, and `E2.1`
  owns the vocabulary." This ADR is that vocabulary landing, so a
  `chore(agents):` commit (§9.10) is owed alongside: soften/replace that
  bullet, update the status line, and add a `docs/BACKLOG.md` §5 row plus a
  `docs/roadmap.md` mirror. Unlike ADR 0033 (which owed no §6 edit — `F3.6`
  was already in-scope work), this ADR *is* the promotion, so the edit is
  owed from the start rather than found later by compliance review.
- Decision 3's `skill` tightening changes `TemplateAlarmPhilosophy`'s DTO
  (`packages/shared/src/asset-template-content.ts`) and its `AssertAssignable`
  drift guard in `asset-templates-content.schema.ts` together — both must
  move in the same PR or `pnpm typecheck` catches the drift, which is the
  point of that guard.
- Decision 2's `ON DELETE CASCADE` is a real behavior change if alarm
  deletion is ever added later (nothing deletes `bms.alarms` today) — a
  future item adding alarm deletion inherits "enrichment vanishes with it"
  as already decided, not as a new question.
- `F3.10`'s pending `bms.alarms.cleared_at` migration and this ADR's
  `bms.alarm_enrichments` migration touch different tables (decision 2's
  reason for existing) but both alter schema `E2.1`-adjacent work depends on;
  sequencing between the two PRs should still avoid a shared migration
  number collision.
- The Details endpoint (decision 5) adds one more query to
  `apps/api/src/alarms/` beside `list`/`acknowledge` — no new WebSocket
  surface, since Details is a pull-on-click view, not a streamed one.

## Promotion follow-ups owed (separate `chore(agents):` commit, per §9.10/§10.1)

- `AGENTS.md` §6 — soften/replace the `alarms.philosophy` deferral bullet;
  update the status line.
- `docs/BACKLOG.md` §5 — add a row for this ADR.
- `docs/roadmap.md` — mirror `E2.1`'s progress once built.
