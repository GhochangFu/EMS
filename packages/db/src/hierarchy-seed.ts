import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { locations } from "./schema/bms-schema";

export const DOMAIN_RTU_SUFFIX: Record<string, string> = {
  electrical: "ELEC",
  hvac: "HVAC",
  it: "IT",
  environment: "ENV",
  // `E4.3` U11 (owner ruling Q4) — one simulator RTU per ESKOM location, the
  // same as every other domain. The demo water plant lives at CSMOC Gauteng
  // only, so ten of the eleven WATER RTUs carry no asset; the owner accepted
  // that for the uniformity (every existing mechanism works unchanged). The
  // RTU exists at every location, but `assignEskomAssetRtus` wires a `water`
  // asset to it ONLY when the asset's code starts with `WTR-` (owner ruling
  // R3, 2026-09-24) — the demo plant's codes, and the only water codes
  // `apps/sim` emits flows for (ruling R2). Any other ESKOM water asset keeps
  // its own `rtu_id` and `meta.telemetrySource` on every boot, so a real MQTT
  // water meter is not moved onto a simulator RTU that feeds it nothing.
  // Assets of the other domains are wired as before.
  water: "WATER",
};

/** `bms.rtus.code` is `varchar(64)` (`schema/bms-schema.ts`). */
const RTU_CODE_MAX = 64;

/** The hex digits kept from the location code's SHA-256, on overflow. */
const SIM_RTU_HASH_WIDTH = 8;

/** `bms.rtus.display_name` is `varchar(255)` (`schema/bms-schema.ts`). */
const RTU_DISPLAY_NAME_MAX = 255;

/**
 * `F4.170` — the code for one ESKOM simulator RTU, bounded to `RTU_CODE_MAX`
 * (64) characters whatever the location code's length.
 *
 * The unbounded template is `SIM-RTU-${locationCode}-${suffix}` —
 * `8 + n + 1 + s` characters. The admin location schema accepts a 64-character
 * code, so a location code of 51+ characters (with `WATER`) otherwise aborts
 * `pnpm db:seed` with Postgres `22001 value too long`. The template is returned
 * unchanged whenever it fits, so every code seeded before `F4.170` keeps its
 * bytes and `ON CONFLICT (location_id, code)` still finds its row.
 *
 * On overflow the result is `SIM-RTU-<cut>-<hash>-<suffix>`: `<hash>` is the
 * first `SIM_RTU_HASH_WIDTH` (8) hex digits of `sha256` of the full raw
 * location code, uppercased, and `<cut>` is the location code cut to what the
 * other parts leave — `46 - s` code points, so the result is exactly 64.
 *
 * The same shape as `ladderRuleCode` (`automation-rules-seed.ts`, `F4.129`),
 * duplicated here on purpose rather than shared (owner ruling, 2026-09-27),
 * with three differences:
 *
 * - **No fold.** The location code goes into the template as it is.
 * - **The fit check and the cut count code points** (`Array.from`), not UTF-16
 *   code units. `bms.locations.code` has no charset CHECK (migration `0070`
 *   constrains only `assets.code` and `point_keys.code`), Postgres counts a
 *   `varchar` length in characters, and a code-unit `slice()` can split a
 *   surrogate pair (the `F4.104` lesson). A code-unit fit check would also cut
 *   a fitting astral code and move its stored identity.
 * - **Uppercase hex is for symmetry** with `ladderRuleCode` only; no compare
 *   here depends on the case.
 *
 * The hash is of the full code because two long codes that agree up to the
 * cut differ only in the tail the cut dropped.
 */
export function simRtuCode(locationCode: string, suffix: string): string {
  const raw = `SIM-RTU-${locationCode}-${suffix}`;
  if (Array.from(raw).length <= RTU_CODE_MAX) {
    return raw;
  }
  const hash = createHash("sha256")
    .update(locationCode)
    .digest("hex")
    .toUpperCase()
    .slice(0, SIM_RTU_HASH_WIDTH);
  // `SIM-RTU-` + `-` around the cut, then the hash, `-`, and the suffix.
  const cutWidth =
    RTU_CODE_MAX - "SIM-RTU--".length - SIM_RTU_HASH_WIDTH - "-".length - Array.from(suffix).length;
  const cut = Array.from(locationCode).slice(0, cutWidth).join("");
  return `SIM-RTU-${cut}-${hash}-${suffix}`;
}

