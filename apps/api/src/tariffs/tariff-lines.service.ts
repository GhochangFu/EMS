import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";

import { resolveSiteTimeZone } from "@bms/shared";
import type {
  JwtPayload,
  TariffDataStatus,
  TariffLineDto,
  TariffLineVersionsResponse,
  TariffLinesResponse,
  TariffSlab,
  TariffSource,
  TariffVersionDto,
} from "@bms/shared";
import type { z } from "zod";

import type { tariffCategoriesQuerySchema, tariffLineVersionsQuerySchema } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_POOL } from "../database/database.tokens";
import { monthFirstDay, monthOf } from "./month-window";

type EnergyUnit = "kwh" | "kvah";
type FixedBasis = TariffLineDto["fixedBasis"];

/** One version of a line with every descriptive column — the versions DTO and U6's copy source. */
export interface LineVersionRow {
  id: string;
  key: string;
  source: TariffSource;
  organizationId: string | null;
  areaId: string;
  state: string;
  discoms: string;
  ownership: string;
  code: string;
  name: string;
  segment: string;
  supply: string;
  energyUnit: EnergyUnit;
  fixedBasis: FixedBasis;
  dataStatus: TariffDataStatus;
  tariffOrder: string | null;
  sourceUrl: string | null;
  notes: string | null;
  effectiveFrom: string;
  reason: string | null;
  slabs: TariffSlab[];
}

interface RawVersionRow {
  id: string;
  key: string;
  source: TariffSource;
  organization_id: string | null;
  area_id: string;
  state: string;
  discoms: string;
  ownership: string;
  code: string;
  name: string;
  segment: string;
  supply: string;
  energy_unit: EnergyUnit;
  fixed_basis: FixedBasis;
  data_status: TariffDataStatus;
  tariff_order: string | null;
  source_url: string | null;
  notes: string | null;
  effective_from: string;
  reason: string | null;
  slabs: { slab_no: number; from_units: string; to_units: string | null; energy_rate: string; fixed_rate: string; wheeling_rate: string; notes: string | null }[] | null;
}

const COLUMNS = (t: string) => `${t}.id, ${t}.key, ${t}.area_id, ${t}.state, ${t}.discoms, ${t}.ownership, ${t}.code, ${t}.name,
       ${t}.segment, ${t}.supply, ${t}.energy_unit, ${t}.fixed_basis, ${t}.data_status, ${t}.tariff_order, ${t}.source_url,
       ${t}.notes, to_char(${t}.effective_from, 'YYYY-MM-DD') AS effective_from`;

const SLABS = (table: string, where: string) => `(SELECT json_agg(json_build_object('slab_no', s.slab_no, 'from_units', s.from_units,
         'to_units', s.to_units, 'energy_rate', s.energy_rate, 'fixed_rate', s.fixed_rate, 'wheeling_rate', s.wheeling_rate,
         'notes', s.notes) ORDER BY s.slab_no) FROM ${table} s WHERE ${where}) AS slabs`;

/**
 * Every version of `key`: the catalog's, and — when `organizationId` is set —
 * that organization's own, read with the organization equality (plan D12: the
 * fleet pool bypasses RLS, so that predicate is the isolation). Ordered by
 * `effective_from`, the organization's after the catalog's on the same date.
 */
export async function readLineVersions(
  pool: Pick<Pool, "query">,
  key: string,
  organizationId: string | null,
): Promise<LineVersionRow[]> {
  const { rows } = await pool.query<RawVersionRow>(
    `SELECT ${COLUMNS("c")}, 'catalog' AS source, NULL::uuid AS organization_id, NULL::varchar AS reason,
            ${SLABS("bms.tariff_slabs", "s.category_id = c.id")}
       FROM bms.tariff_categories c
      WHERE c.key = $1
     UNION ALL
     SELECT ${COLUMNS("o")}, 'organization', o.organization_id, o.reason,
            ${SLABS("bms.org_tariff_slabs", "s.category_id = o.id AND s.organization_id = o.organization_id")}
       FROM bms.org_tariff_categories o
      WHERE o.key = $1 AND o.organization_id = $2::uuid
      ORDER BY effective_from, source`,
    [key, organizationId],
  );
  return rows.map(toLineVersion);
}

