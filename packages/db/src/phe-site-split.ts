import type pg from "pg";

import type { PheRtuSite } from "./phe-pilot-seed";
import { siteLayoutSlug } from "./site-layout-seed-reads";

/**
 * `F4.388` (ADR 0139 decisions 3, 4 and 4a; plan D3–D6) — the database steps
 * of a PHE station split: the sites, the one-statement move and the tariff
 * copy. `seedPheCatalog` calls them inside PHEWB's seed transaction, between
 * its station loop and its RTU loop.
 *
 * Type-only imports from `phe-pilot-seed.ts`, which imports this module, so
 * there is no import cycle at run time. No function here reads the split list:
 * the caller hands each one the stations and sites it resolved.
 */

/** Why the seed skipped a site (owner ruling Q2). */
export type PheSiteSkipReason =
  /** Another organization's location holds the site's slug. */
  | "foreign-slug"
  /** A PHEWB location holds the site's slug and is not the site. */
  | "phewb-slug"
  /**
   * A PHEWB location holds the site's code under another slug. Only PHEWB's
   * own rows count: `code` is unique per organization (`locations_org_code_idx`,
   * migration 0016), so another organization's row on the code collides with
   * nothing (owner ruling B, 2026-11-19).
   */
  | "code-holder";

/**
 * A location that holds a site's slug (any organization: `slug` is globally
 * unique) or its code (PHEWB only, owner ruling B), as the superuser reader
 * sees it.
 */
export type PheSiteHolder = {
  readonly id: string;
  readonly slug: string;
  readonly code: string;
  readonly organizationId: string;
  /**
   * The row is this site: a PHEWB child of the site's station whose
   * `meta.phe` carries the site's `stationCode` and `edgeRtuId`, on the
   * site's slug. Decided in SQL ({@link PHE_SITE_HOLDERS_SQL}) with the boot
   * gate's own expression, so the seed never adopts a row the gate rejects.
   */
  readonly isSite: boolean;
};

export type PheSiteDecision =
  | { readonly kind: "insert" }
  | { readonly kind: "adopt"; readonly locationId: string }
  | { readonly kind: "skip"; readonly reason: PheSiteSkipReason; readonly holderId: string; readonly holderSlug: string };

/** A site the seed skipped, as `seedPheCatalog` reports it and the boot gate reads it. */
export type PheSkippedSite = {
  readonly site: PheRtuSite;
  readonly reason: PheSiteSkipReason;
  readonly holderId: string;
  readonly holderSlug: string;
};

/** A site the seed created or adopted this run. */
export type PheResolvedSite = PheRtuSite & { readonly locationId: string; readonly locationName: string };

/**
 * ADR 0139 decision 3 — what the seed does with one site, given every row
 * that holds its slug or its code. Pure.
 *
 * Adopt only the site itself. Any other holder of the slug, or a PHEWB row on
 * the code, skips the site, so its RTU stays where it is: never a `23505`,
 * never a takeover. Another organization's row on the code is not a holder
 * (owner ruling B): it collides with nothing, so the site is written. A PHEWB
 * row on the slug is named first, because it is the one holder the boot gate
 * stops on (owner ruling Q2).
 */
export function decidePheSite(
  site: PheRtuSite,
  holders: readonly PheSiteHolder[],
  phewbOrgId: string,
): PheSiteDecision {
  const slugHolder = holders.find((holder) => holder.slug === site.slug);
  const codeHolder = holders.find((holder) => holder.code === site.code && holder.organizationId === phewbOrgId);
  if (slugHolder && !slugHolder.isSite) {
    const reason = slugHolder.organizationId === phewbOrgId ? "phewb-slug" : "foreign-slug";
    return { kind: "skip", reason, holderId: slugHolder.id, holderSlug: slugHolder.slug };
  }
  if (codeHolder && codeHolder.id !== slugHolder?.id) {
    return { kind: "skip", reason: "code-holder", holderId: codeHolder.id, holderSlug: codeHolder.slug };
  }
  return slugHolder ? { kind: "adopt", locationId: slugHolder.id } : { kind: "insert" };
}

