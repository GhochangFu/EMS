import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { automationRules } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AutomationRuleOperator, TelemetryReading } from "@bms/shared";

import { TENANT_DRIZZLE } from "../database/database.tokens";
import { alarmMessageFieldsFromCondition } from "../rules/alarm-message";
import { compare } from "../rules/rule-evaluation";
import { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import type { AlarmRaiseRule } from "./alarm-raise.service";
import { AlarmRaiser } from "./alarm-raise.service";

type CachedThresholdRule = AlarmRaiseRule & {
  assetId: string;
  operator: AutomationRuleOperator;
  thresholdValue: number;
};

const CACHE_TTL_MS = 60_000;

/**
 * Evaluates published, DB-backed threshold rules on live telemetry and raises
 * through `AlarmRaiser` — the only alarm-raising path since F3.6 / ADR 0033
 * retired the hardcoded Eskom-only ladder this class used to also carry.
 * Migration `0033_eskom_simulator_threshold_rules.sql` reseeded its five
 * checks as ordinary `bms.automation_rules` rows, so nothing here special-cases
 * an organization any more — every threshold rule, from any org, is evaluated
 * and raised the same way.
 */
@Injectable()
export class AlarmEngineService implements OnModuleInit {
  private readonly logger = new Logger(AlarmEngineService.name);
  private thresholdRules: CachedThresholdRule[] = [];
  private cacheLoadedAt = 0;

  constructor(
    private readonly hub: TelemetryBroadcastHub,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    private readonly raiser: AlarmRaiser,
  ) {}

  onModuleInit(): void {
    this.hub.on("readings", (readings: TelemetryReading[]) => {
      void this.evaluateReadings(readings).catch((err: unknown) => {
        this.logger.warn({ err }, "threshold evaluation failed");
      });
    });
  }

  /** Collapses a batch to the last sample per asset/point for rule evaluation. */
  private collapseLatest(readings: TelemetryReading[]): TelemetryReading[] {
    const map = new Map<string, TelemetryReading>();
    for (const r of readings) {
      map.set(`${r.assetId}:${r.pointKey}`, r);
    }
    return [...map.values()];
  }

  private async ensureCachesFresh(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) {
      return;
    }
    const ruleRows = await this.db
      .select({
        id: automationRules.id,
        assetId: automationRules.assetId,
        pointKey: automationRules.pointKey,
        code: automationRules.code,
        name: automationRules.name,
        operator: automationRules.operator,
        thresholdValue: automationRules.thresholdValue,
        severity: automationRules.severity,
        condition: automationRules.condition,
      })
      .from(automationRules)
      .where(
        and(
          eq(automationRules.enabled, true),
          eq(automationRules.lifecycleStatus, "published"),
          eq(automationRules.ruleType, "threshold"),
        ),
      );

    this.thresholdRules = ruleRows
      .filter(
        (
          row,
        ): row is typeof row & {
          assetId: string;
          pointKey: string;
          operator: string;
          thresholdValue: number;
        } =>
          Boolean(row.assetId && row.pointKey && row.operator && row.thresholdValue !== null),
      )
      .map((row) => {
        const { alarmMessage, unit } = alarmMessageFieldsFromCondition(row.condition);
        return {
          id: row.id,
          assetId: row.assetId,
          pointKey: row.pointKey,
          code: row.code,
          name: row.name,
          operator: row.operator as AutomationRuleOperator,
          thresholdValue: row.thresholdValue,
          // Raw, not pre-defaulted: `AlarmRaiser.raise` owns the one default
          // `alarms.severity` needs (`defaultAlarmSeverity`), so this cache is
          // not a second place that could disagree with it.
          severity: row.severity,
          alarmMessage,
          unit,
        };
      });

    this.cacheLoadedAt = Date.now();
  }

  private async evaluateReadings(readings: TelemetryReading[]): Promise<void> {
    await this.ensureCachesFresh();
    const latest = this.collapseLatest(readings);
    for (const r of latest) {
      for (const rule of this.thresholdRules) {
        if (rule.assetId !== r.assetId || rule.pointKey !== r.pointKey) {
          continue;
        }
        if (!compare(r.value, rule.operator, rule.thresholdValue)) {
          continue;
        }
        // Per-rule, not per-batch: `onModuleInit`'s own `.catch` covers a
        // throw from `ensureCachesFresh`/`collapseLatest`, but a bare `await`
        // here would let one rule's raise failure abort every remaining
        // reading and rule in this batch — the `F4.36` shape (§4.3), widened
        // by F3.6 from ~88 to 337+ seeded rules and up to three writes per
        // raise instead of two.
        try {
          await this.raiser.raise(r.assetId, rule, r.value);
        } catch (err) {
          this.logger.warn(
            { err, assetId: r.assetId, ruleId: rule.id },
            "alarm raise failed for one rule; continuing the batch",
          );
        }
      }
    }
  }
}
