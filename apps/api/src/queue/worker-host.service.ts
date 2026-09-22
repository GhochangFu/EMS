import type { BmsDb } from "@bms/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { MetricsService } from "../observability/metrics.service";
import { ReportDispatchService } from "../reports/report-dispatch.service";
import { ReportRenderService } from "../reports/report-render.service";
import { RuleSweepService } from "../rules/rule-sweep.service";
import {
  HEARTBEAT_EVERY_MS,
  HEARTBEAT_SCHEDULER_ID,
  heartbeatKey,
  heartbeatProcessor,
  heartbeatQueue,
} from "./heartbeat";
import type { WorkerConfig } from "./queue-config";
import { runProcessor, type ProcessorDbs } from "./queue-processor";
import {
  QueuePayloadError,
  QueueUnavailableError,
  upsertSchedule,
  type QueueClient,
  type QueueDeclaration,
  type QueueHandle,
} from "./queue-registry";
import { REPORT_DISPATCH_SCHEDULER_ID, reportsDispatchQueue } from "./reports-dispatch";
import { reportsRenderQueue } from "./reports-render";
import {
  RULE_SWEEP_SCHEDULER_ID,
  recordRuleSweep,
  ruleSweepKey,
  rulesSweepQueue,
} from "./rules-sweep";
import { startQueueWorkers, type WorkerHost } from "./worker-host";
import { QUEUE_CLIENT, WORKER_CONFIG } from "./queue.tokens";

/**
 * The worker process's one provider (ADR 0063 decisions 3, 6, 10, 12; ADR
 * 0064 decisions 2, 6, 7; ADR 0071 decisions 8, 9): on `onModuleInit` it
 * upserts one repeatable job per scheduled queue — the heartbeat's every
 * `HEARTBEAT_EVERY_MS`, the rules sweep's every
 * `config.ruleSweepIntervalMs`, the report dispatch tick's every
 * `config.reportDispatchIntervalMs` — and starts one `Worker` per registered
 * processor; on `onModuleDestroy` it closes them (`worker.ts` enables
 * shutdown hooks for exactly this).
 *
 * **Constructor order is a contract**: `(client, tenantDb, fleetDb,
 * metrics, ruleSweep, config, reportDispatch, reportRender)`. `runProcessor`
 * receives `{ tenantDb, fleetDb }` and a `tenant` queue's handler runs
 * inside `withTenant(tenantDb, …)` — swap the two pools and every tenant job
 * runs on the BYPASSRLS pool with a GUC nobody reads. No test boots
 * `WorkerModule` (Amendment 1), so `database/fleet-read-wiring.spec.ts` pins
 * slots 1 and 2 by token; `F3.11` **appended** slots 4 and 5 and `F3.5b`
 * **appended** slots 6 and 7, each moving nothing before them.
 *
 * **Every consumer is registered here, beside `ALL_QUEUES`'s declarations,
 * and not in a host of its own inside the module that owns the body.** One
 * file lists every consumer; one `close()` on `onModuleDestroy` ends them;
 * and one spec (`worker-host.service.spec.ts`) asserts decision 12's
 * invariant — every declared queue has exactly one processor — as a set
 * equality, which two hosts in two modules could not. `F3.12` appends the
 * same way. The cost is this file's `queue/ → rules/` import
 * (`RuleSweepService`) and, since `F3.5b`, its second such edge, `queue/ →
 * reports/` (`ReportDispatchService`, `ReportRenderService`) — both recorded
 * here so nobody reads them as a layering slip.
 *
 * **The heartbeat processor never touches Postgres.** `pg.Pool` connects
 * lazily and the handler ignores `ctx.db`, which is what made ADR 0063
 * Amendment 1's stack measurement hold for `F4.24`. Since `F3.11` the sweep
 * processor does open backends — the fleet read on `ctx.db` and the tenant
 * writes — so the worker's `pg_stat_activity` count is non-zero by design
 * (ADR 0064 Consequences record the numbers). `F3.5b` adds two more shapes:
 * the dispatch tick is one fleet transaction per tick (`FOR UPDATE SKIP
 * LOCKED`, then the enqueues, then the advances), and **every render job
 * holds one tenant backend for its whole phase A** — the `withTenant`
 * transaction `runProcessor` opens, in which the schedule read, the asset
 * resolution, the unique checks, the puts and the row writes run — so a
 * `pg_stat_activity` read during a render shows a `bms_tenant` backend for
 * the worker's address beside the fleet one (U10 records the numbers).
 *
 * **What the two report handlers do.** The dispatch handler hands `ctx.db`
 * (the fleet handle, decision 6's mechanism again — the service injects no
 * fleet token of its own) to `ReportDispatchService.tick` and logs its
 * four counts on one `info` line (R-17: no Redis key, no health field).
 * The render handler hands `ctx.tx` to `ReportRenderService.render` and
 * returns `runProcessor`'s post-commit continuation (R-5, Q-4): phase A ran
 * in the transaction, and `finish(outcome)` — the pruned objects' deletes,
 * the email, the `delivery_status` update — runs only after that
 * transaction committed. Drop the `return` and the mail precedes the
 * commit of the rows it names; `worker-host.service.spec.ts` reddens on it.
 *
 * **What the sweep handler does**, in order: `RuleSweepService.run(ctx.db)`
 * — `ctx.db` is the fleet handle `runProcessor` builds for a `fleet` queue
 * (decision 6's mechanism; the service injects no fleet token of its own) —
 * then `recordRuleSweep`, which lands the summary in the three sinks decision
 * 8 names: the Redis key `GET /health` reads back on both processes, the two
 * metrics, one `info` line with counts only. A sweep that throws is failed by
 * BullMQ, counted under `outcome=failed`, and retried on `RETRY_DEFAULTS`;
 * the next scheduled tick runs regardless (decision 2), and `concurrency: 1`
 * in `startQueueWorkers` keeps a slow sweep from overlapping the next
 * (decision 7).
 *
 * Nest wiring, uncovered like `main.ts`; `worker-host.spec.ts`,
 * `heartbeat.spec.ts`, `rules-sweep.spec.ts` and `queue-registry.spec.ts`
 * gate what it composes, and `worker-host.service.spec.ts` what it registers.
 */