/**
 * Owner ruling Q2 — the boot gate exempts a skipped site from its split
 * presence checks unless a PHEWB row holds the site's slug: that row fails
 * the gate's shape check, which names it and the fix.
 */
export function gateExemptsSkip(skip: PheSkippedSite): boolean {
  return skip.reason !== "phewb-slug";
}

/** A location an RTU and its assets can be written at. */
export type PheTargetLocation = { readonly locationId: string; readonly name: string };

/** The PHEWB location an RTU sits at now, when that is not its station (plan D5 step 2). */
export type PheCurrentLocation = PheTargetLocation & {
  readonly slug: string;
  /** The row is the RTU's own site by the triple (slug, parent = its station, `meta.phe`). */
  readonly isOwnSite: boolean;
};

export type PheRtuTarget = {
  readonly locationId: string;
  /** The assets' `site_name` (ADR 0139 decision 11). */
  readonly siteName: string;
  readonly kind: "site" | "stays" | "station";
  /**
   * Case 2 only, when the row is not the RTU's own site by the triple (an
   * administrator re-slugged or re-parented it): the row the seed names in
   * its one log line (owner ruling A).
   */
  readonly offSite?: { readonly locationId: string; readonly slug: string; readonly name: string };
};

/**
 * ADR 0139 decisions 4 and 11 (plan D5, amended by owner ruling A on
 * 2026-11-19) — where the seed writes an RTU and its assets: (1) its resolved
 * site, when its station is on the list and the site was not skipped; else
 * (2) the PHEWB location it sits at now, when that is not its station (never
 * back, literally: an administrator's re-slug or re-parent does not send the
 * RTU back alone and raise `23503` on K4); else (3) the station. `site_name`
 * is the location's name in the first two and the catalog `StationName`
 * (`station.name`) in the third. Pure.
 */
export function pheRtuTarget(input: {
  readonly site?: PheTargetLocation;
  readonly current?: PheCurrentLocation;
  readonly station: PheTargetLocation;
}): PheRtuTarget {
  if (input.site) {
    return { locationId: input.site.locationId, siteName: input.site.name, kind: "site" };
  }
  const current = input.current;
  if (current && current.locationId !== input.station.locationId) {
    const stays: PheRtuTarget = { locationId: current.locationId, siteName: current.name, kind: "stays" };
    return current.isOwnSite
      ? stays
      : { ...stays, offSite: { locationId: current.locationId, slug: current.slug, name: current.name } };
  }
  return { locationId: input.station.locationId, siteName: input.station.name, kind: "station" };
}

/**
 * Owner ruling A — the one line the seed logs for an RTU that stays at a
 * PHEWB location which is not its site by the triple. Names the RTU and the
 * row (slug, id, name), nothing else. Pure.
 */
export function pheOffSiteLine(edgeRtuId: number, offSite: NonNullable<PheRtuTarget["offSite"]>): string {
  return (
    `phe site split: edge RTU ${edgeRtuId} stays at location ${offSite.slug} (id ${offSite.locationId}, ` +
    `name ${JSON.stringify(offSite.name)}), which is not its site by slug, parent and meta.phe; ` +
    "its assets stay with it (never back, owner ruling A)"
  );
}

/**
 * The holders of a site's slug or code, read on the superuser pool so another
 * organization's row is seen (ADR 0080 ruling 16). `is_site` is the boot gate's
 * shape rule (`PHE_RTU_SLUG_SHAPE_SQL`) for one site, with the parent named by
 * id: the station `seedPheCatalog` found by slug in PHEWB. The slug leg is
 * cross-organization (`locations_slug_unique` is global); the code leg reads
 * PHEWB's rows only (`code` is unique per organization, migration 0016; owner
 * ruling B), so another organization's row is neither a holder nor logged.
 * Params: `[slug, code, phewbOrgId, stationId, stationCode, edgeRtuId]`.
 */
