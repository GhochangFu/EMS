import { FACILITY_ACCESS_DOOR } from "./facility-access-door";
import { FACILITY_FIRE_PANEL } from "./facility-fire-panel";
import { FACILITY_LIGHTING_ZONE } from "./facility-lighting-zone";
import { FACILITY_OCCUPANCY_ZONE } from "./facility-occupancy-zone";
import { FACILITY_PARKING_LEVEL } from "./facility-parking-level";
import type { StockAssetTemplateEntry } from "./types";

/**
 * `E5.3` — the facility/smart-building pack index, the fourth pack through the
 * mechanism `F2.13` built, `F2.12` split per class and `E5.1` and `E5.2` proved
 * twice (ADR 0054, Accepted 2026-09-03; ADR 0052 decisions 1, 2 and 6). This
 * file aggregates; it authors nothing.
 *
 * **THE ARRAY BELOW SHIPS EMPTY, AND IT IS EMPTY ON PURPOSE.** This module
 * lands in the commit that declares the pack — the two `PACK_SOURCE_DOC`
 * prefixes, the seven new `STOCK_ENTRY_CODES`, the seven deferral lists and this
 * index — one commit before the first class is authored, and it **fills one
 * class per commit** from there. `E5.1` §13 item 1 is the reason it ships empty
 * rather than holding seven skeletons with one placeholder point each: a
 * skeleton passes every check in this directory while telling a global
 * administrator that the catalog ships a fire panel it cannot instantiate, and
 * it makes the anti-vacuity bounds in
 * `tests/f2.13-asset-stock-catalog-vocabulary` move for content that does not
 * exist. **Each entry commit creates its module, adds its import and its line to
 * the array below, adds the file to `STOCK_ASSET_RELS`, and appends its own
 * version line to the history at the foot of this docblock** — so no commit is
 * red on the directory cross-check and no docblock has to explain a placeholder
 * away.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §§1-8b — the v1 point basis for
 * the nine facility/smart-building and vertical-transport classes.
 * **PROVISIONAL, and that word is load-bearing**: like the water and mechanical
 * handouts, this document is a workshop sheet whose instruction to the client is
 * to strike what is not fitted, add what is missing and correct names and units.
 * Every entry's own `description` repeats the marking and cites the file and its
 * section by name, because the stamp plus the citation IS the provenance (ADR
 * 0052 decision 6, ADR 0054 decision 7) and there is no `meta.provenance` to
 * fall back on. The client-confirmed release is v2, and each module records its
 * own redline candidates.
 *
 * ---
 *
 * **THREE DOMAINS, ONE PACK, ONE INDEX — AND THE PREFIX SAYS WHICH** (ADR 0054
 * decision 2). This is the first pack to span three, and the reason is the same
 * one that gave `mechanical.ts` two: a pack is one DOCUMENT, and the code prefix
 * is the DOMAIN. The two are different axes.
 *
 *  - **`facility`** — the lighting zone, the fire panel, the access door, the
 *    occupancy zone, the parking level and the BAS gateway. `facility` is the
 *    **seventh `bms.asset_domains` row** and the SECOND a pack has added through
 *    the seed path (`packages/db/src/asset-domains-seed.ts`, ADR 0031 A1.1);
 *    `E5.2`'s `mechanical` was the first.
 *  - **`environment`** — the indoor air quality node alone. It is filed under
 *    the existing domain whose vocabulary already holds its `temperature_c` and
 *    `humidity_pct`, which is also why the seeded `BASELINE-ENVIRONMENT`
 *    template and the PHE gateway screens keep working unchanged.
 *  - **`mechanical`** — the lift and the escalator, in PR 2. They are machines
 *    in a machine room; the domain their motor, energy and vibration codes
 *    already live in is the right one.
 *
 * Entry codes keep the convention all three shipped packs set, prefix = domain,
 * and **module file names follow the entry code**: `facility-lighting-zone.ts`,
 * `facility-fire-panel.ts`, `facility-access-door.ts`,
 * `facility-occupancy-zone.ts`, `facility-parking-level.ts`,
 * `environment-iaq-node.ts`, `facility-bas-gateway.ts`, then `mechanical-lift.ts`
 * and `mechanical-escalator.ts`. **So one `environment-*.ts` and two
 * `mechanical-*.ts` files live under this FACILITY index.** Stated here so
 * nobody tidies them into an `environment.ts` — or, worse, into `mechanical.ts`,
 * whose prefix already belongs to `e5.2-derived-taglist-v1.md`. That collision
 * is real and is what `stock-catalog.spec.ts`'s per-entry `ENTRY_SOURCE_DOC`
 * override exists for (PR 2, Task 11): `PACK_SOURCE_DOC` is keyed by PREFIX, so
 * `mechanical-lift` would otherwise be checked against the `E5.2` document and
 * pass green against the wrong source.
 *
 * ---
 *
 * **THE DOCUMENT, COUNTED — AND ITS OWN COUNTS LINE RECONCILES ON ROWS, NOT ON
 * CODES.** The tag list carries **227 table rows over 210 distinct codes**
 * across §§1-8b: 44 `C`, 171 `X`, 10 `M` and 2 dual-tier (`X/D`). Its own
 * *Counts:* line says exactly that — 44 / 171 / 10 — so unlike the water
 * handout's it is right, provided the reader counts ROWS. Sixteen codes recur
 * over 17 extra rows (227 − 17 = 210).
 *
 * The arithmetic every number in this pack derives from:
 *
 *  - **210 distinct table codes = 11 reused + 199 new.** The reused 11 are
 *    **referenced, never redeclared** (ADR 0054 decision 3): units are
 *    write-once through the seed's `COALESCE`, so `temperature_c` keeps `°C` and
 *    `smoke_state` keeps the empty string, and each stays in the array that
 *    already holds it. Four are the control room's (`temperature_c`,
 *    `humidity_pct`, `smoke_state`, `leak_state`), three the mechanical pack's
 *    (`motor_current_a`, `motor_temp_c`, `vibration_mms`) and four electrical
 *    (`kw`, `kwh_total`, `run_hours_h`, `start_count`). Every one of the eleven
 *    units is compatible with the column the document gives.
 *  - **206 new vocabulary codes = 199 new table codes + 7 promoted derived
 *    codes.** They land as three arrays in
 *    `packages/shared/src/facility-point-keys.ts` —
 *    `FACILITY_CLASS_POINT_KEYS` (91), `ENVIRONMENT_CLASS_POINT_KEYS` (13) and,
 *    in PR 2, `VERTICAL_TRANSPORT_CLASS_POINT_KEYS` (102) — with their
 *    `UNIT_BY_KEY` entries and three `keysForDomain(…)` lines, taking
 *    `bms.point_keys` to **604** on a cold start. A promoted code must be
 *    vocabulary because `assertPointKeysActive` checks a derived point's key
 *    like any other.
 *  - **A NEW FILE, NOT `constants.ts`** (plan §12 ruling 1, a correction to ADR
 *    0054 decision 3's *"three arrays in `constants.ts`"*): that file measured
 *    927 lines and the AGENTS.md §4.5 cap is read whole-file, so 206 more codes
 *    cannot go there. The four existing class arrays stay where they are — they
 *    are write-once and frozen — and the three guards that used to read
 *    `constants.ts` as TEXT now read a two-file list with a per-file
 *    anti-vacuity floor, so a mistyped path cannot pass as an empty scan.
 *
 * **THREE NUMBERS IN ADR 0054 ARE CORRECTED BY THIS COUNT, none of them a
 * re-opened decision, all recorded for the closure `docs(adr):` commit:**
 *
 *  1. **PR 1 declares 104 distinct codes, not 106.** §§1-7 carry 109 rows less
 *     five in-PR recurrences (`occupancy_state` §1/§4, `entry_count` and
 *     `exit_count` §4/§5, `sensor_battery_pct` §4/§6, `co_ppm` §5/§6) = 104 =
 *     100 new + 4 already seeded — which is the ADR's own arithmetic. PR 2's
 *     half is right.
 *  2. **The document names 48 distinct derived codes over 51 mentions, not 37.**
 *     `occupancy_pct` (§4, §5) and `availability_pct` and `mtbf_h` (§8a, §8b)
 *     are the three repeats. The ledger below reconciles 8 + 40 = 48.
 *  3. **The row tiers are 44 / 171 / 10 / 2, not 40 / 159 / 8 / 3.** The ADR
 *     counted DISTINCT codes and filed `co_ppm` as a third dual-tier row; by
 *     first occurrence the distinct split is 41 / 159 / 8 / 2. Same 210 either
 *     way. One redline for the handout itself: its Counts line says *"eight
 *     classes"* and there are nine.
 *
 * **TIERS → `meta.tier`** (ADR 0054 decision 4, ADR 0040 decision 3): `C` is
 * `core` / required, `X` is `extended` / optional, `M` is `manual` / optional and
 * entered by hand through `F1.8` / `F1.9`, never mapped from a data key. **A
 * tier is per ENTRY, not per code** — `co_ppm` is `core` on the parking level
 * (the ventilation interlock) and `extended` on the IAQ node, exactly as
 * `effluent_cod_mgl` is `manual` on the STP and `extended` on the ETP.
 *
 * **FIRST OCCURRENCE WINS, AND THREE CODES CROSS A DOMAIN LINE** (ADR 0054
 * decision 3): `co_ppm` (§5 before §6), `sensor_battery_pct` (§4 before §6) and
 * `controller_comms_ok` (§3 before §8a/§8b) are all filed under **`facility`**,
 * which is why the access door's `controller_comms_ok` is a cross-PR dependency
 * PR 2 references rather than redeclares.
 *
 * **THE TWO `X/D` ROWS RESOLVE DIFFERENTLY** (plan §12 ruling 3):
 * `entrapment_state` (§8a) is authored **measured, `extended`** — its derivation
 * needs a car-load threshold B7/B8 forbid in v1 — and `handrail_speed_dev_pct`
 * (§8b) is authored **derived**, because the document defines it and all three
 * of its inputs are declared. Over the 48: 8 promoted, 40 deferred, 1 declared
 * measured.
 *
 * ---
 *
 * **DEFERRAL LEDGER — 48 derived codes named by the document, 8 promoted and
 * authored over 9 points, 40 deferred over 42 records and NAMED, never
 * placeholdered** (ADR 0054 decision 6, ADR 0051 Amendment 6 decision 8: a code
 * with no `bms-calc-v1` formula is not vocabulary). 8 + 40 = 48 is the distinct
 * set the nine *Derived:* prose lines name across 51 mentions, and that
 * reconciliation is the proof nothing was dropped. PR 1 is 4 + 25 = 29 over 30
 * mentions; PR 2 is 4 + 15 = 19 over 21. The per-entry lists live in
 * `stock-catalog-deferrals.spec.ts`, which asserts each entry declares none of
 * its own; the formulas live in the module that authors them, beside the code
 * they compute.
 *
 * **Promoted and authored — 8 codes, 9 points, and one code authored twice:**
 * `denied_ratio_pct` (access door); `occupancy_pct` (occupancy zone AND parking
 * level); `co2_above_outdoor_ppm` and `pm25_indoor_outdoor_ratio` (IAQ node);
 * `door_reversal_ratio_pct` and `kwh_per_trip` (lift); `handrail_speed_dev_pct`
 * and `kwh_per_run_hour` (escalator).
 *
 * **`occupancy_pct` is one code, two entries, two formulas** — people over a
 * declared `occupancy_capacity` on the zone, occupied bays over `bays_total` on
 * the parking level. One meaning (*how full is this space*), two denominators,
 * and it is deferred on neither. That is the `recovery_pct` shape `E5.1` set and
 * the reason the deferral ledger is a per-entry `Record` rather than one flat
 * list. **The capacity is a declared *attribute-as-point* row**, which is why
 * ADR 0054's sketch of `occupancy_pct` as attribute-deferred does not apply
 * (plan §12 ruling 2).
 *
 * **Deferred — 40 codes, 42 records, in eight classes**, the seven `E5.2`
 * enumerated plus **one new**. The new one is the first whose formula PARSES:
 *
 *  - **A SUBSYSTEM STATE ROLL-UP — NEW in this pack** — `fire_system_healthy`
 *    (fire panel), `access_system_healthy` (access door) and `data_quality_pct`
 *    (BAS gateway). `fire_system_healthy` is expressible as a product of five
 *    declared binaries and is refused all the same: a health flag over states is
 *    `content.health`'s job — ADR 0050's surface, not a template point — each of
 *    its five inputs already raises its own alarm, and a roll-up restates several
 *    decisions as one number with no way back to which input moved it. ADR 0054
 *    decision 6 routes `data_quality_pct` to the `F3.x` estate view for the same
 *    reason at a different scale. **Every other class here is deferred because
 *    it cannot be written; this one because it should not be** (plan §12 ruling
 *    5).
 *  - **A time window the grammar has no state for** — **27 of the 42 records
 *    over 25 distinct codes**, the largest class in the pack by a distance:
 *    `lit_while_unoccupied_min_day`,
 *    `override_hours_day`, `isolation_hours_month`, `jockey_starts_per_hour`,
 *    `door_open_minutes_day`, `traffic_per_hour`, `occupied_hours_day`,
 *    `turnover_per_day`, `avg_dwell_min`, `fan_hours_day`, `co_driven_fan_pct`,
 *    `hours_out_of_band_day`, `uptime_pct`, `mean_latency_s`, and in PR 2
 *    `availability_pct` and `mtbf_h` (both twice), `entrapments_per_month`,
 *    `door_cycles_per_day`, `trips_per_day`, `peak_hour_wait_s`,
 *    `out_of_service_hours_month`, `starts_per_day`, `safety_trips_per_month`,
 *    `fault_rate_per_1000_trips` (an interval counter over a cumulative one is
 *    not a rate) and `levelling_drift_mm` (a trend against a commissioning
 *    baseline — the `approach_trend` class; ADR 0054 read this one the other way
 *    and plan §12 ruling 5 defers it).
 *  - **An asset attribute the grammar cannot read** — `lighting_w_per_m2` (zone
 *    area), `daylight_saving_pct` (the full-output baseline),
 *    `lamp_availability_pct` (the luminaire count), `fire_pump_run_unplanned`
 *    (the test schedule), `space_utilization_pct` (the desk or room count) and
 *    `motor_current_baseline_dev_pct` (a commissioning baseline).
 *  - **A value on another asset that `bms-calc-v1` cannot name** —
 *    `conditioning_while_empty_kwh` (the HVAC zone's energy) and `mttr_h` (work
 *    orders, `E3.1`).
 *  - **A method the document only names** — `iaq_index` and
 *    `ventilation_adequacy_pct` (ISHRAE banding and a ventilation rate the
 *    document does not fix), `ride_quality_index` (ISO 18738 banding) and
 *    `standby_ratio_pct`, whose denominator the document leaves open — standby
 *    over run, or over run plus standby — and a definition picked under the
 *    right name is worse than a deferral.
 *  - Plus the three earlier classes with no instance in this pack: a standard's
 *    lookup, a second code for a meaning already declared, and a point that
 *    could never receive a value. They stay in `DEFERRAL_REASON` because the
 *    ledger is catalog-wide.
 *
 * ---
 *
 * **KPI vs. POINT, AND WHY THIS PACK ALSO HAS NO `content.kpis`** (ADR 0054
 * decision 6, the same structural reason `water.ts` and `mechanical.ts` record).
 * A code the document marks derived becomes a `kind: "derived"` point when a
 * formula exists over MEASURED siblings the SAME entry declares — never over
 * another derived point (ADR 0036 decision 7), never over another asset's. Every
 * expressible quantity this document names is such a code, and four of the nine
 * points are bound by an alarm, so every one is a point. The gap the electrical
 * pack's six KPI codes filled — an expressible ratio with no code — does not
 * exist here.
 *
 * **DIVISION BY ZERO IS HANDLED AND MUST NOT BE GUARDED.** `evaluate.ts` returns
 * `non_finite`, so the denied ratio at zero events, occupancy at zero capacity,
 * the indoor/outdoor ratio at a zero outdoor reference, the reversal ratio at
 * zero cycles, kWh per trip at zero trips and kWh per run hour on a stopped
 * escalator all produce **no value for that reading**. No `clamp`, no
 * `max(…, 0.001)`: a fabricated denominator turns "no data" into a plausible
 * number.
 *
 * **THE TWO `maxInputAgeSeconds: 3600` OVERRIDES ARE THE ONLY ONES IN THE PACK**
 * and both are on the IAQ node: `co2_above_outdoor_ppm` and
 * `pm25_indoor_outdoor_ratio` each reference an outdoor value the document calls
 * *"site or API"*, which is a slow input the 300 s default would starve — the
 * `approach_c` precedent `E5.1` set. The other seven formulas assert `null`, and
 * a helpful override on any of them is a test failure with a reason.
 *
 * **SEVEN OF THE NINE FORMULAS REFERENCE `X`-TIER INPUTS.** That is legal and
 * deliberate: a site without the gateway point simply gets no value for that
 * derived point, which is the honest outcome.
 *
 * ---
 *
 * **ALARMS: A `philosophy` ON EVERY ROW, AND NO NUMBER ANYWHERE.** Every alarm
 * in the pack is **pair-absent** — no `thresholdValue`, no `operator` — per ADR
 * 0019 Amendment 2, ADR 0054 decision 5 and B7's rule that limit values are set
 * per site at commissioning. **That includes the EN 115 handrail-deviation band,
 * the ISHRAE indoor-air limits and the egress capacity, which carry no number
 * even inside `philosophy`.** The meaning is carried by the message and by a
 * populated ADR 0019 §3 `philosophy` object: `cause`, `impact`, `action`, and
 * `skill` where one of the seeded trades genuinely answers.
 *
 * **THE `skill` RULE, AND THE THREE FUNCTIONS THAT ARE NOT TRADES.**
 * `bms.alarm_skills` holds exactly five codes from migration `0034` —
 * `electrical`, `mechanical`, `hvac`, `controls`, `civil` — and
 * `assertTemplateAlarmVocabularies` closes `philosophy.skill` against the live
 * table at import, so a wrong code is a 400 on a client's site. So `skill` is
 * set only where one of the five genuinely answers: `electrical` for a supply, a
 * panel mains, a motor or a drive; `controls` for a gateway, a controller link, a
 * sensor node, a clock or a schedule; `mechanical` for a lift or escalator
 * machine, a door operator, a brake, a fan, a barrier or a pump; `hvac` for
 * ventilation and a comfort band; `civil` for a tank, a pit or a truss.
 *
 * **It is omitted on exactly 16 rows across the pack — 14 in PR 1 and 2 in PR
 * 2** — and the distinction is the one ADR 0054 decision 5 was reaching for
 * (plan §12 ruling 4): **a trade answers the panel's own infrastructure; none of
 * the five answers the EVENT the panel reports.** The responder there is the
 * fire, security or life-safety function, and no such trade exists. So
 * `panel_on_battery` is `electrical`, `panel_comms_loss` is `controls`,
 * `fire_tank_level_low` is `civil`, `jockey_pump_cycling` is `mechanical`,
 * `controller_comms_loss` is `controls` and `controller_on_battery` is
 * `electrical` — while `fire_alarm`, `door_forced`, `fire_release_active`,
 * `fire_recall_active`, `emergency_stop_pressed` and the rest carry none.
 * Inventing a code, or filing a fire event under `controls` because a field
 * wants a value, is the guessing this rule prevents. `F4.78` files the missing
 * trades; when they land those rows gain a `skill` in a `stockVersion: 2`.
 *
 * **Vendor fault codes are carried in the alarm text, never enumerated**:
 * `lift_fault_code`, `esc_fault_code`, `drive_fault_code` and
 * `safety_device_tripped` are declared `code` / `enum` rows with empty units, and
 * the alarms bind the `0/1` flag beside them.
 *
 * **TWO ALARM BULLETS ARE DROPPED, AND NAMED HERE RATHER THAN INVENTED** (plan
 * §12 ruling 6). §1's *communication loss to gateway* has no point to bind — §1
 * carries no `lighting_comms_ok` row — and §4's *sensor offline* has none either,
 * because §4 carries no `sensor_online` (§6 does). **No row is invented to give a
 * bullet a home.** Both are v2 redline candidates for the `F2.18` handout, and
 * the events themselves are not lost: the gateway's own `device_offline` on
 * `facility-bas-gateway` is where a comms failure lives.
 *
 * ---
 *
 * **INSTANTIATION: AN IMPORTED DRAFT CANNOT BE INSTANTIATED UNTIL AN OPERATOR
 * FILLS IN THE SOURCE PATTERNS.** Every point in the pack carries
 * `sourceDataKeyPattern: null` — the pattern is the site's telemetry wiring,
 * which the tag list does not know and the catalog must not guess.
 * `resolveSourceDataKey` returns `null` for a null pattern, and
 * `AssetTemplateInstantiationService` throws a 400 for a REQUIRED point with no
 * resolvable key while listing an optional one in `skippedPoints`.
 *
 * **The `M` rows are the sharper half of the same fact — eight distinct codes
 * over ten rows, the most of any pack so far**, two of them in PR 1
 * (`weekly_test_done` on the fire panel, `microbial_count_cfu` on the IAQ node)
 * and eight rows in PR 2 (`annual_inspection_due`, `rope_condition`,
 * `brake_test_result`, `buffer_test_result`, `ard_battery_test` on the lift, and
 * the escalator's three, two of which reference the lift's). An `M` row carries
 * a null pattern **forever**, so it is always skipped and never gets an
 * `asset_points` row; `F1.8` manual entry still has nothing to attach a reading
 * to. **Two alarms bind an `M` row anyway** — both `statutory_inspection_overdue`
 * rows, against `annual_inspection_due` — and that is authored rather than
 * dropped: the date arrives through `F1.8`, and nothing fires before `E2.4`
 * wires alarms to rules.
 *
 * ---
 *
 * **DELIVERED IN TWO PULL REQUESTS, AND PR 2 IS CUT FROM `main`** (plan §12
 * ruling 8). PR 1 is this index and the seven facility/environment classes of
 * §§1-7. PR 2 — `feat/E5.3-vertical-transport-pack` — adds §8a's lift and §8b's
 * escalator, the `VERTICAL_TRANSPORT_CLASS_POINT_KEYS` array, and the per-entry
 * `ENTRY_SOURCE_DOC` override that lets a `mechanical-`prefixed entry cite the
 * `E5.3` document. It is **not stacked** on PR 1: this repository squash-merges,
 * so a stacked branch would have to rebase across a commit that no longer exists
 * in that form. **PR 2 cannot start until PR 1 merges.**
 *
 * **SCOPE FENCE** (ADR 0054). This pack authors content and one
 * `bms.asset_domains` row. It does **not** build fire, access or life-safety
 * analytics — the fire panel is **observe-only**, with no reset, silence or
 * isolate command anywhere — and does not wire alarms to rules (`E2.4`), build
 * or rebind dashboards (`F3.1`, `F3.45`), touch the hierarchy (`F2.10`), add the
 * missing trades (`F4.78`), the runtime import parse (`F2.16`) or the catalog
 * accordion (`F2.17`). It creates no `BASELINE-FACILITY` template: nothing
 * selects a domain with no active asset, and `bms.asset_templates` on a cold
 * start stays at 4. The four reused control-room codes are not moved into the new
 * array, which is why `controlRoomEnvironmentPointKeySchema` stays a closed
 * `z.enum` and the control-room screens keep working.
 *
 * **NAMES STAY GENERIC** (decision 7's overlay rule): a template name is the
 * class name — *Lighting zone (DALI-2 / relay panel)*, *Fire alarm panel
 * (FACP)*, *Lift (traction or hydraulic)* — and OEM or IESL product names swap in
 * as display names when confirmed.
 *
 * ---
 *
 * **TWO DIFFERENT ORDERS, AND NEITHER IS TO BE "CORRECTED" INTO THE OTHER.** The
 * vocabulary arrays in `packages/shared/src/facility-point-keys.ts` follow **the
 * document, per array**, so each can be audited row for row against the handout
 * a client is holding. The index below follows **document order ACROSS ALL THREE
 * DOMAINS** (ADR 0054 decision 1): lighting zone, fire panel, access door,
 * occupancy zone, parking level, IAQ node, BAS gateway, lift, escalator. That is
 * what a client sees, because it is the order
 * `GET /admin/asset-templates/stock` returns, and
 * `stock-catalog-deferrals.spec.ts` holds the catalog to it. **The single
 * `environment-` entry therefore sits SIXTH, between the parking level and the
 * BAS gateway** — do not sort it to the end to make the prefixes group.
 *
 * **A NEW CLASS MODULE MUST JOIN `STOCK_ASSET_RELS`** in
 * `tests/f2.13-asset-stock-catalog-vocabulary.test.ts`. That guard reads these
 * files as TEXT and cannot follow the spread below; an unlisted module has its
 * point keys checked against no vocabulary at all, and every assertion there
 * stays green while checking less. The directory cross-check in that file makes
 * it a build failure rather than an instruction — which is what makes the
 * one-module-per-commit rule at the head of this docblock safe, and it is why
 * this index was listed there in the commit that created it, empty.
 *
 * ---
 *
 * **VERSION HISTORY**, per entry (ADR 0052 decision 6): a change to a shipped
 * entry is a new `stockVersion`, recorded here and in the module, taken by an
 * organization through a re-import (decision 4), never by mutating its row. Each
 * entry will be **v1 (2026-09-04, `E5.3`), PROVISIONAL — derived from the tag
 * list and published practice, not client-confirmed**, and **each entry commit
 * appends its own line here** with its section, its point count and tier split,
 * its alarm count and its maintenance-plan count.
 *
 *  - `facility-lighting-zone` **v1** (2026-09-04, `E5.3`): §1, 15 points
 *    (5 C + 10 X + 0 M + 0 derived), 4 alarms, 3 maintenance plans.
 *  - `facility-fire-panel` **v1** (2026-09-04, `E5.3`): §2, 24 points
 *    (8 C + 15 X + 1 M + 0 derived), 11 alarms — seven of them with no `skill`
 *    — 4 maintenance plans, two `safetyCritical`. Observe-only.
 *  - `facility-access-door` **v1** (2026-09-04, `E5.3`): §3, 17 points
 *    (5 C + 11 X + 0 M + 1 derived — `denied_ratio_pct`, the pack's first
 *    formula), 7 alarms — five of them with no `skill`, the security class — 3
 *    maintenance plans, one `safetyCritical`. Declares `controller_comms_ok`,
 *    the code PR 2 depends on.
 *  - `facility-occupancy-zone` **v1** (2026-09-04, `E5.3`): §4, 11 points
 *    (2 C + 8 X + 0 M + 1 derived — `occupancy_pct`, the first of its two
 *    authorings), 4 alarms from five bullets — the pack's second dropped bullet
 *    — one of them with no `skill`, 2 maintenance plans, none `safetyCritical`.
 *  - `facility-parking-level` **v1** (2026-09-04, `E5.3`): §5, 17 points
 *    (5 C + 11 X + 0 M + 1 derived — `occupancy_pct`, the second authoring),
 *    7 alarms — one of them with no `skill` — 4 maintenance plans, none
 *    `safetyCritical`, one `condition_based`. Carries the pack's dual-tier row:
 *    `co_ppm` is `core` here and `extended` on the IAQ node.
 */
export const FACILITY_STOCK_ASSET_TEMPLATES: readonly StockAssetTemplateEntry[] = [
  // ADR 0054 decision 1's document order — lighting zone, fire panel, access
  // door, occupancy zone, parking level, IAQ node, BAS gateway, then the lift
  // and the escalator in PR 2 — which is the order GET /stock lists in, and NOT
  // the prefix order. Each entry commit adds one import above and one line here,
  // in this order.
  FACILITY_LIGHTING_ZONE,
  FACILITY_FIRE_PANEL,
  FACILITY_ACCESS_DOOR,
  FACILITY_OCCUPANCY_ZONE,
  FACILITY_PARKING_LEVEL,
];
