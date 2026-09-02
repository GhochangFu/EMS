import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's diesel-generator class — `assetType: "dg_set"`,
 * source `docs/electrical-derived-taglist-v1.md` §3 (Diesel generator with
 * AMF controller). Plan §5.2: 38 points (21 core + 15 extended + 2 derived),
 * 13 alarms, 1 KPI, 5 maintenance plans.
 *
 * `F2.12` pass C authors this entry (Task 5). Left out of
 * `ELECTRICAL_STOCK_ASSET_TEMPLATES` until then — a stub entry here would
 * fail `stock-catalog.spec.ts`'s `checkEntry` "declares ≥ 1 point" claim and
 * would list a pointless template on `GET /admin/asset-templates/stock`.
 */
// F2.12 pass C authors this entry
export const ELECTRICAL_DG_SET = {
  /* authored in pass C — plan §5.2 */
} as unknown as StockAssetTemplateEntry;
