import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, ilike, or, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

import { assets, assetTemplates, locations, rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { locationAncestorChains } from "../../auth/location-tree";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import type { ParentCandidate } from "./onboarding-location-parent";
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
  /**
   * `F4.243` (ADR 0098 Amendment 2, B7): the parent's code, `null` for a root.
   * A code and not an id — this inventory exposes no ids (ADR 0095 decision 3).
   */
  parentCode: string | null;
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

/**
 * `rtu` is the asset's RTU's own `code` (the RTU row's `code`), not the
 * `F4.182` device id — named apart from `ExistingRtu.rtuCode` so one key never
 * carries two meanings in one tool's results (F3.26 review M1).
 */
export type ExistingAsset = {
  code: string;
  name: string;
  domain: string;
  locationCode: string;
  rtu: string | null;
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
 *
 * Every join carries the organization predicate in its `ON` clause, not only
 * the base table's `WHERE`: nothing in the database makes a child row and its
 * parent share one organization, so on this pool the join predicate is the
 * only thing that keeps another organization's RTU code or RTU count out of a
 * result (F3.26 review L6). In `ON`, not `WHERE`, so a left join stays a left
 * join.
 */
/** The parent row of a listed location, joined by `parent_id` (`F4.243`). */
const parentLocation = alias(locations, "parent");

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
        parentCode: parentLocation.code,
      })
      .from(locations)
      .leftJoin(rtus, and(eq(rtus.locationId, locations.id), eq(rtus.organizationId, organizationId)))
      // F4.243: the organization predicate in `ON` as on every join here (L6).
      // Migration `0103`'s composite foreign key already keeps a parent in its
      // child's organization, so this one is belt-and-braces: no row a test
      // can plant without disabling that key reaches it.
      .leftJoin(
        parentLocation,
        and(eq(parentLocation.id, locations.parentId), eq(parentLocation.organizationId, organizationId)),
      )
      .where(where)
      .groupBy(locations.id, parentLocation.id)
      .orderBy(asc(locations.code))
      .limit(TOOL_LIST_MAX_ITEMS);
    // No rtus join here: the join fans a location out per RTU, and the total
    // counts locations.
    const [counted] = await this.db.select({ total: count() }).from(locations).where(where);
    return { rows, total: counted?.total ?? 0 };
  }

  /**
   * `F4.243` (ADR 0098 Amendment 2, B4): every location of the organization
   * with its code, name, active flag and depth (a root is 1), for validate's
   * parent check and the guided chat's parent question. Not capped: validate
   * must find any code the draft names. Tenant-only, as `listExisting`.
   */
  async listParentCandidates(organizationId: string): Promise<ParentCandidate[]> {
    const rows = await this.db
      .select({ id: locations.id, code: locations.code, name: locations.name, active: locations.active })
      .from(locations)
      .where(eq(locations.organizationId, organizationId))
      .orderBy(asc(locations.code));
    const chains = await locationAncestorChains(this.db, {
      organizationIds: [organizationId],
      ids: rows.map((row) => row.id),
    });
    // `steps` 0 is the node itself, so the deepest step plus one is its depth.
    const depth = new Map<string, number>();
    for (const link of chains) {
      depth.set(link.nodeId, Math.max(depth.get(link.nodeId) ?? 0, link.steps + 1));
    }
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      active: row.active,
      // Fails closed: a node the walk did not reach reads as `NaN`, and
      // `depthExceeded` treats a non-finite depth as exceeded.
      depth: depth.get(row.id) ?? Number.NaN,
    }));
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
      .innerJoin(locations, sameOrgLocation(rtus.locationId, organizationId))
      .leftJoin(
        rtuConnectionConfigs,
        and(eq(rtuConnectionConfigs.rtuId, rtus.id), eq(rtuConnectionConfigs.organizationId, organizationId)),
      )
      .where(where)
      .orderBy(asc(locations.code), asc(rtus.code))
      .limit(TOOL_LIST_MAX_ITEMS);
    // `rtu_connection_configs.rtu_id` is unique, so the left join never fans out.
    const [counted] = await this.db
      .select({ total: count() })
      .from(rtus)
      .innerJoin(locations, sameOrgLocation(rtus.locationId, organizationId))
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
        rtu: rtus.code,
        templateCode: assetTemplates.code,
        templateVersion: assetTemplates.version,
      })
      .from(assets)
      .innerJoin(locations, sameOrgLocation(assets.locationId, organizationId))
      .leftJoin(rtus, and(eq(assets.rtuId, rtus.id), eq(rtus.organizationId, organizationId)))
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
      .innerJoin(locations, sameOrgLocation(assets.locationId, organizationId))
      .where(where);
    return { rows, total: counted?.total ?? 0 };
  }
}

/** The `locations` join condition, with the session organization in `ON` (review L6). */
function sameOrgLocation(locationId: AnyPgColumn, organizationId: string): SQL | undefined {
  return and(eq(locationId, locations.id), eq(locations.organizationId, organizationId));
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
