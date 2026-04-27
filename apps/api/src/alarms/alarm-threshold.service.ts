import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { alarms, assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { TelemetryReading } from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
import { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import { AlarmsGateway } from "./alarms.gateway";

type RuleHit = {
  ruleKey: string;
  severity: "critical" | "warning" | "info";
  message: string;
};

@Injectable()
export class AlarmThresholdService implements OnModuleInit {
  private readonly logger = new Logger(AlarmThresholdService.name);

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

  private evaluateRules(r: TelemetryReading): RuleHit | null {
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

  private async ensureAlarm(
    assetId: string,
    hit: RuleHit,
  ): Promise<void> {
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
    const latest = this.collapseLatest(readings);
    for (const r of latest) {
      const hit = this.evaluateRules(r);
      if (hit) {
        await this.ensureAlarm(r.assetId, hit);
      }
    }
  }
}
