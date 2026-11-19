import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { and, eq, sql } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { getOrganizationId } from "./hierarchy-seed";
import { ENABLED_SET_VERSION, resolveIngestEnabled } from "./ingest-enabled-set";
import {
  copyStationTariffsToSite,
  ensurePheSites,
  movePheRtusToSites,
  type PheResolvedSite,
  type PheSkippedSite,
  type PheSplitStation,
  pheOffSiteLine,
  pheRtuTarget,
  readRtusAwayFromStation,
} from "./phe-site-split";
import { PHE_SPLIT_STATION_CODES } from "./phe-split-stations";
import { assets, locations } from "./schema/bms-schema";

export type PheCatalogRow = {
  EdgeRTUId: number;
  RTUCode: string;
  MqttTopic: string;
  RTUDisplayName: string;
  StationId: number;
  StationCode: string;
  StationName: string;
  Latitude: number;
  Longitude: number;
  OrgCode: string;
  OrgName: string;
  DeviceId: number;
  DeviceCode: string;
  DeviceName: string;
  DeviceDisplayName: string;
  DeviceTypeCode: string;
  ModelDeviceCode: string;
  DeviceSensorId: number;
  SensorCode: string;
  SensorName: string;
  DataKey: string;
  UnitCode: string | null;
};

export type PheCatalogFile = {
  org: { orgId: number; orgCode: string; orgName: string };
  pilotEdgeRtuId: number;
  rows: PheCatalogRow[];
};