/**
 * `F4.170` — the display name for one ESKOM simulator RTU,
 * `${locationName} ${DOMAIN} Simulator`, bounded to `RTU_DISPLAY_NAME_MAX`
 * (255) characters. `bms.locations.name` is `varchar(255)` as well, so without
 * the bound a location name of 234+ characters (with `ENVIRONMENT`) aborts
 * `pnpm db:seed` with `22001`, the same failure as the code.
 *
 * The location name is cut, never the ` <DOMAIN> Simulator` tail, and the
 * whole name is returned unchanged whenever it fits. No hash: display names
 * are not unique. The fit check and the cut count code points, for the reason
 * `simRtuCode` gives.
 */
export function simRtuDisplayName(locationName: string, domain: string): string {
  const tail = ` ${domain.toUpperCase()} Simulator`;
  const budget = RTU_DISPLAY_NAME_MAX - Array.from(tail).length;
  const characters = Array.from(locationName);
  const head = characters.length <= budget ? locationName : characters.slice(0, budget).join("");
  return `${head}${tail}`;
}

/** Maps asset domain to simulator RTU domain column. */
export function rtuDomainForAssetDomain(domain: string): string {
  if (domain === "it") {
    return "it";
  }
  return domain;
}

/** Returns organization id by code (ESKOM | PHEWB). */
export async function getOrganizationId(
  pool: pg.Pool,
  code: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE code = $1 LIMIT 1`,
    [code],
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error(`Organization not found: ${code}`);
  }
  return id;
}

/**
 * Ensures ESKOM and PHEWB organization rows exist.
 *
 * E4.1c / ADR 0070 decision 7: the SEED owns `currency` — migration `0076`
 * backfills the two codes once, and every re-seed restates them here, so a
 * hand edit on the demo database is reverted the way `name` is.
 */
export async function ensureOrganizations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    INSERT INTO bms.organizations (code, name, meta, currency)
    VALUES
      ('ESKOM', 'Eskom SMOC', '{"tenant":"demo"}'::jsonb, 'ZAR'),
      ('PHEWB', 'Public Health Engineering — West Bengal', '{"orgId":10}'::jsonb, 'INR')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency
  `);
}

/**
 * Creates simulator RTUs per domain for each Eskom canonical location.
 *
 * `F4.170`: the code and display name come from {@link simRtuCode} and
 * {@link simRtuDisplayName}, which return the pre-`F4.170` values unchanged
 * whenever they fit `varchar(64)` / `varchar(255)`. A location created through
 * the admin API with a long code or name therefore no longer aborts
 * `pnpm db:seed` with `22001`, and every seeded RTU keeps its code, so the
 * `ON CONFLICT (location_id, code)` upsert still updates it in place.
 */
export async function ensureEskomDomainRtus(db: BmsDb, pool: pg.Pool): Promise<void> {
  const eskomOrgId = await getOrganizationId(pool, "ESKOM");
  const locRows = await db
    .select({
      id: locations.id,
      code: locations.code,
      name: locations.name,
    })
    .from(locations)
    .where(eq(locations.organizationId, eskomOrgId));

  for (const loc of locRows) {
    for (const [domain, suffix] of Object.entries(DOMAIN_RTU_SUFFIX)) {
      const code = simRtuCode(loc.code, suffix);
      const displayName = simRtuDisplayName(loc.name, domain);
      await pool.query(
        `
        INSERT INTO bms.rtus (
          location_id, code, display_name, source_type, domain, ingest_enabled, meta,
          organization_id
        )
        VALUES ($1, $2, $3, 'simulator', $4, false, '{"synthetic":true}'::jsonb, $5)
        ON CONFLICT (location_id, code) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          source_type = EXCLUDED.source_type,
          domain = EXCLUDED.domain,
          organization_id = EXCLUDED.organization_id
        `,
        [loc.id, code, displayName, domain, eskomOrgId],
      );
    }
  }
}

