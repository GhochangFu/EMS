import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";

import { assets, locations, locationTariffs } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { loadUnitForBasis } from "@bms/shared";
import type {
  CreateLocationTariffBody,
  JwtPayload,
  LocationTariffDto,
  LocationTariffsResponse,
  UpdateLocationTariffBody,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { expandLocationSubtrees } from "../auth/location-tree";
import { FLEET_DRIZZLE, FLEET_POOL, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { listedVersion, readLineVersions } from "./tariff-lines.service";

const NOT_FOUND = "Tariff mapping not found";

/**
 * Maps a driver error from a `bms.location_tariffs` write to the HTTP
 * exception the caller gets; anything unrecognised comes back unchanged for
 * the caller to rethrow (the `translateCalcParameterWriteError` shape).
 */
export function translateLocationTariffWriteError(err: unknown, organizationId: string): unknown {
  const code = (err as { code?: string } | null)?.code;
  const constraint = (err as { constraint?: string } | null)?.constraint;
  if (code === "23P01" && constraint === "location_tariffs_no_overlap") {
    return new ConflictException(
      "A tariff mapping for this location overlaps one written moments ago; the database's overlap " +
        "constraint refused it. Reload the list and choose months outside that mapping.",
    );
  }
  if (code === "42501") {
    return new BadRequestException(
      `The write was refused by this table's row-level security policy: the location or the billing meter ` +
        `does not belong to organization ${organizationId}.`,
    );
  }
  if (code === "23514" && constraint?.startsWith("location_tariffs_")) {
    return new BadRequestException(
      "The mapping breaks a rule of the table: effectiveFrom and effectiveTo are first days of a month with " +
        "effectiveTo later, and the sanctioned load is a non-negative number in kw, kva or hp.",
    );
  }
  if (code === "23503" && constraint?.startsWith("location_tariffs_")) {
    return new BadRequestException("The location or the billing meter no longer exists.");
  }
  return err;
}

type Window = { readonly from: string; readonly to: string | null };

interface DtoRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  location_id: string;
  tariff_key: string;
  tariff_name: string | null;
  data_status: LocationTariffDto["dataStatus"];
  billing_meter_asset_id: string;
  billing_meter_name: string | null;
  sanctioned_load: string;
  sanctioned_load_unit: LocationTariffDto["sanctionedLoadUnit"];
  effective_from: string;
  effective_to: string | null;
}

/**
 * `F4.365` U5 (ADR 0134 decision 3, plan D5/D6) — `/admin/locations/:locationId/tariffs`:
 * a location's mappings to tariff lines, the `CalcParametersAdminService` shape.
 *
 * **Gate.** Every route: `requireMasterDataUser`, then `canManageLocation` on
 * the path's location (a `location_admin` manages its own subtree only).
 *
 * **Parents.** The billing meter must belong to the location's organization
 * and sit in the location's subtree; "not yours" and "does not exist" are one
 * 400 sentence. The `tariffKey` must name a line with at least one version the
 * organization can see, and a per-load fixed basis needs the matching
 * sanctioned-load unit.
 *
 * **Overlap** is refused twice: a `FOR SHARE` pre-read inside the write
 * transaction gives the 409 that names the clashing months, and
 * `location_tariffs_no_overlap` is the race backstop
 * ({@link translateLocationTariffWriteError}). Pre-reads run on the fleet
 * handles; the list and every write run inside `withTenant`, with the audit
 * row in the same transaction.
 */
@Injectable()
export class LocationTariffsService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(FLEET_POOL) private readonly fleetPool: Pick<Pool, "query">,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  async list(jwt: JwtPayload, locationId: string): Promise<LocationTariffsResponse> {
    const organizationId = await this.requireManageable(jwt, locationId);
    const items = await withTenant(this.db, organizationId, (tx) => this.selectDtos(tx, sql`lt.location_id = ${locationId}::uuid`));
    return { items };
  }

  async create(jwt: JwtPayload, locationId: string, body: CreateLocationTariffBody): Promise<LocationTariffDto> {
    const organizationId = await this.requireManageable(jwt, locationId);
    await this.assertKeyAndUnit(organizationId, body.tariffKey, body.effectiveFrom, body.sanctionedLoadUnit);
    const window: Window = { from: body.effectiveFrom, to: body.effectiveTo ?? null };

    return this.translating(organizationId, () =>
      withTenant(this.db, organizationId, async (tx) => {
        await this.assertMeterInSubtree(tx, organizationId, locationId, body.billingMeterAssetId);
        await this.refuseOverlap(tx, locationId, window, null);
        const [written] = await tx
          .insert(locationTariffs)
          .values({
            organizationId,
            locationId,
            tariffKey: body.tariffKey,
            billingMeterAssetId: body.billingMeterAssetId,
            sanctionedLoad: String(body.sanctionedLoad),
            sanctionedLoadUnit: body.sanctionedLoadUnit,
            effectiveFrom: window.from,
            effectiveTo: window.to,
          })
          .returning({ id: locationTariffs.id });
        if (!written) throw new Error("create: the insert returned no row");
        await this.audit.write(
          {
            actor: jwt,
            action: "master.location_tariff.create",
            entityType: "location_tariff",
            entityId: written.id,
            organizationId,
            payload: { locationId, ...body },
          },
          tx,
        );
        return this.requireDto(tx, written.id);
      }),
    );
  }

  /** The line (`tariffKey`) is immutable: a different line is delete + create, or a new dated mapping. */
  async update(jwt: JwtPayload, locationId: string, id: string, body: UpdateLocationTariffBody): Promise<LocationTariffDto> {
    const organizationId = await this.requireManageable(jwt, locationId);

    return this.translating(organizationId, () =>
      withTenant(this.db, organizationId, async (tx) => {
        // The stored row and the meter are tenant rows: read under the write's own GUC and transaction.
        const existing = await this.fetchExisting(tx, organizationId, locationId, id);
        const meter = body.billingMeterAssetId ?? existing.billingMeterAssetId;
        if (body.billingMeterAssetId !== undefined) {
          await this.assertMeterInSubtree(tx, organizationId, locationId, meter);
        }
        const window: Window = {
          from: body.effectiveFrom ?? existing.effectiveFrom,
          to: body.effectiveTo === undefined ? existing.effectiveTo : body.effectiveTo,
        };
        if (window.to !== null && window.to <= window.from) {
          throw new BadRequestException("effectiveTo must be later than effectiveFrom");
        }
        const unit = body.sanctionedLoadUnit ?? existing.sanctionedLoadUnit;
        await this.assertKeyAndUnit(organizationId, existing.tariffKey, window.from, unit);
        await this.refuseOverlap(tx, locationId, window, id);
        const updated = await tx
          .update(locationTariffs)
          .set({
            billingMeterAssetId: meter,
            ...(body.sanctionedLoad === undefined ? {} : { sanctionedLoad: String(body.sanctionedLoad) }),
            sanctionedLoadUnit: unit,
            effectiveFrom: window.from,
            effectiveTo: window.to,
            updatedAt: new Date(),
          })
          .where(and(eq(locationTariffs.id, id), eq(locationTariffs.locationId, locationId)))
          .returning({ id: locationTariffs.id });
        if (updated.length === 0) throw new NotFoundException(NOT_FOUND);
        await this.audit.write(
          {
            actor: jwt,
            action: "master.location_tariff.update",
            entityType: "location_tariff",
            entityId: id,
            organizationId,
            payload: { locationId, tariffKey: existing.tariffKey, ...body },
          },
          tx,
        );
        return this.requireDto(tx, id);
      }),
    );
  }

  /** A hard delete with an audit row; ending a mapping is an edit of `effectiveTo`. */
  async remove(jwt: JwtPayload, locationId: string, id: string): Promise<void> {
    const organizationId = await this.requireManageable(jwt, locationId);
    await withTenant(this.db, organizationId, async (tx) => {
      // The audit payload is the row as the delete's own transaction sees it.
      const existing = await this.fetchExisting(tx, organizationId, locationId, id);
      const deleted = await tx
        .delete(locationTariffs)
        .where(and(eq(locationTariffs.id, id), eq(locationTariffs.locationId, locationId)))
        .returning({ id: locationTariffs.id });
      if (deleted.length === 0) throw new NotFoundException(NOT_FOUND);
      await this.audit.write(
        {
          actor: jwt,
          action: "master.location_tariff.delete",
          entityType: "location_tariff",
          entityId: id,
          organizationId,
          payload: existing,
        },
        tx,
      );
    });
  }

  // ---- gates -----------------------------------------------------------------

  /** `requireMasterDataUser`, then `canManageLocation`; returns the location's organization. */
  private async requireManageable(jwt: JwtPayload, locationId: string): Promise<string> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    // Fleet read (ADR 0043 Amendment 3): the organization is what `withTenant` needs, so it is read before any GUC exists.
    const [row] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!row) throw new NotFoundException("Location not found");
    return row.organizationId;
  }

  /** Inside the write's transaction: the meter and the subtree are read under the tenant GUC. */
  private async assertMeterInSubtree(tx: BmsTx, organizationId: string, locationId: string, assetId: string): Promise<void> {
    const [row] = await tx
      .select({ organizationId: assets.organizationId, locationId: assets.locationId })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    const subtree =
      row?.organizationId === organizationId && row.locationId !== null
        ? await expandLocationSubtrees(tx, { organizationIds: [organizationId], ids: [locationId] })
        : [];
    if (!row || row.locationId === null || !subtree.includes(row.locationId)) {
      throw new BadRequestException(
        "The billingMeterAssetId you supplied is not an asset of this location or a location under it, or does not exist.",
      );
    }
  }

  private async assertKeyAndUnit(organizationId: string, key: string, effectiveFrom: string, unit: string): Promise<void> {
    // Fleet read (ADR 0043 Amendment 3): the shared catalog beside the organization's own lines, bounded by organizationId in the reader.
    const versions = await readLineVersions(this.fleetPool, key, organizationId);
    const version = listedVersion(versions, effectiveFrom);
    if (version === null) {
      throw new BadRequestException(`"${key}" is not a tariff line in the catalog or this organization's own lines.`);
    }
    const needed = loadUnitForBasis(version.fixedBasis);
    if (needed !== null && needed !== unit) {
      throw new BadRequestException(`"${key}" charges ${version.fixedBasis}, so the sanctioned load must be in ${needed}.`);
    }
  }

  /** The author-facing overlap refusal, inside the write transaction (`FOR SHARE` holds the clash). */
  private async refuseOverlap(tx: BmsTx, locationId: string, window: Window, excludeId: string | null): Promise<void> {
    const result = await tx.execute<{ effective_from: string; effective_to: string | null }>(
      sql`SELECT to_char(effective_from, 'YYYY-MM-DD') AS effective_from, to_char(effective_to, 'YYYY-MM-DD') AS effective_to
            FROM bms.location_tariffs
           WHERE location_id = ${locationId}::uuid
             AND daterange(effective_from, effective_to, '[)') && daterange(${window.from}::date, ${window.to}::date, '[)')
             ${excludeId === null ? sql`` : sql`AND id <> ${excludeId}::uuid`}
           ORDER BY effective_from
           LIMIT 1
           FOR SHARE`,
    );
    const clash = result.rows[0];
    if (clash) {
      throw new ConflictException(
        `This location is already mapped from ${clash.effective_from} to ${clash.effective_to ?? "open"}. ` +
          "End that mapping first, or choose months outside it.",
      );
    }
  }

  private async translating<T>(organizationId: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw translateLocationTariffWriteError(err, organizationId);
    }
  }

  // ---- reads -----------------------------------------------------------------

  /** The stored row, read in the caller's tenant transaction with the organization and location equalities; else 404. */
  private async fetchExisting(tx: BmsTx, organizationId: string, locationId: string, id: string) {
    const [row] = await tx
      .select()
      .from(locationTariffs)
      .where(and(eq(locationTariffs.id, id), eq(locationTariffs.organizationId, organizationId), eq(locationTariffs.locationId, locationId)))
      .limit(1);
    if (!row) throw new NotFoundException(NOT_FOUND);
    return {
      id: row.id,
      tariffKey: row.tariffKey,
      billingMeterAssetId: row.billingMeterAssetId,
      sanctionedLoad: Number(row.sanctionedLoad),
      sanctionedLoadUnit: row.sanctionedLoadUnit,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    };
  }

  private async requireDto(tx: BmsTx, id: string): Promise<LocationTariffDto> {
    const [dto] = await this.selectDtos(tx, sql`lt.id = ${id}::uuid`);
    if (!dto) throw new NotFoundException(NOT_FOUND);
    return dto;
  }

  /**
   * Mappings with the line's current name and data status (its newest
   * version, the organization's on a tie) and the meter's name. Runs under
   * the tenant GUC, so the organization rows are the policy's; the catalog is
   * readable by `bms_tenant`.
   */
  private async selectDtos(tx: BmsTx, where: ReturnType<typeof sql>): Promise<LocationTariffDto[]> {
    const result = await tx.execute<DtoRow>(sql`
      SELECT lt.id, lt.organization_id, lt.location_id, lt.tariff_key, line.name AS tariff_name, line.data_status,
             lt.billing_meter_asset_id, a.name AS billing_meter_name, lt.sanctioned_load, lt.sanctioned_load_unit,
             to_char(lt.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(lt.effective_to, 'YYYY-MM-DD') AS effective_to
        FROM bms.location_tariffs lt
        LEFT JOIN bms.assets a ON a.id = lt.billing_meter_asset_id AND a.organization_id = lt.organization_id
        LEFT JOIN LATERAL (
          SELECT v.name, v.data_status FROM (
            SELECT c.name, c.data_status, c.effective_from, 0 AS rank FROM bms.tariff_categories c WHERE c.key = lt.tariff_key
            UNION ALL
            SELECT o.name, o.data_status, o.effective_from, 1 FROM bms.org_tariff_categories o
             WHERE o.key = lt.tariff_key AND o.organization_id = lt.organization_id
          ) v ORDER BY v.effective_from DESC, v.rank DESC LIMIT 1
        ) line ON true
       WHERE ${where}
       ORDER BY lt.effective_from`);
    return result.rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      locationId: r.location_id,
      tariffKey: r.tariff_key,
      tariffName: r.tariff_name,
      dataStatus: r.data_status,
      billingMeterAssetId: r.billing_meter_asset_id,
      billingMeterName: r.billing_meter_name,
      sanctionedLoad: Number(r.sanctioned_load),
      sanctionedLoadUnit: r.sanctioned_load_unit,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
    }));
  }
}
