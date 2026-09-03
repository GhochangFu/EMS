import { CORE, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's cooling-tower class — `E5.1`, ADR 0040 decision 1, ADR 0052
 * decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §4 — *"Cooling water / cooling
 * tower"*. PROVISIONAL: derived from published practice, not client-confirmed.
 *
 * **THIS ENTRY IS A SKELETON. Pass C (plan Task 6) fills it in**, and it is the
 * pass-C entry that matters most: **this is the first entry in the pack that
 * exercises the derived machinery at all** — four formulas (`range_c`,
 * `approach_c`, `cycles_of_concentration`, `makeup_pct`), the one
 * `maxInputAgeSeconds: 3600` override in the row, and two alarms that bind
 * derived points. The plan's second escalation checkpoint keys on it.
 *
 * **The placeholder is one point: `supply_temp_c`**, §4's first table row (cold
 * basin / supply water temperature), tier `C`, `sortOrder` 0. `checkEntry`
 * refuses an entry with no point at all, so an empty `points` array is not an
 * available shape. Pass C replaces it with §4's 17 rows plus the four derived
 * points — 10 core + 6 extended + 1 manual + 4 derived = 21 — together with
 * 7 alarms, 4 maintenance plans and no `content.kpis`.
 *
 * Note for pass C, so it is not rediscovered: `supply_temp_c` and
 * `return_temp_c` are **basin water**, not air and not chilled water. They do
 * not clash with HVAC's `supply_air_temp_c` / `chw_supply_temp_c`, and `E5.2`'s
 * chiller table must reuse the `chw_*` codes rather than these.
 * `evaporation_loss_klh` is the class's one deferred derived code — the
 * standard estimate needs an empirical evaporation factor the tag list does not
 * give, and a fabricated coefficient is the guessing ADR 0019 exists to prevent.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-cooling-tower` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §4, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_COOLING_TOWER: StockAssetTemplateEntry = {
  code: "water-cooling-tower",
  name: "Cooling tower / cooling water circuit",
  assetType: "cooling_tower",
  domain: "water",
  description:
    "Cooling tower and its circulating water circuit — basin, make-up and blowdown, fans, " +
    "circulation pumps and the water-treatment program. Authored from " +
    "docs/e5.1-derived-taglist-v1.md §4 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit. E5.1 pass B ships this entry as a skeleton; pass C authors " +
    "§4's full row set and its four derived points.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
  },
  points: [
    { ...MEASURED, pointKey: "supply_temp_c", label: "Cold basin / supply water temperature", unit: "°C", required: true, sortOrder: 0, meta: CORE },
  ],
};
