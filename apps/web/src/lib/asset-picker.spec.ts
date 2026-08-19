import type { AssetRow } from "../api/assets";

import { filterAssetsByQuery, toggleAssetSelection } from "./asset-picker";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSETS: AssetRow[] = [
  { id: "1", code: "KZN-CR-UTILITY", name: "KwaZulu-Natal Control Room Utility Incomer", siteName: "RSMOC KwaZulu-Natal", domain: "electrical" },
  { id: "2", code: "GP-HVAC-01", name: "Gauteng CRAC Unit 1", siteName: "RSMOC Gauteng", domain: "hvac" },
  { id: "3", code: "WC-PUMP-02", name: "Western Cape Feed Pump 2", siteName: "RSMOC Western Cape", domain: "water" },
];

/**
 * The picker's affected-asset list is the caller's own readable-asset set
 * (`GET /api/v1/assets` is already scoped server-side), which can run to
 * hundreds of rows — a plain unfiltered checkbox list would be unusable, so
 * this is what narrows it.
 */
export function runFilterAssetsByQueryTests(): void {
  assert(
    filterAssetsByQuery(ASSETS, "").length === 3,
    "an empty query must return every asset unfiltered",
  );
  assert(
    filterAssetsByQuery(ASSETS, "kzn").map((a) => a.id).join(",") === "1",
    "must match the code case-insensitively",
  );
  assert(
    filterAssetsByQuery(ASSETS, "crac").map((a) => a.id).join(",") === "2",
    "must match the name",
  );
  assert(
    filterAssetsByQuery(ASSETS, "western cape").map((a) => a.id).join(",") === "3",
    "must match the site name",
  );
  assert(
    filterAssetsByQuery(ASSETS, "no-such-asset").length === 0,
    "a query matching nothing must return an empty list, not everything",
  );
}

/** Add/remove is a plain toggle: present → removed, absent → appended. */
export function runToggleAssetSelectionTests(): void {
  const afterAdd = toggleAssetSelection([], "1");
  assert(afterAdd.join(",") === "1", `expected ["1"], got [${afterAdd.join(",")}]`);

  const afterAddSecond = toggleAssetSelection(afterAdd, "2");
  assert(
    afterAddSecond.join(",") === "1,2",
    `expected ["1","2"], got [${afterAddSecond.join(",")}]`,
  );

  const afterRemove = toggleAssetSelection(afterAddSecond, "1");
  assert(afterRemove.join(",") === "2", `expected ["2"], got [${afterRemove.join(",")}]`);

  // Toggling twice is a no-op on the set.
  const roundTrip = toggleAssetSelection(toggleAssetSelection([], "1"), "1");
  assert(roundTrip.length === 0, `expected [], got [${roundTrip.join(",")}]`);
}