export const PHE_SITE_HOLDERS_SQL = `
  SELECT l.id, l.slug, l.code, l.organization_id::text AS organization_id,
         COALESCE(
           l.organization_id = $3::uuid
           AND l.slug = $1
           AND p.id = $4::uuid
           AND p.organization_id = l.organization_id
           AND l.meta->'phe'->>'stationCode' = $5
           AND l.meta->'phe'->>'edgeRtuId' = $6::int::text,
           false) AS is_site
    FROM bms.locations l
    LEFT JOIN bms.locations p ON p.id = l.parent_id
   WHERE l.slug = $1 OR (l.code = $2 AND l.organization_id = $3::uuid)
   ORDER BY l.id
`;

/** A split station as `seedPheCatalog` resolved it, with what its sites copy. */
export type PheSplitStation = {
  readonly locationId: string;
  readonly stationCode: string;
  /** The station's `meta.phe` block; each site adds its `edgeRtuId`. */
  readonly phe: Record<string, unknown>;
  readonly province: string;
  readonly timezone: string;
};

/**
 * Inserts a site under its station. `active` follows the parent (ADR 0098
 * decision 5), so a site under an inactive station is written inactive and
 * `locations_tree_guard` does not raise.
 */
const SITE_INSERT_SQL = `
  INSERT INTO bms.locations (
    organization_id, parent_id, code, slug, name, type, province, capital,
    latitude, longitude, timezone, active, meta, updated_at
  )
  VALUES (
    $1, $2, $3, $4, $5, 'pump_station', $6, NULL, $7, $8, $9,
    (SELECT p.active FROM bms.locations p WHERE p.id = $2), $10::jsonb, now()
  )
  RETURNING id, name
`;

/**
 * Re-asserts an adopted site. `active` follows `updatePheStationLocation`'s
 * rule: re-asserted only when the parent is active.
 */
const SITE_UPDATE_SQL = `
  UPDATE bms.locations AS l SET
    code = $3, slug = $4, name = $5, type = 'pump_station', province = $6, capital = NULL,
    latitude = $7, longitude = $8, timezone = $9, meta = $10::jsonb, updated_at = now(),
    active = CASE
      WHEN (SELECT p.active FROM bms.locations p WHERE p.id = $2) THEN true
      ELSE l.active
    END
  WHERE l.id = $1 AND l.parent_id = $2
  RETURNING id, name
`;

/**
 * ADR 0139 decision 3 — creates or adopts one site per RTU of each split
 * station, and skips (with one log line each) every site another row holds.
 * Runs on `pool` inside the caller's PHEWB transaction; reads holders on
 * `holderReader`.
 */
export async function ensurePheSites(
  pool: pg.Pool,
  holderReader: pg.Pool,
  args: {
    readonly phewbOrgId: string;
    readonly stations: ReadonlyMap<string, PheSplitStation>;
    readonly sites: readonly PheRtuSite[];
    readonly log: (line: string) => void;
  },
): Promise<{ sites: PheResolvedSite[]; skippedSites: PheSkippedSite[] }> {
  const resolved: PheResolvedSite[] = [];
  const skippedSites: PheSkippedSite[] = [];
  for (const site of args.sites) {
    const station = args.stations.get(site.stationCode);
    if (!station) {
      continue;
    }
    const holders = await holderReader.query<{
      id: string;
      slug: string;
      code: string;
      organization_id: string;
      is_site: boolean;
    }>(PHE_SITE_HOLDERS_SQL, [
      site.slug,
      site.code,
      args.phewbOrgId,
      station.locationId,
      site.stationCode,
      site.edgeRtuId,
    ]);
    const decision = decidePheSite(
      site,
      holders.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        code: row.code,
        organizationId: row.organization_id,
        isSite: row.is_site,
      })),
      args.phewbOrgId,
    );
    if (decision.kind === "skip") {
      skippedSites.push({ site, reason: decision.reason, holderId: decision.holderId, holderSlug: decision.holderSlug });
      args.log(
        `phe site split: skipped ${site.slug} (${site.code}) of station ${site.stationCode}: ` +
          `location ${decision.holderId} (${decision.holderSlug}) holds its ${decision.reason === "code-holder" ? "code" : "slug"} ` +
          `(${decision.reason}); edge RTU ${site.edgeRtuId} stays where it is`,
      );
      continue;
    }
    const values = [
      decision.kind === "adopt" ? decision.locationId : args.phewbOrgId,
      station.locationId,
      site.code,
      site.slug,
      site.name,
      station.province,
      site.latitude,
      site.longitude,
      station.timezone,
      JSON.stringify({ phe: { ...station.phe, edgeRtuId: site.edgeRtuId } }),
    ];
    const written = await pool.query<{ id: string; name: string }>(
      decision.kind === "adopt" ? SITE_UPDATE_SQL : SITE_INSERT_SQL,
      values,
    );
    const row = written.rows[0];
    if (!row) {
      throw new Error(`phe site split: writing ${site.slug} under station ${site.stationCode} returned no row`);
    }
    resolved.push({ ...site, locationId: row.id, locationName: row.name });
  }
  return { sites: resolved, skippedSites };
}

