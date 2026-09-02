import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's solar PV class — `assetType: "solar_pv"`, source
 * `docs/electrical-derived-taglist-v1.md` §5 (Grid-tied inverter with plant
 * sensors). Plan §5.4: 26 points (9 core + 15 extended + 1 manual + 1
 * derived), 7 alarms, 1 KPI, 4 maintenance plans.
 *
 * `F2.12` pass C authors this entry (Task 7). Left out of
 * `ELECTRICAL_STOCK_ASSET_TEMPLATES` until then — a stub entry here would
 * fail `stock-catalog.spec.ts`'s `checkEntry` "declares ≥ 1 point" claim and
 * would list a pointless template on `GET /admin/asset-templates/stock`.
 */
// F2.12 pass C authors this entry
export const ELECTRICAL_SOLAR_PV = {
  /* authored in pass C — plan §5.4 */
} as unknown as StockAssetTemplateEntry;
