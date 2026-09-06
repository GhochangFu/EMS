import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { and, eq, inArray, or } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import {
  alarmEscalationDefaults,
  alarmEscalationProfiles,
  alarmEscalationStepChannels,
  alarmEscalationSteps,
  auditLog,
  users,
} from "@bms/db";
import type {
  EscalationDefaultDto,
  EscalationDefaultsResponse,
  EscalationProfileDto,
  EscalationStepDto,
  JwtPayload,
  UserRole,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import type { BmsTx } from "../database/tenant-context";
import { withTenant } from "../database/tenant-context";
import { ChannelsService } from "./channels.service";
import type {
  CreateEscalationProfileBody,
  SetEscalationDefaultsBody,
  UpdateEscalationProfileBody,
} from "./escalation-profiles.schema";

/** Postgres SQLSTATEs this service can produce and must not answer with a 500. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** Constraint names from `0066_alarm_lifecycle.sql`, read from the file, not guessed. */
const PROFILE_ORGANIZATION_FK = "alarm_escalation_profiles_organization_id_fk";
const DEFAULTS_SEVERITY_FK = "alarm_escalation_defaults_severity_fk";
const DEFAULTS_PROFILE_FK = "alarm_escalation_defaults_profile_id_fk";
const STEP_CHANNEL_FK = "alarm_escalation_step_channels_channel_id_fk";

/**
 * Turns a constraint violation into the answer it is.
 *
 * `ChannelsService`'s `translateConstraintErrors` in miniature, and separate
 * from it deliberately: plan D10 keeps `channels.service.ts` at 986 lines and
 * adds nothing to it, and the foreign keys here mean different things anyway —
 * `alarm_escalation_defaults_profile_id_fk` is a **400** on a severity map (the
 * profile does not exist) and a **409** on a profile delete (a severity still
 * maps to it). One shared translator would answer one of the two wrong, so
 * every caller passes its own `onForeignKey`.
 */
async function translate<T>(
  run: () => Promise<T>,
  onUnique: () => Error,
  onForeignKey: (constraint: string | undefined) => Error,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === UNIQUE_VIOLATION) throw onUnique();
    if (code === FOREIGN_KEY_VIOLATION) {
      throw onForeignKey((err as { constraint?: string }).constraint);
    }
    throw err;
  }
}

const duplicateCode = (): Error =>
  new ConflictException("That escalation profile code is already used in this organization");

/** One row of the profile/step/channel join, before it is grouped. */
interface ProfileJoinRow {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  stepNo: number | null;
  afterMinutes: number | null;
  channelId: string | null;
}

/**
 * `F3.10` — escalation-profile administration (ADR 0057 decision 7, plan D8).
 *
 * **Gated like the channel admin, not like rule authoring** (ruling Q6). A
 * profile binds notification channels, so it must not be editable by someone
 * who cannot manage them: `requireMasterDataUser` plus
 * `canManageNotificationChannel(jwt, organizationId)`, and every channel id in
 * a body is resolved through `ChannelsService.loadById`, which throws a 403 for
 * a channel outside the caller's scope.
 *
 * **The pairing refusal is this service's, not the database's** (PR 1's M2).
 * `0066`'s `alarm_escalation_step_channels` policy reads through step →
 * profile and says nothing about the channel's own organization, exactly as
 * `rule_notifications` does — because a fleet-wide (`organization_id IS NULL`)
 * channel is a legitimate target for any tenant. So a channel that resolves to
 * a *different* organization is refused here, the way `setRuleChannels`
 * refuses one, before any row is written. `dispatchToChannels` drops the same
 * channel at send time as the caller-independent floor; a step that only
 * failed there would look configured and send nothing.
 *
 * **`organization_id` is `NOT NULL` on all four tables**, so unlike
 * `ChannelsService.create` there is no fleet-managed fallback:
 * `resolveTargetOrg` refuses `null` with a 400 rather than creating a global
 * profile nothing could ever read.
 *
 * **The read gate is the write gate** (the 2026-08-27 ruling recorded on
 * `ChannelsService.list`). `writableOrganizationIds` resolves a
 * `location_admin` to a real, non-empty set through
 * `locationDerivedOrganizationIds`, so a read gated on scope alone would hand
 * back configuration that `canManageNotificationChannel` refuses on the very
 * same row. `list` therefore forks on the role and answers `[]`.
 */
