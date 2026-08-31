import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { type BmsDb, organizations } from "@bms/db";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type { AggregateLevel } from "../telemetry/point-aggregates";
import { floorToBucket } from "../telemetry/point-aggregate-window";
import { sleep } from "../telemetry/sleep";

import { levelRollupSql, rawRollupSql } from "./health-rollup-sql";

/**
 * `E1.3` — the scheduled host that materialises the in-range counter
 * (ADR 0050 decision 4, cadence from Amendment 1 decision 4).
 *
 * This is the SECOND scheduled host in `apps/api`. ADR 0037 decision 7 built
 * the first, and its Consequences say the two should share the loop shape —
 * so `runHealthRollupLoop` below is deliberately the same `for (;;)` sweep-then-
 * sleep as `runSchedulerLoop` in `calc-scheduler.service.ts`, down to the
 * injected `sleep`/`now` and the `AbortController` shutdown. A third would be
 * the point at which extracting the shape stops being premature; two is not.
 *
 * **Never `setInterval`.** A slow sweep must delay the next tick, not overlap
 * it — two sweeps writing the same buckets would still be correct thanks to
 * `ON CONFLICT DO UPDATE`, but they would double the load exactly when the
 * database is already the reason the sweep was slow.
 */

/** Amendment 1 decision 4. Matches ADR 0037 decision 7's existing loop. */
export const HEALTH_TICK_MS = 60_000;

/**
 * How far back each level re-derives on every tick — Amendment 1 decision 4's
 * "24 h trailing at `1m`, widening per level".
 *
 * **The trailing window is what makes the job self-healing.** A missed tick, a
 * restart, or a sweep that ran long is repaired by the next pass rather than
 * leaving a permanent hole, because each pass recomputes the whole window
 * rather than only what is new.
 *
 * **It does NOT repair a deletion older than the window, and nothing else
 * does either.** ADR 0050 decision 9 and Amendment 1 decision 8 are the only
 * cover for that case, and they are a standing obligation on whoever runs the
 * `DELETE` — see `0052_health_in_range_counters.sql`'s header. Widening these
 * numbers to "fix" that would put an unbounded scan on a 60-second tick and
 * still not reach a deletion from last year.
 *
 * The coarse levels widen but stay bounded for the same reason: their job is
 * to catch up recent buckets, not to re-derive history that only an explicit
 * re-run should touch.
 */
export const TRAILING_WINDOW_MS: Record<AggregateLevel, number> = {
  "1m": 24 * 60 * 60 * 1000,
  "5m": 24 * 60 * 60 * 1000,
  "1h": 48 * 60 * 60 * 1000,
  "1d": 7 * 24 * 60 * 60 * 1000,
};

/**
 * The ladder, finest first. ADR 0050 decision 9 as extended by Amendment 1
 * decision 8: a coarse level derived from a stale fine one propagates the error
 * upward, so this order is a correctness requirement and not a preference.
 *
 * `levelRollupSql` refuses a non-adjacent pair, so the only way to break the
 * order from here is to reverse this array — which is why the spec asserts the
 * sequence of calls and not merely that four statements ran.
 */
export const LEVEL_STEPS: readonly (readonly [AggregateLevel, AggregateLevel])[] = [
  ["1m", "5m"],
  ["5m", "1h"],
  ["1h", "1d"],
];

/**
 * The window for one level, aligned to bucket boundaries.
 *
 * **`to` is the start of the newest COMPLETE bucket, not `now`.** ADR 0050
 * decision 5: the score is a completed-bucket figure. Rolling up a bucket that
 * is still filling would write a count over a partial sample set, and the next
 * tick would overwrite it with a larger one — so a score would drift downward
 * or upward within a bucket for no reason a reader could see, and a chart
 * beside it (which reads `materialized_only = false` aggregates and IS exact to
 * the partial bucket) would disagree in a way that looks like an arithmetic
 * bug.
 *
 * That asymmetry against the continuous aggregates is stated in ADR 0050
 * decision 5 rather than discovered here; this function is where it becomes
 * true.
 */
export function alignedWindow(level: AggregateLevel, now: Date): { from: Date; to: Date } {
  // `floorToBucket` rather than the arithmetic inline (`F4.72`): the READ needs
  // the identical boundary, and two copies of it is how a writer and a reader
  // come to disagree about which bucket is the newest.
  const to = floorToBucket(now, level);
  return { from: new Date(to.getTime() - TRAILING_WINDOW_MS[level]), to };
}

export interface HealthRollupDeps {
  /** Every organization to sweep. Read with the FLEET role — see the service. */
  listOrganizationIds: () => Promise<string[]>;
  /** Runs all four statements for one organization, in its own tenant context. */
  rollUpOrganization: (organizationId: string, now: Date) => Promise<void>;
  logger: Pick<Logger, "warn">;
}