function toLineVersion(r: RawVersionRow): LineVersionRow {
  return {
    id: r.id,
    key: r.key,
    source: r.source,
    organizationId: r.organization_id,
    areaId: r.area_id,
    state: r.state,
    discoms: r.discoms,
    ownership: r.ownership,
    code: r.code,
    name: r.name,
    segment: r.segment,
    supply: r.supply,
    energyUnit: r.energy_unit,
    fixedBasis: r.fixed_basis,
    dataStatus: r.data_status,
    tariffOrder: r.tariff_order,
    sourceUrl: r.source_url,
    notes: r.notes,
    effectiveFrom: r.effective_from,
    reason: r.reason,
    slabs: (r.slabs ?? []).map((s) => ({
      slabNo: s.slab_no,
      fromUnits: Number(s.from_units),
      toUnits: s.to_units === null ? null : Number(s.to_units),
      energyRate: Number(s.energy_rate),
      fixedRate: Number(s.fixed_rate),
      wheelingRate: Number(s.wheeling_rate),
      notes: s.notes,
    })),
  };
}

/**
 * The version a line is listed by: the one in force on `firstDay` (latest
 * `effectiveFrom <= firstDay`, the organization's on a tie), else — a line
 * whose every version is still ahead, e.g. a custom line dated next month —
 * the earliest one, so it can be found and mapped before it applies.
 */
export function listedVersion<T extends { effectiveFrom: string; source: TariffSource }>(versions: readonly T[], firstDay: string): T | null {
  let inForce: T | null = null;
  let earliest: T | null = null;
  for (const v of versions) {
    if (earliest === null || v.effectiveFrom < earliest.effectiveFrom) earliest = v;
    if (v.effectiveFrom > firstDay) continue;
    if (
      inForce === null ||
      v.effectiveFrom > inForce.effectiveFrom ||
      (v.effectiveFrom === inForce.effectiveFrom && v.source === "organization" && inForce.source === "catalog")
    ) {
      inForce = v;
    }
  }
  return inForce ?? earliest;
}

/** `YYYY-MM-01` of the month `now` falls in, in the organization's zone (UTC when none). */
export async function currentMonthFirstDay(pool: Pick<Pool, "query">, organizationId: string | null, now: Date): Promise<string> {
  let zone: string | null = null;
  if (organizationId !== null) {
    const { rows } = await pool.query<{ timezone: string | null }>(`SELECT timezone FROM bms.organizations WHERE id = $1`, [organizationId]);
    zone = rows[0]?.timezone ?? null;
  }
  return monthFirstDay(monthOf(now, resolveSiteTimeZone(null, zone).arithmeticZone));
}

interface ListRow {
  key: string;
  source: TariffSource;
  organization_id: string | null;
  area_id: string;
  state: string;
  discoms: string;
  ownership: string;
  code: string;
  name: string;
  segment: string;
  supply: string;
  energy_unit: EnergyUnit;
  fixed_basis: FixedBasis;
  data_status: TariffDataStatus;
  tariff_order: string | null;
  source_url: string | null;
  notes: string | null;
  effective_from: string;
  slab_count: number;
}

/**
 * `F4.365` U5 (ADR 0134, plan D6) — the two tariff read routes any signed-in
 * user may call: the line list and one line's versions.
 *
 * **Which organization's rows.** The global catalog is readable by everyone.
 * An organization's own revisions and custom lines are added for exactly one
 * organization: `organizationId` when the caller names it (403 unless it is
 * in `readableOrganizationIds`), else the caller's one readable organization;
 * a caller reading several (or a global admin) who names none gets the catalog
 * alone. Reads run on the fleet pool with the organization equality in SQL.
 */
@Injectable()
export class TariffLinesService {
  constructor(
    // Fleet read (ADR 0043 Amendment 3): the catalog is global and a global admin reads it with no organization; each organization row is bounded by an equality in SQL.
    @Inject(FLEET_POOL) private readonly pool: Pick<Pool, "query">,
    private readonly accessControl: AccessControlService,
  ) {}

