import { CORE, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's effluent-treatment-plant class — `E5.1`, ADR 0040
 * decision 1, ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §6 — *"ETP — effluent treatment
 * plant (neutralization + physico-chemical + biological)"*. **§6 is the least
 * provisional section in the pack**: five of its rows carry a `◆` marker
 * meaning they were read directly from the client's own reference dashboards
 * (SOW pp. 9-10, `docs/ux/ion-exchange-reference-alignment.md`) rather than from
 * published practice. Pass C records which five.
 *
 * **THIS ENTRY IS A SKELETON. Pass C (plan Task 5) fills it in.** Pass B ships
 * the module, its export and its place in the pack index so that `checkEntry`,
 * the `DEFERRED_DERIVED_CODES` completeness loop and `tests/f2.13`'s vocabulary
 * scan run over it from this commit on.
 *
 * **The placeholder is one point: `influent_flow_klh`**, §6's first table row
 * (raw effluent inlet flow), tier `C`, `sortOrder` 0 — the same vocabulary code
 * §5 declares, which is legitimate and already accounted for: the water
 * vocabulary files it once, under §5, and both plants declare it. `checkEntry`
 * refuses an entry with no point at all, so an empty `points` array is not an
 * available shape. Pass C replaces it with §6's 17 rows — 7 core + 8 extended +
 * 2 manual + 0 derived — together with 8 alarms, 4 maintenance plans and no
 * `content.kpis`.
 *
 * Two claims pass C owes this docblock and that this skeleton does not yet
 * make: the **dual-tier tie-break** — §6 files `effluent_cod_mgl` as `X/M`, so
 * first-listed wins and it is `extended` here where `water-stp` files the same
 * code `manual` — and the **CPCB Schedule VI consent rows**, which carry their
 * meaning and never a limit value (ADR 0040 decision 4). All four of §6's
 * derived codes are deferred, so this class authors ZERO derived points.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-etp` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §6, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_ETP: StockAssetTemplateEntry = {
  code: "water-etp",
  name: "Effluent treatment plant (neutralization + biological)",
  assetType: "etp",
  domain: "water",
  description:
    "Effluent treatment plant — neutralization, physico-chemical and biological stages with a " +
    "consented discharge. Authored from docs/e5.1-derived-taglist-v1.md §6 (PROVISIONAL — " +
    "derived from published practice and the client's reference dashboards, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit, and the discharge-consent rows carry the CPCB Schedule VI " +
    "meaning rather than a number. E5.1 pass B ships this entry as a skeleton; pass C authors " +
    "§6's full row set.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
  },
  points: [
    { ...MEASURED, pointKey: "influent_flow_klh", label: "Raw effluent inlet flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
  ],
};
