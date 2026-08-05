import { eq } from "drizzle-orm";

import type { BmsDb } from "./client";
import type { mapLocationRowsForInsert } from "./map-locations-seed";
import type { pheMapLocationRowsForInsert } from "./phe-map-seed";
import { locations, mapLocations } from "./schema/bms-schema";

/**
 * Map-marker and canonical-location seeding, split out of `seed.ts` to keep it
 * under the AGENTS.md §4.5 1000-line cap. Pure move: the callers still invoke
 * these in the original order, and every statement is unchanged.
 */

/** One row of the combined Eskom + PHE map-marker dataset. */
export type MapLocationSeedRow =
  | ReturnType<typeof mapLocationRowsForInsert>[number]
  | ReturnType<typeof pheMapLocationRowsForInsert>[number];

const locationCodeByProvince = new Map([
  ["Eastern Cape", "EC"],
  ["Free State", "FS"],
  ["Gauteng", "GP"],
  ["KwaZulu-Natal", "KZN"],
  ["Limpopo", "LP"],
  ["Mpumalanga", "MP"],
  ["North West", "NW"],
  ["Northern Cape", "NC"],
  ["Western Cape", "WC"],
]);

/** Province short code, falling back to the slug's initials. */
export function locationCode(slug: string, province: string | null): string {
  if (province) {
    const code = locationCodeByProvince.get(province);
    if (code) {
      return code;
    }
  }
  return slug
    .split("-")
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 8);
}

/** Province short code for the RSMOC demo-asset prefix, or undefined. */
export function provinceCode(province: string): string | undefined {
  return locationCodeByProvince.get(province);
}

/** Inserts map markers that do not already exist, keyed by slug. */
export async function seedMapLocations(
  db: BmsDb,
  mapLocationRows: readonly MapLocationSeedRow[],
): Promise<void> {
  for (const row of mapLocationRows) {
    const exists = await db
      .select({ id: mapLocations.id })
      .from(mapLocations)
      .where(eq(mapLocations.slug, row.slug))
      .limit(1);
    if (exists[0]) {
      continue;
    }
    await db.insert(mapLocations).values({
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      siteName: row.siteName,
      latitude: row.latitude,
      longitude: row.longitude,
      capacityMw: row.capacityMw,
      stationType: row.stationType,
      stationCategory: row.stationCategory,
      province: row.province,
      stationOperatingStatus: row.stationOperatingStatus,
      meta: row.meta,
    });
  }
}

/** Upserts the canonical `bms.locations` rows for Eskom campuses and centres. */
export async function seedEskomLocations(
  db: BmsDb,
  mapLocationRows: readonly MapLocationSeedRow[],
  eskomOrgId: string,
): Promise<void> {
  for (const row of mapLocationRows.filter((item) =>
    ["smoc_campus", "rsmoc", "csmoc"].includes(item.kind),
  )) {
    const isPhe =
      typeof row.meta === "object" &&
      row.meta !== null &&
      "organizationCode" in row.meta &&
      row.meta.organizationCode === "PHEWB";
    if (isPhe) {
      continue;
    }
    const capital =
      typeof row.meta === "object" &&
      row.meta !== null &&
      "capital" in row.meta &&
      typeof row.meta.capital === "string"
        ? row.meta.capital
        : null;
    const code = `${row.kind.replace("_campus", "").toUpperCase()}-${locationCode(
      row.slug,
      row.province,
    )}`;
    const existingLocation = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, row.slug))
      .limit(1);
    const values = {
      organizationId: eskomOrgId,
      code,
      slug: row.slug,
      name: row.name,
      type: row.kind,
      province: row.province,
      capital,
      latitude: row.latitude,
      longitude: row.longitude,
      active: true,
      meta: row.meta,
      updatedAt: new Date(),
    };
    if (existingLocation[0]) {
      await db
        .update(locations)
        .set(values)
        .where(eq(locations.id, existingLocation[0].id));
    } else {
      await db.insert(locations).values(values);
    }
  }
}

/** Renames the pre-rebrand `smoc-cape-town` marker to `rsmoc-western-cape`. */
export async function renameLegacyCapeTownMapLocation(
  db: BmsDb,
  mapLocationRows: readonly MapLocationSeedRow[],
): Promise<void> {
  const westernCapeLocation = mapLocationRows.find(
    (row) => row.slug === "rsmoc-western-cape",
  );
  if (!westernCapeLocation) {
    return;
  }
  const existingWesternCape = await db
    .select({ id: mapLocations.id })
    .from(mapLocations)
    .where(eq(mapLocations.slug, westernCapeLocation.slug))
    .limit(1);
  const legacyCapeTown = await db
    .select({ id: mapLocations.id })
    .from(mapLocations)
    .where(eq(mapLocations.slug, "smoc-cape-town"))
    .limit(1);
  if (!existingWesternCape[0] && legacyCapeTown[0]) {
    await db
      .update(mapLocations)
      .set({
        slug: westernCapeLocation.slug,
        name: westernCapeLocation.name,
        kind: westernCapeLocation.kind,
        siteName: westernCapeLocation.siteName,
        latitude: westernCapeLocation.latitude,
        longitude: westernCapeLocation.longitude,
        capacityMw: westernCapeLocation.capacityMw,
        stationType: westernCapeLocation.stationType,
        stationCategory: westernCapeLocation.stationCategory,
        province: westernCapeLocation.province,
        stationOperatingStatus: westernCapeLocation.stationOperatingStatus,
        meta: westernCapeLocation.meta,
      })
      .where(eq(mapLocations.id, legacyCapeTown[0].id));
  }
}
