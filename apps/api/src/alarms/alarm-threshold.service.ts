import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import {
  alarms,
  assets,
  automationRules,
  locations,
  organizations,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AutomationRuleOperator, TelemetryReading } from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
import { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import { AlarmsGateway } from "./alarms.gateway";

type RuleHit = {
  ruleKey: string;
  severity: "critical" | "warning" | "info";
  message: string;
};

type CachedThresholdRule = {
  assetId: string;
  pointKey: string;
  code: string;
  name: string;
  operator: AutomationRuleOperator;
  thresholdValue: number;
  severity: "critical" | "warning" | "info";
  alarmMessage: string | null;
};

const CACHE_TTL_MS = 60_000;

/** Evaluates org-scoped automation rules and Eskom-only legacy thresholds on live telemetry. */
@Injectable()
export class AlarmThresholdService implements OnModuleInit {
  private readonly logger = new Logger(AlarmThresholdService.name);
  private assetOrgCodes = new Map<string, string>();
  private thresholdRules: CachedThresholdRule[] = [];
  private cacheLoadedAt = 0;

  constructor(
    private readonly hub: TelemetryBroadcastHub,
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly gateway: AlarmsGateway,
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
    const assetRows = await this.db
      .select({
        assetId: assets.id,
        orgCode: organizations.code,
      })
      .from(assets)
      .innerJoin(locations, eq(assets.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id));

    this.assetOrgCodes = new Map(assetRows.map((row) => [row.assetId, row.orgCode]));

    const ruleRows = await this.db
      .select({
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
          severity: string;
        } =>
          Boolean(row.assetId && row.pointKey && row.operator && row.thresholdValue !== null),
      )
      .map((row) => {
        const condition =
          typeof row.condition === "object" && row.condition !== null
            ? (row.condition as Record<string, unknown>)
            : {};
        const alarmMessage =
          typeof condition.alarmMessage === "string" ? condition.alarmMessage : null;
        return {
          assetId: row.assetId,
          pointKey: row.pointKey,
          code: row.code,
          name: row.name,
          operator: row.operator as AutomationRuleOperator,
          thresholdValue: row.thresholdValue,
          severity: this.normalizeSeverity(row.severity),
          alarmMessage,
        };
      });

    this.cacheLoadedAt = Date.now();
  }

  private normalizeSeverity(value: string | null): "critical" | "warning" | "info" {
    if (value === "critical" || value === "warning" || value === "info") {
      return value;
    }
    return "warning";
  }

  private compare(
    value: number,
    operator: AutomationRuleOperator,
    threshold: number,
  ): boolean {
    switch (operator) {
      case "gt":
        return value > threshold;
      case "gte":
        return value >= threshold;
      case "lt":
        return value < threshold;
      case "lte":
        return value <= threshold;
      case "eq":
        return value === threshold;
    }
  }

  private evaluatePublishedRules(r: TelemetryReading): RuleHit[] {
    const hits: RuleHit[] = [];
    for (const rule of this.thresholdRules) {
      if (rule.assetId !== r.assetId || rule.pointKey !== r.pointKey) {
        continue;
      }
      if (!this.compare(r.value, rule.operator, rule.thresholdValue)) {
        continue;
      }
      hits.push({
        ruleKey: rule.code,
        severity: rule.severity,
        message: this.formatRuleMessage(rule, r.value),
      });
    }
    return hits;
  }

  private formatRuleMessage(rule: CachedThresholdRule, value: number): string {
    if (rule.alarmMessage === "voltage_l1_critical") {
      return `L1 voltage critically high (${value.toFixed(1)} V)`;
    }
    if (rule.alarmMessage === "voltage_l1_high") {
      return `L1 voltage above nominal envelope (${value.toFixed(1)} V)`;
    }
    if (rule.alarmMessage === "breaker_main_open") {
      return "Main breaker reported OPEN";
    }
    if (rule.pointKey === "kw") {
      return `Asset demand high (${value.toFixed(0)} kW)`;
    }
    if (rule.pointKey === "pf") {
      return `Power factor low (${value.toFixed(2)})`;
    }
    return `${rule.name} matched at ${value}`;
  }

  /** Eskom simulator demo thresholds — never applied to other organizations. */
  private evaluateEskomLegacyRules(r: TelemetryReading): RuleHit | null {
    if (r.pointKey === "voltage_l1_v") {
      if (r.value >= 239.5) {
        return {
          ruleKey: "voltage_l1_critical",
          severity: "critical",
          message: `L1 voltage critically high (${r.value.toFixed(1)} V)`,
        };
      }
      if (r.value >= 237) {
        return {
          ruleKey: "voltage_l1_high",
          severity: "warning",
          message: `L1 voltage above nominal envelope (${r.value.toFixed(1)} V)`,
        };
      }
    }
    if (r.pointKey === "breaker_main" && r.value < 0.5) {
      return {
        ruleKey: "breaker_main_open",
        severity: "critical",
        message: "Main breaker reported OPEN",
      };
    }
    if (r.pointKey === "kw" && r.value >= 115) {
      return {
        ruleKey: "demand_high",
        severity: "warning",
        message: `Asset demand high (${r.value.toFixed(0)} kW)`,
      };
    }
    if (r.pointKey === "pf" && r.value > 0 && r.value < 0.82) {
      return {
        ruleKey: "power_factor_low",
        severity: "warning",
        message: `Power factor low (${r.value.toFixed(2)})`,
      };
    }
    return null;
  }

  private async ensureAlarm(assetId: string, hit: RuleHit): Promise<void> {
    const open = await this.db
      .select({ id: alarms.id })
      .from(alarms)
      .where(
        and(
          eq(alarms.assetId, assetId),
          eq(alarms.ruleKey, hit.ruleKey),
          isNull(alarms.acknowledgedAt),
        ),
      )
      .limit(1);
    if (open.length > 0) {
      return;
    }

    const inserted = await this.db
      .insert(alarms)
      .values({
        assetId,
        ruleKey: hit.ruleKey,
        severity: hit.severity,
        message: hit.message,
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      return;
    }

    const [full] = await this.db
      .select({
        id: alarms.id,
        assetId: alarms.assetId,
        ruleKey: alarms.ruleKey,
        severity: alarms.severity,
        message: alarms.message,
        raisedAt: alarms.raisedAt,
        acknowledgedAt: alarms.acknowledgedAt,
        acknowledgedBy: alarms.acknowledgedBy,
        assetCode: assets.code,
        assetName: assets.name,
        siteName: assets.siteName,
      })
      .from(alarms)
      .innerJoin(assets, eq(alarms.assetId, assets.id))
      .where(eq(alarms.id, row.id))
      .limit(1);
    if (!full) {
      return;
    }

    this.gateway.broadcastCreated({
      id: full.id,
      assetId: full.assetId,
      ruleKey: full.ruleKey,
      severity: full.severity,
      message: full.message,
      raisedAt: full.raisedAt.toISOString(),
      acknowledgedAt: full.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: full.acknowledgedBy,
      assetCode: full.assetCode,
      assetName: full.assetName,
      siteName: full.siteName,
    });
  }

  private async evaluateReadings(readings: TelemetryReading[]): Promise<void> {
    await this.ensureCachesFresh();
    const latest = this.collapseLatest(readings);
    for (const r of latest) {
      for (const hit of this.evaluatePublishedRules(r)) {
        await this.ensureAlarm(r.assetId, hit);
      }

      const orgCode = this.assetOrgCodes.get(r.assetId);
      if (orgCode === "ESKOM") {
        const legacyHit = this.evaluateEskomLegacyRules(r);
        if (legacyHit) {
          await this.ensureAlarm(r.assetId, legacyHit);
        }
      }
    }
  }
}
