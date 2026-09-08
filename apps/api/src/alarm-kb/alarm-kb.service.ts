import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { alarmSkills, assetTemplates } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AlarmKbAlarm, AlarmKbResponse } from "@bms/shared";

import { FLEET_DRIZZLE } from "../database/database.tokens";

/**
 * `GET /api/v1/alarm-kb` — the browsable alarm philosophy knowledge base
 * (`E2.2` PR 2, ADR 0059 decision 4).
 *
 * **Its own module rather than more methods on `AlarmsModule` or on the admin
 * template service**, for the reason ADR 0034 gave `AlarmDetailsService` its own
 * file: this is a read over template content for an *operations* audience, and it
 * belongs to neither existing owner. The admin service authorizes as master data;
 * this one must not (ruling Q0b).
 *
 * Runs on `FLEET_DRIZZLE`, which is `bms_fleet` and carries `BYPASSRLS` — so the
 * organization filter below is hand-written and RLS will not catch its absence
 * (ADR 0059 decision 9). `assertKbScopedToTheCallersOrganization` is what holds it.
 */
@Injectable()
export class AlarmKbService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly db: BmsDb) {}

  /**
   * `organizationIds === null` means an unrestricted admin, matching
   * `AccessControlService.readableOrganizationIds`. An empty array is a caller
   * with no organization at all, which returns nothing rather than everything —
   * the failure direction has to be closed, not open.
   */
  async list(organizationIds: string[] | null): Promise<AlarmKbResponse> {
    if (organizationIds && organizationIds.length === 0) {
      return { classes: [] };
    }

    // Ruling Q0a: one row per template `code`, at the highest published
    // version. `DISTINCT ON` rather than a correlated MAX subquery — the
    // ordering is the selection here, and it reads as the rule it implements.
    //
    // Only philosophy-bearing entries cross the wire: `jsonb_path_query_array`
    // filters in the database, so a template whose alarms are all bare
    // threshold rows contributes an empty array instead of its whole `content`
    // column, which is bounded at 256 KiB.
    const rows = await this.db
      .selectDistinctOn([assetTemplates.code], {
        templateId: assetTemplates.id,
        templateCode: assetTemplates.code,
        templateName: assetTemplates.name,
        templateVersion: assetTemplates.version,
        organizationId: assetTemplates.organizationId,
        domain: assetTemplates.domain,
        alarms: sql<unknown[]>`jsonb_path_query_array(
          ${assetTemplates.content},
          '$.alarms[*] ? (exists (@.philosophy))'
        )`,
      })
      .from(assetTemplates)
      .where(
        and(
          eq(assetTemplates.status, "published"),
          ...(organizationIds
            ? [inArray(assetTemplates.organizationId, organizationIds)]
            : []),
        ),
      )
      .orderBy(asc(assetTemplates.code), desc(assetTemplates.version));

    // One read of the whole vocabulary rather than a lookup per alarm: the
    // table is five rows on the seed, and every class shares it. No `active`
    // filter, for decision 7's reason — a retired trade must still render its
    // label on a philosophy authored before it was retired.
    const skills = new Map(
      (await this.db.select({ code: alarmSkills.code, label: alarmSkills.label }).from(alarmSkills))
        .map((row) => [row.code, row.label] as const),
    );

    const classes = rows
      .map((row) => ({
        templateId: row.templateId,
        templateCode: row.templateCode,
        templateName: row.templateName,
        templateVersion: row.templateVersion,
        organizationId: row.organizationId,
        domain: row.domain,
        alarms: (Array.isArray(row.alarms) ? row.alarms : [])
          .map((entry) => this.toKbAlarm(entry, skills))
          .filter((entry): entry is AlarmKbAlarm => entry !== null),
      }))
      // A class whose every philosophy turned out to be empty text is not an
      // entry — the KB lists knowledge, not the templates that could carry it.
      .filter((entry) => entry.alarms.length > 0);

    return { classes };
  }

  /**
   * Read defensively: this is authored content, validated by the template
   * service on write, and a drifted shape must drop a row rather than throw on
   * a reference screen.
   */
  private toKbAlarm(entry: unknown, skills: Map<string, string>): AlarmKbAlarm | null {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const row = entry as Record<string, unknown>;
    const alarmCode = text(row.code);
    if (alarmCode === null) {
      return null;
    }
    const philosophy =
      typeof row.philosophy === "object" && row.philosophy !== null
        ? (row.philosophy as Record<string, unknown>)
        : {};
    const cause = text(philosophy.cause);
    const impact = text(philosophy.impact);
    const action = text(philosophy.action);
    const skillCode = text(philosophy.skill);
    if (cause === null && impact === null && action === null && skillCode === null) {
      return null;
    }
    return {
      alarmCode,
      message: text(row.message),
      severity: text(row.severity),
      cause,
      impact,
      action,
      skillCode,
      skillLabel: skillCode === null ? null : (skills.get(skillCode) ?? null),
    };
  }
}

/** A field is text or it is absent. Anything else is not shown. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