/**
 * The never-back read (ADR 0139 decision 4; plan D5 step 2 as amended by owner
 * ruling A): each RTU of `sites` that sits at a PHEWB location other than its
 * station, with whether that row is its own site by the triple (the same shape
 * rule as {@link PHE_SITE_HOLDERS_SQL}). Read under the caller's PHEWB tenant
 * context. On a database where every PHE RTU sits at its station it returns no
 * row. Params: `[edgeRtuIds, stationIds, slugs, stationCodes, organizationId]`.
 */
export const PHE_RTUS_AWAY_FROM_STATION_SQL = `
  SELECT r.external_rtu_id, l.id, l.slug, l.name,
         COALESCE(
           l.parent_id = s.station_id
           AND l.slug = s.slug
           AND l.meta->'phe'->>'stationCode' = s.station_code
           AND l.meta->'phe'->>'edgeRtuId' = s.edge_rtu_id::text,
           false) AS is_own_site
    FROM bms.rtus r
    INNER JOIN bms.locations l ON l.id = r.location_id
    INNER JOIN unnest($1::int[], $2::uuid[], $3::varchar[], $4::varchar[])
      AS s(edge_rtu_id, station_id, slug, station_code) ON s.edge_rtu_id = r.external_rtu_id
   WHERE r.organization_id = $5
     AND l.organization_id = r.organization_id
     AND l.id <> s.station_id
`;

/** Reads where each RTU sits when that is a PHEWB location other than its station (plan D5 step 2). */
export async function readRtusAwayFromStation(
  pool: pg.Pool,
  sites: readonly (PheRtuSite & { readonly stationLocationId: string })[],
  organizationId: string,
): Promise<Map<number, PheCurrentLocation>> {
  const res = await pool.query<{
    external_rtu_id: number;
    id: string;
    slug: string;
    name: string;
    is_own_site: boolean;
  }>(PHE_RTUS_AWAY_FROM_STATION_SQL, [
    sites.map((site) => site.edgeRtuId),
    sites.map((site) => site.stationLocationId),
    sites.map((site) => site.slug),
    sites.map((site) => site.stationCode),
    organizationId,
  ]);
  return new Map(
    res.rows.map((row) => [
      Number(row.external_rtu_id),
      { locationId: row.id, slug: row.slug, name: row.name, isOwnSite: row.is_own_site },
    ]),
  );
}

/**
 * ADR 0139 decision 4 (plan D4) — moves each RTU to its site with every asset
 * wired to it, in ONE statement, so `assets_rtu_id_location_id_fkey` (K4,
 * `NO ACTION`, not deferrable) is checked once, on the final rows. The assets
 * take the site from `r`'s `RETURNING`, not from a read of `bms.rtus`, which
 * would see the old row. The match is by `external_rtu_id` and `rtu_id`. An
 * RTU already at its site is not touched, so a second run returns no row; the
 * final `SELECT` reads `r`, so an RTU with no wired asset still reports.
 * Params: `[externalRtuIds, siteIds, organizationId]`.
 */
