import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, count, eq, or } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import { assetImages, assets, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { assetImageContentTypeSchema, MAX_ASSET_IMAGE_BYTES, MAX_ASSET_IMAGES_PER_ASSET } from "@bms/shared";
import type { AssetImageDto, JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import { buildObjectKey } from "../storage/object-key";
import { deleteObject, putObject } from "../storage/storage-client";
import type { StorageClient } from "../storage/storage-client";
import { STORAGE_CLIENT } from "../storage/storage.tokens";
import { toAssetImageDto } from "./asset-images.service";
import { sniffImageContentType } from "./image-signature";
import { requireStorageConfigured } from "./require-storage";

/** What the controller hands `upload` after multer buffered the part and the field parses ran (Unit 4). */
export type AssetImageUploadInput = {
  readonly buffer: Buffer;
  /** multer's `mimetype` — client text, checked against the allowlist and never echoed. */
  readonly declaredType: string;
  readonly originalFilename: string;
  readonly caption: string | null;
};

/**
 * `F3.4` (ADR 0066 decisions 4, 7, 11; Amendment 3 R-1..R-6) — the write
 * half of asset images: put the object, then insert the row; delete the
 * row, commit, then delete the object.
 *
 * **The gate is not here.** `AccessControlService.canManageAsset` runs in
 * `AssetImagesWriteController` before any read (the `asset-images.
 * controller.ts` rule); this service assumes the caller may write this
 * asset and adds only the storage and tenant rules below.
 *
 * **R-1 — sniff, and require agreement.** The declared multer `mimetype` is
 * parsed through `assetImageContentTypeSchema` (400 "Only JPEG, PNG or WebP
 * images are accepted" — the declared string is client text and is not
 * echoed); a `null` sniff is 400 "The file is not a JPEG, PNG or WebP
 * image"; sniff ≠ declared is 400 "The file's content does not match its
 * declared type". The **sniffed** type is stored: decision 7 makes the
 * vocabulary a security allowlist, and an allowlist checked against a
 * client-supplied label is not checked.
 *
 * **R-2 — put the object first, then the row.** Decision 4 makes the orphan
 * object the tolerable failure ("costs storage and serves nothing") and the
 * object-less row the bad one (a 404 that lies, a warn on every read);
 * decision 11 already accepts orphans. The tenant transaction never holds a
 * connection across an S3 call (the F3.3 read-path rule). On any failure
 * after `putObject`, `deleteObject` runs best-effort; a failed cleanup is
 * one `warn` naming the image id and `err.name`.
 *
 * **R-3 — the cap, checked twice.** `MAX_ASSET_IMAGES_PER_ASSET` is a state
 * of the resource, so exceeding it is 409, not 400. A cheap fleet-pool
 * pre-check refuses before the put (the common refusal costs no upload);
 * the authoritative count runs inside the tenant transaction after
 * `SELECT … FOR UPDATE` on the asset row, which serialises concurrent
 * uploads for one asset. Both compare fail-closed: `!(n < cap)`, so a
 * non-numeric count refuses rather than admits.
 *
 * **R-4 — `sha256` and `byte_size` are computed from the buffer.** No
 * `size` or `Content-Length` header is read. An empty buffer is 400; a
 * buffer over `MAX_ASSET_IMAGE_BYTES` is 413 here as well as at multer —
 * each parser keeps its own byte cap (the F4.102 rule).
 *
 * **R-5 — Amendment 2 L-1 re-check: not needed here, and this is why.** L-1
 * asks a *grant-write* endpoint to re-check a location's organization
 * before inserting into `user_location_access`. F3.4 writes `asset_images`,
 * never a grant. Its tenant GUC and the row's `organization_id` both come
 * from **the asset's own row** (`assets.organization_id`, NOT NULL), so
 * even under a cross-organization grant the row is stamped consistently
 * with its parent and `0072`'s `WITH CHECK` holds; the exposure L-1 names
 * is the same one every existing asset write carries through
 * `canManageAsset`, and it is the grant data's, not this row's.
 *
 * **R-6 — the RLS path for the insert.** `withTenant(tenantDb,
 * assetOrganizationId, tx => …)` with the org resolved from `bms.assets` on
 * `fleetDb` (the `resolveAssetOrg` shape, a private copy — §9 rule 9: new
 * code gets the helper, the old file is not refactored). Inside: `FOR
 * UPDATE` on the asset (404 if it vanished), count, insert with
 * `organizationId: assetOrganizationId`, `audit.write({…, organizationId},
 * tx)`. The integration spec proves the negative: the same insert stamped
 * with organization B under GUC A is `42501`. `bms_fleet` is BYPASSRLS, so
 * the insert must never run on `fleetDb`; the constructor order (tenant,
 * fleet, …) is pinned in `database/fleet-read-wiring.spec.ts`.
 *
 * **`remove` — row, commit, then object (decision 11).** The row is deleted
 * and audited inside the tenant transaction (0 rows → 404, rolled back);
 * the object is deleted **after** the commit, so a bucket that is down
 * leaves a row-less orphan (tolerated, one `warn`) and never a rowed
 * object-less image (the 404 that lies). The method resolves either way.
 *
 * **§9.6.** No key, no filename, no caption and no endpoint in any log line
 * or thrown message. Every warn names the image id and `err.name` — never
 * `err.message`, which an SDK error may stuff with the key. The audit
 * payload carries ids, a code and numbers only.
 */
@Injectable()
export class AssetImagesWriteService {
  private readonly logger = new Logger(AssetImagesWriteService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(STORAGE_CLIENT) private readonly client: StorageClient,
    private readonly audit: MasterDataAuditService,
  ) {}

  async upload(jwt: JwtPayload, assetId: string, input: AssetImageUploadInput): Promise<AssetImageDto> {
    requireStorageConfigured(this.client);

    // R-1: the allowlist first, on the label; the label is never echoed.
    if (!assetImageContentTypeSchema.safeParse(input.declaredType).success) {
      throw new BadRequestException("Only JPEG, PNG or WebP images are accepted");
    }
    // R-4: the buffer is the only size authority.
    if (input.buffer.length === 0) {
      throw new BadRequestException("Image file is required");
    }
    if (input.buffer.length > MAX_ASSET_IMAGE_BYTES) {
      throw new PayloadTooLargeException(`Image exceeds the ${MAX_ASSET_IMAGE_BYTES}-byte limit`);
    }
    // R-1: the bytes decide; the label must agree with them.
    const contentType = sniffImageContentType(input.buffer);
    if (contentType === null) {
      throw new BadRequestException("The file is not a JPEG, PNG or WebP image");
    }
    if (contentType !== input.declaredType) {
      throw new BadRequestException("The file's content does not match its declared type");
    }
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    const byteSize = input.buffer.length;

    const organizationId = await this.resolveAssetOrg(assetId);
    // R-3: the cheap refusal, before any byte is uploaded.
    this.refuseAtCap(await countImages(this.fleetDb, assetId));
    const createdBy = await this.resolveActorId(jwt);

    const imageId = randomUUID();
    const key = buildObjectKey({ organizationId, assetId, imageId });

    // R-2: the object first, outside any transaction.
    try {
      await putObject(this.client, key, input.buffer, contentType);
    } catch (err) {
      this.logger.warn(
        `asset image ${imageId}: object storage write failed with ${errorName(err)} (ADR 0066 Amendment 1 Q-F)`,
      );
      throw new ServiceUnavailableException("Object storage is unreachable");
    }

    let row: Awaited<ReturnType<typeof insertRow>>;
    try {
      row = await withTenant(this.tenantDb, organizationId, async (tx) => {
        // R-3/R-6: FOR UPDATE serialises uploads for one asset; the row is
        // visible under the GUC, so a miss means the asset vanished.
        const [asset] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).for("update");
        if (!asset) {
          throw new NotFoundException("Asset not found");
        }
        this.refuseAtCap(await countImages(tx, assetId));
        const inserted = await insertRow(tx, {
          id: imageId,
          organizationId,
          assetId,
          objectKey: key,
          contentType,
          byteSize,
          sha256,
          originalFilename: input.originalFilename,
          caption: input.caption,
          createdBy,
        });
        await this.audit.write(
          {
            actor: jwt,
            action: "master.asset_image.create",
            entityType: "asset_image",
            entityId: imageId,
            organizationId,
            payload: { assetId, imageId, contentType, byteSize, sha256 },
          },
          tx,
        );
        return inserted;
      });
    } catch (err) {
      // R-2: best-effort cleanup of the object the failed row would have served.
      await this.discardObject(imageId, key);
      throw err;
    }
    return toAssetImageDto(row);
  }

  async remove(jwt: JwtPayload, assetId: string, imageId: string): Promise<void> {
    requireStorageConfigured(this.client);
    const organizationId = await this.resolveAssetOrg(assetId);

    const objectKey = await withTenant(this.tenantDb, organizationId, async (tx) => {
      const [deleted] = await tx
        .delete(assetImages)
        .where(and(eq(assetImages.id, imageId), eq(assetImages.assetId, assetId)))
        .returning({ objectKey: assetImages.objectKey });
      if (!deleted) {
        throw new NotFoundException("Asset image not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_image.delete",
          entityType: "asset_image",
          entityId: imageId,
          organizationId,
          payload: { assetId, imageId },
        },
        tx,
      );
      return deleted.objectKey;
    });

    // Decision 11: after the commit, and the method resolves either way.
    try {
      await deleteObject(this.client, objectKey);
    } catch (err) {
      this.logger.warn(
        `asset image ${imageId}: object delete failed after the row was removed (${errorName(err)}); an orphan object remains (ADR 0066 decision 11)`,
      );
    }
  }

  /** R-3: 409 at or over the cap; `!(n < cap)` so a non-numeric count refuses rather than admits. */
  private refuseAtCap(current: number): void {
    if (!(current < MAX_ASSET_IMAGES_PER_ASSET)) {
      throw new ConflictException(
        `This asset already has ${MAX_ASSET_IMAGES_PER_ASSET} images; delete one before uploading another`,
      );
    }
  }

  /** R-2: cleanup after a failed row; a failure here is one warn (image id and `err.name`), never a throw. */
  private async discardObject(imageId: string, key: string): Promise<void> {
    try {
      await deleteObject(this.client, key);
    } catch (err) {
      this.logger.warn(
        `asset image ${imageId}: cleanup of the object after a failed row write failed with ${errorName(err)}; an orphan object remains (ADR 0066 decision 11)`,
      );
    }
  }

  /**
   * The asset's own organization, read on `fleetDb` before the tenant
   * context opens (the `AssetsAdminService.resolveAssetOrg` shape). The
   * caller has already passed `canManageAsset`. A null column would only
   * survive from a pre-0046 row; it is unresolvable, not a `withTenant(null)`.
   */
  private async resolveAssetOrg(assetId: string): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: assets.organizationId })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset not found");
    }
    if (!row.organizationId) {
      throw new BadRequestException("Asset has no organization; run the 0046 backfill");
    }
    return row.organizationId;
  }

  /** `created_by`: the `bms.users.id` the way `MasterDataAuditService.write` resolves its actor — on the fleet pool, `null` when absent. */
  private async resolveActorId(jwt: JwtPayload): Promise<string | null> {
    const [row] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);
    return row?.id ?? null;
  }
}

/** The per-asset count on whichever executor the caller is on (fleet pre-check, or the tenant transaction). */
async function countImages(db: BmsDb | BmsTx, assetId: string): Promise<number> {
  const [row] = await db.select({ count: count() }).from(assetImages).where(eq(assetImages.assetId, assetId));
  return Number(row?.count);
}

async function insertRow(tx: BmsTx, values: typeof assetImages.$inferInsert) {
  const [inserted] = await tx.insert(assetImages).values(values).returning();
  if (!inserted) {
    throw new Error("asset image insert returned no row");
  }
  return inserted;
}

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : "Error";
}