/**
 * One pass over every organization.
 *
 * **One organization's failure must not end the sweep.** A single tenant with a
 * malformed rule, a lock, or a statement timeout would otherwise silently stop
 * every organization after it in the list from being scored at all — and
 * because this runs in a background loop with no request to fail, the only
 * symptom would be stale scores for an arbitrary subset of tenants. The catch
 * is per-organization for that reason, and it logs the organization id.
 */
export async function runHealthRollupSweep(deps: HealthRollupDeps, now: Date): Promise<void> {
  const organizationIds = await deps.listOrganizationIds();
  for (const organizationId of organizationIds) {
    try {
      await deps.rollUpOrganization(organizationId, now);
    } catch (err) {
      deps.logger.warn(
        `health roll-up: organization ${organizationId} failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}

export interface HealthRollupLoopDeps extends HealthRollupDeps {
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  baseTickMs: number;
}

/**
 * The self-scheduling loop (ADR 0037 decision 7's shape): `for (;;)`, sweep,
 * **then** sleep. `sleep`/`now` are injected so a test does not wait out a real
 * 60-second tick — `CalcSchedulerLoopDeps`' reason applies unchanged.
 */
export async function runHealthRollupLoop(
  deps: HealthRollupLoopDeps,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    if (signal.aborted) {
      return;
    }
    try {
      await runHealthRollupSweep(deps, new Date(deps.now()));
    } catch (err) {
      deps.logger.warn(`health roll-up: sweep failed: ${(err as Error)?.message ?? err}`);
    }
    if (signal.aborted) {
      return;
    }
    await deps.sleep(deps.baseTickMs, signal);
  }
}

/**
 * Scheduled health roll-up host — a thin wiring shell over
 * {@link runHealthRollupLoop}, matching `CalcSchedulerService`.
 *
 * **Two pools, and the split is the containment.** ADR 0050 decision 8 requires
 * the sweep to read rules one organization at a time as the tenant role, and
 * `bms.automation_rules` is org-bearing under ADR 0043's forced policies — so
 * `withTenant` on `TENANT_DRIZZLE` is what stops one tenant's rules scoring
 * another's telemetry. `telemetry.point_values` carries no row-level security
 * at all, which is why the roll-up SQL joins `bms.assets`: that join is the
 * only thing scoping the telemetry side, and it works only under the tenant
 * role.
 *
 * `FLEET_DRIZZLE` appears exactly once, to enumerate the organizations. It
 * cannot be avoided — a tenant-role connection can only see the tenant it has
 * already named, so something has to know the list — and it is deliberately
 * confined to reading ids. Do not reach for `fleetDb` for anything else here;
 * `bms_fleet` is `BYPASSRLS`, so a query added to this class against it would
 * cross every tenant boundary at once and nothing would fail.
 */
@Injectable()
export class HealthRollupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthRollupService.name);
  private readonly abortController = new AbortController();

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
  ) {}

  onModuleInit(): void {
    const deps: HealthRollupLoopDeps = {
      listOrganizationIds: () => this.listOrganizationIds(),
      rollUpOrganization: (organizationId, now) => this.rollUpOrganization(organizationId, now),
      logger: this.logger,
      sleep,
      now: () => Date.now(),
      baseTickMs: HEALTH_TICK_MS,
    };
    void runHealthRollupLoop(deps, this.abortController.signal).catch((err: unknown) => {
      this.logger.warn(`health roll-up loop exited: ${(err as Error)?.message ?? err}`);
    });
  }

  onModuleDestroy(): void {
    this.abortController.abort();
  }

  private async listOrganizationIds(): Promise<string[]> {
    const rows = await this.fleetDb.select({ id: organizations.id }).from(organizations);
    return rows.map((row) => row.id);
  }

  /**
   * All four statements for one organization, inside ONE tenant transaction.
   *
   * One transaction because `withTenant` issues `set_config(..., true)` — a
   * `SET LOCAL`, discarded at COMMIT — so every statement that must see the
   * tenant context has to be inside it. Splitting the four into separate
   * transactions would also let a crash leave `1d` derived from a `1h` that a
   * later statement was about to change.
   *
   * Finest first, and each level derived only from the one below it.
   */
  private async rollUpOrganization(organizationId: string, now: Date): Promise<void> {
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      const raw = alignedWindow("1m", now);
      await tx.execute(rawRollupSql(raw.from, raw.to));

      for (const [from, to] of LEVEL_STEPS) {
        const window = alignedWindow(to, now);
        await tx.execute(levelRollupSql(from, to, window.from, window.to));
      }
    });
  }
}
