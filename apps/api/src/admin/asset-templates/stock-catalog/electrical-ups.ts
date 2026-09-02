import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's UPS class — `assetType: "ups"`, source
 * `docs/electrical-derived-taglist-v1.md` §4 (Static UPS with battery).
 * Plan §5.3: 31 points (12 core + 16 extended + 1 manual + 2 derived), 11
 * alarms, no KPI (the spread became a point, plan §12 ruling 2), 4
 * maintenance plans.
 *
 * `F2.12` pass C authors this entry (Task 6). Left out of
 * `ELECTRICAL_STOCK_ASSET_TEMPLATES` until then — a stub entry here would
 * fail `stock-catalog.spec.ts`'s `checkEntry` "declares ≥ 1 point" claim and
 * would list a pointless template on `GET /admin/asset-templates/stock`.
 */
// F2.12 pass C authors this entry
export const ELECTRICAL_UPS = {
  /* authored in pass C — plan §5.3 */
} as unknown as StockAssetTemplateEntry;
