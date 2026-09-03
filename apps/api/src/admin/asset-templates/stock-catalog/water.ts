import type { StockAssetTemplateEntry } from "./types";
import { WATER_COOLING_TOWER } from "./water-cooling-tower";
import { WATER_ETP } from "./water-etp";
import { WATER_RO } from "./water-ro";
import { WATER_SOFTENER } from "./water-softener";
import { WATER_STP } from "./water-stp";
import { WATER_WTP } from "./water-wtp";

/**
 * `E5.1` — the water-treatment pack index, the second pack through the
 * mechanism `F2.13` built and `F2.12` proved a second time (ADR 0040, ADR 0052
 * decisions 1, 2 and 6). This file aggregates; it authors nothing.
 *
 * The pack is **six plant modules behind one index**, the shape `F2.12` gave
 * the electrical pack, and for the same §4.5 reason: 103 point rows, 40 alarms
 * each carrying a populated `philosophy`, 8 formulas and 23 maintenance plans
 * project to ~1400-1800 lines in one file, well past the 1000-line cap
 * AGENTS.md §4.5 reads whole-file. Each module answers exactly one question —
 * *what does this plant class ship?*
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §§1-6 — the v1 point basis for
 * all six water-treatment plant classes. **PROVISIONAL, and that word is
 * load-bearing**: the document describes itself as a workshop handout whose
 * instruction to the client is *"strike what is not fitted, add what is
 * missing, correct names and units"*. Every entry's own `description` repeats
 * the marking, because the stamp plus the citation IS the provenance (ADR 0052
 * decision 6) and there is no `meta.provenance` to fall back on. The
 * client-confirmed release is v2, and each module records its own redline
 * candidates.
 *
 * **TIERS → `meta.tier`** (ADR 0040 decision 3), unchanged from the electrical
 * pack: the tag list's `C` is `core` / required; `X` is `extended` / optional;
 * `M` is `manual` / optional — entered by hand via `F1.8` / `F1.9`, never
 * mapped from a data key.
 *
 * **THE DUAL-TIER TIE-BREAK, STATED ONCE AS A RULE.** Two rows in the document
 * carry two tiers. **The first-listed tier wins.** §5 marks `effluent_cod_mgl`
 * `M/X` → `manual`; §6 marks the same code `X/M` → `extended`. Both are
 * optional either way, so only `meta.tier` differs — and **the same vocabulary
 * code legitimately carries a different tier in two entries**, because
 * `meta.tier` says what *that plant type* typically fits, not what the code
 * means. That is the only place in the pack where it happens, and both entry
 * specs assert it by name so the disagreement reads as deliberate.
 *
 * ---
 *
 * **DEFERRAL LEDGER — 21 derived codes named by the document, 7 promoted and
 * authored, 14 deferred and NAMED, never placeholdered** (ADR 0051 Amendment 6
 * decision 8: a code with no `bms-calc-v1` formula is not vocabulary). The
 * reconciliation is the proof nothing was dropped: 7 + 14 = 21, the distinct
 * set the six *Derived:* prose lines name across 23 mentions.
 *
 * **Promoted and authored — 7 codes, 8 points** (`recovery_pct` is authored
 * twice, on the WTP and the RO; one code, one meaning — *the fraction of the
 * input stream that leaves as product* — and two formulas, exactly as
 * `load_pct` means one thing on four electrical classes):
 * `recovery_pct`, `turbidity_removal_pct`, `salt_rejection_pct`, `range_c`,
 * `approach_c`, `cycles_of_concentration`, `makeup_pct`. Each formula lives in
 * the module that authors it, beside the code it computes.
 *
 * **Deferred — 14 codes, 15 per-entry records** (`hydraulic_load_pct` is
 * deferred on two entries), each with the reason it is named rather than
 * placeholdered:
 *
 *  - **An asset or site attribute the grammar cannot read** —
 *    `hydraulic_load_pct` (stp, etp: design capacity), `fm_ratio` (stp: also
 *    the aeration tank volume), `evaporation_loss_klh` (cooling tower: an
 *    empirical evaporation factor the document does not give).
 *  - **A reagent strength, which is a site attribute** — `specific_chlorine_gkl`
 *    (wtp) and `neutralization_chem_gkl` (etp). Both dose rows are litres per
 *    hour of *solution*; grams of chemical per KL needs the strength. **A new
 *    deferral class in this pack**, and the reason it is worth naming
 *    separately is that the formula looks trivially expressible until you ask
 *    what the litres contain.
 *  - **A meter or an analyser the section does not list** — `reuse_pct` (stp)
 *    and `recycle_pct` (etp) need a reuse meter; `cod_removal_pct` (etp) and
 *    `fm_ratio` (stp) need an INFLUENT analyser where the tables carry the
 *    outlet only; `specific_energy_kwh_kl` (ro) and `specific_aeration_kwh_kl`
 *    (stp) need kWh where the tables declare motor current.
 *  - **A time window the grammar has no state for** —
 *    `regen_frequency_per_day` (softener).
 *  - **A function the grammar does not have** — `normalized_permeate_flow`
 *    (ro): the temperature-correction factor is an exponential, and
 *    `bms-calc-v1` has `+ - * /` and five functions with no `exp`.
 *  - **A second code for a meaning already declared** —
 *    `throughput_since_regen_kl` (softener) is §3's measured
 *    `outlet_flow_totalizer_kl`.
 *  - **A point that could never receive a value** — `salt_efficiency_kg_kl`
 *    (softener). **The second new deferral class in this pack, and the only one
 *    in the repository whose reason is the data model rather than the
 *    grammar.** The formula parses over two declared measured points; one of
 *    them is an `M` row, so it never gets an `asset_points` row and the formula
 *    never has an input. See `water-softener.ts`. It becomes authorable the day
 *    `F1.8` gives a manual row somewhere to write to.
 *
 * ---
 *
 * **KPI vs. POINT, AND WHY THIS PACK HAS NO `content.kpis` AT ALL.** A code the
 * document marks derived becomes a `kind: "derived"` point when a formula
 * exists over measured siblings in the SAME entry; `content.kpis` is for a
 * named ratio that is not itself a point another row references.
 *
 * **The water pack invents no KPI code, where `F2.12` invented six — and that
 * is a structural consequence of the document, not a deferral of effort.**
 * Every ratio this tag list names *and* the grammar can express is a **named
 * code an alarm binds**, so it is a point (the cooling tower's approach and
 * cycles rows and the RO's recovery row are the three that bind one); every
 * ratio it names that the grammar cannot express is deferred above. The
 * electrical tag list named expressible ratios it had no code for, and that gap
 * is what its six KPI codes filled. This one has no such gap.
 *
 * Two shipped facts close off the alternative, so nobody re-derives them:
 * `checkEntry` refuses `dialect: "unvalidated"` catalog-wide (`F2.12` Task 3),
 * and `collectContentPointRefs` walks a KPI's key list **regardless of
 * dialect**, so every key a KPI names must be a key its own entry declares. A
 * cross-asset KPI is therefore not authorable in a stock entry in either
 * dialect — which is why ADR 0040 decision 5's second half is not implemented
 * here and is corrected at closure rather than worked around.
 *
 * ---
 *
 * **ALARMS: A `philosophy` ON EVERY ROW, AND THE ASYMMETRY THAT CREATES.**
 * Every alarm in the pack is **pair-absent** — no `thresholdValue`, no
 * `operator` — per ADR 0019 Amendment 2 and B7's *"limit values are set per
 * site at commissioning"*. The meaning is carried by `message` and, new in this
 * pack, by a populated ADR 0019 §3 `philosophy` object (ADR 0040 decision 4):
 * `cause`, `impact`, `action`, and `skill` where one of the seeded trades
 * genuinely answers. **This is the first stock content anywhere to carry one.**
 *
 * **Not one of the 64 shipped electrical alarms carries a `philosophy`** —
 * measured, not assumed. ADR 0051 Amendment 6 did not require one; ADR 0040
 * decision 4 requires one here. **The asymmetry is between two ADRs, not a
 * defect**, and closing it would be a `stockVersion` bump on six shipped
 * entries. It is recorded here so a reviewer does not read it as inconsistency,
 * and **nothing catalog-wide asserts `philosophy` in `stock-catalog.spec.ts`**:
 * such an assertion would fail six correct entries. The claim lives in the
 * water entry specs instead.
 *
 * **THE `skill` RULE, AND THE TRADE THAT DOES NOT EXIST** (plan §12 ruling 6).
 * `bms.alarm_skills` holds exactly five codes, seeded by migration `0034`:
 * `electrical`, `mechanical`, `hvac`, `controls`, `civil`.
 * `assertTemplateAlarmVocabularies` closes `philosophy.skill` against the live
 * table at import, so a wrong code is a 400 on a client's site. **There is no
 * `process`, `chemistry` or `lab` trade.** So `skill` is set only where one of
 * the five genuinely answers — `mechanical` for a pump, blower, fan or press,
 * `electrical` for a motor, `controls` for an analyser or a dosing controller,
 * `civil` for a tank, bund or pond — and is **omitted on the process-chemistry
 * rows**, which are the majority of this pack's alarms. Inventing a code, or
 * filing a chemistry alarm under `controls` because a field wants a value, is
 * the guessing this rule prevents. A `process` skill is a migration and its own
 * backlog row; when it lands, those rows gain a `skill` in a `stockVersion: 2`.
 *
 * ---
 *
 * **INSTANTIATION: AN IMPORTED DRAFT CANNOT BE INSTANTIATED UNTIL AN OPERATOR
 * FILLS IN THE SOURCE PATTERNS.** Every point in the pack carries
 * `sourceDataKeyPattern: null` — the pattern is the site's telemetry wiring,
 * which the tag list does not know and the catalog must not guess. The
 * consequence is real and belongs here rather than being discovered on a site:
 * `resolveSourceDataKey` returns `null` for a null pattern, and
 * `AssetTemplateInstantiationService` **throws a 400 for a REQUIRED point with
 * no resolvable key** and lists an optional one in `skippedPoints`. So every
 * imported water draft needs its patterns filled in by hand before its first
 * instantiation.
 *
 * The ten `M` rows are the sharper half of the same fact: an `M` row carries a
 * null pattern **forever**, so it is always skipped and **never gets an
 * `asset_points` row** — `F1.8` manual entry still has nothing to attach a
 * reading to. `F2.12` first hit this with seven rows; water adds ten and,
 * uniquely, **defers a whole derived code over it** (`salt_efficiency_kg_kl`,
 * above). A flag for `F1.8`; not fixed here.
 *
 * ---
 *
 * **A FINDING ABOUT THE SOURCE DOCUMENT, RECORDED RATHER THAN CORRECTED.** The
 * tag list's own *Counts:* line says *"~100 points across six plant types; 58
 * core, 27 extended, ~15 manual/lab"*. Counted row by row, the document has
 * **95 table rows over 91 distinct codes: 53 core, 31 extended, 9 manual and
 * 2 dual-tier.** Not one of the four numbers matches. The electrical tag list's
 * equivalent line reconciled exactly to 169, and `F2.12` used that
 * reconciliation as evidence its rows had been measured; this one uses `~` on
 * two of the three and is simply wrong on the other two. **It is a v2 redline
 * candidate for the document and a closure record, and the document is NOT
 * edited on this branch** — the tag list is the cited source and the citation
 * must stay stable while the branch is reviewed.
 *
 * **THE GAP BETWEEN THE BACKLOG ROW'S TITLE AND THE SHIPPED SIX.** `E5.1`'s row
 * title names **UF, DM, dosing skids and potable water**. `docs/e5.1-derived-
 * taglist-v1.md` has **no section for any of the four**, and ADR 0040
 * decision 1 rules six templates. They are v2 work, gated on the same tag-list
 * redline. Recorded here so the gap is a decision on the record and not a
 * silent omission.
 *
 * Also out of scope and stated for the same reason: **a train of unit assets.**
 * ADR 0040 ruling 5 is one asset per plant for v1; the plant's assets go in an
 * asset group at their location, and the train is a v2 shape behind `F2.10`.
 * Point codes carry the unit operation as a prefix (`aeration_do_mgl`,
 * `bio_do_mgl`), which is what the document already does. `0051` seeds sixteen
 * water-train roles and none of them has a v1 asset to fill it.
 *
 * ---
 *
 * **TWO DIFFERENT ORDERS, AND NEITHER IS TO BE "CORRECTED" INTO THE OTHER.**
 * The vocabulary array in `packages/shared/src/constants.ts` follows the
 * **document** — §1 WTP through §6 ETP, first occurrence wins — so it can be
 * audited row for row against the handout a client is holding. The index below
 * follows **ADR 0040 ruling 2's authoring order** — STP, ETP, cooling tower,
 * WTP, RO, softener — which is what a client sees, because it is the order
 * `GET /admin/asset-templates/stock` returns.
 *
 * **A NEW CLASS MODULE MUST JOIN `STOCK_ASSET_RELS`** in
 * `tests/f2.13-asset-stock-catalog-vocabulary.test.ts`. That guard reads these
 * files as TEXT and cannot follow the spread below; an unlisted module has its
 * point keys checked against no vocabulary at all. The directory cross-check in
 * that file makes it a build failure rather than an instruction.
 *
 * ---
 *
 * **VERSION HISTORY**, per entry (ADR 0052 decision 6): a change to a shipped
 * entry is a new `stockVersion`, recorded here and in the module, taken by an
 * organization through a re-import (decision 4), never by mutating its row.
 * Each entry is **v1 (2026-09-03, `E5.1`), PROVISIONAL — derived from published
 * practice and the client's reference dashboards, not client-confirmed**:
 *
 *  - `water-stp` — §5. **Authored** (plan Task 4): 18 points (11 core +
 *    5 extended + 2 manual + 0 derived), 9 alarms, 4 maintenance plans, no KPI.
 *  - `water-etp` — §6, the least provisional section (five `◆` rows read from
 *    the client's own dashboards). **Authored** (plan Task 5): 17 points
 *    (7 + 8 + 2 + 0), 8 alarms, 4 maintenance plans, no KPI.
 *  - `water-cooling-tower` — §4, the entry that exercises the derived machinery.
 *    Target 21 points (10 + 6 + 1 + 4), 7 alarms, 4 maintenance plans, no KPI.
 *  - `water-wtp` — §1. Target 20 points (11 + 5 + 2 + 2), 6 alarms,
 *    4 maintenance plans, no KPI.
 *  - `water-ro` — §2. Target 18 points (10 + 5 + 1 + 2), 6 alarms,
 *    4 maintenance plans, no KPI.
 *  - `water-softener` — §3, the smallest. Target 9 points (4 + 3 + 2 + 0),
 *    4 alarms, 3 maintenance plans, no KPI.
 *
 * **`E5.1` pass B shipped all six as SKELETONS** — one core point each, no
 * alarms, no maintenance — so that `checkEntry`, the per-entry deferral loop
 * and the vocabulary guard ran over a water entry from that commit on. **Pass C
 * (plan Tasks 4-9) authors them one plant per commit, in the index order
 * below**, and each bullet above says whether its entry is authored or still a
 * skeleton. A bullet marked **Authored** states what its module carries; a
 * bullet marked *Target* states what pass C will make it carry, and that
 * module's own docblock names the single placeholder point it ships until then.
 */
export const WATER_STOCK_ASSET_TEMPLATES: readonly StockAssetTemplateEntry[] = [
  // ADR 0040 ruling 2's authoring order, which is the order GET /stock lists
  // in — NOT the tag list's section order, which the vocabulary array follows.
  WATER_STP,
  WATER_ETP,
  WATER_COOLING_TOWER,
  WATER_WTP,
  WATER_RO,
  WATER_SOFTENER,
];