export const PHE_MOVE_RTUS_SQL = `
  WITH r AS (
    UPDATE bms.rtus AS t SET location_id = x.site_id
      FROM unnest($1::int[], $2::uuid[]) AS x(external_rtu_id, site_id)
     WHERE t.external_rtu_id = x.external_rtu_id AND t.organization_id = $3
       AND t.location_id IS DISTINCT FROM x.site_id
    RETURNING t.id, t.location_id, t.external_rtu_id
  ), a AS (
    UPDATE bms.assets AS a SET location_id = r.location_id FROM r WHERE a.rtu_id = r.id RETURNING a.id
  )
  SELECT r.external_rtu_id, r.location_id, (SELECT count(*)::int FROM a) AS assets FROM r
`;

export type PheRtuMove = { readonly externalRtuId: number; readonly locationId: string };

/** Runs the one-statement move (plan D4); returns the RTUs it moved and the assets they carried. */
export async function movePheRtusToSites(
  pool: pg.Pool,
  sites: readonly PheResolvedSite[],
  organizationId: string,
): Promise<{ moves: PheRtuMove[]; assets: number }> {
  if (sites.length === 0) {
    return { moves: [], assets: 0 };
  }
  const res = await pool.query<{ external_rtu_id: number; location_id: string; assets: number }>(PHE_MOVE_RTUS_SQL, [
    sites.map((site) => site.edgeRtuId),
    sites.map((site) => site.locationId),
    organizationId,
  ]);
  return {
    moves: res.rows.map((row) => ({ externalRtuId: Number(row.external_rtu_id), locationId: row.location_id })),
    assets: res.rows[0]?.assets ?? 0,
  };
}

/**
 * The station's tariff mappings with the meters of each that now sit at the
 * site, lowest asset id first (the list order of
 * `location-tariffs.service.ts`). A mapping with no meter at the site is not
 * returned. Params: `[stationId, siteId]`.
 */
const STATION_MAPPINGS_AT_SITE_SQL = `
  SELECT lt.id, lt.organization_id, lt.tariff_key, lt.billing_meter_asset_id,
         lt.sanctioned_load, lt.sanctioned_load_unit, lt.effective_from, lt.effective_to,
         array_agg(m.asset_id::text ORDER BY m.asset_id) AS meters
    FROM bms.location_tariffs lt
    INNER JOIN bms.location_tariff_meters m
      ON m.location_tariff_id = lt.id AND m.organization_id = lt.organization_id
    INNER JOIN bms.assets a ON a.id = m.asset_id AND a.location_id = $2
   WHERE lt.location_id = $1
   GROUP BY lt.id
   ORDER BY lt.effective_from, lt.id
`;

/**
 * ADR 0139 decision 4a (plan D6) — the site carries its station's tariff
 * forward, once: the caller runs this only for a site whose RTU the move
 * statement moved in this run, and it copies nothing when the site has a
 * mapping of its own. Per station mapping: the meters of that mapping now at
 * the site (none → no copy); billing meter = the station's when it is at the
 * site, else the lowest asset id. Matched by asset id. The station's rows are
 * not touched. One log line per copy and no audit row (no actor, as
 * `db:seed`'s other writes). Returns the number of mappings copied.
 */