  async listCategories(jwt: JwtPayload, query: z.infer<typeof tariffCategoriesQuerySchema>, now = new Date()): Promise<TariffLinesResponse> {
    const organizationId = await this.readOrganization(jwt, query.organizationId);
    const { rows } = await this.pool.query<ListRow>(
      `SELECT c.key, 'catalog' AS source, NULL::uuid AS organization_id, ${LIST_COLUMNS("c")},
              (SELECT count(*)::int FROM bms.tariff_slabs s WHERE s.category_id = c.id) AS slab_count
         FROM bms.tariff_categories c
       UNION ALL
       SELECT o.key, 'organization', o.organization_id, ${LIST_COLUMNS("o")},
              (SELECT count(*)::int FROM bms.org_tariff_slabs s WHERE s.category_id = o.id AND s.organization_id = o.organization_id)
         FROM bms.org_tariff_categories o
        WHERE o.organization_id = $1::uuid`,
      [organizationId],
    );
    const byKey = new Map<string, TariffLineDto[]>();
    for (const r of rows) {
      const dto = toLineDto(r);
      const list = byKey.get(dto.key);
      if (list) list.push(dto);
      else byKey.set(dto.key, [dto]);
    }
    const firstDay = await currentMonthFirstDay(this.pool, organizationId, now);
    const needle = query.q?.trim().toLowerCase();
    const items = [...byKey.values()]
      .map((versions) => listedVersion(versions, firstDay))
      .filter((line): line is TariffLineDto => line !== null)
      .filter((line) => query.state === undefined || line.state === query.state)
      .filter((line) => query.segment === undefined || line.segment === query.segment)
      .filter(
        (line) =>
          needle === undefined ||
          needle === "" ||
          line.key.toLowerCase().includes(needle) ||
          line.name.toLowerCase().includes(needle) ||
          line.code.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.state.localeCompare(b.state) || a.key.localeCompare(b.key));
    return { items };
  }

  /** One line's versions, oldest first; 404 when the caller can see none. */
  async listVersions(jwt: JwtPayload, query: z.infer<typeof tariffLineVersionsQuerySchema>, now = new Date()): Promise<TariffLineVersionsResponse> {
    const organizationId = await this.readOrganization(jwt, query.organizationId);
    const versions = await readLineVersions(this.pool, query.key, organizationId);
    if (versions.length === 0) {
      throw new NotFoundException("Tariff line not found");
    }
    const firstDay = await currentMonthFirstDay(this.pool, organizationId, now);
    return { key: query.key, versions: versions.map((v) => toVersionDto(v, firstDay)) };
  }

  /** The one organization whose own rows the read adds, or `null` for the catalog alone (see the class doc). */
  private async readOrganization(jwt: JwtPayload, requested: string | undefined): Promise<string | null> {
    const readable = await this.accessControl.readableOrganizationIds(jwt);
    if (requested !== undefined) {
      if (readable !== null && !readable.includes(requested)) {
        throw new ForbiddenException("Organization is outside your access scope");
      }
      return requested;
    }
    return readable !== null && readable.length === 1 ? readable[0]! : null;
  }
}

const LIST_COLUMNS = (t: string) => `${t}.area_id, ${t}.state, ${t}.discoms, ${t}.ownership, ${t}.code, ${t}.name, ${t}.segment,
       ${t}.supply, ${t}.energy_unit, ${t}.fixed_basis, ${t}.data_status, ${t}.tariff_order, ${t}.source_url, ${t}.notes,
       to_char(${t}.effective_from, 'YYYY-MM-DD') AS effective_from`;

function toLineDto(r: ListRow): TariffLineDto {
  return {
    key: r.key,
    source: r.source,
    organizationId: r.organization_id,
    areaId: r.area_id,
    state: r.state,
    discoms: r.discoms,
    ownership: r.ownership,
    code: r.code,
    name: r.name,
    segment: r.segment,
    supply: r.supply,
    energyUnit: r.energy_unit,
    fixedBasis: r.fixed_basis,
    dataStatus: r.data_status,
    tariffOrder: r.tariff_order,
    sourceUrl: r.source_url,
    notes: r.notes,
    effectiveFrom: r.effective_from,
    slabCount: r.slab_count,
  };
}

/**
 * Amendment 1: a version already in force cannot be edited or deleted, only
 * superseded — so only an organization version dated after the current
 * month's first day (in the organization's zone) is `editable`.
 */
export function toVersionDto(v: LineVersionRow, currentFirstDay: string): TariffVersionDto {
  return {
    id: v.id,
    key: v.key,
    source: v.source,
    organizationId: v.organizationId,
    areaId: v.areaId,
    state: v.state,
    discoms: v.discoms,
    ownership: v.ownership,
    code: v.code,
    name: v.name,
    segment: v.segment,
    supply: v.supply,
    energyUnit: v.energyUnit,
    fixedBasis: v.fixedBasis,
    dataStatus: v.dataStatus,
    tariffOrder: v.tariffOrder,
    sourceUrl: v.sourceUrl,
    notes: v.notes,
    effectiveFrom: v.effectiveFrom,
    slabs: v.slabs,
    reason: v.reason,
    editable: v.source === "organization" && v.effectiveFrom > currentFirstDay,
  };
}
