import { CORE, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's reverse-osmosis class — `E5.1`, ADR 0040 decision 1, ADR
 * 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §2 — *"RO — reverse osmosis
 * skid"*. PROVISIONAL: derived from published practice, not client-confirmed.
 *
 * **`assetType` is `ro_skid`, the repository's existing spelling** (plan §12
 * ruling 4) — `asset-templates.instantiate.integration.spec.ts`'s fixtures
 * already use it beside `feeder`, `test_rig` and `test_skid`, and minting a
 * second spelling for one concept is what ADR 0051 Amendment 6 decision 5
 * refuses.
 *
 * **THIS ENTRY IS A SKELETON. Pass C (plan Task 8) fills it in.** Pass B ships
 * the module, its export and its place in the pack index so that `checkEntry`,
 * the `DEFERRED_DERIVED_CODES` completeness loop and `tests/f2.13`'s vocabulary
 * scan run over it from this commit on.
 *
 * **The placeholder is one point: `feed_flow_klh`**, §2's first table row (feed
 * water flow), tier `C`, `sortOrder` 0. `checkEntry` refuses an entry with no
 * point at all, so an empty `points` array is not an available shape. Pass C
 * replaces it with §2's 16 rows plus two derived points — 10 core + 5 extended
 * + 1 manual + 2 derived = 18 — together with 6 alarms, 4 maintenance plans and
 * no `content.kpis`.
 *
 * Notes for pass C, recorded here so they are not rediscovered: the two derived
 * codes are `recovery_pct` (permeate ÷ feed flow — the same code and the same
 * meaning `water-wtp` authors over its own inputs) and `salt_rejection_pct`
 * (permeate against feed conductivity). Two of §2's three derived codes are
 * deferred: `specific_energy_kwh_kl` needs the high-pressure pump's kW where §2
 * declares current only, and `normalized_permeate_flow`'s temperature
 * correction factor is an **exponential** — `bms-calc-v1` has the four
 * arithmetic operators and five functions, and no `exp`.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-ro` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §2, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_RO: StockAssetTemplateEntry = {
  code: "water-ro",
  name: "Reverse osmosis skid",
  assetType: "ro_skid",
  domain: "water",
  description:
    "Reverse osmosis skid — cartridge pre-filtration, antiscalant dosing, a high-pressure pump " +
    "and the membrane array, with permeate and reject streams. Authored from " +
    "docs/e5.1-derived-taglist-v1.md §2 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit. E5.1 pass B ships this entry as a skeleton; pass C authors " +
    "§2's full row set and its two derived points.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
  },
  points: [
    { ...MEASURED, pointKey: "feed_flow_klh", label: "Feed water flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
  ],
};