export async function copyStationTariffsToSite(
  pool: pg.Pool,
  args: {
    readonly stationId: string;
    readonly site: PheResolvedSite;
    readonly log: (line: string) => void;
  },
): Promise<number> {
  const own = await pool.query(`SELECT 1 FROM bms.location_tariffs WHERE location_id = $1 LIMIT 1`, [
    args.site.locationId,
  ]);
  if ((own.rowCount ?? 0) > 0) {
    return 0;
  }
  const mappings = await pool.query<{
    id: string;
    organization_id: string;
    tariff_key: string;
    billing_meter_asset_id: string;
    sanctioned_load: string;
    sanctioned_load_unit: string;
    effective_from: Date | string;
    effective_to: Date | string | null;
    meters: string[];
  }>(STATION_MAPPINGS_AT_SITE_SQL, [args.stationId, args.site.locationId]);
  let copied = 0;
  for (const mapping of mappings.rows) {
    const billing = mapping.meters.includes(mapping.billing_meter_asset_id)
      ? mapping.billing_meter_asset_id
      : mapping.meters[0];
    if (billing === undefined) {
      continue;
    }
    // The dates are copied in SQL from the station's row, so no time zone
    // ever touches a `date`.
    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO bms.location_tariffs (
        organization_id, location_id, tariff_key, billing_meter_asset_id,
        sanctioned_load, sanctioned_load_unit, effective_from, effective_to
      )
      SELECT lt.organization_id, $2, lt.tariff_key, $3,
             lt.sanctioned_load, lt.sanctioned_load_unit, lt.effective_from, lt.effective_to
        FROM bms.location_tariffs lt WHERE lt.id = $1
      RETURNING id
      `,
      [mapping.id, args.site.locationId, billing],
    );
    const copyId = inserted.rows[0]?.id;
    if (!copyId) {
      throw new Error(`phe site split: copying tariff ${mapping.id} to ${args.site.slug} returned no row`);
    }
    await pool.query(
      `INSERT INTO bms.location_tariff_meters (location_tariff_id, organization_id, asset_id)
       SELECT $1, $2, unnest($3::uuid[])`,
      [copyId, mapping.organization_id, mapping.meters],
    );
    copied += 1;
    args.log(
      `phe site split: copied tariff ${mapping.tariff_key} (from ${mapping.id}) to ${args.site.slug} as ${copyId} ` +
        `with ${mapping.meters.length} meter(s), billing meter ${billing}`,
    );
  }
  return copied;
}

/**
 * ADR 0139 decision 7 (owner ruling Q5; plan D7) — the station's view stops naming its seeded
 * site-layout copy: `kind = 'generated'`, no dashboard. Only while the view still names that copy
 * (`site-layout-<station slug>` at the station), so a view an administrator pointed elsewhere is
 * kept. The dashboard row, its tabs and the emptied groups stay. Params: `[stationId,
 * organizationId, dashboardSlug]`.
 */
const UNLINK_STATION_VIEW_SQL = `
  UPDATE bms.site_control_room_views AS v
     SET kind = 'generated', dashboard_id = NULL, updated_at = now(), updated_by = NULL
   WHERE v.location_id = $1 AND v.organization_id = $2 AND v.kind = 'dashboard'
     AND v.dashboard_id = (
       SELECT d.id FROM bms.dashboards d
        WHERE d.organization_id = $2 AND d.slug = $3 AND d.location_id = $1
     )
  RETURNING v.location_id
`;

/**
 * Unlinks a split station's view from its seeded copy (decision 7). `seedPheCatalog` calls it in
 * the move's transaction, only for a station with an RTU the move statement moved this run: the
 * move happens once, so the unlink does too, and a view an administrator re-links later is not
 * matched again. Returns whether it unlinked.
 */
export async function unlinkSplitStationView(
  pool: pg.Pool,
  args: {
    readonly stationId: string;
    readonly stationSlug: string;
    readonly organizationId: string;
    readonly log: (line: string) => void;
  },
): Promise<boolean> {
  const dashboardSlug = siteLayoutSlug(args.stationSlug);
  const res = await pool.query(UNLINK_STATION_VIEW_SQL, [args.stationId, args.organizationId, dashboardSlug]);
  const unlinked = (res.rowCount ?? 0) > 0;
  if (unlinked) {
    args.log(
      `phe site split: unlinked the view of station ${args.stationSlug} from ${dashboardSlug}; ` +
        "it is generated now, and the dashboard row and its tabs stay",
    );
  }
  return unlinked;
}