/** Resolves simulator RTU id for an Eskom asset by site name and domain. */
export async function resolveEskomSimRtuId(
  pool: pg.Pool,
  siteName: string,
  assetDomain: string,
): Promise<string> {
  const domain = rtuDomainForAssetDomain(assetDomain);
  const suffix = DOMAIN_RTU_SUFFIX[domain];
  if (!suffix) {
    throw new Error(`Unknown asset domain for RTU mapping: ${assetDomain}`);
  }
  const res = await pool.query<{ id: string }>(
    `
    SELECT r.id
    FROM bms.rtus r
    INNER JOIN bms.locations l ON l.id = r.location_id
    INNER JOIN bms.organizations o ON o.id = l.organization_id
    WHERE l.name = $1
      AND o.code = 'ESKOM'
      AND r.domain = $2
      AND r.source_type = 'simulator'
    LIMIT 1
    `,
    [siteName, domain],
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error(`No simulator RTU for site=${siteName} domain=${domain}`);
  }
  return id;
}

/**
 * Wires every non-manual, non-`PHE-` ESKOM asset whose domain has a simulator
 * RTU at its `site_name` to that RTU, on every boot (an asset of a domain
 * with no `DOMAIN_RTU_SUFFIX` entry, such as `mechanical` or `facility`, or
 * one whose `site_name` matches no ESKOM location, is skipped silently). The
 * function overwrites an existing `rtu_id` and sets `meta.telemetrySource` to
 * `simulator`. A `water` asset is wired only
 * when its code starts with `WTR-` (owner ruling R3); any other water asset
 * keeps its `rtu_id` and its `telemetrySource`.
 */
export async function assignEskomAssetRtus(pool: pg.Pool): Promise<void> {
  const rows = await pool.query<{
    id: string;
    site_name: string;
    domain: string;
    location_id: string | null;
  }>(`
    SELECT a.id, a.site_name, a.domain, a.location_id
    FROM bms.assets a
    INNER JOIN bms.locations l ON l.id = a.location_id
    INNER JOIN bms.organizations o ON o.id = l.organization_id
    WHERE o.code = 'ESKOM'
      AND a.code NOT LIKE 'PHE-%'
      -- ADR 0018 made a gateway-less asset legal, and F4.10 seeds one to prove
      -- the scope queries do not join through bms.rtus. Without this exemption
      -- the second db:seed would wire it and the fixture would silently stop
      -- being a fixture. Any hand-read asset is exempt, not just that one.
      AND COALESCE(a.meta->>'sourceKind', '') <> 'manual'
      -- E4.3 owner ruling R3: a water asset is wired only when its code starts
      -- with WTR- (the demo plant, the only water codes apps/sim feeds). Any
      -- other water asset keeps its rtu_id and its telemetrySource.
      AND (a.domain <> 'water' OR a.code LIKE 'WTR-%')
  `);

  for (const row of rows.rows) {
    const rtuId = await resolveEskomSimRtuId(pool, row.site_name, row.domain).catch(
      () => null,
    );
    if (!rtuId) {
      continue;
    }
    await pool.query(
      `
      UPDATE bms.assets
      SET rtu_id = $1,
          meta = COALESCE(meta, '{}'::jsonb) || '{"telemetrySource":"simulator"}'::jsonb
      WHERE id = $2
      `,
      [rtuId, row.id],
    );
  }
}

/**
 * Sets NOT NULL on hierarchy FK columns after seed backfill.
 *
 * ADR 0018 inverted the asset polarities: `location_id` is now mandatory and
 * `rtu_id` is not. This function used to run
 * `ALTER TABLE bms.assets ALTER COLUMN rtu_id SET NOT NULL`, which would have
 * silently re-applied the old constraint on every `db:seed` and undone
 * migration 0023 — including in CI, which runs `db:migrate` then `db:seed`.
 * A migration is not the last word on schema here; this is. Do not re-add it.
 */
