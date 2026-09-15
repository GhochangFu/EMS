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
 * **The read runs under the request's RLS.** Both reads go through
 * `withReadScope(tenantDb, fleetDb, [assetId], …)`: one asset id always
 * resolves to a single organization, so the read runs inside `withTenant`
 * with the GUC set and the `0072` `FORCE` policy scoping it — a tenant read
 * inside a transaction, never on a bare connection (AGENTS.md §4.4). The
 * controller has already refused an asset outside the caller's scope, so
 * the policy is the backstop, not the gate. The constructor order (tenant,
 * fleet) is pinned by `database/fleet-read-wiring.spec.ts`: `withReadScope`
 * reads its pools positionally and a swap silently unscopes.
 *
 * **The row is the authority (decision 4).** `objectKey` is read and used
 * to address the bucket and appears in no DTO, no thrown message and no log
 * line. A row whose object is missing is a 404 with one `warn` naming the
 * **image id**; a transport failure (MinIO down, configured) is a 503
 * "Object storage is unreachable" with one `warn` naming the image id and
 * `err.name` (Q-F) — never `err.message`, which an SDK error may stuff with
 * the key or the endpoint (§9.6).
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
 * `asset_images_content_type_check` (Q-E), so the cast is backed in SQL.
 */
function toDto(row: StoredRow): AssetImageDto {
  return {
    id: row.id,
    assetId: row.assetId,
    contentType: row.contentType as AssetImageDto["contentType"],
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
