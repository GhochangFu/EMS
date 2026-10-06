import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { assets, assetTemplates, locations, rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { TOOL_LIST_MAX_ITEMS } from "./onboarding-tool-outcome";

export type ExistingKind = "location" | "rtu" | "asset";

export type ExistingQuery = {
  readonly kind: ExistingKind;
  /** Case-insensitive substring on code and name (an RTU's name is its `displayName`). */
  readonly search?: string;
  /** Exact location code. */
  readonly locationCode?: string;
};

export type ExistingLocation = {
  code: string;
  slug: string;
  name: string;
  type: string;
  active: boolean;
  rtuCount: number;
};

/**
 * `rtuCode` is the `F4.182` device id. Listed because `draftRtuSchema` carries
 * an `rtuCode` field (`onboarding.schema.ts:106`), so the model can act on it —
 * the plan's Q-B rule ("if it does, flip to yes").
 */
export type ExistingRtu = {
  code: string;
  displayName: string;
  protocol: string | null;
  rtuCode: string | null;
  locationCode: string;
  active: boolean;
};

export type ExistingAsset = {
  code: string;
  name: string;
  domain: string;
  locationCode: string;
  rtuCode: string | null;
  templateCode: string | null;
  templateVersion: number | null;
};

export type ExistingRow = ExistingLocation | ExistingRtu | ExistingAsset;

export type ExistingResult = { rows: ExistingRow[]; total: number };

/**
 * Reads the session organization's committed locations, RTUs and assets for
 * the onboarding agent's `find_existing` tool (`F3.26` / ADR 0095).
 *
 * Runs on `fleetDb`, on the `OnboardingCatalogService` pattern: the
 * `organizationId` is always a value the caller has already been authorized
 * against (the session's organization, checked upstream in
 * `OnboardingService`), so this is a pool choice, not a new authorization
 * surface. `bms_fleet` bypasses RLS, so **the `organization_id` predicate on
 * the listed table is the only tenant boundary** — decision 2; the integration
 * spec holds it per kind.
 *
 * Decision 3: never selects `rtu_connection_configs.config`, a credential
 * column or any `meta`. Every select below names its columns; the result keys
 * are a fixed allowlist per kind, held by the integration spec.
 *
 * Decision 1 / plan Q-E: at most `TOOL_LIST_MAX_ITEMS` rows, plus one
 * `COUNT(*)` under the same predicates so the tool's tail is exact.
 */
@Injectable()
export class OnboardingInventoryService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly db: BmsDb) {}

  /** Tenant-only (ADR 0095 decision 2). Never selects `rtu_connection_configs.config`, a credential column or `meta` (decision 3). */
  async listExisting(organizationId: string, query: ExistingQuery): Promise<ExistingResult> {
    switch (query.kind) {
      case "location":
        return this.listLocations(organizationId, query);
      case "rtu":
        return this.listRtus(organizationId, query);
      case "asset":
        return this.listAssets(organizationId, query);
    }
  }

  private async listLocations(organizationId: string, query: ExistingQuery): Promise<ExistingResult> {
    const where = and(
      eq(locations.organizationId, organizationId),
      searchOn(query.search, locations.code, locations.name),
      query.locationCode === undefined ? undefined : eq(locations.code, query.locationCode),
    );
    const rows = await this.db
      .select({
        code: locations.code,
        slug: locations.slug,
        name: locations.name,
        type: locations.type,
        active: locations.active,
        rtuCount: count(rtus.id),
      })
      .from(locations)
      .leftJoin(rtus, eq(rtus.locationId, locations.id))
      .where(where)
      .groupBy(locations.id)
      .orderBy(asc(locations.code))
      .limit(TOOL_LIST_MAX_ITEMS);
    // No rtus join here: the join fans a location out per RTU, and the total
    // counts locations.
    const [counted] = await this.db.select({ total: count() }).from(locations).where(where);
    return { rows, total: counted?.total ?? 0 };
  }

  private async listRtus(organizationId: string, query: ExistingQuery): Promise<ExistingResult> {
    const where = and(
      eq(rtus.organizationId, organizationId),
      searchOn(query.search, rtus.code, rtus.displayName),
      query.locationCode === undefined ? undefined : eq(locations.code, query.locationCode),
    );
    const rows = await this.db
      .select({
        code: rtus.code,
        displayName: rtus.displayName,
        // The protocol column only: never `config`, `credentials_ciphertext` or `credentials_iv`.
        protocol: rtuConnectionConfigs.protocol,
        rtuCode: rtus.rtuCode,
        locationCode: locations.code,
        active: rtus.active,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .leftJoin(rtuConnectionConfigs, eq(rtuConnectionConfigs.rtuId, rtus.id))
      .where(where)
      .orderBy(asc(locations.code), asc(rtus.code))
      .limit(TOOL_LIST_MAX_ITEMS);
    // `rtu_connection_configs.rtu_id` is unique, so the left join never fans out.
    const [counted] = await this.db
      .select({ total: count() })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .where(where);
    return { rows, total: counted?.total ?? 0 };
  }

  private async listAssets(organizationId: string, query: ExistingQuery): Promise<ExistingResult> {
    const where = and(
      eq(assets.organizationId, organizationId),
      searchOn(query.search, assets.code, assets.name),
      query.locationCode === undefined ? undefined : eq(locations.code, query.locationCode),
    );
    const rows = await this.db
      .select({
        code: assets.code,
        name: assets.name,
        domain: assets.domain,
        locationCode: locations.code,
        rtuCode: rtus.code,
        templateCode: assetTemplates.code,
        templateVersion: assetTemplates.version,
      })
      .from(assets)
      .innerJoin(locations, eq(assets.locationId, locations.id))
      .leftJoin(rtus, eq(assets.rtuId, rtus.id))
      .leftJoin(
        assetTemplates,
        and(eq(assets.templateId, assetTemplates.id), eq(assetTemplates.organizationId, organizationId)),
      )
      .where(where)
      .orderBy(asc(assets.code))
      .limit(TOOL_LIST_MAX_ITEMS);
    // Both left joins are on a primary key, so neither fans out.
    const [counted] = await this.db
      .select({ total: count() })
      .from(assets)
      .innerJoin(locations, eq(assets.locationId, locations.id))
      .where(where);
    return { rows, total: counted?.total ?? 0 };
  }
}

/** `code ILIKE %search% OR name ILIKE %search%`, or no predicate when no search is given. */
function searchOn(search: string | undefined, code: AnyPgColumn, name: AnyPgColumn): SQL | undefined {
  if (search === undefined) return undefined;
  const pattern = likePattern(search);
  return or(ilike(code, pattern), ilike(name, pattern));
}

/**
 * A substring pattern with `\`, `%` and `_` escaped, so a search is literal
 * text. Postgres's default `LIKE` escape character is the backslash.
 */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
