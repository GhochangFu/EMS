import { CORE, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's capacitor-bank / APFC class — `F2.12` Task 8, ADR 0052
 * decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/electrical-derived-taglist-v1.md` §6 — *"Capacitor bank /
 * APFC panel"*, the SOW page-10 *Capacitor* utility node. All 14 of §6's table
 * rows are declared, **in the document's own order** (`sortOrder` 0…13) —
 * **14 points: 4 core + 10 extended + 0 manual + 0 derived**, 6 alarms, 1 KPI,
 * 3 maintenance plans.
 *
 * **THE SMALLEST ENTRY IN THE PACK, AND THE ONE WITH NO FORMULA AT ALL.** Every
 * other class authors at least one `kind: "derived"` point; §6 authors none,
 * because all four of its derived codes need something the grammar does not
 * have (below). It is therefore the cheap opposite end of the row — 14 measured
 * rows, no manual rows, no `F1.8` exposure and no calc engine involvement — and
 * `electrical-classes-2.spec.ts` checks it as hard as the largest entry so that
 * "small" never becomes "special case".
 *
 * **§6's TABLE INTERLEAVES THE TIERS BY ONE ROW, and the order here is the
 * table's.** `target_pf` (X) is row 3, ahead of `actual_pf` and
 * `steps_on_count` (both C). Plan §5.5 lists them grouped core-then-extended,
 * which describes the tiers and not the order.
 *
 * **PROVISIONAL — derived from published practice, not client-confirmed**, and
 * the entry's own `description` says so (decision 6; there is no
 * `meta.provenance`). Plan §12 ruling 1 ships the maintenance plans and the KPI
 * code on that footing — **the tag list has no maintenance section and names no
 * KPI code** — so the derivation basis is recorded here the way the tag list
 * records its own at the top:
 *
 *  - **Capacitor-bank practice** — a capacitor is a wear part. It loses
 *    capacitance from the day it is energised, and it loses it fastest hot, so
 *    the three plans below are the three things that actually shorten a bank's
 *    life: measured kVAr per step (is the capacitor still a capacitor), the
 *    contactors and fuses (the parts that switch, arc and weld), and heat (the
 *    thermography and cleaning round). All three run at six months, which is
 *    the interval an APFC panel's own duty cycle justifies and a site adjusts.
 *
 * The asymmetry that makes authoring this safe: **a KPI code is per-entry
 * template content, changeable by a version bump; a point key is seeded into
 * `bms.point_keys`, foreign-keyed by `0058` and permanent.** This entry invents
 * no point key, and — uniquely in the row — promotes none either.
 *
 * ---
 *
 * **EVERY ONE OF §6's 14 ROWS IS DECLARED.** No `text` unit, no in-table `D`,
 * no row that reads another asset's meter, and **no `M` column at all** — an
 * APFC controller instruments every row it names.
 *
 * **THE DEFERRED DERIVED CODES**, each with the reason it is named rather than
 * placeholdered (ADR 0051 Amendment 6 decision 8: a code with no formula is not
 * vocabulary). §6's `Derived:` line names **four**, and all four are deferred:
 *
 *  - `pf_correction_kvar` — the reactive power a target PF needs is
 *    `kW × (tan φ₁ − tan φ₂)`. `bms-calc-v1` has `+ - * /`, `abs`, `round`,
 *    `min`, `max` and `clamp`, and **no trigonometry** — no `tan`, no `acos`.
 *    The controller computes it itself and publishes it as the measured
 *    `kvar_required` row, which is why that row exists and this code does not.
 *  - `steps_per_day` — a time window the grammar has no state for.
 *    `step_operation_count` is the cumulative counter behind it, and the
 *    `switching_rate_high` alarm binds that counter instead.
 *  - `capacitor_health_pct` = measured ÷ **rated** kVAr per step — the rated
 *    kVAr per step is an asset attribute. The bank-health plan below is the
 *    manual version, and it says so.
 *  - `pf_penalty_hours` — the tariff PF band is a **site** attribute, and the
 *    figure also needs accumulation over a billing window.
 *
 * **A NOTE ON `pf_penalty_flag`, because the plan's dispatch and the document
 * disagree.** §6's `Derived:` line names `pf_penalty_hours` and **not**
 * `pf_penalty_flag`; the flag is named by §1 and sits on the feeder's deferral
 * list in `stock-catalog.spec.ts`, where the tariff band is the same blocker.
 * The document decides, so §6's four are the four above.
 *
 * **NO AUTHORED FORMULA, and that is a finding rather than a gap.** §6 is the
 * one section of the six whose entire derived list is blocked by an attribute,
 * a time window or a missing function. It is also the section with the clearest
 * *commercial* value — power factor is billed — which is exactly why it is
 * worth writing down that the platform cannot compute a penalty today. **A v2
 * candidate: an asset attribute for rated kVAr per step and a site attribute
 * for the tariff PF band would make `capacitor_health_pct` and the penalty
 * codes expressible in one move.** That is an attribute-model row, not a
 * catalog one.
 *
 * **THE ONE KPI, and its DELIBERATELY ABSENT `unit`.** `pf_gap` =
 * `{target_pf} - {actual_pf}`, `higherIsBetter: false`; negative means leading.
 * **It carries no `unit` key at all.** Power factor is dimensionless,
 * `templateKpiSchema`'s `unit` is optional, and omitting it is the honest
 * encoding — the alternatives are both worse: `""` is a unit nobody can render,
 * and `"pf"` is not a unit. It is stated here and asserted in the spec because
 * an absent optional field looks exactly like a forgotten one, and the next
 * author's instinct is to fill it in.
 *
 * **ALARMS — 6 philosophy rows, every one pair-absent** (ADR 0019 Amendment 2
 * decisions 1 and 2; B7: limit values are set per site at commissioning). §6 is
 * the second section after §3 whose bullets map **1:1** onto rows. **Two of
 * them bind `actual_pf`** — `pf_below_target` (lagging, the tariff penalty) and
 * `over_compensation` (leading, which some tariffs penalise as heavily) — which
 * is two meanings at two bands on one point, exactly as the feeder binds
 * `voltage_vry` twice for under- and over-voltage. The row order below is plan
 * §5.5's rather than §6's bullet order, which puts `over_compensation` fifth:
 * the two `actual_pf` rows read better together, a bullet list carries no
 * `sortOrder`, and the transformer entry took the same liberty with §2.
 *
 * **UNITS.** Authored from `packages/db/src/point-keys-seed.ts`'s `UNIT_BY_KEY`
 * and not from §6's Unit column, because those spellings are permanent and
 * `onboarding-commit.service.ts` refuses a client CSV that disagrees.
 * `kvar_connected` and `kvar_required` therefore take **`kVAr`** and not §6's
 * `kVAR` — the 2026-09-02 spelling ruling. `unit` is `null` wherever
 * `UNIT_BY_KEY` holds `""` — `apfc_status`'s "enum", the three `0/1` rows, the
 * two "count" rows and the two dimensionless PF rows. A template `unit` is an
 * *override*; `null` defers to the catalog's own unit. Labels drop the table's
 * editorial remarks (`(child points)`, `(controller)`, `(resonance guard)`,
 * `(per step or total)`, `(per step, cumulative)`).
 *
 * ---
 *
 * **VERSION HISTORY** (ADR 0052 decision 6): a change to a shipped entry is a
 * new `stockVersion`, recorded here, taken by an organization through a
 * re-import (decision 4), never by mutating its row.
 *
 *  - `electrical-apfc` **v1** (2026-09-02, `F2.12`): authored from
 *    `electrical-derived-taglist-v1.md` §6, PROVISIONAL — derived, not
 *    client-confirmed. The client-confirmed release is v2; its redline
 *    candidate is the attribute pair recorded above.
 */
export const ELECTRICAL_APFC: StockAssetTemplateEntry = {
  code: "electrical-apfc",
  name: "Capacitor bank / APFC panel",
  assetType: "apfc",
  domain: "electrical",
  description:
    "Automatic power-factor-correction panel with a switched capacitor bank — the SOW page-10 " +
    "Capacitor utility node. Authored from docs/electrical-derived-taglist-v1.md §6 (PROVISIONAL " +
    "— derived from industry practice, not client-confirmed). The class carries no derived point " +
    "at all: every one of §6's derived codes needs a rated kVAr per step, a tariff band, a time " +
    "window or trigonometry, none of which bms-calc-v1 has. Tier C points are required and X " +
    "optional; §6 has no manual rows. Alarm rows carry a meaning and no limit.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "pf_below_target",
        pointKey: "actual_pf",
        severity: "warning",
        category: "energy",
        message:
          "Power factor below the controller's target with the bank fully switched in — the bank " +
          "is undersized or steps have failed. This is the tariff penalty exposure, and the " +
          "penalty band itself is a site value, so no number is carried here.",
      },
      {
        code: "over_compensation",
        pointKey: "actual_pf",
        severity: "warning",
        category: "energy",
        message:
          "Leading power factor — over-compensation, which some tariffs penalise as heavily as " +
          "lagging. The second of two meanings on actual_pf, at the other band.",
      },
      {
        code: "step_fault",
        pointKey: "step_fault_state",
        severity: "warning",
        category: "operations",
        message:
          "A capacitor step has failed or lost capacity. The bank still switches, so the loss is " +
          "visible only as a PF the controller cannot reach.",
      },
      {
        code: "panel_temp_high",
        pointKey: "panel_temp_c",
        severity: "warning",
        category: "safety",
        message:
          "Panel internal temperature high — capacitor life falls sharply with temperature, and a " +
          "failing capacitor heats, so this is both a cause and a symptom.",
      },
      {
        code: "thd_high",
        pointKey: "thd_v_pct",
        severity: "warning",
        category: "operations",
        message:
          "Bus voltage THD high — resonance risk between the bank and the supply reactance. The " +
          "limit depends on the transformer impedance and the harmonic load, so it is set per " +
          "site.",
      },
      {
        code: "switching_rate_high",
        pointKey: "step_operation_count",
        severity: "info",
        category: "operations",
        message:
          "Steps switching far more often than expected — contactor wear, or a hunting " +
          "controller. Binds the cumulative counter because steps_per_day, the rate this bullet " +
          "describes, needs a time window the grammar has no state for.",
      },
    ],
    kpis: [
      {
        // NO `unit` key, deliberately: power factor is dimensionless, and both
        // alternatives are worse than omitting it. See the module docblock.
        code: "pf_gap",
        name: "Power factor gap to target",
        pointKeys: ["target_pf", "actual_pf"],
        expression: "{target_pf} - {actual_pf}",
        dialect: "bms-calc-v1",
        higherIsBetter: false,
      },
    ],
    maintenance: [
      {
        title: "Capacitor bank health — measured kVAr per step",
        category: "predictive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Isolate and discharge the bank, then measure each step's actual kVAr and compare it " +
          "with the step's rating. This is the manual version of the deferred " +
          "capacitor_health_pct, which stays deferred because the rated kVAr per step is an asset " +
          "attribute bms-calc-v1 cannot read.",
      },
      {
        title: "Contactor and fuse inspection",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 90,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Inspect the switching contactors and the step fuses for arcing, welding and wear. " +
          "Contactor wear is exactly what switching_rate_high predicts, and step_operation_count " +
          "is the counter to read before opening the panel.",
      },
      {
        title: "Panel thermography and cleaning",
        category: "predictive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 90,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Thermal-scan the bank, the contactors and the terminations under load, then clean the " +
          "filters and vents. Confirms panel_temp_c against a thermal image: a capacitor loses " +
          "capacitance fastest hot, so heat is the failure mode behind most of the others.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "apfc_status", label: "Controller in auto / manual", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "apfc_alarm", label: "Controller alarm active", unit: null, required: true, sortOrder: 1, meta: CORE },
    // Tier X at row 3, ahead of two C rows — §6's own order, not the plan's grouping.
    { ...MEASURED, pointKey: "target_pf", label: "PF setpoint", unit: null, required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "actual_pf", label: "Measured PF at the bus", unit: null, required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "steps_on_count", label: "Capacitor steps switched in", unit: null, required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "step_state", label: "Per-step in / out", unit: null, required: false, sortOrder: 5, meta: EXTENDED },
    // kVAr and not §6's kVAR — the 2026-09-02 spelling ruling, and what UNIT_BY_KEY seeds.
    { ...MEASURED, pointKey: "kvar_connected", label: "Connected reactive power", unit: "kVAr", required: false, sortOrder: 6, meta: EXTENDED },
    { ...MEASURED, pointKey: "kvar_required", label: "Reactive power still required", unit: "kVAr", required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "bus_voltage_v", label: "Bus voltage", unit: "V", required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "thd_v_pct", label: "Bus voltage THD", unit: "%", required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "panel_temp_c", label: "Panel internal temperature", unit: "°C", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "step_operation_count", label: "Switching operations, cumulative", unit: null, required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "capacitor_current_a", label: "Capacitor bank current", unit: "A", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "step_fault_state", label: "Step failed / capacitor lost capacity", unit: null, required: false, sortOrder: 13, meta: EXTENDED },
  ],
};
