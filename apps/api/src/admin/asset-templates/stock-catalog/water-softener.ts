import { CORE, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's ion-exchange softener class — `E5.1`, ADR 0040 decision 1,
 * ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §3 — *"Softener — ion-exchange
 * softening"*. PROVISIONAL: derived from published practice, not
 * client-confirmed.
 *
 * **THIS ENTRY IS A SKELETON. Pass C (plan Task 9) fills it in.** Pass B ships
 * the module, its export and its place in the pack index so that `checkEntry`,
 * the `DEFERRED_DERIVED_CODES` completeness loop and `tests/f2.13`'s vocabulary
 * scan run over it from this commit on.
 *
 * **The placeholder is one point: `inlet_flow_klh`**, §3's first table row
 * (service inlet flow), tier `C`, `sortOrder` 0. `checkEntry` refuses an entry
 * with no point at all, so an empty `points` array is not an available shape.
 * Pass C replaces it with §3's 9 rows — 4 core + 3 extended + 2 manual +
 * 0 derived — together with 4 alarms, 3 maintenance plans and no
 * `content.kpis`. It is the smallest entry in the pack, and the cheap opposite
 * end that proves the pack is not tuned to one shape.
 *
 * Notes for pass C, recorded here because one of them is the deferral a later
 * reader will try to "complete": all three of §3's derived codes are deferred.
 * `throughput_since_regen_kl` is already carried as the **measured**
 * `outlet_flow_totalizer_kl`, and a derived restatement of a declared point is
 * a second code for one meaning. `regen_frequency_per_day` needs a time window
 * the grammar has no state for. **`salt_efficiency_kg_kl` is the one whose
 * reason is the data model rather than the grammar**: the formula
 * `salt_consumption_kg` ÷ `outlet_flow_totalizer_kl` parses over two declared
 * measured points, and the point could never fire — `salt_consumption_kg` is an
 * `M` row, its `sourceDataKeyPattern` is `null` forever, `planAsset` puts it in
 * `skippedPoints`, so it never gets an `asset_points` row, never gets a value,
 * and the formula never has an input. A permanent, `0058`-foreign-keyed point
 * key for a formula that cannot run is the decorative vocabulary ADR 0051
 * fact 4 exists to end. It becomes authorable the day `F1.8` gives a manual row
 * somewhere to write to.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-softener` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §3, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_SOFTENER: StockAssetTemplateEntry = {
  code: "water-softener",
  name: "Ion-exchange softener",
  assetType: "softener",
  domain: "water",
  description:
    "Ion-exchange softening vessel with its brine system and regeneration cycle. Authored from " +
    "docs/e5.1-derived-taglist-v1.md §3 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit. E5.1 pass B ships this entry as a skeleton; pass C authors " +
    "§3's full row set.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
  },
  points: [
    { ...MEASURED, pointKey: "inlet_flow_klh", label: "Service inlet flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
  ],
};
