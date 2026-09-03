import { CORE, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's sewage-treatment-plant class — `E5.1`, ADR 0040 decision 1,
 * ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §5 — *"STP — sewage treatment
 * plant (ASP / MBR)"*. PROVISIONAL: derived from published practice and the
 * client's own reference dashboards, not client-confirmed.
 *
 * **THIS ENTRY IS A SKELETON. Pass C (plan Task 4) fills it in.** `E5.1` builds
 * in three passes and this is pass B's: the module, its export and its place in
 * the pack index exist so that `checkEntry`, the `DEFERRED_DERIVED_CODES`
 * completeness loop and `tests/f2.13`'s vocabulary scan all run over a water
 * entry from this commit on, rather than being written against six files that
 * do not exist yet.
 *
 * **The placeholder is one point: `influent_flow_klh`**, §5's first table row,
 * tier `C`, `sortOrder` 0. It is a placeholder and not a start: `checkEntry`
 * refuses an entry with no point at all (*"publish refuses a template with
 * none, so this entry could be imported but never published"*), so an empty
 * `points` array is not an available shape. Pass C replaces it with §5's 18
 * rows — 11 core + 5 extended + 2 manual + 0 derived — together with 9 alarms,
 * 4 maintenance plans and no `content.kpis` at all.
 *
 * Nothing about the skeleton should be read as a decision: the tier split, the
 * alarm rows, the two deferred-code claims (`reuse_pct`, `fm_ratio`,
 * `specific_aeration_kwh_kl` and `hydraulic_load_pct` are all deferred, so this
 * class authors ZERO derived points) and the maintenance basis are all pass C's
 * to author and to record here. The deferral ledger is already live against
 * this entry — `stock-catalog.spec.ts`'s per-entry loop checks its list from
 * this commit — and the pack-level record is in `water.ts`.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-stp` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §5, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_STP: StockAssetTemplateEntry = {
  code: "water-stp",
  name: "Sewage treatment plant (ASP / MBR)",
  assetType: "stp",
  domain: "water",
  description:
    "Sewage treatment plant — activated sludge or MBR, with aeration, secondary clarification " +
    "and disinfection. Authored from docs/e5.1-derived-taglist-v1.md §5 (PROVISIONAL — derived " +
    "from published practice and the client's reference dashboards, not client-confirmed). Tier " +
    "C points are required, X optional, M entered by hand; alarm rows carry a meaning and no " +
    "limit. E5.1 pass B ships this entry as a skeleton; pass C authors §5's full row set.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
  },
  points: [
    { ...MEASURED, pointKey: "influent_flow_klh", label: "Influent flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
  ],
};
