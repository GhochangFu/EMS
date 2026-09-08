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
    // `null` — and ONLY `null` — is the unrestricted-admin scope. A truthiness
    // test would let `undefined`, or anything else falsy a future caller or a
    // widened signature hands in, take the same branch and drop the tenant
    // filter on a `BYPASSRLS` pool. Unlike `AlarmDetailsService`, where a falsy
    // scope loses only the asset filter and the tenant predicate still holds off
    // the alarm's own location, this argument IS the whole tenant control
    // (ADR 0059 decision 9). Post-merge security review L1.
    const scope: string[] | null = organizationIds === null
      ? null
      : Array.isArray(organizationIds)
        ? organizationIds
        : [];
    if (scope !== null && scope.length === 0) {
      return { classes: [] };
    }

    // Ruling Q0a: one row per template `code` **per organization**, at that
    // organization's highest published version. `DISTINCT ON` rather than a
    // correlated MAX subquery — the ordering is the selection here, and it reads
    // as the rule it implements.
    //
    // The key is `(organization_id, code)` and not `code`, because that is the
    // table's own identity (`asset_templates` is unique on
    // `(organization_id, code, version)`). Keyed on `code` alone this collapsed
    // two tenants' copies of one class into a single row and silently dropped
    // the other — and the collision is guaranteed rather than hypothetical,
    // since importing the same stock catalog entry into two organizations
    // writes the identical code. Post-merge review finding 1.
    //
    // Only philosophy-bearing entries cross the wire: `jsonb_path_query_array`
    // filters in the database, so a template whose alarms are all bare
    // threshold rows contributes an empty array instead of its whole `content`
    // column, which is bounded at 256 KiB.
    const rows = await this.db
      .selectDistinctOn([assetTemplates.organizationId, assetTemplates.code], {
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
          ...(scope === null ? [] : [inArray(assetTemplates.organizationId, scope)]),
        ),
      )
      .orderBy(
        asc(assetTemplates.organizationId),
        asc(assetTemplates.code),
        desc(assetTemplates.version),
        // A tiebreaker, because two organizations can hold the same code at the
        // same version and `version DESC` alone then leaves the winner
        // arbitrary between runs.
        asc(assetTemplates.id),
      );

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
    const skillLabel = skillCode === null ? null : (skills.get(skillCode) ?? null);
    // Gated on the LABEL, not the code: an entry whose only field is a skill
    // that no longer resolves renders four blank values, so it would draw its
    // alarm code over an empty list. Template content references the skill
    // inside jsonb, so no foreign key stops a `bms.alarm_skills` row being
    // re-coded after publish. Post-merge review finding 4.
    if (cause === null && impact === null && action === null && skillLabel === null) {
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
      skillLabel,
    };
  }
}

/** A field is text or it is absent. Anything else is not shown. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
