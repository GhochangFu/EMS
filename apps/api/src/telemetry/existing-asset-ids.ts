import type { TelemetryReading } from "@bms/shared";
import type { Pool } from "pg";

/**
 * `F4.159` post-merge review — the live socket's half of the orphan fix.
 *
 * `telemetry.point_values` carries no foreign key to `bms.assets`, so a writer
 * can keep inserting readings for an asset id whose row is gone. `F4.159` (#561)
 * left those readings out of every served kW and PUE sum, but the
 * `/ws/telemetry` gateway forwarded every reading to a global user (`null`
 * scope applies no filter), and the `/` Total kW tile shows the socket's batch
 * sum while ticks arrive. `TelemetryGateway` now passes each batch through
 * {@link ExistingAssetIds.filter} before it fans out, so an orphan reading no
 * longer reaches any socket. The alarm engine and calc streaming, the other two
 * hub consumers, are not changed.
 *
 * The set of existing ids is cached, because a batch arrives every few seconds:
 *
 * - **A new asset** is an unknown id. It triggers a reload, at most once per
 *   {@link EXISTING_ASSET_IDS_UNKNOWN_RELOAD_MS}, so its readings are dropped for
 *   at most that long. The rate limit is also what stops a deleted asset that
 *   keeps writing from reloading the set on every batch.
 * - **A deleted asset** is still a known id. It leaves the set on the periodic
 *   reload, at most {@link EXISTING_ASSET_IDS_MAX_AGE_MS} after its deletion.
 * - **Before the first load completes, or when it fails, every reading is
 *   forwarded (fail-open).** Dropping all live telemetry on a database blip is
 *   an outage, while an orphan reading is a wrong figure on one tile. A failed
 *   reload after a successful one keeps the last good set.
 *
 * The load reads `bms.assets` on the fleet pool (BYPASSRLS), as every other
 * cross-organization read of it does; a tenant pool with no
 * `app.current_organization` would see no asset and drop everything.
 */

/** A deleted asset's readings stop reaching sockets within this long. */
export const EXISTING_ASSET_IDS_MAX_AGE_MS = 60_000;

/** An unknown id reloads the set at most once per this long. */
export const EXISTING_ASSET_IDS_UNKNOWN_RELOAD_MS = 5_000;

export interface ExistingAssetIdsOptions {
  readonly load: () => Promise<ReadonlySet<string>>;
  readonly now: () => number;
  readonly maxAgeMs: number;
  readonly unknownReloadMs: number;
  readonly onLoadError?: (err: unknown) => void;
}

/** A cached set of `bms.assets` ids and the filter the gateway applies with it. */
export class ExistingAssetIds {
  private ids: ReadonlySet<string> | null = null;
  private lastLoadStartedAt = Number.NEGATIVE_INFINITY;
  private loading: Promise<void> | null = null;

  constructor(private readonly options: ExistingAssetIdsOptions) {}

  /**
   * The readings whose asset exists — or all of them while no set has loaded.
   * Starts a reload in the background when the set is older than `maxAgeMs`, or
   * when the batch holds an unknown id and the last load started at least
   * `unknownReloadMs` ago. The reload serves later batches, not this one.
   */
  filter(readings: readonly TelemetryReading[]): TelemetryReading[] {
    const ids = this.ids;
    const age = this.options.now() - this.lastLoadStartedAt;
    const unknown = ids === null || readings.some((reading) => !ids.has(reading.assetId));
    if (age >= this.options.maxAgeMs || (unknown && age >= this.options.unknownReloadMs)) {
      this.reload();
    }
    return ids === null ? [...readings] : readings.filter((reading) => ids.has(reading.assetId));
  }

  /** Resolves once no load is in flight. */
  async settled(): Promise<void> {
    await this.loading;
  }

  private reload(): void {
    if (this.loading) {
      return;
    }
    this.lastLoadStartedAt = this.options.now();
    this.loading = this.options
      .load()
      .then(
        (ids) => {
          this.ids = ids;
        },
        (err: unknown) => {
          this.options.onLoadError?.(err);
        },
      )
      .finally(() => {
        this.loading = null;
      });
  }
}

/** Every `bms.assets` id, read on the caller's fleet pool. */
export async function loadExistingAssetIds(pool: Pick<Pool, "query">): Promise<ReadonlySet<string>> {
  const r = await pool.query<{ id: string }>("SELECT id FROM bms.assets");
  return new Set(r.rows.map((row) => row.id));
}
