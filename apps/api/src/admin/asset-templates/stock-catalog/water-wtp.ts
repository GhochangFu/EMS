import { CORE, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's water-treatment-plant class — `E5.1`, ADR 0040 decision 1,
 * ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §1 — *"WTP — water treatment
 * plant (clarifier + filtration + disinfection)"*. PROVISIONAL: derived from
 * published practice, not client-confirmed.
 *
 * **THIS ENTRY IS A SKELETON. Pass C (plan Task 7) fills it in.** Pass B ships
 * the module, its export and its place in the pack index so that `checkEntry`,
 * the `DEFERRED_DERIVED_CODES` completeness loop and `tests/f2.13`'s vocabulary
 * scan run over it from this commit on.
 *
 * **The placeholder is one point: `raw_water_flow_klh`**, §1's first table row
 * (raw water intake flow), tier `C`, `sortOrder` 0. `checkEntry` refuses an
 * entry with no point at all, so an empty `points` array is not an available
 * shape. Pass C replaces it with §1's 18 rows plus two derived points —
 * 11 core + 5 extended + 2 manual + 2 derived = 20 — together with 6 alarms,
 * 4 maintenance plans and no `content.kpis`.
 *
 * Notes for pass C, recorded here so they are not rediscovered: the two derived
 * codes are `recovery_pct` (treated ÷ raw intake flow) and
 * `turbidity_removal_pct` (filtered against raw turbidity), and **`recovery_pct`
 * is one vocabulary code with two formulas** — this class's and the RO skid's —
 * because the meaning is identical on both plants and only the input names
 * differ. The tag list spells it `pct_recovery`; the code is `recovery_pct`
 * (plan §12 ruling 1), and the document is corrected at closure, not on this
 * branch. `specific_chlorine_gkl` is the class's one deferred derived code:
 * `chlorine_dose_lph` is litres per hour of hypochlorite **solution**, and
 * grams of chlorine per KL needs the solution strength, a site attribute.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-wtp` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §1, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_WTP: StockAssetTemplateEntry = {
  code: "water-wtp",
  name: "Water treatment plant (clarifier + filtration + disinfection)",
  assetType: "wtp",
  domain: "water",
  description:
    "Water treatment plant — raw water intake, coagulation and clarification, filtration and " +
    "chlorination to a clear water reservoir. Authored from " +
    "docs/e5.1-derived-taglist-v1.md §1 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit. E5.1 pass B ships this entry as a skeleton; pass C authors " +
    "§1's full row set and its two derived points.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
  },
  points: [
    { ...MEASURED, pointKey: "raw_water_flow_klh", label: "Raw water intake flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
  ],
};
