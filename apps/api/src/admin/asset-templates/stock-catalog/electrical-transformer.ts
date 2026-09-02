import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's transformer class — `assetType: "transformer"`,
 * source `docs/electrical-derived-taglist-v1.md` §2 (Oil-immersed
 * distribution / power transformer with OTI/WTI, Buchholz and optional
 * online DGA). Plan §5.1: 30 points (9 core + 16 extended + 4 manual + 1
 * derived), 15 alarms, 2 KPIs, 5 maintenance plans.
 *
 * `F2.12` pass C authors this entry (Task 4). Left out of
 * `ELECTRICAL_STOCK_ASSET_TEMPLATES` until then — a stub entry here would
 * fail `stock-catalog.spec.ts`'s `checkEntry` "declares ≥ 1 point" claim and
 * would list a pointless template on `GET /admin/asset-templates/stock`.
 */
// F2.12 pass C authors this entry
export const ELECTRICAL_TRANSFORMER = {
  /* authored in pass C — plan §5.1 */
} as unknown as StockAssetTemplateEntry;
