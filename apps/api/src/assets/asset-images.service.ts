import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { Readable } from "node:stream";

import { assetImages } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { assetImageContentTypeSchema } from "@bms/shared";
import type { AssetImageDto } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import type { BmsTx } from "../database/tenant-context";
import { withReadScope } from "../database/tenant-read-scope";
import { getObject } from "../storage/storage-client";
import type { StorageClient } from "../storage/storage-client";
import { STORAGE_CLIENT } from "../storage/storage.tokens";

/**
 * `F3.3` (ADR 0066 decisions 3, 4, 6; Amendment 1 Q-F) — the read half of
 * asset images: one asset's rows, and one row's bytes.
 *
 * **Storage first, then the pool.** Both methods ask `requireStorage()`
 * before any read: an unconfigured client answers 503 naming the variable
 * (decision 3, "two routes that answer 503") and never opens a transaction
 * for a list it cannot serve.
 *
 * **The read runs under the request's RLS — and the policy is not the
 * tenant-isolation gate here.** Both reads go through
 * `withReadScope(tenantDb, fleetDb, [assetId], …)`, which resolves the tenant
 * GUC **from the path asset** on the fleet pool and then runs the read inside
 * `withTenant` with that GUC set (a tenant read inside a transaction, never
 * on a bare connection — AGENTS.md §4.4). Because the GUC comes from the
 * asset and not from the caller, the `0072` `FORCE` policy scopes the read
 * to *that asset's* organization: it filters a row mis-stamped with another
 * organization (the integration spec's scoped-list rows), but it cannot
 * refuse a caller from organization B asking for organization A's asset —
 * for that request the GUC is A. The isolation gate is
 * `AccessControlService.canReadAsset` in the controller, which runs before
 * this service and is organization-bounded for every non-admin:
 * `readableAssetIds` walks `scopeForUser`'s grant sources
 * (`auth/access-control.service.ts`), and no source but the admin-only
 * `global` one reaches an asset outside the caller's organizations. That is
 * proved behaviourally by `auth/access-control.integration.spec.ts`:
 * `assertOrganizationScope` (the seeded `phe-admin@bms.local`,
 * `organization_admin` in PHEWB, sees none of the other organization's
 * assets in `scope.assetIds`, with the fixture-not-vacuous control) and
 * `assertLocationScope` (`canReadAsset` answers `false` for an asset
 * `readableAssetIds` excluded — the two paths agree). The constructor order
 * (tenant, fleet) is pinned by `database/fleet-read-wiring.spec.ts`:
 * `withReadScope` reads its pools positionally and a swap silently unscopes.
 *
 * **The row is the authority (decision 4).** `objectKey` is read and used
 * to address the bucket and appears in no DTO, no thrown message and no log
 * line. A row whose object is missing is a 404 with one `warn` naming the
 * **image id**; so is an object whose reported `contentLength` differs from
 * the row's `byte_size` — the controller sends `Content-Length` from the
 * row, and a body of another length under that header is a 200 that lies,
 * so the mismatch is treated as the missing-object case (warn names the
 * image id and both numbers; an unreported length is trusted). A transport
 * failure (MinIO down, configured) is a 503 "Object storage is unreachable"
 * with one `warn` naming the image id and `err.name` (Q-F) — never
 * `err.message`, which an SDK error may stuff with the key or the endpoint
 * (§9.6).
 *
 * `content` reads the row inside the transaction and fetches the object
 * **after** it commits, so a streaming body never holds a tenant
 * connection open.
 */
@Injectable()
export class AssetImagesService {
  private readonly logger = new Logger(AssetImagesService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(STORAGE_CLIENT) private readonly client: StorageClient,
  ) {}

  /** Decision 3: a 503 that names the variable, before any pool is touched. */
  private requireStorage(): void {
    if (this.client.kind === "unconfigured") {
      throw new ServiceUnavailableException(
        "Object storage is not configured: OBJECT_STORAGE_ENDPOINT is unset (ADR 0066 decision 3)",
      );
    }
  }

  async list(assetId: string): Promise<AssetImageDto[]> {
    this.requireStorage();
    const rows = await withReadScope(
      this.tenantDb,
      this.fleetDb,
      [assetId],
      () => [] as StoredRow[],
      (tx) => selectRows(tx, eq(assetImages.assetId, assetId)),
    );
    return rows.map(toDto);
  }

  async content(assetId: string, imageId: string): Promise<{ row: AssetImageDto; body: Readable }> {
    this.requireStorage();
    const [row] = await withReadScope(
      this.tenantDb,
      this.fleetDb,
      [assetId],
      () => [] as StoredRow[],
      (tx) => selectRows(tx, and(eq(assetImages.assetId, assetId), eq(assetImages.id, imageId))),
    );
    if (!row) {
      throw new NotFoundException("Asset image not found");
    }

    let object: Awaited<ReturnType<typeof getObject>>;
    try {
      object = await getObject(this.client, row.objectKey);
    } catch (err) {
      this.logger.warn(
        `asset image ${imageId}: object storage read failed with ${errorName(err)} (ADR 0066 Amendment 1 Q-F)`,
      );
      throw new ServiceUnavailableException("Object storage is unreachable");
    }
    if (object === null) {
      this.logger.warn(`asset image ${imageId} has no object in the bucket (ADR 0066 decision 4)`);
      throw new NotFoundException("Asset image not found");
    }
    if (object.contentLength !== null && object.contentLength !== row.byteSize) {
      // The socket behind the body is open; release it before refusing.
      object.body.destroy();
      this.logger.warn(
        `asset image ${imageId}: the object's length ${object.contentLength} differs from the row's byteSize ${row.byteSize}; treated as missing (ADR 0066 decision 4)`,
      );
      throw new NotFoundException("Asset image not found");
    }
    return { row: toDto(row), body: object.body };
  }
}

/** The columns the two reads select — the DTO's plus `objectKey`, which stays in this file. */
type StoredRow = {
  id: string;
  assetId: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string;
  caption: string | null;
  createdBy: string | null;
  createdAt: Date;
};

function selectRows(tx: BmsTx, where: ReturnType<typeof eq> | ReturnType<typeof and>): Promise<StoredRow[]> {
  return tx
    .select({
      id: assetImages.id,
      assetId: assetImages.assetId,
      objectKey: assetImages.objectKey,
      contentType: assetImages.contentType,
      byteSize: assetImages.byteSize,
      sha256: assetImages.sha256,
      originalFilename: assetImages.originalFilename,
      caption: assetImages.caption,
      createdBy: assetImages.createdBy,
      createdAt: assetImages.createdAt,
    })
    .from(assetImages)
    .where(where)
    .orderBy(desc(assetImages.createdAt));
}

/**
 * Picks the DTO's fields by name — never a spread, so `objectKey` cannot ride
 * along. `contentType` is a `text` column bound to the DTO's closed enum by
 * `asset_images_content_type_check` (Q-E) in SQL, and **parsed** through the
 * same schema here rather than cast: the ADR 0030 derivation is
 * load-bearing, so a row outside the vocabulary throws instead of being
 * served as a typed value it is not.
 */
function toDto(row: StoredRow): AssetImageDto {
  return {
    id: row.id,
    assetId: row.assetId,
    contentType: assetImageContentTypeSchema.parse(row.contentType),
    byteSize: row.byteSize,
    sha256: row.sha256,
    originalFilename: row.originalFilename,
    caption: row.caption,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : "Error";
}