@Injectable()
export class EscalationProfilesService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    private readonly channels: ChannelsService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * Every profile the caller may administer, with its ladder.
   *
   * **`fleetDb`, and the reason is the surface** (ADR 0043 Amendment 3): this
   * is a master-data list that resolves across organizations. An `admin` sees
   * every tenant's profiles and an `organization_admin` may hold grants in more
   * than one organization, so a single tenant GUC cannot serve the read — there
   * is no one organization to name. The fence is the `inArray` filter below,
   * built from `writableOrganizationIds`, plus the role fork above it.
   */
  async list(jwt: JwtPayload): Promise<EscalationProfileDto[]> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      return [];
    }
    const writableOrgIds = await this.accessControl.writableOrganizationIds(jwt);
    if (writableOrgIds !== null && writableOrgIds.length === 0) {
      return [];
    }

    const rows = (await this.fleetDb
      .select({
        id: alarmEscalationProfiles.id,
        organizationId: alarmEscalationProfiles.organizationId,
        code: alarmEscalationProfiles.code,
        name: alarmEscalationProfiles.name,
        createdAt: alarmEscalationProfiles.createdAt,
        updatedAt: alarmEscalationProfiles.updatedAt,
        stepNo: alarmEscalationSteps.stepNo,
        afterMinutes: alarmEscalationSteps.afterMinutes,
        channelId: alarmEscalationStepChannels.channelId,
      })
      .from(alarmEscalationProfiles)
      .leftJoin(
        alarmEscalationSteps,
        eq(alarmEscalationSteps.profileId, alarmEscalationProfiles.id),
      )
      .leftJoin(
        alarmEscalationStepChannels,
        eq(alarmEscalationStepChannels.stepId, alarmEscalationSteps.id),
      )
      .where(
        writableOrgIds === null
          ? undefined
          : inArray(alarmEscalationProfiles.organizationId, writableOrgIds),
      )
      .orderBy(alarmEscalationProfiles.code, alarmEscalationSteps.stepNo)) as ProfileJoinRow[];

    return groupProfiles(rows);
  }

  async create(
    jwt: JwtPayload,
    body: CreateEscalationProfileBody,
  ): Promise<EscalationProfileDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    const organizationId = await this.resolveTargetOrg(jwt, user.role, body.organizationId);
    if (!(await this.accessControl.canManageNotificationChannel(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
    await this.assertChannelsPairWithOrg(jwt, organizationId, body.steps);

    const profile = await translate(
      () =>
        withTenant(this.db, organizationId, async (tx) => {
          const inserted = await tx
            .insert(alarmEscalationProfiles)
            .values({ organizationId, code: body.code, name: body.name })
            .returning();
          const row = inserted[0];
          if (row === undefined) throw new Error("escalation profile insert returned no row");
          await this.replaceSteps(tx, row.id, body.steps);
          return { ...row, steps: await readSteps(tx, row.id) };
        }),
      duplicateCode,
      (constraint) => onProfileWriteForeignKey(constraint),
    );

    await this.audit(jwt, "alarm_escalation_profile_create", "alarm_escalation_profile", profile.id, organizationId, {
      code: profile.code,
      stepCount: profile.steps.length,
    });
    return toProfileDto(profile, profile.steps);
  }

  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateEscalationProfileBody,
  ): Promise<EscalationProfileDto | null> {
    await this.accessControl.requireMasterDataUser(jwt);
    const existing = await this.loadExistingForWrite(id);
    if (existing === null) return null;
    if (!(await this.accessControl.canManageNotificationChannel(jwt, existing.organizationId))) {
      throw new ForbiddenException("Escalation profile is outside your access scope");
    }
    if (body.steps !== undefined) {
      await this.assertChannelsPairWithOrg(jwt, existing.organizationId, body.steps);
    }

    const organizationId = existing.organizationId;
    const updated = await translate(
      () =>
        withTenant(this.db, organizationId, async (tx) => {
          // `updatedAt` moves even for a steps-only PATCH: the ladder is the
          // profile's configuration, and a page that sorts on the stamp would
          // otherwise show a rewritten profile as untouched.
          const values: Record<string, unknown> = { updatedAt: new Date() };
          if (body.name !== undefined) values.name = body.name;
          const rows = await tx
            .update(alarmEscalationProfiles)
            .set(values)
            .where(eq(alarmEscalationProfiles.id, id))
            .returning();
          const row = rows[0];
          // A foreign-org row cannot reach here — the gate above refused it.
          // If it ever did, an UPDATE under FORCE matches zero rows WITHOUT
          // erroring, which falls through to the 404 rather than to a
          // corrupted write. That silence is a backstop, not the authorization.
          if (row === undefined) return null;
          if (body.steps !== undefined) await this.replaceSteps(tx, id, body.steps);
          return { ...row, steps: await readSteps(tx, id) };
        }),
      duplicateCode,
      (constraint) => onProfileWriteForeignKey(constraint),
    );
    if (updated === null) return null;

    await this.audit(jwt, "alarm_escalation_profile_update", "alarm_escalation_profile", id, organizationId, {
      code: updated.code,
      // Which FIELDS changed, never their values.
      changed: Object.keys(body).sort(),
      stepCount: updated.steps.length,
    });
    return toProfileDto(updated, updated.steps);
  }

  async remove(jwt: JwtPayload, id: string): Promise<boolean> {
    await this.accessControl.requireMasterDataUser(jwt);
    const existing = await this.loadExistingForWrite(id);
    if (existing === null) return false;
    if (!(await this.accessControl.canManageNotificationChannel(jwt, existing.organizationId))) {
      throw new ForbiddenException("Escalation profile is outside your access scope");
    }
    const organizationId = existing.organizationId;

    const rows = await translate(
      () =>
        withTenant(this.db, organizationId, (tx) =>
          tx
            .delete(alarmEscalationProfiles)
            .where(eq(alarmEscalationProfiles.id, id))
            .returning({ id: alarmEscalationProfiles.id }),
        ),
      duplicateCode,
      // The only foreign key pointing at a profile that is not `ON DELETE
      // CASCADE` is the severity map's (D6): the map must not be silently
      // emptied by a delete. Untranslated that is "Internal server error" on
      // the admin screen, which is the incident `ChannelsService.remove`
      // already carries for the delivery ledger.
      () =>
        new ConflictException(
          "A severity still maps to this escalation profile. Point that severity at another " +
            "profile (or clear it) on the severity map, then delete this one.",
        ),
    );
    if (rows.length === 0) return false;

    await this.audit(jwt, "alarm_escalation_profile_delete", "alarm_escalation_profile", id, organizationId, {
      code: existing.code,
    });
    return true;
  }

  /**
   * One organization's severity → profile map.
   *
   * A single organization, so this runs under `withTenant` — §4.3's default,
   * and unlike `list` there is nothing here that spans tenants. A caller who
   * may not manage the organization is refused **before** the read, so there is
   * no read-then-403 of the kind the `list` fork exists to prevent.
   */
  async getDefaults(jwt: JwtPayload, organizationId?: string): Promise<EscalationDefaultsResponse> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    const targetOrgId = await this.resolveTargetOrg(jwt, user.role, organizationId);
    if (!(await this.accessControl.canManageNotificationChannel(jwt, targetOrgId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
    const items = await withTenant(this.db, targetOrgId, (tx) => readDefaults(tx, targetOrgId));
    return { organizationId: targetOrgId, items };
  }

  async setDefaults(
    jwt: JwtPayload,
    body: SetEscalationDefaultsBody,
  ): Promise<EscalationDefaultsResponse> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    const organizationId = await this.resolveTargetOrg(jwt, user.role, body.organizationId);
    if (!(await this.accessControl.canManageNotificationChannel(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }

    const items = await translate(
      () =>
        withTenant(this.db, organizationId, async (tx) => {
          // **Ask before inserting.** `0066`'s parent leg on `profile_id`
          // refuses another organization's profile with a row-level-security
          // error (42501), which no SQLSTATE translation here catches and which
          // surfaces as a 500. Under this same GUC an invisible profile is
          // either absent or another tenant's, and the answer is the same
          // either way — which also means the message discloses nothing about
          // what other organizations hold. The policy stays the floor, proven
          // in `escalation-profiles.rls.integration.spec.ts`.
          const wanted = [...new Set(body.items.map((item) => item.profileId))];
          if (wanted.length > 0) {
            const visible = await tx
              .select({ id: alarmEscalationProfiles.id })
              .from(alarmEscalationProfiles)
              .where(inArray(alarmEscalationProfiles.id, wanted));
            const seen = new Set(visible.map((row) => row.id));
            const missing = wanted.filter((profileId) => !seen.has(profileId));
            if (missing.length > 0) {
              throw new BadRequestException(
                `Profile(s) do not exist in this organization: ${missing.join(", ")}`,
              );
            }
          }

          await tx
            .delete(alarmEscalationDefaults)
            .where(eq(alarmEscalationDefaults.organizationId, organizationId));
          if (body.items.length > 0) {
            await tx.insert(alarmEscalationDefaults).values(
              body.items.map((item) => ({
                organizationId,
                severity: item.severity,
                profileId: item.profileId,
              })),
            );
          }
          return readDefaults(tx, organizationId);
        }),
      // The primary key is `(organization_id, severity)`, and the body schema
      // already refuses a repeated severity, so a unique violation here means
      // two concurrent writers rather than a malformed request.
      () =>
        new ConflictException(
          "The severity map changed while this write was in flight — reload it and try again",
        ),
      (constraint) => {
        if (constraint === DEFAULTS_SEVERITY_FK) {
          return new BadRequestException(
            "Unknown severity — it must be a code declared in bms.alarm_severities",
          );
        }
        if (constraint === DEFAULTS_PROFILE_FK) {
          return new BadRequestException("profileId does not name an existing escalation profile");
        }
        return new BadRequestException("organizationId does not name an existing organization");
      },
    );

    await this.audit(
      jwt,
      "alarm_escalation_defaults_set",
      "alarm_escalation_defaults",
      // The map has no id of its own — its primary key is `(organization_id,
      // severity)` and `audit_log.entity_id` is a single uuid, so the
      // organization is the only honest candidate. The `action` is what tells
      // this row apart from a profile write on the same organization.
      organizationId,
      organizationId,
      { itemCount: items.length, severities: items.map((item) => item.severity) },
    );
    return { organizationId, items };
  }

  /* ---------------------------------------------------------------------- */
  /* Resolution and gates                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Resolves which organization a write (or a map read) is for.
   *
   * `ChannelsService.resolveCreateTargetOrg`'s rule with one deliberate
   * difference: it **never returns `null`**. A channel omitted by an `admin`
   * becomes a fleet-managed global, which is a real thing; a profile cannot be,
   * because `alarm_escalation_profiles.organization_id` is `NOT NULL` and the
   * severity map is per organization by decision 7. So an `admin` who names no
   * organization is told to name one rather than handed a row nothing reads.
   */
  private async resolveTargetOrg(
    jwt: JwtPayload,
    role: UserRole,
    bodyOrgId: string | undefined,
  ): Promise<string> {
    if (bodyOrgId !== undefined) return bodyOrgId;
    if (role === "organization_admin") {
      const writable = (await this.accessControl.writableOrganizationIds(jwt)) ?? [];
      if (writable.length === 1) return writable[0] as string;
      if (writable.length === 0) {
        throw new ForbiddenException("You have no organization to administer escalation for");
      }
      throw new BadRequestException(
        "You manage more than one organization — specify organizationId explicitly",
      );
    }
    throw new BadRequestException(
      "organizationId is required — an escalation profile always belongs to one organization",
    );
  }

  /**
   * Every channel a ladder names resolves, is in the caller's scope, and pairs
   * with the profile's organization.
   *
   * Three refusals, in that order, and all of them **before** any transaction
   * opens:
   *   - `loadById` throws a 403 for a channel outside the caller's manage scope
   *     (its own gate, unchanged);
   *   - a `null` return is a 400 naming the id, rather than a fall-through to
   *     `alarm_escalation_step_channels_channel_id_fk`, which would report a
   *     database constraint to an operator who mistyped one field;
   *   - a channel whose organization is neither `null` nor the profile's is the
   *     pairing refusal (M2), collected so one message names every offender the
   *     way `setRuleChannels`' does.
   */
  private async assertChannelsPairWithOrg(
    jwt: JwtPayload,
    organizationId: string,
    steps: readonly { channelIds: readonly string[] }[],
  ): Promise<void> {
    const unique = [...new Set(steps.flatMap((step) => [...step.channelIds]))];
    const wrongOrg: string[] = [];
    for (const channelId of unique) {
      const channel = await this.channels.loadById(jwt, channelId);
      if (channel === null) {
        throw new BadRequestException(`Channel does not exist: ${channelId}`);
      }
      if (channel.organizationId !== null && channel.organizationId !== organizationId) {
        wrongOrg.push(channelId);
      }
    }
    if (wrongOrg.length > 0) {
      throw new BadRequestException(
        `Channel(s) belong to a different organization than this profile: ${wrongOrg.join(", ")}`,
      );
    }
  }

  /**
   * Pre-GUC resolution: the profile's own organization, read on `fleetDb`
   * before any tenant GUC exists to read it under (`E7.1b`'s classification,
   * the shape `ChannelsService.loadExistingForWrite` established). `null` when
   * the profile does not exist.
   */
  private async loadExistingForWrite(
    id: string,
  ): Promise<{ organizationId: string; code: string; name: string } | null> {
    const rows = await this.fleetDb
      .select({
        organizationId: alarmEscalationProfiles.organizationId,
        code: alarmEscalationProfiles.code,
        name: alarmEscalationProfiles.name,
      })
      .from(alarmEscalationProfiles)
      .where(eq(alarmEscalationProfiles.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /* ---------------------------------------------------------------------- */
  /* Writes                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Replace-all, the way `setRuleChannels` rewrites a rule's join set: a ladder
   * is a set, and "these are the steps" survives a lost request in a way "add
   * this one" does not. The `step_channels` rows go with their step through
   * `ON DELETE CASCADE`, so the delete below is the whole teardown.
   *
   * `step_no` is the 1-based position, assigned here and never taken from the
   * client, so `(profile_id, step_no)` can never be handed a gap or a duplicate.
   */
  private async replaceSteps(
    tx: BmsTx,
    profileId: string,
    steps: readonly { afterMinutes: number; channelIds: readonly string[] }[],
  ): Promise<void> {
    await tx.delete(alarmEscalationSteps).where(eq(alarmEscalationSteps.profileId, profileId));
    if (steps.length === 0) return;

    const inserted = await tx
      .insert(alarmEscalationSteps)
      .values(
        steps.map((step, index) => ({
          profileId,
          stepNo: index + 1,
          afterMinutes: step.afterMinutes,
        })),
      )
      .returning({ id: alarmEscalationSteps.id, stepNo: alarmEscalationSteps.stepNo });

    const byStepNo = new Map(inserted.map((row) => [row.stepNo, row.id]));
    const links = steps.flatMap((step, index) => {
      const stepId = byStepNo.get(index + 1);
      if (stepId === undefined) return [];
      return [...new Set(step.channelIds)].map((channelId) => ({ stepId, channelId }));
    });
    if (links.length > 0) await tx.insert(alarmEscalationStepChannels).values(links);
  }

  /**
   * The audit row, in `ChannelsService.audit()`'s shape and with its own copy
   * for plan D10's reason (that file adds nothing this unit).
   *
   * `entityType` is free-form on `audit_log`, so `alarm_escalation_profile` and
   * `alarm_escalation_defaults` need no vocabulary row. The payload carries
   * codes, ids and counts only (§9.6). The write stays on `fleetDb`: `bms_fleet`
   * is BYPASSRLS, so it is not subject to `audit_log`'s policy either way, and
   * the actor lookup is the same pre-tenant read it is there.
   */
  private async audit(
    actor: Pick<JwtPayload, "sub" | "email">,
    action: string,
    entityType: string,
    entityId: string,
    organizationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const [actorRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
      .limit(1);

    await this.fleetDb.insert(auditLog).values({
      organizationId,
      actorId: actorRow?.id ?? null,
      action,
      entityType,
      entityId,
      reason: null,
      payload: { ...payload, oidcSubject: actor.sub, actorEmail: actor.email },
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Reads and shaping                                                         */
/* ------------------------------------------------------------------------ */

/**
 * A profile's ladder, read back inside the write's own transaction.
 *
 * Read-back rather than assembled from the request: under `FORCE` a row that
 * did not land is a row this returns nothing for, so the response is what the
 * database holds and not what the caller hoped for.
 */
async function readSteps(tx: BmsTx, profileId: string): Promise<EscalationStepDto[]> {
  const rows = await tx
    .select({
      stepNo: alarmEscalationSteps.stepNo,
      afterMinutes: alarmEscalationSteps.afterMinutes,
      channelId: alarmEscalationStepChannels.channelId,
    })
    .from(alarmEscalationSteps)
    .leftJoin(
      alarmEscalationStepChannels,
      eq(alarmEscalationStepChannels.stepId, alarmEscalationSteps.id),
    )
    .where(eq(alarmEscalationSteps.profileId, profileId))
    .orderBy(alarmEscalationSteps.stepNo);
  return groupSteps(rows);
}

async function readDefaults(tx: BmsTx, organizationId: string): Promise<EscalationDefaultDto[]> {
  // The organization filter is redundant under the GUC and kept anyway: the
  // policy is the fence, and a `WHERE` that states the same thing is what makes
  // the read correct if it is ever moved off the tenant pool.
  const rows = await tx
    .select({
      severity: alarmEscalationDefaults.severity,
      profileId: alarmEscalationDefaults.profileId,
      profileCode: alarmEscalationProfiles.code,
    })
    .from(alarmEscalationDefaults)
    .innerJoin(
      alarmEscalationProfiles,
      and(
        eq(alarmEscalationProfiles.id, alarmEscalationDefaults.profileId),
        eq(alarmEscalationProfiles.organizationId, organizationId),
      ),
    )
    .where(eq(alarmEscalationDefaults.organizationId, organizationId))
    .orderBy(alarmEscalationDefaults.severity);
  return rows;
}

/**
 * Collapses a step/channel left join into one entry per step.
 *
 * A step with no channel arrives as one row with `channelId: null` — the left
 * join is deliberate, so a ladder rung an operator has not finished wiring is
 * still visible on the page rather than silently absent.
 */
function groupSteps(
  rows: readonly { stepNo: number; afterMinutes: number; channelId: string | null }[],
): EscalationStepDto[] {
  const byStepNo = new Map<number, EscalationStepDto>();
  for (const row of rows) {
    const step = byStepNo.get(row.stepNo) ?? {
      stepNo: row.stepNo,
      afterMinutes: row.afterMinutes,
      channelIds: [] as string[],
    };
    if (row.channelId !== null) step.channelIds.push(row.channelId);
    byStepNo.set(row.stepNo, step);
  }
  return [...byStepNo.values()].sort((a, b) => a.stepNo - b.stepNo);
}

/** The same collapse one level up, for `list`'s three-table join. */
function groupProfiles(rows: readonly ProfileJoinRow[]): EscalationProfileDto[] {
  const byId = new Map<string, { row: ProfileJoinRow; steps: ProfileJoinRow[] }>();
  for (const row of rows) {
    const entry = byId.get(row.id) ?? { row, steps: [] };
    if (row.stepNo !== null && row.afterMinutes !== null) entry.steps.push(row);
    byId.set(row.id, entry);
  }
  return [...byId.values()].map(({ row, steps }) =>
    toProfileDto(
      row,
      groupSteps(
        steps.map((step) => ({
          stepNo: step.stepNo as number,
          afterMinutes: step.afterMinutes as number,
          channelId: step.channelId,
        })),
      ),
    ),
  );
}

function toProfileDto(
  row: { id: string; organizationId: string; code: string; name: string; createdAt: Date; updatedAt: Date },
  steps: EscalationStepDto[],
): EscalationProfileDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    steps,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The two foreign keys a profile write can hit, told apart by name.
 *
 * `alarm_escalation_step_channels_channel_id_fk` is reachable only by a race —
 * `assertChannelsPairWithOrg` resolves every channel first — so its message
 * says the channel went away rather than blaming the field.
 */
function onProfileWriteForeignKey(constraint: string | undefined): Error {
  if (constraint === STEP_CHANNEL_FK) {
    return new BadRequestException(
      "A channel named by one of these steps no longer exists — reload the channel list",
    );
  }
  if (constraint === PROFILE_ORGANIZATION_FK) {
    return new BadRequestException("organizationId does not name an existing organization");
  }
  return new BadRequestException("The escalation profile references a row that does not exist");
}