@Injectable()
export class WorkerHostService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHostService.name);
  private host: WorkerHost | undefined;

  constructor(
    @Inject(QUEUE_CLIENT) private readonly client: QueueClient,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly metrics: MetricsService,
    private readonly ruleSweep: RuleSweepService,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    private readonly reportDispatch: ReportDispatchService,
    private readonly reportRender: ReportRenderService,
  ) {}

  async onModuleInit(): Promise<void> {
    await upsertSchedule(
      this.client,
      heartbeatQueue,
      { schedulerId: HEARTBEAT_SCHEDULER_ID, everyMs: HEARTBEAT_EVERY_MS },
      {},
    );
    await upsertSchedule(
      this.client,
      rulesSweepQueue,
      { schedulerId: RULE_SWEEP_SCHEDULER_ID, everyMs: this.config.ruleSweepIntervalMs },
      {},
    );
    await upsertSchedule(
      this.client,
      reportsDispatchQueue,
      { schedulerId: REPORT_DISPATCH_SCHEDULER_ID, everyMs: this.config.reportDispatchIntervalMs },
      {},
    );
    // All three upserts passed, so the client is configured; `requireConfigured`
    // is the same refusal they applied, kept for the type narrowing.
    const { prefix } = requireConfigured(this.client);
    const dbs: ProcessorDbs = { tenantDb: this.tenantDb, fleetDb: this.fleetDb };

    const heartbeat = runProcessor(
      heartbeatQueue,
      dbs,
      heartbeatProcessor({
        writeTick: (iso) => this.writeKey(heartbeatQueue, heartbeatKey(prefix), iso),
        now: Date.now,
      }),
    );
    const sweep = runProcessor(rulesSweepQueue, dbs, async (_payload, ctx) => {
      const summary = await this.ruleSweep.run(ctx.db);
      await recordRuleSweep(summary, {
        writeSummary: (json) => this.writeKey(rulesSweepQueue, ruleSweepKey(prefix), json),
        metrics: this.metrics,
        logger: this.logger,
      });
    });

    const dispatch = runProcessor(reportsDispatchQueue, dbs, async (_payload, ctx) => {
      const s = await this.reportDispatch.tick(ctx.db);
      this.logger.log(
        `reports-dispatch finished: due=${s.due} enqueued=${s.enqueued} skippedInvalid=${s.skippedInvalid} durationMs=${s.durationMs}`,
      );
    });
    const render = runProcessor(reportsRenderQueue, dbs, async (payload, ctx) => {
      const outcome = await this.reportRender.render(payload, ctx.tx);
      return { afterCommit: () => this.reportRender.finish(outcome) };
    });

    this.host = startQueueWorkers(this.client, [heartbeat, sweep, dispatch, render], {
      createWorker: (name, process, opts) => new Worker(name, process, opts),
      metrics: this.metrics,
      logger: this.logger,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.host?.close();
  }

  /** One `SET key value` through the declared queue's own connection — the heartbeat tick, the sweep summary. */
  private async writeKey(decl: QueueDeclaration, key: string, value: string): Promise<void> {
    const handle = queueStore(this.client, decl);
    const redis = await handle.client;
    await redis.set(key, value);
  }
}

type ConfiguredQueueClient = Extract<QueueClient, { kind: "configured" }>;

/**
 * Narrows to the configured variant or refuses by name. Unreachable once
 * `onModuleInit`'s `upsertSchedule` calls have passed — the refusal exists so
 * a key written through a mis-built client fails with a name rather than a
 * `TypeError` on `undefined`.
 */
function requireConfigured(client: QueueClient): ConfiguredQueueClient {
  if (client.kind === "unconfigured") {
    throw new QueueUnavailableError(
      "REDIS_URL is not configured, so a queue's key write has nowhere to land (ADR 0063 decision 9)",
    );
  }
  return client;
}

/**
 * Where a queue's key writes land: the declared queue's handle, whose
 * connection carries the `SET`. A declaration with no handle is a client
 * built from a different `ALL_QUEUES` than the one this host registers
 * against — named, not a `TypeError`.
 */
function queueStore(client: QueueClient, decl: QueueDeclaration): QueueHandle {
  const handle = requireConfigured(client).queues.get(decl.name);
  if (handle === undefined) {
    throw new QueuePayloadError("unknown_queue", decl.name);
  }
  return handle;
}
