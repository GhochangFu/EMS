import { DECOMMISSIONED_LOCATION_CODE } from "./access-fixtures-seed";
import { demoRoleForAsset } from "./asset-groups-seed";
import { eskomSeedAssetCatalog } from "./eskom-assets-seed";
import {
  eskomCanonicalLocationRows,
  eskomLocationCode,
  eskomSeedLocationIdentity,
  type SeedLocationIdentity,
  seedMapLocationRows,
} from "./eskom-locations-seed";
import { CONTROL_ROOM_VIEW_LOCATION_KEY } from "./site-control-room-views-seed";
import { SEED_ORGANIZATION_CODES } from "./hierarchy-seed";
import {
  loadPheCatalog,
  type PheCatalogFile,
  phePilotExpectedRows,
  type PhePilotExpectedRows,
} from "./phe-pilot-seed";
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
  /** The identity whose row carries the seeded control room view (`RSMOC-WC`). */
  readonly controlRoomViewLocation: SeedLocationIdentity;
  /** The catalog assets `seedPueDemo` pins to the incomer template. */
  readonly eskomIncomerCodes: readonly string[];
  /** The catalog's IT assets: each in `IT_LOAD`, each with a `rack_kw` row. */
  readonly eskomItCodes: readonly string[];
  /** What `seedPheCatalog` writes for PHEWB. */
  readonly phe: PhePilotExpectedRows;
};

/**
 * The expectations for the repository's catalogs, from the map rows `seed.ts`
 * seeds ({@link seedMapLocationRows}) and one read of the PHE catalog.
 *
 * **Throws on an empty list.** A presence count's wanted number is its list's
 * length, so an empty list wants 0 and the count passes whatever the database
 * holds — a derivation that broke would turn its check off without a word.
 * The legacy PHE slugs are in the set too: an empty list would also make the
 * legacy cleanup delete nothing. The `TS` pairs are not, because a catalog
 * with no `TS` sensor is a legitimate vendor export (see `seedPheCatalog`).
 */
export function hierarchyExpectations(pheCatalog: PheCatalogFile = loadPheCatalog()): HierarchyExpectations {
  const mapLocationRows = seedMapLocationRows(pheCatalog);
  const eskomCatalog = eskomSeedAssetCatalog(mapLocationRows);
  const viewRow = eskomCanonicalLocationRows(mapLocationRows).find(
    (row) => eskomSeedLocationIdentity(row).key === CONTROL_ROOM_VIEW_LOCATION_KEY,
  );
  if (!viewRow) {
    throw new Error(
      `hierarchyExpectations: no canonical ESKOM location has the key ${CONTROL_ROOM_VIEW_LOCATION_KEY}, ` +
        "which seedSiteControlRoomViews seeds the control room view on",
    );
  }
  const expected: HierarchyExpectations = {
    organizationCodes: SEED_ORGANIZATION_CODES,
    eskomLocationCodes: [
      ...eskomCanonicalLocationRows(mapLocationRows).map(eskomLocationCode),
      DECOMMISSIONED_LOCATION_CODE,
    ],
    decommissionedLocationCode: DECOMMISSIONED_LOCATION_CODE,
    controlRoomViewLocation: eskomSeedLocationIdentity(viewRow),
    eskomIncomerCodes: eskomCatalog
      .filter((asset) => demoRoleForAsset(asset.code, asset.domain) === PUE_DEMO_INCOMER_ROLE)
      .map((asset) => asset.code),
    eskomItCodes: eskomCatalog.filter((asset) => asset.domain === "it").map((asset) => asset.code),
    phe: phePilotExpectedRows(pheCatalog),
  };
  const lists: ReadonlyArray<readonly [string, readonly unknown[]]> = [
    ["organizationCodes", expected.organizationCodes],
    ["eskomLocationCodes", expected.eskomLocationCodes],
    ["eskomIncomerCodes", expected.eskomIncomerCodes],
    ["eskomItCodes", expected.eskomItCodes],
    ["phe.locationCodes", expected.phe.locationCodes],
    ["phe.externalRtuIds", expected.phe.externalRtuIds],
    ["phe.assetCodes", expected.phe.assetCodes],
    ["phe.points", expected.phe.points],
    ["phe.electricalAssetCodes", expected.phe.electricalAssetCodes],
    ["phe.legacyLocationSlugs", expected.phe.legacyLocationSlugs],
  ];
  const empty = lists.filter(([, list]) => list.length === 0).map(([name]) => name);
  if (empty.length > 0) {
    throw new Error(
      `hierarchyExpectations: derived an empty list for ${empty.join(", ")}; ` +
        "a presence count over an empty list wants 0 and passes on any database",
    );
  }
  return expected;
}