export async function enforceHierarchyNotNull(pool: pg.Pool): Promise<void> {
  // `E7.1b`: this asset pre-check joined the vacuous-but-kept set below. `0047`
  // gave `bms.assets` its own `tenant_isolation` + `FORCE`, so as `bms_owner`
  // with no `app.current_organization` this count reads 0 whether or not an
  // orphan exists — exactly as the `bms.locations` check already did since
  // `E7.1a`. The `SET NOT NULL` on `location_id` below still scans every row and
  // still fails loudly on a real orphan; only the friendly message is lost.
  const assetOrphans = await pool.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM bms.assets WHERE location_id IS NULL
  `);
  if (Number(assetOrphans.rows[0]?.n ?? "0") > 0) {
    throw new Error("Cannot enforce NOT NULL: assets without location_id remain");
  }
  // `E7.1a`: this pre-check is now **vacuous, and deliberately kept.** Since
  // ADR 0045 the seed runs as `bms_owner` under `FORCE ROW LEVEL SECURITY`, and
  // a row with `organization_id IS NULL` matches no tenant policy under any
  // `app.current_organization` — so this count reads 0 whether or not an orphan
  // exists, and no tenant context can rescue it.
  //
  // What is lost is the friendly message, not the guarantee: RLS filters DML,
  // it does not filter constraint validation, so the `SET NOT NULL` below still
  // scans every row and still fails loudly on a real orphan. Do not "fix" this
  // by widening the role or by deleting the check — the first defeats the
  // point of the item and the second removes the place this note lives.
  const locOrphans = await pool.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM bms.locations WHERE organization_id IS NULL
  `);
  if (Number(locOrphans.rows[0]?.n ?? "0") > 0) {
    throw new Error("Cannot enforce NOT NULL: locations without organization_id remain");
  }
  await pool.query(`
    ALTER TABLE bms.assets ALTER COLUMN location_id SET NOT NULL
  `);
  await pool.query(`
    ALTER TABLE bms.locations ALTER COLUMN organization_id SET NOT NULL
  `);
  // Assert the gateway column is nullable, rather than merely not asserting the
  // opposite. Removing the old `SET NOT NULL` stops this seed re-applying it,
  // but does not undo a constraint an earlier build already applied — and
  // drizzle will not re-run migration 0023 to repair it, because it is recorded
  // as applied. Any database that ran an older seed after migrating is stuck
  // otherwise. Found by creating a gateway-less asset through the UI against a
  // stack whose `migrate` service image predated this change.
  await pool.query(`
    ALTER TABLE bms.assets ALTER COLUMN rtu_id DROP NOT NULL
  `);
}

/**
 * Removes legacy PHE locations that used one RTU per location slug.
 *
 * **Must run inside a PHEWB tenant context** (`seed.ts` supplies one). All five
 * statements below join or target `bms.locations`, which carries `FORCE ROW
 * LEVEL SECURITY` since `E7.1a`. Without a context the role sees no location
 * rows, so every `DELETE` matches nothing, deletes nothing, and reports success
 * — the legacy rows would survive with no error anywhere. This is the one place
 * in the seed where a missing tenant context fails silently rather than loudly.
 */
export async function cleanupLegacyPheRtuLocations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    DELETE FROM bms.user_location_access ula
    USING bms.locations l
    WHERE ula.location_id = l.id
      AND l.slug ~ '^phe-.+-(i|ii)$'
  `);
  await pool.query(`
    DELETE FROM bms.asset_group_members agm
    USING bms.asset_groups ag, bms.locations l
    WHERE agm.asset_group_id = ag.id
      AND ag.location_id = l.id
      AND l.slug ~ '^phe-.+-(i|ii)$'
  `);
  await pool.query(`
    DELETE FROM bms.asset_groups ag
    USING bms.locations l
    WHERE ag.location_id = l.id
      AND l.slug ~ '^phe-.+-(i|ii)$'
  `);
  await pool.query(`
    DELETE FROM bms.rtus r
    USING bms.locations l
    WHERE r.location_id = l.id
      AND l.slug ~ '^phe-.+-(i|ii)$'
  `);
  await pool.query(`
    DELETE FROM bms.locations
    WHERE slug ~ '^phe-.+-(i|ii)$'
  `);
}
