import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, arrayContained, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import { locations, organizations, reportFiles, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { reportFileDtoSchema, reportTemplateIdSchema } from "@bms/shared";
import type { JwtPayload, ReportFileDto, ReportFileFormat } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { requireStorageConfigured } from "../assets/require-storage";
import { parseStoredContract } from "../common/parse-stored-contract";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import { withOrganizationReadScope } from "../database/tenant-read-scope";
import { buildReportObjectKey } from "../storage/object-key";
import { deleteObject, getObject, putObject } from "../storage/storage-client";
import type { StorageClient } from "../storage/storage-client";
import { STORAGE_CLIENT } from "../storage/storage.tokens";
import type { ReportFilesConfig } from "./report-files-config";
import { REPORT_FILES_CONFIG } from "./report-files.tokens";
import { ReportsService } from "./reports.service";

/** What the controller hands `saveOnDemand` after the body parse ran (U8's `saveEnergyReportFileBodySchema`). */
export type SaveEnergyReportFileBody = {
  readonly startDate: string;
  readonly endDate: string;
  readonly format: ReportFileFormat;
  /** ADR 0071 Amendment 1 item 1 — required for a global admin and for an admin holding several organizations. */
  readonly organizationId?: string;
};

/** The one sentence a covered role gets for a file its scope does not cover (ADR 0071 Amendment 1 item 3). */
export const OUT_OF_SCOPE_SENTENCE = "Report file is outside your access scope";

const CONTENT_TYPES: Record<ReportFileFormat, ReportFileDto["contentType"]> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * `F3.5a` (ADR 0071 decisions 4, 5, 6, 11; Amendment 1 items 1–3) — the
 * stored report files: render, object then row under the tenant GUC, the
 * scoped list, the proxied read and the row-then-object delete.
 *
 * **`saveOnDemand`, in this order.** `requireStorageConfigured` (503,
 * before any read — decision 5's "the file routes answer 503") →
 * `writableLocationIds(jwt)` (`assertMasterDataRole` refuses
 * `asset_group_admin`, `operator` and `viewer` with its own sentence before
 * any read — decision 6's `wc-hvac-admin` case) → the target organization
 * (Amendment 1 item 1: `writableOrganizationIds` `null` → the body id is
 * required and must name an existing organization, 404 otherwise; one id →
 * that id, a differing body id is 403; several → the body
 * id is required and must be one of them; zero → 403) → the `location_ids`
 * stamp (item 2, see below) → the cheap cap pre-check on `fleetDb` (409,
 * before the render and before any storage call) →
 * `readableAssetIdsInOrganization` → the render → `sha256` and `byteSize`
 * from the rendered `Buffer`, never from a header (the F3.4 R-4 point) →
 * `putObject` → the tenant transaction (the advisory lock, the authoritative
 * count, the insert, the `report_file.create` audit row) → on any throw
 * after the put, `discardObjectUnlessTheRowCommitted`.
 *
 * **The stamp's role comes from the database, not from the token.** Item 2
 * says `admin` and `organization_admin` stamp `{}` and a `location_admin`
 * stamps `writableLocationIds ∩ locations.organization_id = org`, but
 * `writableLocationIds` answers `string[]` for both non-global roles, so its
 * output cannot tell them apart — and `jwt.role` is not consulted anywhere
 * in this API because a token outlives a demotion (`audit.service.ts`).
 * The discriminator is `reportFileReadScope(jwt)`'s `kind`, resolved from
 * `bms.users`: `global` and `organization` stamp `{}`; `location`
 * intersects, and an empty intersection is 403.
 *
 * **The cap, checked twice, fail-closed (R-11).** The pre-check on `fleetDb`
 * refuses the common case before a render costs anything; the authoritative
 * count runs inside the tenant transaction under
 * `pg_advisory_xact_lock(hashtextextended('report_files:' || org, 0))` —
 * there is no parent row to `FOR UPDATE`, unlike F3.4's asset. Both compare
 * `!(n < cap)`, so a non-numeric count refuses rather than admits. Until
 * `0078` lands the count is every row of the organization.
 *
 * **Object first, then the row (decision 5, the F3.4 R-2 shape).** The
 * tenant transaction never holds a connection across an S3 call. A failed
 * `putObject` is one `warn` naming the file id and `err.name`, then 503. A
 * failure after the put runs `discardObjectUnlessTheRowCommitted` — a
 * private copy of F3.4's helper parameterised on `reportFiles` (R-12: the
 * F3.51 extraction precedent is narrow, and §9 rule 9 forbids lifting the
 * original in this row): it re-reads the row on `fleetDb` and keeps the
 * object when the row cannot be proved absent, because a live row whose
 * object is gone is decision 4's bad state and the orphan is the tolerable
 * one.
 *
 * **`list` (R-7).** `reportFileReadScope` names the organizations and, for a
 * location admin, the location set; `withOrganizationReadScope` routes a
 * single organization to a tenant transaction (the `0077` `FORCE` policy
 * scopes it) and several or all to `fleetDb` with the organization filter.
 * The location predicate `cardinality(location_ids) > 0 AND location_ids
 * <@ $writable` applies for the `location` kind **on both branches** — a
 * one-organization location admin runs on the tenant branch with a `null`
 * filter and must still not see the organization admin's `{}` file.
 *
 * **`download` and `remove` (decision 6, item 3).** The row is read on
 * `fleetDb` by id (404), then `canReadReportFile` decides (403 with
 * `OUT_OF_SCOPE_SENTENCE` for a covered role; the master-data sentence for
 * the others, thrown from inside that method). The DTO is parsed **before**
 * `getObject` (the F3.3 order: a row that cannot be served never opens a
 * socket); a missing object or a `contentLength` that differs from the row's
 * `byte_size` is a 404 after `body.destroy()` — the row is the authority
 * (decision 4). `remove` deletes and audits the row under the tenant GUC,
 * commits, then deletes the object best-effort: a bucket that is down leaves
 * a row-less orphan (tolerated, one `warn`, ADR 0066 decision 11) and never a
 * rowed object-less file.
 *
 * **§9.6.** No key, no filename and no endpoint in any log line or thrown
 * message; every warn names the file id, and every warn with an error to
 * describe names `err.name`, never `err.message`. The audit payloads carry
 * ids, a code and numbers only (R-9). The constructor order (tenant, fleet,
 * …) is pinned in `database/fleet-read-wiring.spec.ts`.
 */
@Injectable()
export class ReportFilesService {
  private readonly logger = new Logger(ReportFilesService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(STORAGE_CLIENT) private readonly client: StorageClient,
    @Inject(REPORT_FILES_CONFIG) private readonly config: ReportFilesConfig,
    private readonly reports: ReportsService,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  async saveOnDemand(jwt: JwtPayload, body: SaveEnergyReportFileBody): Promise<ReportFileDto> {
    requireStorageConfigured(this.client);

    // Decision 6: the role gate, before any other read.
    const writableLocations = await this.accessControl.writableLocationIds(jwt);
    const organizationId = await this.resolveOrganization(jwt, body.organizationId);
    const locationIds = await this.resolveLocationStamp(jwt, organizationId, writableLocations);

    // R-11: the cheap refusal, before the render and before any storage call.
    this.refuseAtCap(await countFiles(this.fleetDb, organizationId));

    // Amendment 1 item 1: the render never carries another organization's rows.
    const assetIds = await this.accessControl.readableAssetIdsInOrganization(jwt, organizationId);
    const query = { startDate: body.startDate, endDate: body.endDate };
    const buffer =
      body.format === "pdf"
        ? await this.reports.energyPdf(query, assetIds)
        : await this.reports.energyXlsx(query, assetIds);

    // R-3: the buffer is the only size and hash authority.
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const byteSize = buffer.length;
    const filename = `energy-consumption-${body.startDate}-to-${body.endDate}.${body.format}`;
    const contentType = CONTENT_TYPES[body.format];
    const createdBy = await this.resolveActorId(jwt);

    const fileId = randomUUID();
    const key = buildReportObjectKey({ organizationId, fileId });

    // Decision 5: the object first, outside any transaction.
    try {
      await putObject(this.client, key, buffer, contentType);
    } catch (err) {
      this.logger.warn(`report file ${fileId}: object storage write failed with ${errorName(err)} (ADR 0071 decision 5)`);
      throw new ServiceUnavailableException("Object storage is unreachable");
    }

    let row: StoredRow;
    try {
      row = await withTenant(this.tenantDb, organizationId, async (tx) => {
        // R-11: serialise concurrent saves for one organization; no parent row to lock.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`report_files:${organizationId}`}, 0))`,
        );
        this.refuseAtCap(await countFiles(tx, organizationId));
        const inserted = await insertRow(tx, {
          id: fileId,
          organizationId,
          templateId: reportTemplateIdSchema.value,
          format: body.format,
          periodStart: body.startDate,
          periodEnd: body.endDate,
          locationIds,
          objectKey: key,
          contentType,
          byteSize,
          sha256,
          filename,
          deliveryStatus: "none",
          deliveryError: null,
          createdBy,
        });
        await this.audit.write(
          {
            actor: jwt,
            action: "report_file.create",
            entityType: "report_file",
            entityId: fileId,
            organizationId,
            payload: {
              fileId,
              organizationId,
              format: body.format,
              byteSize,
              sha256,
              periodStart: body.startDate,
              periodEnd: body.endDate,
            },
          },
          tx,
        );
        return inserted;
      });
    } catch (err) {
      // R-12: cleanup of the object the failed row would have served — only
      // after the row is proved absent.
      await this.discardObjectUnlessTheRowCommitted(fileId, key);
      throw err;
    }
    return toReportFileDto(row);
  }

  async list(jwt: JwtPayload, limit: number): Promise<ReportFileDto[]> {
    requireStorageConfigured(this.client);
    const scope = await this.accessControl.reportFileReadScope(jwt);
    const organizationIds = scope.kind === "global" ? null : scope.organizationIds;
    const locationPredicate: SQL | undefined =
      scope.kind === "location"
        ? and(
            sql`cardinality(${reportFiles.locationIds}) > 0`,
            arrayContained(reportFiles.locationIds, scope.locationIds),
          )
        : undefined;
    const rows = await withOrganizationReadScope(
      this.tenantDb,
      this.fleetDb,
      organizationIds,
      () => [] as StoredRow[],
      (tx, filter) =>
        selectRows(tx)
          .where(and(filter ? inArray(reportFiles.organizationId, filter) : undefined, locationPredicate))
          .orderBy(desc(reportFiles.createdAt), desc(reportFiles.id))
          .limit(limit),
    );
    return rows.map(toReportFileDto);
  }

  async download(jwt: JwtPayload, id: string): Promise<{ row: ReportFileDto; body: Readable }> {
    requireStorageConfigured(this.client);
    const row = await this.readRowForVerdict(jwt, id);
    // The contract parse runs BEFORE the bucket is asked (the F3.3 order).
    const dto = toReportFileDto(row);

    let object: Awaited<ReturnType<typeof getObject>>;
    try {
      object = await getObject(this.client, row.objectKey);
    } catch (err) {
      this.logger.warn(`report file ${id}: object storage read failed with ${errorName(err)} (ADR 0066 Amendment 1 Q-F)`);
      throw new ServiceUnavailableException("Object storage is unreachable");
    }
    if (object === null) {
      this.logger.warn(`report file ${id} has no object in the bucket (ADR 0071 decision 4)`);
      throw new NotFoundException("Report file not found");
    }
    if (object.contentLength !== null && object.contentLength !== row.byteSize) {
      // The socket behind the body is open; release it before refusing.
      object.body.destroy();
      this.logger.warn(
        `report file ${id}: the object's length ${object.contentLength} differs from the row's byteSize ${row.byteSize}; treated as missing (ADR 0071 decision 4)`,
      );
      throw new NotFoundException("Report file not found");
    }
    return { row: dto, body: object.body };
  }

  async remove(jwt: JwtPayload, id: string): Promise<void> {
    requireStorageConfigured(this.client);
    const row = await this.readRowForVerdict(jwt, id);

    const objectKey = await withTenant(this.tenantDb, row.organizationId, async (tx) => {
      const [deleted] = await tx
        .delete(reportFiles)
        .where(eq(reportFiles.id, id))
        .returning({ objectKey: reportFiles.objectKey });
      if (!deleted) {
        throw new NotFoundException("Report file not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "report_file.delete",
          entityType: "report_file",
          entityId: id,
          organizationId: row.organizationId,
          payload: { fileId: id, organizationId: row.organizationId },
        },
        tx,
      );
      return deleted.objectKey;
    });

    // ADR 0066 decision 11: after the commit, and the method resolves either way.
    try {
      await deleteObject(this.client, objectKey);
    } catch (err) {
      this.logger.warn(
        `report file ${id}: object delete failed after the row was removed (${errorName(err)}); an orphan object remains (ADR 0066 decision 11)`,
      );
    }
  }

  /** Amendment 1 item 1 — which organization the row belongs to, from the actor's own grants. */
  private async resolveOrganization(jwt: JwtPayload, requested: string | undefined): Promise<string> {
    const writable = await this.accessControl.writableOrganizationIds(jwt);
    if (writable === null) {
      if (requested === undefined) {
        throw new BadRequestException("organizationId is required for a global admin");
      }
      // The global admin's id comes from the body, not from a grant, so its
      // existence is checked here (fleet handle) — before the stamp, the cap
      // pre-check and any storage call. Without this a well-formed uuid naming
      // no organization reached `putObject` and then failed the FK: a 500 for
      // a caller error. The other branches validate against `writable`, which
      // came from real grants.
      const [organization] = await this.fleetDb
        .select({ organizationId: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, requested))
        .limit(1);
      if (!organization) {
        throw new NotFoundException("Organization not found");
      }
      return requested;
    }
    if (writable.length === 0) {
      throw new ForbiddenException("No organization scope to file the report under");
    }
    if (writable.length === 1) {
      const [only] = writable as [string];
      if (requested !== undefined && requested !== only) {
        throw new ForbiddenException("Report organization is outside your access scope");
      }
      return only;
    }
    if (requested === undefined) {
      throw new BadRequestException(
        `organizationId is required: you administer ${writable.length} organizations`,
      );
    }
    if (!writable.includes(requested)) {
      throw new ForbiddenException("Report organization is outside your access scope");
    }
    return requested;
  }

  /** Amendment 1 item 2 — `{}` for a global or organization admin; the intersection for a location admin. */
  private async resolveLocationStamp(
    jwt: JwtPayload,
    organizationId: string,
    writableLocations: string[] | null,
  ): Promise<string[]> {
    const scope = await this.accessControl.reportFileReadScope(jwt);
    if (scope.kind !== "location" || writableLocations === null) {
      return [];
    }
    // fleetDb: the organization's own locations; the id was resolved from the actor's grants.
    const rows = await this.fleetDb
      .select({ locationId: locations.id })
      .from(locations)
      .where(eq(locations.organizationId, organizationId));
    const inOrganization = new Set(rows.map((row) => row.locationId));
    const stamp = writableLocations.filter((id) => inOrganization.has(id));
    if (stamp.length === 0) {
      throw new ForbiddenException("No location scope in this organization to record for the report");
    }
    return stamp;
  }

  /** The fleet read by id (404), then the decision-6 verdict (403). Shared by `download` and `remove`. */
  private async readRowForVerdict(jwt: JwtPayload, id: string): Promise<StoredRow> {
    const [row] = await selectRows(this.fleetDb).where(eq(reportFiles.id, id)).limit(1);
    if (!row) {
      throw new NotFoundException("Report file not found");
    }
    const allowed = await this.accessControl.canReadReportFile(jwt, {
      organizationId: row.organizationId,
      locationIds: row.locationIds,
    });
    if (!allowed) {
      throw new ForbiddenException(OUT_OF_SCOPE_SENTENCE);
    }
    return row;
  }

  /** R-11: 409 at or over the cap; `!(n < cap)` so a non-numeric count refuses rather than admits. */
  private refuseAtCap(current: number): void {
    const cap = this.config.onDemandCap;
    if (!(current < cap)) {
      throw new ConflictException(
        `This organization already has ${cap} saved reports; delete one before saving another`,
      );
    }
  }

  /**
   * A private copy of `AssetImagesWriteService.discardObjectUnlessTheRowCommitted`
   * (F3.4, post-merge sweep C3) parameterised on `reportFiles` — R-12 says why
   * it is copied and not lifted. `withTenant` rejects on any failure of the
   * tenant transaction, and one of those failures is not a rollback: a
   * connection dropped between the server's `COMMIT` and the acknowledgement
   * leaves the row committed. Discarding then makes a live row whose object is
   * gone. So the row is re-read on `fleetDb` (the tenant connection is the one
   * that just failed); a present row, or a re-read that itself fails, keeps
   * the object. Never throws — the caller rethrows the original error.
   *
   * The projection is `fileId`, not `id`, so the spec's fleet fake can tell
   * this read from the others by its shape.
   */
  private async discardObjectUnlessTheRowCommitted(fileId: string, key: string): Promise<void> {
    let committed: boolean;
    try {
      const rows = await this.fleetDb
        .select({ fileId: reportFiles.id })
        .from(reportFiles)
        .where(eq(reportFiles.id, fileId))
        .limit(1);
      committed = rows.length > 0;
    } catch (err) {
      this.logger.warn(
        `report file ${fileId}: the committed-row re-check failed with ${errorName(err)}; the object is kept (ADR 0071 decision 4)`,
      );
      return;
    }
    if (committed) {
      this.logger.warn(
        `report file ${fileId}: the row committed but the transaction reported failure; the object is kept (ADR 0071 decision 4)`,
      );
      return;
    }
    try {
      await deleteObject(this.client, key);
    } catch (err) {
      this.logger.warn(
        `report file ${fileId}: cleanup of the object after a failed row write failed with ${errorName(err)}; an orphan object remains (ADR 0066 decision 11)`,
      );
    }
  }

  /** `created_by`: the `bms.users.id` the way `MasterDataAuditService.write` resolves its actor — on the fleet pool, `null` when absent. */
  private async resolveActorId(jwt: JwtPayload): Promise<string | null> {
    const [row] = await this.fleetDb
      .select({ actorId: users.id })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);
    return row?.actorId ?? null;
  }
}

/** The columns every read selects — the DTO's plus `objectKey`, which stays in this file. */
type StoredRow = {
  id: string;
  organizationId: string;
  templateId: string;
  format: string;
  periodStart: string;
  periodEnd: string;
  locationIds: string[];
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  filename: string;
  deliveryStatus: string;
  deliveryError: string | null;
  createdBy: string | null;
  createdAt: Date;
};

function selectRows(db: BmsDb | BmsTx) {
  return db
    .select({
      id: reportFiles.id,
      organizationId: reportFiles.organizationId,
      templateId: reportFiles.templateId,
      format: reportFiles.format,
      periodStart: reportFiles.periodStart,
      periodEnd: reportFiles.periodEnd,
      locationIds: reportFiles.locationIds,
      objectKey: reportFiles.objectKey,
      contentType: reportFiles.contentType,
      byteSize: reportFiles.byteSize,
      sha256: reportFiles.sha256,
      filename: reportFiles.filename,
      deliveryStatus: reportFiles.deliveryStatus,
      deliveryError: reportFiles.deliveryError,
      createdBy: reportFiles.createdBy,
      createdAt: reportFiles.createdAt,
    })
    .from(reportFiles);
}

/** The per-organization count on whichever executor the caller is on (fleet pre-check, or the tenant transaction). */
async function countFiles(db: BmsDb | BmsTx, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(reportFiles)
    .where(eq(reportFiles.organizationId, organizationId));
  return Number(row?.count);
}

async function insertRow(tx: BmsTx, values: typeof reportFiles.$inferInsert): Promise<StoredRow> {
  const [inserted] = await tx.insert(reportFiles).values(values).returning();
  if (!inserted) {
    throw new Error("report file insert returned no row");
  }
  return inserted;
}

/**
 * Picks the DTO's fields by name — never a spread, so `objectKey` cannot ride
 * along — and parses the whole assembled DTO through `reportFileDtoSchema`
 * via `parseStoredContract` (ADR 0060 ruling 2, `F4.108`): a stored row that
 * breaks its contract is the server's fault, a 500 with the context logged,
 * never the 400 a bare `.parse()` would hand the global `ZodErrorFilter`.
 * The one site `tests/f4.108-service-parses-are-guarded.test.ts` counts as
 * `reportFiles: 1`, called by `saveOnDemand`, `list` and `download` alike.
 */
export function toReportFileDto(row: StoredRow): ReportFileDto {
  const candidate = {
    id: row.id,
    organizationId: row.organizationId,
    templateId: row.templateId,
    format: row.format,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    locationIds: row.locationIds,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    filename: row.filename,
    deliveryStatus: row.deliveryStatus,
    deliveryError: row.deliveryError,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  } satisfies Record<keyof ReportFileDto, unknown>;
  return parseStoredContract(reportFileDtoSchema, candidate, "report_files.to_dto.row");
}

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : "Error";
}