/** Maps TeleCash sensor codes to BMS `point_key` values. */
export function bmsPointKeyForSensor(sensorCode: string, dataKey: string): string {
  const bySensor: Record<string, string> = {
    TKW: "kw",
    TKWH: "kwh_total",
    APV: "voltage_l1_v",
    APF: "pf",
    FR: "frequency_hz",
    IR: "current_ir",
    IY: "current_iy",
    IB: "current_ib",
    VRY: "voltage_vry",
    VYB: "voltage_vyb",
    VBR: "voltage_vbr",
    VRN: "voltage_vrn",
    VYN: "voltage_vyn",
    VBN: "voltage_vbn",
    TKVA: "kva",
    TKVAR: "kvar",
    PMP_ONOFF: "breaker_main",
    CPMP_ONOFF: "chlorine_pump_on",
    BC: "battery_charge_pct",
    NS: "network_strength",
    CPS: "controller_power_status",
    TS: "device_timestamp",
  };
  return bySensor[sensorCode] ?? dataKey.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

/**
 * Which `bms.assets.domain` a PHE device lands in.
 *
 * Exported since `F3.41` so `asset-groups-seed.spec.ts` can run the real 48
 * device codes through the real pair of functions rather than restating them.
 * The MFM and both PUMP shapes are `electrical`, which is why all six per site
 * land in the same `electrical` asset group and one section template can serve
 * them.
 */
export function deviceDomain(deviceCode: string, modelCode: string): string {
  if (deviceCode.startsWith("PUMP") || modelCode.startsWith("PUMP")) {
    return "electrical";
  }
  if (deviceCode.startsWith("MFM") || modelCode.startsWith("MFM")) {
    return "electrical";
  }
  if (deviceCode.startsWith("AIRSP") || modelCode.startsWith("AIRSP")) {
    return "environment";
  }
  return "electrical";
}

/**
 * The `bms.locations.slug` a PHE station takes. Exported so `phe-map-seed.ts`
 * uses this one copy, and so {@link pheRtuSites} derives an RTU site's slug
 * from the RTU display name with the same function.
 */
export function stationSlug(stationName: string): string {
  return `phe-${stationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

/** The `bms.assets.code` a PHE device takes. Exported with `deviceDomain`. */
export function assetCode(deviceCode: string): string {
  return `PHE-${deviceCode}`;
}

/** The `bms.locations.code` a PHE station takes. */
export function pheLocationCode(stationCode: string): string {
  return `PHE-${stationCode}`;
}

/** The `bms.rtus.code` a PHE edge RTU takes. */
export function pheRtuCode(rtuCode: string): string {
  return `RTU-${rtuCode}`;
}

/**
 * ADR 0139 decision 3 (plan D3) — the identity of the site an edge RTU gets
 * when its station splits. The seed adopts a location as this site only by
 * the triple (`slug`, `meta.phe.stationCode`, `meta.phe.edgeRtuId`) with
 * `parent_id` = the station, which is also the shape the boot gate checks.
 */
export type PheRtuSite = {
  /** The RTU's display name, for example `Lotapata I`. */
  readonly name: string;
  /** {@link stationSlug} of the display name, for example `phe-lotapata-i`. */
  readonly slug: string;
  /** `PHE-<StationCode>-<SUFFIX>`, for example `PHE-CBLTPT1-I`. */
  readonly code: string;
  /** The station's catalog `StationCode`, as `meta.phe.stationCode` carries it. */
  readonly stationCode: string;
  /** The station's `bms.locations.slug`: the site's parent. */
  readonly stationSlug: string;
  /** The catalog `EdgeRTUId`, as `meta.phe.edgeRtuId` carries it. */
  readonly edgeRtuId: number;
  /** The RTU's first catalog row's coordinates. */
  readonly latitude: number;
  readonly longitude: number;
};

/**
 * One {@link PheRtuSite} per edge RTU of `catalog`, in catalog order. Pure.
 *
 * The code's suffix is the display name's last word, upper-cased (`I`, `II`):
 * the station name cannot be cut off instead, because `Bhutnirghat I` belongs
 * to the station `BhutnirGhat`. Throws, rather than guess, on a suffix that is
 * not `[A-Z0-9]+` and on two RTUs that give one slug or one code, because
 * either would make the seed adopt one site for two RTUs; and on a site slug
 * that is some station's slug, because the boot gate's shape check would then
 * count the live station itself.
 */
export function pheRtuSites(catalog: PheCatalogFile): PheRtuSite[] {
  const sites: PheRtuSite[] = [];
  const seen = new Set<number>();
  const stationSlugs = new Set(catalog.rows.map((row) => stationSlug(row.StationName)));
  const slugs = new Map<string, number>();
  const codes = new Map<string, number>();
  for (const row of catalog.rows) {
    if (seen.has(row.EdgeRTUId)) {
      continue;
    }
    seen.add(row.EdgeRTUId);
    const suffix = (row.RTUDisplayName.trim().split(/\s+/).pop() ?? "").toUpperCase();
    if (!/^[A-Z0-9]+$/.test(suffix)) {
      throw new Error(
        `pheRtuSites: edge RTU ${row.EdgeRTUId} "${row.RTUDisplayName}" gives the site-code suffix ` +
          `${JSON.stringify(suffix)}, which is not [A-Z0-9]+`,
      );
    }
    const site: PheRtuSite = {
      name: row.RTUDisplayName,
      slug: stationSlug(row.RTUDisplayName),
      code: `${pheLocationCode(row.StationCode)}-${suffix}`,
      stationCode: row.StationCode,
      stationSlug: stationSlug(row.StationName),
      edgeRtuId: row.EdgeRTUId,
      latitude: Number(row.Latitude),
      longitude: Number(row.Longitude),
    };
    if (stationSlugs.has(site.slug)) {
      throw new Error(
        `pheRtuSites: edge RTU ${row.EdgeRTUId} "${row.RTUDisplayName}" gives the site slug ${site.slug}, ` +
          "which is a station's slug",
      );
    }
    for (const [kind, key, held] of [
      ["slug", site.slug, slugs],
      ["code", site.code, codes],
    ] as const) {
      const other = held.get(key);
      if (other !== undefined) {
        throw new Error(
          `pheRtuSites: edge RTUs ${other} and ${row.EdgeRTUId} give the duplicate site ${kind} ${key}`,
        );
      }
      held.set(key, row.EdgeRTUId);
    }
    sites.push(site);
  }
  return sites;
}

/** ADR 0139 decision 10 — a site of a split station, with the catalog assets of its RTU. */
export type PheSplitSite = PheRtuSite & {
  /** The `bms.assets.code` of each device on the site's RTU. */
  readonly assetCodes: readonly string[];
};

/**
 * Refuses a split list the seed cannot apply, before anything reads it: a code
 * that is not a catalog `StationCode` (a typo would split nothing and pass
 * every gate) and a code listed twice. Pure.
 */
export function assertPheSplitStationCodes(catalog: PheCatalogFile, splitStationCodes: readonly string[]): void {
  const stationCodes = new Set(catalog.rows.map((row) => row.StationCode));
  const unknown = splitStationCodes.filter((code) => !stationCodes.has(code));
  if (unknown.length > 0) {
    throw new Error(
      `PHE split list: ${unknown.map((code) => JSON.stringify(code)).join(", ")} is not a catalog StationCode ` +
        `(the catalog has ${[...stationCodes].join(", ")})`,
    );
  }
  const repeated = splitStationCodes.filter((code, index) => splitStationCodes.indexOf(code) !== index);
  if (repeated.length > 0) {
    throw new Error(`PHE split list: ${[...new Set(repeated)].join(", ")} is listed more than once`);
  }
}

/**
 * The sites of the listed stations, in catalog order, each with its RTU's
 * asset codes (plan D9). Pure; throws through
 * {@link assertPheSplitStationCodes}.
 */
export function pheSplitSites(catalog: PheCatalogFile, splitStationCodes: readonly string[]): PheSplitSite[] {
  assertPheSplitStationCodes(catalog, splitStationCodes);
  const listed = new Set(splitStationCodes);
  return pheRtuSites(catalog)
    .filter((site) => listed.has(site.stationCode))
    .map((site) => ({
      ...site,
      assetCodes: [
        ...new Set(
          catalog.rows.filter((row) => row.EdgeRTUId === site.edgeRtuId).map((row) => assetCode(row.DeviceCode)),
        ),
      ],
    }));
}

/** One `(asset code, point key)` pair. */
export type PheAssetPoint = { readonly assetCode: string; readonly pointKey: string };

/** What {@link seedPheCatalog} writes for a catalog, as the boot gate counts it. */
export type PhePilotExpectedRows = {
  /** One `bms.locations.code` per station. */
  readonly locationCodes: readonly string[];
  /** One `bms.rtus.external_rtu_id` per edge RTU (the seed's conflict key). */
  readonly externalRtuIds: readonly number[];
  /** One `bms.assets.code` per device. */
  readonly assetCodes: readonly string[];
  /** The `(asset, point)` pairs the seed catalogues: every sensor but `TS`. */
  readonly points: readonly PheAssetPoint[];
  /** The `TS` pairs the seed deletes rather than catalogues. */
  readonly tsPoints: readonly PheAssetPoint[];
  /** The devices whose domain is `electrical`. */
  readonly electricalAssetCodes: readonly string[];
  /**
   * ADR 0139 decision 8 — one {@link PheRtuSite} per edge RTU, whether or
   * not its station is split. The boot gate's shape check reads it: a PHEWB
   * location on one of these slugs must be that RTU's site, so a legacy
   * one-RTU-per-location row restored from an old backup stops the boot
   * rather than being adopted.
   */
  readonly rtuSites: readonly PheRtuSite[];
  /**
   * ADR 0139 decision 10 (plan D9) — the sites of the listed stations, which
   * the boot gate counts present, with each RTU and asset at its site. Not in
   * `hierarchyExpectations`' throw-on-empty set: release A's list is empty.
   */
  readonly splitSites: readonly PheSplitSite[];
};

/**
 * The rows {@link seedPheCatalog} writes for `catalog`, derived with the same
 * functions it calls: one location per station, one RTU per edge RTU, one
 * asset per device, one point per `(asset, point key)` pair except `TS`.
 * Pure; `verify-hierarchy-expected.ts` hands it to the boot gate, which counts
 * these rows present rather than counting every PHEWB row.
 */
export function phePilotExpectedRows(
  catalog: PheCatalogFile,
  splitStationCodes: readonly string[] = PHE_SPLIT_STATION_CODES,
): PhePilotExpectedRows {
  const splitSites = pheSplitSites(catalog, splitStationCodes);
  const locationCodes = new Set<string>();
  const externalRtuIds = new Set<number>();
  const domains = new Map<string, string>();
  const points = new Map<string, PheAssetPoint>();
  const tsPoints = new Map<string, PheAssetPoint>();
  for (const row of catalog.rows) {
    locationCodes.add(pheLocationCode(row.StationCode));
    externalRtuIds.add(row.EdgeRTUId);
    const code = assetCode(row.DeviceCode);
    // The seed takes a device's domain from its first catalog row.
    if (!domains.has(code)) {
      domains.set(code, deviceDomain(row.DeviceCode, row.ModelDeviceCode));
    }
    const pointKey = bmsPointKeyForSensor(row.SensorCode, row.DataKey);
    const target = row.SensorCode === "TS" ? tsPoints : points;
    target.set(`${code}\u0000${pointKey}`, { assetCode: code, pointKey });
  }
  return {
    locationCodes: [...locationCodes],
    externalRtuIds: [...externalRtuIds],
    assetCodes: [...domains.keys()],
    points: [...points.values()],
    tsPoints: [...tsPoints.values()],
    electricalAssetCodes: [...domains].filter(([, domain]) => domain === "electrical").map(([code]) => code),
    rtuSites: pheRtuSites(catalog),
    splitSites,
  };
}

function unitLabel(unitCode: string | null): string | null {
  if (!unitCode || unitCode === "NA") {
    return null;
  }
  return unitCode;
}

/**
 * Where the catalog might be, tried in order.
 *
 * `resolve(process.cwd(), "src/phe-catalog.json")` alone only worked because
 * `pnpm db:seed` happens to run with `packages/db` as its working directory.
 * Every other caller got `ENOENT` on a path assembled from its own cwd, and
 * `F1.7`'s two-pass seed test is the first other caller.
 *
 * **Resolving from the module would be the better fix and is not available
 * here.** `import.meta.url` is a `TS1470` error because `tsconfig.build.json`
 * emits CommonJS, and `__dirname` does not exist when Vitest loads this file as
 * ESM — so naming the candidates is the one thing that works in both. Caught by
 * `tsc` and not by the suite: the runner and the build disagree about the module
 * format, so a green test proved nothing about the shipped output.
 */
const CATALOG_CANDIDATES = ["src/phe-catalog.json", "packages/db/src/phe-catalog.json"];

/**
 * Reads `phe-catalog.json`, the vendor's frozen export of PHE WB's estate.
 *
 * Exported since `F3.41` for the same reason `assetCode` and `deviceDomain`
 * are: `asset-groups-seed.spec.ts` runs the real 48 device codes through the
 * real functions rather than restating six of them as a fixture. Resolves
 * against `CATALOG_CANDIDATES` above, so it works from the repository root and
 * from `packages/db` alike — and throws rather than returning an empty catalog,
 * which would read as "the fleet is gone".
 */
export function loadPheCatalog(): PheCatalogFile {
  const path = CATALOG_CANDIDATES.map((c) => resolve(process.cwd(), c)).find((p) =>
    existsSync(p),
  );
  if (path === undefined) {
    // Loud and specific: an empty catalog would seed zero RTUs and read as "the
    // fleet is gone" rather than "the file was not found".
    throw new Error(
      `phe-catalog.json not found from ${process.cwd()}; tried ${CATALOG_CANDIDATES.join(", ")}`,
    );
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as PheCatalogFile;
}

/** Seeds PHEWB catalog: Station → location, EdgeRTU → rtus, devices → assets. */
/**
 * Re-asserts an existing seeded station's `bms.locations` row from `values`.
 *
 * `F2.10` (ADR 0098 decision 5): `active` is re-asserted only where the tree
 * allows it, whatever `values.active` says — an operator may have moved this
 * station under a parent and deactivated both, and reactivating it there
 * raises `location_parent_inactive` and stops the boot. The outer row is named
 * by hand as "locations": a bare "parent_id" in the subquery binds to `p`.
 * Exported so `tests/f2.10-seed-under-inactive-parent` can drive this one
 * statement in a rolled-back transaction without the whole catalog's locks.
 */
export async function updatePheStationLocation(
  db: BmsDb,
  locationId: string,
  values: Partial<typeof locations.$inferInsert>,
): Promise<void> {
  // A named object, not a literal in `.set()`: `typecheck:tests` compiles
  // this file non-strict through `tests/f1.7-seed-ownership`, and there the
  // literal's `active` fails the excess-property check (TS2353).
  const updateValues = {
    ...values,
    active: sql<boolean>`CASE
      WHEN "locations"."parent_id" IS NULL THEN true
      WHEN (SELECT p.active FROM bms.locations p WHERE p.id = "locations"."parent_id") THEN true
      ELSE "locations"."active"
    END`,
  };
  await db.update(locations).set(updateValues).where(eq(locations.id, locationId));
}

/**
 * What a test may hand {@link seedPheCatalog} (plan D2). Production passes only
 * `holderReader` (`seed.ts`), so the committed {@link PHE_SPLIT_STATION_CODES}
 * and the committed catalog are what a deployed seed reads;
 * `tests/f4.388-split-list-is-source.test.ts` holds that.
 */
export type PheSeedOptions = {
  /** The catalog to seed; `phe-catalog.json` by default. */
  readonly catalog?: PheCatalogFile;
  /** ADR 0139 decision 1 — the stations to split; the committed list by default. */
  readonly splitStationCodes?: readonly string[];
  /**
   * The superuser pool the site-holder read runs on (ADR 0080 ruling 16), so
   * another organization's row is seen. Required when the list is not empty.
   */
  readonly holderReader?: pg.Pool;
  /** Where the split path's lines go; `console.error` by default. */
  readonly log?: (line: string) => void;
};

/** What {@link seedPheCatalog} did on the split path this run. */
export type PheSeedOutcome = {
  /** The sites it created or adopted. */
  readonly sites: readonly PheResolvedSite[];
  /** The sites it skipped; `seed.ts` hands them to the boot gate (owner ruling Q2). */
  readonly skippedSites: readonly PheSkippedSite[];
  /** The edge RTUs the one-statement move moved this run (plan D4). */
  readonly movedExternalRtuIds: readonly number[];
  /** The assets that move carried with those RTUs. */
  readonly movedAssets: number;
};

export async function seedPheCatalog(db: BmsDb, pool: pg.Pool, options: PheSeedOptions = {}): Promise<PheSeedOutcome> {
  const catalog = options.catalog ?? loadPheCatalog();
  const splitStationCodes = options.splitStationCodes ?? PHE_SPLIT_STATION_CODES;
  const log = options.log ?? ((line: string) => console.error(line));
  // Before any write: an unknown code throws, and so does a list with no reader.
  const splitSites = pheSplitSites(catalog, splitStationCodes);
  const holderReader = options.holderReader;
  if (splitStationCodes.length > 0 && holderReader === undefined) {
    throw new Error(
      "seedPheCatalog: a non-empty split list needs a holderReader (the superuser pool), " +
        "so another organization's holder of a site slug is seen and skipped",
    );
  }
  const listed = new Set(splitStationCodes);
  const phewbOrgId = await getOrganizationId(pool, "PHEWB");
  const stationIds = [...new Set(catalog.rows.map((r) => r.StationId))];

  const stationLocationIds = new Map<number, string>();
  /** The split stations by `StationCode`, for the site writes. */
  const splitStations = new Map<string, PheSplitStation>();
  /** Every station by `StationCode`: its location and catalog name (plan D5). */
  const stationsByCode = new Map<string, { locationId: string; name: string }>();

  for (const stationId of stationIds) {
    const stationRows = catalog.rows.filter((r) => r.StationId === stationId);
    const head = stationRows[0];
    if (!head) {
      continue;
    }

    const slug = stationSlug(head.StationName);
    const locationCode = pheLocationCode(head.StationCode);

    const existingLocation = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.slug, slug), eq(locations.organizationId, phewbOrgId)))
      .limit(1);

    let locationId = existingLocation[0]?.id;
    const locationValues = {
      organizationId: phewbOrgId,
      code: locationCode,
      slug,
      name: head.StationName,
      // ADR 0139 decision 2 (Q4): a split station is a parent, `campus`.
      type: listed.has(head.StationCode) ? "campus" : "pump_station",
      province: "West Bengal",
      capital: null,
      latitude: Number(head.Latitude),
      longitude: Number(head.Longitude),
      // E4.1b (ADR 0070 decision 6, plan Q12 ruling): the PHE pilot site is in India.
      // Seed-owned like `latitude` (ruled 2026-09-19 at the PR 1 review): the
      // zone is a fact of the site, so a re-seed re-asserts it — unlike
      // `ingest_enabled` (F1.7), which an operator owns.
      timezone: "Asia/Kolkata",
      active: true,
      meta: {
        phe: {
          orgId: catalog.org.orgId,
          orgCode: catalog.org.orgCode,
          stationId,
          stationCode: head.StationCode,
          stationName: head.StationName,
        },
      },
      updatedAt: new Date(),
    };

    if (locationId) {
      await updatePheStationLocation(db, locationId, locationValues);
    } else {
      const [created] = await db
        .insert(locations)
        .values(locationValues)
        .returning({ id: locations.id });
      locationId = created?.id;
    }
    if (!locationId) {
      continue;
    }
    stationLocationIds.set(stationId, locationId);
    stationsByCode.set(head.StationCode, { locationId, name: head.StationName });
    if (listed.has(head.StationCode)) {
      splitStations.set(head.StationCode, {
        locationId,
        stationCode: head.StationCode,
        phe: locationValues.meta.phe,
        province: locationValues.province,
        timezone: locationValues.timezone,
      });
    }
  }

  // ── ADR 0139 decisions 3, 4 and 4a: the sites, the move, the tariff copy ──
  // Between the station loop and the RTU loop, in PHEWB's one seed
  // transaction, so the RTU upsert below already writes each RTU's site.
  const split =
    holderReader === undefined || splitSites.length === 0
      ? { sites: [] as PheResolvedSite[], skippedSites: [] as PheSkippedSite[] }
      : await ensurePheSites(pool, holderReader, { phewbOrgId, stations: splitStations, sites: splitSites, log });
  const moved = await movePheRtusToSites(pool, split.sites, phewbOrgId);
  if (moved.moves.length > 0) {
    log(`phe site split: moved ${moved.moves.length} RTU(s) with ${moved.assets} asset(s) to their sites`);
  }
  const movedSiteIds = new Set(moved.moves.map((move) => move.locationId));
  for (const site of split.sites) {
    const stationId = splitStations.get(site.stationCode)?.locationId;
    if (stationId !== undefined && movedSiteIds.has(site.locationId)) {
      await copyStationTariffsToSite(pool, { stationId, site, log });
    }
  }
  const resolvedByRtu = new Map(split.sites.map((site) => [site.edgeRtuId, site]));
  // Never back (decision 4, owner ruling A): an RTU already at a PHEWB
  // location other than its station stays there, whether or not its station
  // is listed and whether or not that row is still shaped as its site.
  const awayFromStation = await readRtusAwayFromStation(
    pool,
    pheRtuSites(catalog).flatMap((site) => {
      const station = stationsByCode.get(site.stationCode);
      return station ? [{ ...site, stationLocationId: station.locationId }] : [];
    }),
    phewbOrgId,
  );

  const rtuIds = [...new Set(catalog.rows.map((r) => r.EdgeRTUId))];
  const rtuIdByExternal = new Map<number, string>();
  /** `rtu_code` → why `ingest_enabled` ended up where it did, summarised below. */
  const reasons = new Map<string, string>();

  for (const edgeRtuId of rtuIds) {
    const rtuRows = catalog.rows.filter((r) => r.EdgeRTUId === edgeRtuId);
    const head = rtuRows[0];
    if (!head) {
      continue;
    }

    const stationLocationId = stationLocationIds.get(head.StationId);
    if (!stationLocationId) {
      continue;
    }
    // Plan D5 (ruling A): the RTU's site, else where it sits off its station
    // (never back), else the station.
    const resolvedSite = resolvedByRtu.get(edgeRtuId);
    const target = pheRtuTarget({
      site: resolvedSite && { locationId: resolvedSite.locationId, name: resolvedSite.locationName },
      current: awayFromStation.get(edgeRtuId),
      station: { locationId: stationLocationId, name: head.StationName },
    });
    if (target.offSite) {
      log(pheOffSiteLine(edgeRtuId, target.offSite));
    }
    const locationId = target.locationId;

    // What the database already thinks, read before the upsert overwrites it.
    // `ingest_enabled` stopped being the seed's to assert on every run at
    // `F1.7`: the admin RTU screen writes this column, and re-asserting it here
    // reverted an operator's decision on the next `pnpm db:seed` — which CI
    // runs on every PR. `resolveIngestEnabled` owns the rule; see its comment.
    const existingRtu = await pool.query<{
      ingest_enabled: boolean;
      enabled_set_version: string | null;
    }>(
      `SELECT ingest_enabled, meta->>'enabledSetVersion' AS enabled_set_version
       FROM bms.rtus WHERE external_rtu_id = $1`,
      [edgeRtuId],
    );
    const existingRow = existingRtu.rows[0];
    const resolved = resolveIngestEnabled({
      rtuCode: head.RTUCode,
      existing:
        existingRow === undefined
          ? null
          : {
              ingestEnabled: existingRow.ingest_enabled,
              enabledSetVersion: existingRow.enabled_set_version,
            },
    });
    const ingestEnabled = resolved.ingestEnabled;
    // Logged because `ResolveIngestEnabledResult.reason` promises it — "so the
    // seed can log it and an operator can tell an adoption from an override
    // without reading this file" — and until now nothing did, which is the same
    // class of untrue docblock this branch already fixed once in `renderHealth`.
    //
    // It is also the missing signal. The review reverted this whole mechanism
    // and every test stayed green; with this line, a reverted seed prints no
    // `reason` at all and the CI log says so. `operator` on a run nobody
    // expected is the other thing worth seeing — it means the database is
    // holding a decision the catalog does not know about.
    reasons.set(head.RTUCode, resolved.reason);
    // Derived from the *resolved* value, not from the catalog's opinion, so the
    // invariant the simulator depends on holds however the row got here: an
    // RTU is `mqtt` on both `rtus.source_type` and its assets'
    // `meta.telemetrySource`, or on neither. Split them and ingest and
    // `apps/sim` write the same points.
    const sourceType = ingestEnabled ? "mqtt" : "catalog";
    const rtuCode = pheRtuCode(head.RTUCode);

    // `meta` is merged rather than replaced on conflict. It is a shared bag —
    // the admin RTU API accepts arbitrary keys — so `meta = EXCLUDED.meta`
    // deleted whatever an operator or another process had put there, on every
    // `pnpm db:seed`, which CI runs on every PR. That was survivable while the
    // seed was the only writer. It stopped being survivable at `F1.7`, because
    // `enabledSetVersion` now lives in this column and decides who owns
    // `ingest_enabled`: lose the key and the next seed reverts the operator.
    // The `||` idiom is `hierarchy-seed.ts`'s. Merging makes a *removed* key
    // sticky, which costs nothing here — all three keys are rewritten every run.
    const rtuRes = await pool.query<{ id: string }>(
      `
      INSERT INTO bms.rtus (
        location_id, code, display_name, source_type,
        external_rtu_id, rtu_code, mqtt_topic,
        station_code, station_name, ingest_enabled, meta,
        organization_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      ON CONFLICT (external_rtu_id) WHERE external_rtu_id IS NOT NULL DO UPDATE SET
        location_id = EXCLUDED.location_id,
        code = EXCLUDED.code,
        display_name = EXCLUDED.display_name,
        source_type = EXCLUDED.source_type,
        rtu_code = EXCLUDED.rtu_code,
        mqtt_topic = EXCLUDED.mqtt_topic,
        station_code = EXCLUDED.station_code,
        station_name = EXCLUDED.station_name,
        ingest_enabled = EXCLUDED.ingest_enabled,
        organization_id = EXCLUDED.organization_id,
        -- Merged, not replaced: see the note above this query.
        meta = COALESCE(bms.rtus.meta, '{}'::jsonb) || EXCLUDED.meta
      RETURNING id
      `,
      [
        locationId,
        rtuCode,
        head.RTUDisplayName,
        sourceType,
        edgeRtuId,
        head.RTUCode,
        head.MqttTopic,
        head.StationCode,
        head.StationName,
        ingestEnabled,
        JSON.stringify({
          orgCode: catalog.org.orgCode,
          // `pilot` still means the ADR 0007 RTU specifically, not "ingesting".
          // Nine RTUs ingest now; one of them is the pilot.
          pilot: edgeRtuId === catalog.pilotEdgeRtuId,
          // The stamp that makes this row the operator's from here on.
          enabledSetVersion: ENABLED_SET_VERSION,
        }),
        phewbOrgId,
      ],
    );

    const rtuUuid = rtuRes.rows[0]?.id;
    if (rtuUuid) {
      rtuIdByExternal.set(edgeRtuId, rtuUuid);
    }

    const deviceIds = [...new Set(rtuRows.map((r) => r.DeviceId))];
    for (const deviceId of deviceIds) {
      const deviceRows = rtuRows.filter((r) => r.DeviceId === deviceId);
      const deviceHead = deviceRows[0];
      if (!deviceHead) {
        continue;
      }

      const code = assetCode(deviceHead.DeviceCode);
      const telemetrySource = ingestEnabled ? "mqtt" : "catalog";
      const meta = {
        telemetrySource,
        phe: {
          deviceId: deviceHead.DeviceId,
          deviceCode: deviceHead.DeviceCode,
          modelDeviceCode: deviceHead.ModelDeviceCode,
          deviceTypeCode: deviceHead.DeviceTypeCode,
        },
      };

      const existingAsset = await db
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.code, code))
        .limit(1);

      let assetId = existingAsset[0]?.id;
      const rtuUuidForAsset = rtuIdByExternal.get(edgeRtuId);
      if (!rtuUuidForAsset) {
        continue;
      }

      const assetValues = {
        organizationId: phewbOrgId,
        code,
        name: deviceHead.DeviceDisplayName || deviceHead.DeviceName,
        // ADR 0139 decision 11 (Q8): the site's name at a site, else the catalog station name.
        siteName: target.siteName,
        locationId,
        rtuId: rtuUuidForAsset,
        domain: deviceDomain(deviceHead.DeviceCode, deviceHead.ModelDeviceCode),
        meta,
      };

      if (assetId) {
        // The vendor's `DeviceDisplayName` names an asset only when the seed
        // creates it. After that the name belongs to the operator: the
        // admin asset page renames it (the AWS demo names PHE assets by RTU),
        // and every deploy re-runs this seed, so writing the name here would
        // put the vendor's "DEVICE - PHEWB - …" back on each one.
        // ADR 0007 decision 4a's rule for `ingest_enabled` ("the seed asserts
        // once, then the operator owns it"), applied to the asset name.
        const { name: _vendorName, ...updateValues } = assetValues;
        await db.update(assets).set(updateValues).where(eq(assets.id, assetId));
      } else {
        const [created] = await db.insert(assets).values(assetValues).returning({ id: assets.id });
        assetId = created?.id;
      }
      if (!assetId) {
        continue;
      }

      for (const sensor of deviceRows) {
        // `TS` is the envelope's own timestamp, which the ingest adapter
        // consumes as the sample time (`ENVELOPE_KEYS` in
        // `apps/ingest/src/adapters/mqtt.ts`). Cataloguing it as a measured
        // point would assert a provenance that is false by construction: the
        // row could never arrive, and if it somehow did its value would be its
        // own `time` in epoch milliseconds. A mapped point that silently never
        // arrives is the defect this seed's `NS`/`network_strength` row spent
        // its life demonstrating — do not add a second one.
        if (sensor.SensorCode === "TS") {
          // Databases seeded before this skip carry the row already, and a seed
          // that only stops *writing* the mistake never converges. It has no
          // telemetry to lose — that is the whole point.
          //
          // Migration `0025` does the same delete unconditionally, and is the
          // durable half: this one only fires while a catalog row with
          // `SensorCode = 'TS'` still exists to iterate, and `phe-catalog.json`
          // is a vendor export that may reasonably stop carrying one.
          await pool.query(
            `DELETE FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
            [assetId, bmsPointKeyForSensor(sensor.SensorCode, sensor.DataKey)],
          );
          continue;
        }
        const pointKey = bmsPointKeyForSensor(sensor.SensorCode, sensor.DataKey);

        // `F3.39` / ADR 0051 decision 4 — REGISTER THE CODE BEFORE THE ROW
        // THAT REFERENCES IT. `asset_points.point_key` is a foreign key into
        // `bms.point_keys` from migration `0057`, and this seed maps 15 codes
        // that no other seed path writes: `kwh_total`, `kva`, six `voltage_v*`,
        // three `current_i*`, `chlorine_pump_on`, `battery_charge_pct`,
        // `network_strength` and `controller_power_status`. They come from
        // `bmsPointKeyForSensor`'s TeleCash map, which is their only source of
        // truth.
        //
        // **This is not belt-and-braces for what `0057` already did.** That
        // migration admits the orphans on a database that HAS them; a cold
        // start has none, because `bms.asset_points` is still empty when it
        // runs. Without this the very first `pnpm db:seed` on an empty volume
        // fails here with `asset_points_point_key_point_keys_code_fk` and
        // `compose up` never completes. Measured on a scratch database before
        // this block existed, not reasoned about.
        //
        // Written inline rather than hoisted to a one-time pass on purpose: the
        // dependency is one statement above the row that needs it, so it cannot
        // be moved or deleted without the reason being visible.
        //
        // `name` uses `initcap(replace(...))`, which is the exact expression
        // `0057` uses, so a repaired row and a seeded one are indistinguishable.
        // `COALESCE` on conflict, never `EXCLUDED.unit`: this seed re-runs on
        // every `compose up`, `0057` admitted these codes with a NULL unit, and
        // an admin who fills one in must not have it reverted at the next boot.
        await pool.query(
          `
          INSERT INTO bms.point_keys (code, name, domain, unit, active)
          -- \`$1\` is cast on both uses: without it Postgres deduces varchar
          -- from the column and text from \`replace()\` and refuses the
          -- statement with "inconsistent types deduced for parameter $1".
          VALUES ($1::text, initcap(replace($1::text, '_', ' ')), $2, nullif($3::text, ''), true)
          ON CONFLICT (code) DO UPDATE SET
            unit = COALESCE(bms.point_keys.unit, EXCLUDED.unit)
          `,
          [pointKey, assetValues.domain, unitLabel(sensor.UnitCode)],
        );

        await pool.query(
          `
          -- ADR 0018: provenance binds at the point. These are measured points
          -- fed by the asset's gateway, so rtu_id is taken from the asset —
          -- asset_points_source_ref_check rejects a 'measured' row without one.
          INSERT INTO bms.asset_points (
            asset_id, point_key, source_data_key, sensor_code, unit, active,
            rtu_id, source_kind, organization_id
          )
          VALUES (
            $1, $2, $3, $4, $5, true,
            (SELECT rtu_id FROM bms.assets WHERE id = $1), 'measured', $6
          )
          ON CONFLICT (asset_id, point_key) DO UPDATE SET
            source_data_key = EXCLUDED.source_data_key,
            sensor_code = EXCLUDED.sensor_code,
            unit = EXCLUDED.unit,
            active = true,
            rtu_id = EXCLUDED.rtu_id,
            source_kind = EXCLUDED.source_kind,
            organization_id = EXCLUDED.organization_id
          `,
          [assetId, pointKey, sensor.DataKey, sensor.SensorCode, unitLabel(sensor.UnitCode), phewbOrgId],
        );
      }
    }
  }

  reportIngestEnabledReasons(reasons);
  return {
    sites: split.sites,
    skippedSites: split.skippedSites,
    movedExternalRtuIds: moved.moves.map((move) => move.externalRtuId),
    movedAssets: moved.assets,
  };
}

/**
 * One line saying who decided `ingest_enabled` for each RTU, and why.
 *
 * `stderr` via `console.error`, matching `migrate.ts`, `seed.ts` and
 * `refresh-aggregates.ts` — §4.5 reserves `console.log` for the Pino logger and
 * these CLI scripts have no Nest container to resolve one from.
 *
 * **`operator` is the interesting word.** It means the database is holding a
 * decision this catalog does not know about, which is correct and invisible
 * until something prints it. `adopted` on a run nobody expected means the stamp
 * went missing — see the `meta` merge above for how that used to happen.
 */
function reportIngestEnabledReasons(reasons: ReadonlyMap<string, string>): void {
  const byReason = new Map<string, number>();
  for (const reason of reasons.values()) {
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const summary = [...byReason.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(" ");
  console.error(`phe ingest_enabled: ${summary || "no rtus"} (set ${ENABLED_SET_VERSION})`);
}
