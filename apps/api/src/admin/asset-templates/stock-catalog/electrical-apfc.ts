import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's capacitor bank / APFC class — `assetType: "apfc"`,
 * source `docs/electrical-derived-taglist-v1.md` §6 (Capacitor bank / APFC
 * panel). Plan §5.5: 14 points (4 core + 10 extended, no manual, no
 * derived), 6 alarms, 1 KPI, 3 maintenance plans.
 *
 * `F2.12` pass C authors this entry (Task 8). Left out of
 * `ELECTRICAL_STOCK_ASSET_TEMPLATES` until then — a stub entry here would
 * fail `stock-catalog.spec.ts`'s `checkEntry` "declares ≥ 1 point" claim and
 * would list a pointless template on `GET /admin/asset-templates/stock`.
 */
// F2.12 pass C authors this entry
export const ELECTRICAL_APFC = {
  /* authored in pass C — plan §5.5 */
} as unknown as StockAssetTemplateEntry;
