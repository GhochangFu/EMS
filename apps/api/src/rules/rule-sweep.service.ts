import { Inject, Injectable, Logger } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { RuleSweepSummary } from "@bms/shared";

import { AlarmRaiser } from "../alarms/alarm-raise.service";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { NotificationsService } from "../notifications/notifications.service";
import { selectRuleRows, stampRulesEvaluated } from "./rule-reads";
import { batchedLatestPointValues } from "./rule-samples";
import { runRuleSweep } from "./rule-sweep";

/**
 * `F3.11` / ADR 0064 decisions 3, 6 — `runRuleSweep` composed against the
 * real pools. Provided by `RuleSweepModule`; called by `WorkerHostService`'s
 * `rules-sweep` processor once per tick.
 *
 * **Injects the tenant pool only.** The fleet handle is `run(fleetDb)`'s
 * argument: `rules-sweep` is a `fleet`-tenancy queue, so `runProcessor` hands
 * the handler `{ db: dbs.fleetDb }` (`queue-processor.ts`) — decision 6's
 * mechanism — and the cross-organization `selectRuleRows` read runs on it
 * (ADR 0033 decision 2: every tenant's rules, one read, the GUC-free
 * BYPASSRLS pool). A second `FLEET_DRIZZLE` injection here would be a second,
 * unrecorded route to the same pool that the processor's mapping and
 * `worker-host.service.spec.ts` could not see.
 *
 * The tenant pool serves the other two deps: `batchedLatestPointValues`
 * (`telemetry.point_values` has no `0047` policy — `rule-samples.ts` records
 * why it stayed on this pool) and `stampRulesEvaluated`, which runs under
 * `withTenant(organizationId)` so the `FORCE` policy scopes each
 * organization's one `UPDATE`. `rule-sweep.service.spec.ts` pins all three.
 */
@Injectable()
export class RuleSweepService {
  private readonly logger = new Logger(RuleSweepService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    private readonly alarmRaiser: AlarmRaiser,
    private readonly notifications: NotificationsService,
  ) {}

  run(fleetDb: BmsDb): Promise<RuleSweepSummary> {
    return runRuleSweep({
      readRules: () => fleetDb.transaction((tx) => selectRuleRows(tx)),
      loadSamples: (rows) => batchedLatestPointValues(this.db, rows),
      raiser: this.alarmRaiser,
      notifications: this.notifications,
      stampEvaluated: (organizationId, ruleIds, at) =>
        withTenant(this.db, organizationId, (tx) => stampRulesEvaluated(tx, ruleIds, at)),
      logger: this.logger,
      now: Date.now,
    });
  }
}
