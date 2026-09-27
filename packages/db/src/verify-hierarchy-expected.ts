import { DECOMMISSIONED_LOCATION_CODE } from "./access-fixtures-seed";
import { demoRoleForAsset } from "./asset-groups-seed";
import { eskomSeedAssetCatalog } from "./eskom-assets-seed";
import { eskomCanonicalLocationRows, eskomLocationCode } from "./eskom-locations-seed";
import { SEED_ORGANIZATION_CODES } from "./hierarchy-seed";
import { mapLocationRowsForInsert } from "./map-locations-seed";
import { loadPheCatalog, phePilotExpectedRows, type PhePilotExpectedRows } from "./phe-pilot-seed";
import { PUE_DEMO_INCOMER_ROLE } from "./pue-demo-seed";

/**
 * `F4.169` / `F4.170` addendum — the rows the seed owns, as the boot gate
 * (`verify-hierarchy-seed.ts`) counts them.
 *
 * Every list is derived from the seed's own catalogs through the functions
 * the seed calls, never written out here. The gate counts these rows PRESENT,
 * not every row of a table: an administrator may add a location, an RTU, an
 * asset or an organization through the admin API, and the next `compose up`
 * re-seeds and runs the gate, so a raw `COUNT(*)` stopped the stack on an
 * ordinary write. Nothing deletes a seeded row (the admin surfaces have no
 * DELETE for these tables) and the seed re-creates each one on every boot, so
 * "every seeded row is present" holds on every healthy boot.
 */
export type HierarchyExpectations = {
  /** The organizations `ensureOrganizations` writes. */
  readonly organizationCodes: readonly string[];
  /** The canonical ESKOM locations plus the inactive `F4.10` fixture. */
  readonly eskomLocationCodes: readonly string[];
  /** The fixture location that must stay inactive. */
  readonly decommissionedLocationCode: string;
  /** The catalog assets `seedPueDemo` pins to the incomer template. */
  readonly eskomIncomerCodes: readonly string[];
  /** The catalog's IT assets: each in `IT_LOAD`, each with a `rack_kw` row. */
  readonly eskomItCodes: readonly string[];
  /** What `seedPheCatalog` writes for PHEWB. */
  readonly phe: PhePilotExpectedRows;
};

/** The expectations for the repository's catalogs. Pure but for reading the PHE catalog file. */
export function hierarchyExpectations(): HierarchyExpectations {
  const eskomCatalog = eskomSeedAssetCatalog();
  return {
    organizationCodes: SEED_ORGANIZATION_CODES,
    eskomLocationCodes: [
      ...eskomCanonicalLocationRows(mapLocationRowsForInsert()).map(eskomLocationCode),
      DECOMMISSIONED_LOCATION_CODE,
    ],
    decommissionedLocationCode: DECOMMISSIONED_LOCATION_CODE,
    eskomIncomerCodes: eskomCatalog
      .filter((asset) => demoRoleForAsset(asset.code, asset.domain) === PUE_DEMO_INCOMER_ROLE)
      .map((asset) => asset.code),
    eskomItCodes: eskomCatalog.filter((asset) => asset.domain === "it").map((asset) => asset.code),
    phe: phePilotExpectedRows(loadPheCatalog()),
  };
}
