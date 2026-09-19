import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";

import { assets, calcParameters, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  CalcParameterDto,
  CalcParameterKeysListResponse,
  CalcParametersListResponse,
  JwtPayload,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import type {
  CreateCalcParameterBody,
  ListCalcParametersQuery,
  UpdateCalcParameterBody,
} from "./calc-parameters.schema";

/** The scope of one row: at most one of the two ids is set; both `null` is the organization. */
type Scope = {
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly assetId: string | null;
};

type Window = { readonly from: Date; readonly to: Date | null };

const NOT_FOUND = "Calc parameter not found";

/**
 * Maps a driver error from a `bms.calc_parameters` write to the HTTP
 * exception the caller gets; anything unrecognised is returned unchanged for
 * the caller to rethrow. `pg` puts SQLSTATE in `code` and the constraint
 * name in `constraint`; this drizzle version does not wrap driver errors
 * (`dashboards.service.ts` reads the same two fields).
 */
export function translateCalcParameterWriteError(err: unknown, organizationId: string): unknown {
  const code = (err as { code?: string } | null)?.code;
  const constraint = (err as { constraint?: string } | null)?.constraint;
  if (code === "23P01" && constraint === "calc_parameters_no_overlap") {
    return new ConflictException(
      "A value for this key at this scope overlaps a row written moments ago; the database's " +
        "overlap constraint refused it. Reload the list and choose dates outside that row.",
    );
  }
  if (code === "42501") {
    return new BadRequestException(
      `The write was refused by this table's row-level security policy: the row, or the locationId or assetId ` +
        `it names, does not belong to organization ${organizationId}.`,
    );
  }
  if (code === "23514" && constraint === "calc_parameters_validity_check") {
    return new BadRequestException("effectiveTo must be later than effectiveFrom");
  }
  if (code === "23503" && constraint === "calc_parameters_key_fkey") {
    return new BadRequestException("The key is not in the calc parameter vocabulary.");
  }
  if (code === "23503" && constraint === "calc_parameters_organization_id_fkey") {
    return new BadRequestException(`Organization ${organizationId} does not exist.`);
  }
  return err;
}

/**
 * `E4.1a` U8 — the admin write path of `bms.calc_parameters` and the read of
 * the vocabulary (ADR 0070 decision 2; plan design decisions 7, 11 and 12).
 *
 * **Reads on `fleetDb`, writes inside `withTenant` on the tenant pool** — the
 * `AssetPointCalcOverrideService` shape (ADR 0043 Amendments 2/3): the scope
 * gates and the parent pre-validation precede any tenant context, and only
 * the write transaction opens the GUC. Every fleet read here carries an
 * `organization_id` predicate or is gated by the row's organization first.
 *
 * **Authorization is by the row's scope, not by the endpoint** (design
 * decision 11, plan ruling Q5). Read: a master-data user whose readable
 * organizations include the row's — a `location_admin` may read its
 * organization's tariff. Write: organization scope → `admin` or
 * `organization_admin` holding the organization; location scope →
 * `canManageLocation`; asset scope → `canManageAsset`. The role test on the
 * organization scope is explicit because `canManageOrganization` alone admits
 * a `location_admin` for the organization its locations derive — the same
 * reason `LocationsAdminService.create` refuses the role by name.
 *
 * **Overlap is refused twice** (design decision 7). The pre-read inside the
 * write transaction (`FOR SHARE`) produces the author-facing 409 that names
 * the clashing window; `calc_parameters_no_overlap` (a `btree_gist`
 * `EXCLUDE`) is the race-proof backstop, and its `23P01` is translated to a
 * second 409 that cannot name the dates — RLS suppresses a constraint
 * violation's DETAIL. The two sentences differ on purpose: the pre-read's is
 * asserted by the integration suite, the backstop's by the unit test of
 * `translateCalcParameterWriteError` (a race cannot be staged in a suite).
 *
 * **`key`, `organizationId` and the scope are immutable on PATCH** (design
 * decision 12): the update body has no such field. A re-scope is delete +
 * create. Delete is a hard `DELETE` with an audit row (ruling Q10).
 */
@Injectable()
export class CalcParametersAdminService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    // `CalcModule` exports it; the vocabulary read is its `listKeys`.
    private readonly vocabulary: CalcParametersService,
  ) {}

  /** The active vocabulary, in `sort_order, code` order. Any master-data user. */
  async listKeys(jwt: JwtPayload): Promise<CalcParameterKeysListResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    const rows = await this.vocabulary.listKeys();
    // `listKeys` reads `WHERE active`, so every row here is active by construction.
    return { items: rows.map((row) => ({ ...row, active: true })) };
  }

  /** One organization's rows, optionally one key, ordered `key, effective_from`. */
  async list(jwt: JwtPayload, query: ListCalcParametersQuery): Promise<CalcParametersListResponse> {
    await this.requireReadable(jwt, query.organizationId);
    const conditions = [eq(calcParameters.organizationId, query.organizationId)];
    if (query.key !== undefined) {
      conditions.push(eq(calcParameters.key, query.key));
    }
    const rows = await this.selectRows()
      .where(and(...conditions))
      .orderBy(asc(calcParameters.key), asc(calcParameters.effectiveFrom));
    return { items: rows.map((row) => this.toDto(row)) };
  }

  /** One row — 404 when it does not exist or sits in an organization the caller cannot read. */
  async getById(jwt: JwtPayload, id: string): Promise<CalcParameterDto> {
    return this.fetchReadable(jwt, id);
  }

  /**
   * Creates a row at the body's scope: write gate by that scope, parents
   * pre-validated, the key checked against the vocabulary, then the overlap
   * pre-read, the insert and the audit row in one tenant transaction.
   */
  async create(jwt: JwtPayload, body: CreateCalcParameterBody): Promise<CalcParameterDto> {
    const scope: Scope = {
      organizationId: body.organizationId,
      locationId: body.locationId ?? null,
      assetId: body.assetId ?? null,
    };
    await this.requireWritable(jwt, scope);
    await this.assertScopeParentsBelong(scope);
    await this.assertKeyInVocabulary(body.key);
    const window = this.windowOf(new Date(body.effectiveFrom), body.effectiveTo == null ? null : new Date(body.effectiveTo));

    const id = await this.translating(scope, () =>
      withTenant(this.db, scope.organizationId, async (tx) => {
        await this.refuseOverlap(tx, body.key, scope, window, null);
        const [written] = await tx
          .insert(calcParameters)
          .values({
            organizationId: scope.organizationId,
            key: body.key,
            locationId: scope.locationId,
            assetId: scope.assetId,
            value: body.value,
            effectiveFrom: window.from,
            effectiveTo: window.to,
          })
          .returning({ id: calcParameters.id });
        if (!written) {
          throw new Error("create: the insert returned no row");
        }
        await this.audit.write(
          {
            actor: jwt,
            action: "master.calc_parameter.create",
            entityType: "calc_parameter",
            entityId: written.id,
            organizationId: scope.organizationId,
            payload: body,
          },
          tx,
        );
        return written.id;
      }),
    );
    return this.fetchRow(id);
  }

  /**
   * Edits value and validity only (key and scope are immutable, design
   * decision 12); the stored end stands for an end the body does not name.
   */
  async update(jwt: JwtPayload, id: string, body: UpdateCalcParameterBody): Promise<CalcParameterDto> {
    const existing = await this.fetchReadable(jwt, id);
    const scope: Scope = {
      organizationId: existing.organizationId,
      locationId: existing.locationId,
      assetId: existing.assetId,
    };
    await this.requireWritable(jwt, scope);
    // The stored end stands for any end the body does not name; the pair is
    // then held here as well as by `calc_parameters_validity_check`.
    const window = this.windowOf(
      body.effectiveFrom === undefined ? new Date(existing.effectiveFrom) : new Date(body.effectiveFrom),
      body.effectiveTo === undefined
        ? existing.effectiveTo === null
          ? null
          : new Date(existing.effectiveTo)
        : body.effectiveTo === null
          ? null
          : new Date(body.effectiveTo),
    );

    await this.translating(scope, () =>
      withTenant(this.db, scope.organizationId, async (tx) => {
        await this.refuseOverlap(tx, existing.key, scope, window, id);
        // `.returning()` so a row the policy hides from this organization's
        // GUC — reachable only through a superuser-written row whose parents
        // disagree with its organization — is a 404, never a silent no-op
        // with an audit row saying it happened (`dashboards.service.ts`'s shape).
        const updated = await tx
          .update(calcParameters)
          .set({
            ...(body.value === undefined ? {} : { value: body.value }),
            effectiveFrom: window.from,
            effectiveTo: window.to,
            updatedAt: new Date(),
          })
          .where(eq(calcParameters.id, id))
          .returning({ id: calcParameters.id });
        if (updated.length === 0) {
          throw new NotFoundException(NOT_FOUND);
        }
        await this.audit.write(
          {
            actor: jwt,
            action: "master.calc_parameter.update",
            entityType: "calc_parameter",
            entityId: id,
            organizationId: scope.organizationId,
            payload: { key: existing.key, ...body },
          },
          tx,
        );
      }),
    );
    return this.fetchRow(id);
  }

  /** A hard delete with an audit row (ruling Q10); ending validity is an edit of `effectiveTo`. */
  async remove(jwt: JwtPayload, id: string): Promise<void> {
    const existing = await this.fetchReadable(jwt, id);
    const scope: Scope = {
      organizationId: existing.organizationId,
      locationId: existing.locationId,
      assetId: existing.assetId,
    };
    await this.requireWritable(jwt, scope);
    await withTenant(this.db, scope.organizationId, async (tx) => {
      const deleted = await tx.delete(calcParameters).where(eq(calcParameters.id, id)).returning({ id: calcParameters.id });
      if (deleted.length === 0) {
        throw new NotFoundException(NOT_FOUND);
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.calc_parameter.delete",
          entityType: "calc_parameter",
          entityId: id,
          organizationId: scope.organizationId,
          payload: {
            key: existing.key,
            locationId: existing.locationId,
            assetId: existing.assetId,
            value: existing.value,
            effectiveFrom: existing.effectiveFrom,
            effectiveTo: existing.effectiveTo,
          },
        },
        tx,
      );
    });
  }

  // ---- gates -----------------------------------------------------------------

  private async requireReadable(jwt: JwtPayload, organizationId: string): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    const readable = await this.accessControl.readableOrganizationIds(jwt);
    if (readable !== null && !readable.includes(organizationId)) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
  }

  private async requireWritable(jwt: JwtPayload, scope: Scope): Promise<void> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (scope.assetId !== null) {
      if (!(await this.accessControl.canManageAsset(jwt, scope.assetId))) {
        throw new ForbiddenException("Asset is outside your access scope");
      }
      return;
    }
    if (scope.locationId !== null) {
      if (!(await this.accessControl.canManageLocation(jwt, scope.locationId))) {
        throw new ForbiddenException("Location is outside your access scope");
      }
      return;
    }
    if (user.role === "location_admin") {
      throw new ForbiddenException(
        "A value at the organization scope requires the admin or organization_admin role; " +
          "a location admin sets values at the location or asset scope",
      );
    }
    if (!(await this.accessControl.canManageOrganization(jwt, scope.organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
  }

  /**
   * A `locationId` / `assetId` must belong to `organizationId` — a 400 with a
   * sentence, ahead of the policy's `WITH CHECK` (which `translating` maps to
   * the same 400 should a race reach it). One sentence for "not yours" and
   * "does not exist", so an id from another tenant is not confirmed as real.
   */
  private async assertScopeParentsBelong(scope: Scope): Promise<void> {
    if (scope.locationId !== null) {
      const [row] = await this.fleetDb
        .select({ organizationId: locations.organizationId })
        .from(locations)
        .where(eq(locations.id, scope.locationId))
        .limit(1);
      if (row?.organizationId !== scope.organizationId) {
        throw new BadRequestException(
          `The locationId you supplied does not belong to organization ${scope.organizationId}, or does not exist.`,
        );
      }
    }
    if (scope.assetId !== null) {
      const [row] = await this.fleetDb
        .select({ organizationId: assets.organizationId })
        .from(assets)
        .where(eq(assets.id, scope.assetId))
        .limit(1);
      if (row?.organizationId !== scope.organizationId) {
        throw new BadRequestException(
          `The assetId you supplied does not belong to organization ${scope.organizationId}, or does not exist.`,
        );
      }
    }
  }

  private windowOf(from: Date, to: Date | null): Window {
    if (Number.isNaN(from.getTime()) || (to !== null && Number.isNaN(to.getTime()))) {
      throw new BadRequestException("effectiveFrom and effectiveTo must be ISO 8601 instants");
    }
    if (to !== null && to.getTime() <= from.getTime()) {
      throw new BadRequestException("effectiveTo must be later than effectiveFrom");
    }
    return { from, to };
  }

  /**
   * The author-facing overlap refusal, inside the write transaction. `FOR
   * SHARE` holds the clashing row until this transaction ends; the `EXCLUDE`
   * constraint holds the window this read cannot see.
   *
   * The bounds cross as ISO strings, not `Date`s: through a raw `sql` param
   * `pg` serialises a `Date` in the process's local zone with an hh:mm offset,
   * which is wrong by the seconds of a pre-1906 local-mean-time offset. The
   * insert below is safe either way — drizzle's `timestamp` column maps a
   * `Date` with `toISOString()` — but this predicate must match it exactly.
   */
  private async refuseOverlap(tx: BmsTx, key: string, scope: Scope, window: Window, excludeId: string | null): Promise<void> {
    const result = await tx.execute<{ effective_from: Date | string; effective_to: Date | string | null }>(
      sql`SELECT effective_from, effective_to
            FROM bms.calc_parameters
           WHERE organization_id = ${scope.organizationId}
             AND key = ${key}
             AND location_id IS NOT DISTINCT FROM ${scope.locationId}::uuid
             AND asset_id IS NOT DISTINCT FROM ${scope.assetId}::uuid
             AND tstzrange(effective_from, effective_to, '[)')
                 && tstzrange(${window.from.toISOString()}::timestamptz, ${window.to === null ? null : window.to.toISOString()}::timestamptz, '[)')
             ${excludeId === null ? sql`` : sql`AND id <> ${excludeId}::uuid`}
           ORDER BY effective_from
           LIMIT 1
           FOR SHARE`,
    );
    const clash = result.rows[0];
    if (clash) {
      const from = new Date(clash.effective_from).toISOString();
      const to = clash.effective_to === null ? "open" : new Date(clash.effective_to).toISOString();
      throw new ConflictException(
        `A value for ${key} at this scope already covers ${from} – ${to}. End that row first, or choose dates outside it.`,
      );
    }
  }

  /**
   * The database refusals a write can still meet after the gates: the
   * `EXCLUDE` backstop under a race (`23P01`), the policy's `WITH CHECK`
   * (`42501`), the validity `CHECK` and the two foreign keys. None may reach
   * a caller as a 500. The mapping is `translateCalcParameterWriteError`, a
   * pure function, so each branch is unit-tested against a synthetic driver
   * error — a genuine race cannot be staged in an integration test.
   */
  private async translating<T>(scope: Scope, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw translateCalcParameterWriteError(err, scope.organizationId);
    }
  }

  /**
   * ADR 0070 decision 2: a key must be in the active vocabulary. Checked here
   * with a sentence, ahead of `calc_parameters_key_fkey` (which a retired key
   * — `active = false` — would pass) and the same read the template save path
   * makes (`CalcParametersService.unknownKeys`).
   */
  private async assertKeyInVocabulary(key: string): Promise<void> {
    const unknown = await this.vocabulary.unknownKeys([key]);
    if (unknown.length > 0) {
      throw new BadRequestException(
        `"${key}" is not in the active calc parameter vocabulary. Choose a key from GET /admin/calc-parameters/keys.`,
      );
    }
  }

  // ---- reads -----------------------------------------------------------------

  private selectRows() {
    return this.fleetDb
      .select({
        row: calcParameters,
        locationName: locations.name,
        assetCode: assets.code,
      })
      .from(calcParameters)
      .leftJoin(locations, eq(calcParameters.locationId, locations.id))
      .leftJoin(assets, eq(calcParameters.assetId, assets.id));
  }

  /**
   * The row, or 404 — also 404 when it exists in an organization the caller
   * cannot read, so an id from another tenant is never confirmed as real
   * (the `assertScopeParentsBelong` principle, applied to the read side).
   * `requireMasterDataUser` runs first, so a non-admin learns nothing either
   * way. Inside the caller's organizations a write the role may not make is
   * still a 403 from `requireWritable`: readable, not writable.
   */
  private async fetchReadable(jwt: JwtPayload, id: string): Promise<CalcParameterDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const row = await this.fetchRow(id);
    const readable = await this.accessControl.readableOrganizationIds(jwt);
    if (readable !== null && !readable.includes(row.organizationId)) {
      throw new NotFoundException(NOT_FOUND);
    }
    return row;
  }

  private async fetchRow(id: string): Promise<CalcParameterDto> {
    const [row] = await this.selectRows().where(eq(calcParameters.id, id)).limit(1);
    if (!row) {
      throw new NotFoundException(NOT_FOUND);
    }
    return this.toDto(row);
  }

  private toDto(joined: {
    row: typeof calcParameters.$inferSelect;
    locationName: string | null;
    assetCode: string | null;
  }): CalcParameterDto {
    const { row } = joined;
    return {
      id: row.id,
      organizationId: row.organizationId,
      key: row.key,
      locationId: row.locationId,
      assetId: row.assetId,
      locationName: joined.locationName,
      assetCode: joined.assetCode,
      value: row.value,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo === null ? null : row.effectiveTo.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
