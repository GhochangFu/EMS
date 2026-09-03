import { MECHANICAL_PUMP } from "./mechanical-pump";
import type { StockAssetTemplateEntry } from "./types";

/**
 * `E5.2` — the mechanical/utility pack index, the third pack through the
 * mechanism `F2.13` built, `F2.12` split per class and `E5.1` proved a second
 * time (ADR 0053, Accepted 2026-09-03; ADR 0052 decisions 1, 2 and 6). This
 * file aggregates; it authors nothing.
 *
 * **THE ARRAY BELOW SHIPPED EMPTY, AND IT WAS EMPTY ON PURPOSE.** This module
 * landed in the commit that declares the pack — the two `PACK_SOURCE_DOC`
 * prefixes, the eighteen `STOCK_ENTRY_CODES`, the six deferral lists and this
 * index — one commit before the first machine was authored, and it **fills one
 * machine per commit** from there (`mechanical-pump` is in). `E5.1` §13 item 1 is
 * the reason it shipped empty rather than holding six skeletons with one
 * placeholder point each: a skeleton passes every check in this directory while
 * telling a global
 * administrator that the catalog ships a pump it cannot instantiate, and it
 * makes the anti-vacuity bounds in `tests/f2.13-asset-stock-catalog-vocabulary`
 * move for content that does not exist. **Each entry commit creates its module,
 * adds its import and its line to the array below, adds the file to
 * `STOCK_ASSET_RELS`, and appends its own version line to the history at the
 * foot of this docblock** — so no commit is red on the directory cross-check and
 * no docblock has to explain a placeholder away.
 *
 * **SOURCE.** `docs/e5.2-derived-taglist-v1.md` §§1-7 — the v1 point basis for
 * the six mechanical/utility machine classes. **PROVISIONAL, and that word is
 * load-bearing**: like the water handout, this document is a workshop sheet
 * whose instruction to the client is to strike what is not fitted, add what is
 * missing and correct names and units. Every entry's own `description` repeats
 * the marking and cites the file and its section by name, because the stamp plus
 * the citation IS the provenance (ADR 0052 decision 6, ADR 0053 decision 7) and
 * there is no `meta.provenance` to fall back on. The client-confirmed release is
 * v2, and each module records its own redline candidates.
 *
 * ---
 *
 * **TWO DOMAINS, ONE PACK, ONE INDEX — AND THE PREFIX SAYS WHICH** (ADR 0053
 * decision 2). The pump set, the VFD, the air compressor and the boiler are
 * `mechanical`, the sixth `bms.asset_domains` row and the first a pack has added
 * through the seed path (ADR 0031 A1.1; `packages/db/src/asset-domains-seed.ts`).
 * The chiller and the AHU are **`hvac`** — the existing domain whose vocabulary
 * already holds nine of their keys, which is also why the seeded `BASELINE-HVAC`
 * template and the CRAC screens keep working unchanged. Entry codes keep the
 * convention both shipped packs set, prefix = domain:
 *
 *  - `mechanical-pump` (`pump`), `mechanical-vfd` (`vfd`),
 *    `mechanical-compressor` (`air_compressor`), `mechanical-boiler` (`boiler`)
 *  - `hvac-chiller` (`chiller`), `hvac-ahu` (`ahu`)
 *
 * **Module file names follow the entry code**, as the water pack's do, so two
 * `hvac-*.ts` files live under this *mechanical* index. Stated here so nobody
 * tidies them into an `hvac.ts`: a second index would need its own source-document
 * story, and `PACK_SOURCE_DOC` is keyed by PREFIX while a pack is one DOCUMENT —
 * the two are different axes. One document feeds both prefixes, and
 * `stock-catalog.spec.ts` declares them both against this file.
 *
 * ---
 *
 * **THE DOCUMENT, COUNTED — AND THIS ONE'S OWN COUNTS LINE RECONCILES.** The tag
 * list carries **128 table rows over 115 distinct codes** across §§1-4, §6 and
 * §7 (§5 is the cooling tower and has no table): 54 `C`, 69 `X`, 4 `M` and one
 * dual-tier row. Its own *Counts:* line says exactly that — unlike the water
 * handout's, which missed on all four numbers and is recorded as a v2 redline in
 * `water.ts`. Thirteen of the 128 rows are recurrences of eight codes across
 * classes, and all eight are already-seeded codes, so the new set partitions
 * cleanly by class and no cross-class tie-break is needed.
 *
 * The arithmetic every number in this pack derives from, after plan §12 ruling 1:
 *
 *  - **115 distinct table codes = 21 reused + 94 new.** The reused 21 are
 *    **referenced, never redeclared** (ADR 0053 decision 3): units are write-once
 *    through the seed's `COALESCE`, so `fan_rpm` keeps `RPM` and `start_count`
 *    keeps the empty string, and each stays in the array that already holds it.
 *    The twenty-first is `fuel_level_pct`: the boiler's day-tank level is the DG
 *    set's code, one meaning and one code (ADR 0051 Amendment 6 decision 5), so
 *    the document's `fuel_tank_level_pct` spelling is a closure correction to the
 *    handout rather than a new key.
 *  - **107 new vocabulary codes = 94 new table codes + 13 promoted derived
 *    codes.** They land as two arrays in `packages/shared/src/constants.ts` —
 *    `MECHANICAL_CLASS_POINT_KEYS` (68) and `HVAC_CLASS_POINT_KEYS` (39) — with
 *    their `UNIT_BY_KEY` entries and two `keysForDomain(…)` lines, taking
 *    `bms.point_keys` to **398** on a cold start. A promoted code must be
 *    vocabulary because `assertPointKeysActive` checks a derived point's key like
 *    any other; ADR 0053 decision 3's figure of 386 counted the table codes only
 *    and is corrected at closure.
 *  - **128 distinct keys the pack names = 94 new + 21 reused + 13 promoted**, and
 *    the six entries together declare **141 point rows** (128 table rows + 13
 *    derived) once all six land. Those are targets until Task 11 re-measures them
 *    off the built files.
 *
 * **TIERS → `meta.tier`** (ADR 0053 decision 4, ADR 0040 decision 3): `C` is
 * `core` / required, `X` is `extended` / optional, `M` is `manual` / optional and
 * entered by hand through `F1.8` / `F1.9`, never mapped from a data key. **The
 * one dual-tier row resolves first-listed-wins**, as the water pack's two did:
 * §7 marks `feedwater_tds_ppm` `X/M`, so it is `extended` on the boiler.
 *
 * ---
 *
 * **DEFERRAL LEDGER — 30 derived codes named by the document, 13 promoted and
 * authored, 17 deferred and NAMED, never placeholdered** (ADR 0053 decision 6,
 * ADR 0051 Amendment 6 decision 8: a code with no `bms-calc-v1` formula is not
 * vocabulary). 13 + 17 = 30 is the distinct set the six *Derived:* prose lines
 * name across 30 mentions, and that reconciliation is the proof nothing was
 * dropped. The per-entry lists live in `stock-catalog-deferrals.spec.ts`, which
 * asserts each entry declares none of its own; the formulas live in the module
 * that authors them, beside the code they compute.
 *
 * **Promoted and authored — 13 codes, 13 points, no code authored twice:**
 * `head_m` and `specific_energy_kwh_kl` (pump); `load_factor_pct` and
 * `specific_power_kw_m3min` (compressor); `chw_delta_t_c`, `cw_delta_t_c`,
 * `cooling_load_tr`, `kw_per_tr` and `cop` (chiller — the N4 form's KPIs, every
 * input `C`); `sat_deviation_c` and `coil_delta_t_c` (AHU); `steam_to_fuel_ratio`
 * and `excess_air_pct` (boiler). The VFD promotes none: §2 is a register block,
 * and all three of its named ratios need the motor's nameplate.
 *
 * **`specific_energy_kwh_kl` is one code, three entries, one authoring.** It is
 * deferred on `electrical-feeder` (which needs a KL throughput from another
 * asset) and on `water-ro` (whose §2 declares pump current, not kW), and it is
 * AUTHORED on the pump, which declares both `kw` and `flow_klh`. One meaning —
 * *energy per kilolitre moved* — exactly the `load_pct` shape, and the reason the
 * deferral ledger is a per-entry `Record` rather than one flat list. The two
 * deferral records stay; a filing domain is not an exclusivity (ADR 0051
 * Amendment 6 decision 3).
 *
 * **Deferred — 17 codes, 17 records, in seven classes**, five inherited from the
 * electrical and water packs and **two new here**. (Plan §5.0's lead sentence
 * says five classes and three inherited; its own table two paragraphs below
 * assigns seven. The enumeration is what holds, and the 13 / 17 / 30 totals are
 * unaffected either way.)
 *
 *  - **A time window the grammar has no state for** — `duty_hours_pct`,
 *    `starts_per_hour`, `availability_pct` (pump), `unload_cycles_per_hour`
 *    (compressor), `approach_trend` (chiller), `fan_energy_kwh_day` (AHU).
 *  - **An asset attribute the grammar cannot read** — `motor_load_pct`,
 *    `speed_pct`, `energy_saving_vs_dol_kwh` (VFD: rated current, rated
 *    frequency, and a direct-on-line baseline that is also a model),
 *    `part_load_pct` (chiller: rated TR), `filter_life_pct` (AHU: the clean and
 *    dirty pressure-drop band per filter class).
 *  - **A meter the section does not list** — `cooling_delivered_kw` (AHU): §6
 *    carries the two chilled-water temperatures and no flow at the coil.
 *  - **A standard's lookup — NEW in this pack** — `vibration_band` (pump): ISO
 *    20816's zones A-D are a table indexed by machine group, power and mounting,
 *    and `bms-calc-v1` has arithmetic and five functions with no lookup at all.
 *  - **A method the document only names — NEW in this pack** —
 *    `air_leak_estimate_pct` (compressor: a no-demand pressure-decay test needing
 *    a window in which nothing draws air) and `efficiency_indirect_pct` (boiler:
 *    IS 13979 / BS 845 over a fuel analysis and a loss model). Both are
 *    procedures whose inputs are not points.
 *  - Plus two the earlier packs already have a class for: **a second code for a
 *    meaning already declared** — `specific_fuel_kg_ton_steam` (boiler), the
 *    reciprocal of the authored `steam_to_fuel_ratio` (plan §12 ruling 3) — and
 *    **a point that could never receive a value** — `blowdown_pct` (boiler),
 *    which parses by TDS balance over two declared measured points, one of them
 *    an `M` row whose pattern is null forever. That is the **second instance** of
 *    `water-softener`'s `salt_efficiency_kg_kl` class, so the data-model deferral
 *    is now a pattern rather than an anecdote, and it becomes authorable the day
 *    `F1.8` gives a manual row somewhere to write to.
 *
 * ---
 *
 * **KPI vs. POINT, AND WHY THIS PACK ALSO HAS NO `content.kpis`** (ADR 0053
 * decision 6, the same structural reason `water.ts` records). A code the document
 * marks derived becomes a `kind: "derived"` point when a formula exists over
 * MEASURED siblings the SAME entry declares — never over another derived point
 * (ADR 0036 decision 7), which is why the chiller's kW/TR and COP restate the
 * chilled-water ΔT inside their own denominators instead of referencing
 * `chw_delta_t_c`. Every expressible ratio this document names is such a code,
 * and two of them are bound by an alarm, so every one is a point. The gap the
 * electrical pack's six KPI codes filled — an expressible ratio with no code —
 * does not exist here.
 *
 * Two shipped facts close off the alternative, so nobody re-derives them:
 * `checkEntry` refuses `dialect: "unvalidated"` catalog-wide, and
 * `collectContentPointRefs` walks a KPI's key list regardless of dialect, so a
 * cross-asset KPI is not authorable in a stock entry in either dialect.
 *
 * **DIVISION BY ZERO IS HANDLED AND MUST NOT BE GUARDED.** `evaluate.ts` returns
 * `non_finite`, so specific energy at zero flow, load factor at zero run hours,
 * specific power at zero FAD, kW/TR and COP on a chiller that is off, the
 * steam-to-fuel ratio at zero fuel and excess air at 20.9 % O₂ all produce **no
 * value for that reading**. No `clamp`, no `max(…, 0.001)`: a fabricated
 * denominator turns "no data" into a plausible number. Nor does any entry
 * override `maxInputAgeSeconds` — every formula's inputs arrive from one
 * controller or one plant-room instrument set inside the 300 s default, so the
 * entry specs assert `null` on all thirteen and a helpful override is a test
 * failure with a reason.
 *
 * ---
 *
 * **ALARMS: A `philosophy` ON EVERY ROW, AND THE ASYMMETRY THAT CREATES.** Every
 * alarm in the pack is **pair-absent** — no `thresholdValue`, no `operator` —
 * per ADR 0019 Amendment 2, ADR 0053 decision 5 and B7's rule that limit values
 * are set per site at commissioning. **That includes the IBR drum-level pair and
 * the safety-valve-lift pressure, which carry no number even inside
 * `philosophy`.** The meaning is carried by the message and by a populated ADR
 * 0019 §3 `philosophy` object: `cause`, `impact`, `action`, and `skill` where one
 * of the seeded trades genuinely answers.
 *
 * **Not one of the shipped electrical alarms carries a `philosophy`**, and the
 * asymmetry is between two ADRs rather than a defect — ADR 0051 Amendment 6 did
 * not require one; ADR 0040 decision 4 and ADR 0053 decision 5 do. Closing it
 * would be a `stockVersion` bump on six shipped entries. It is recorded here for
 * the same reason `water.ts` records it, and nothing catalog-wide asserts
 * `philosophy` in `stock-catalog.spec.ts`: such an assertion would fail six
 * correct entries. The claim lives in the per-class specs.
 *
 * **THE `skill` RULE, AND THE TRADE THAT DOES NOT EXIST.** `bms.alarm_skills`
 * holds exactly five codes from migration `0034` — `electrical`, `mechanical`,
 * `hvac`, `controls`, `civil` — and `assertTemplateAlarmVocabularies` closes
 * `philosophy.skill` against the live table at import, so a wrong code is a 400
 * on a client's site. So `skill` is set only where one of the five genuinely
 * answers: `mechanical` for a pump, bearing, seal, compressor element, burner or
 * boiler mounting; `electrical` for a motor or a drive; `hvac` for a chiller, an
 * AHU or a refrigeration circuit; `controls` for a controller, a setpoint or a
 * short-cycling loop; `civil` for a tank. **It is omitted on exactly four
 * process-chemistry rows, all on the boiler** — flue-gas O₂ high and low, CO
 * high, feedwater TDS high — because no seeded trade answers a combustion or
 * water-chemistry excursion. `F4.78` files the `process` trade; when it lands
 * those four gain a `skill` in a `stockVersion: 2`. Inventing a code, or filing a
 * chemistry alarm under `controls` because a field wants a value, is the guessing
 * this rule prevents. **Vendor fault codes are carried in the alarm text, never
 * enumerated**: the drive's and the chiller's fault-code rows are declared with
 * an empty unit, and the alarms bind the binary fault flag beside them.
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
 * **The four `M` rows are the sharper half of the same fact** — the pump's
 * insulation resistance, the chiller's refrigerant charge, and the boiler's water
 * pH and blowdown TDS. An `M` row carries a null pattern **forever**, so it is
 * always skipped and never gets an `asset_points` row; `F1.8` manual entry still
 * has nothing to attach a reading to. `F2.12` first hit this with seven rows, the
 * water pack added ten and deferred `salt_efficiency_kg_kl` over it, and this
 * pack defers `blowdown_pct` over the fourth of its four. A flag for `F1.8`; not
 * fixed here.
 *
 * ---
 *
 * **THE COOLING TOWER IS `water-cooling-tower`, AND IT IS NOT FORKED** (ADR 0053
 * decision 1). §5 of this tag list is the tower and carries no table because
 * `E5.1` already shipped it. A chiller plant **composes** that entry; no
 * `hvac-cooling-tower` is minted, and the chiller module's docblock points at it
 * rather than restating its rows.
 *
 * **ONE ASSET PER MACHINE; COMPOSITION IS THE ASSET GROUP'S** (decision 9). A
 * driven load with its VFD, a compressor house, a chiller plant with its tower
 * are compositions of assets in a group at their location, not templates. **The
 * VFD is therefore its own template and its own asset**, on the drive's own
 * register block, attached to what it drives by the group — which is also why its
 * power, energy and run-hour codes keep their `vfd_` prefix instead of reusing
 * the motor's. A parent-child train is a v2 shape behind `F2.10`.
 *
 * **NAMES STAY GENERIC** (decision 10): a template name is the machine-class
 * name, and OEM or IESL product names swap in as display names when confirmed.
 *
 * **SCOPE FENCE** (decision 11). This pack authors content and one vocabulary
 * row. It does **not** build chiller-health analytics — `kw_per_tr` is a derived
 * point and *"kW/TR high vs baseline"* is a pair-absent alarm meaning; the N5
 * health signal is ADR 0050's surface — and does not wire alarms to rules
 * (`E2.4`), build or rebind dashboards (`F3.1`, `F3.45`), touch the hierarchy
 * (`F2.10`), add the `process` skill (`F4.78`), the runtime import parse
 * (`F2.16`) or the catalog accordion (`F2.17`), and does not rename, retire or
 * re-point the seeded `BASELINE-HVAC` template or change `apps/sim`. The nine
 * reused `HVAC_POINT_KEYS` codes are not moved into the new array, which is why
 * both keep working unchanged and why `hvacPointKeySchema` stays a closed enum
 * over nine codes.
 *
 * ---
 *
 * **TWO DIFFERENT ORDERS, AND NEITHER IS TO BE "CORRECTED" INTO THE OTHER.** The
 * vocabulary arrays in `packages/shared/src/constants.ts` follow **the document,
 * per array** — `MECHANICAL_CLASS_POINT_KEYS` runs §1, §2, §3, §7 and
 * `HVAC_CLASS_POINT_KEYS` runs §4, §6, each section's promoted codes appended at
 * its end — so either can be audited row for row against the handout a client is
 * holding. The index below follows **document order ACROSS BOTH DOMAINS** (ADR
 * 0053 decision 1): pump, VFD, compressor, chiller, AHU, boiler. That is what a
 * client sees, because it is the order `GET /admin/asset-templates/stock`
 * returns, and `stock-catalog-deferrals.spec.ts` holds the catalog to it.
 *
 * **This differs from `water.ts` on purpose.** That index follows ADR 0040 ruling
 * 2's authoring order rather than its document's section order, because that ADR
 * ruled one. ADR 0053 ruled the other way — the handout reads pump first and the
 * pump set is the base class the document says every other pack's pump is — so
 * the two `hvac-` entries sit in the MIDDLE of this list, between the compressor
 * and the boiler. Do not sort them to the end to make the prefixes group.
 *
 * **A NEW CLASS MODULE MUST JOIN `STOCK_ASSET_RELS`** in
 * `tests/f2.13-asset-stock-catalog-vocabulary.test.ts`. That guard reads these
 * files as TEXT and cannot follow the spread below; an unlisted module has its
 * point keys checked against no vocabulary at all, and every assertion there
 * stays green while checking less. The directory cross-check in that file makes
 * it a build failure rather than an instruction — which is what makes the
 * one-module-per-commit rule at the head of this docblock safe.
 *
 * ---
 *
 * **VERSION HISTORY**, per entry (ADR 0052 decision 6): a change to a shipped
 * entry is a new `stockVersion`, recorded here and in the module, taken by an
 * organization through a re-import (decision 4), never by mutating its row. Each
 * entry will be **v1 (2026-09-03, `E5.2`), PROVISIONAL — derived from the tag
 * list and published practice, not client-confirmed**, and **each entry commit
 * appends its own line here** with its section, its point count and tier split,
 * its alarm count and its maintenance-plan count:
 *
 *  - **`mechanical-pump` v1** (2026-09-03, `E5.2` Task 6) — §1, the pump set.
 *    20 points (6 core + 11 extended + 1 manual + 2 derived), 10 alarms, 4
 *    maintenance plans, none `safetyCritical`. Authors `head_m` and
 *    `specific_energy_kwh_kl`; defers `duty_hours_pct`, `starts_per_hour`,
 *    `availability_pct` and `vibration_band`.
 *
 * The pack's targets, for the reader who wants to know where this is going and
 * as the numbers Task 11 re-measures rather than assumes: **141 declared point
 * rows over 128 distinct codes, 13 derived points over 13 promoted codes, 52
 * alarms all pair-absent and all carrying a populated `philosophy`, 24
 * maintenance plans of which 3 are `safetyCritical`, and no `content.kpis` on any
 * entry.** They are predictions of the plan until the six modules exist; nothing
 * in this file asserts them.
 */
export const MECHANICAL_STOCK_ASSET_TEMPLATES: readonly StockAssetTemplateEntry[] = [
  // ADR 0053 decision 1's document order — pump, VFD, compressor, chiller, AHU,
  // boiler — which is the order GET /stock lists in, and NOT the prefix order.
  // Each entry commit adds one import above and one line here, in this order.
  MECHANICAL_PUMP,
];
