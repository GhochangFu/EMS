import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import {
  auditLog,
  automationRules,
  notificationChannels,
  notificationDeliveries,
  ruleNotifications,
  users,
} from "@bms/db";
import type {
  JwtPayload,
  NotificationChannelDto,
  NotificationDeliveryDto,
  NotificationReadinessDto,
  UserRole,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import type { NotificationChannelRow } from "./notification-transport";
import type { NotificationsConfig } from "./notifications.config";
import type {
  CreateNotificationChannelBody,
  ListDeliveriesQuery,
  UpdateNotificationChannelBody,
} from "./notifications.schema";

/**
 * `F3.8` — reading channels, and the **only** place a channel secret is
 * decrypted (ADR 0041 decision 8).
 *
 * Keeping decryption here is what lets every transport be written without a
 * `try`/`catch` around a key: `CredentialCryptoService.getKey()` throws when
 * `CREDENTIAL_ENCRYPTION_KEY` is unset or the wrong length, and dispatch is
 * fire-and-forget, so a throw down in a transport would land in an unhandled
 * rejection instead of in front of an operator. This service asks
 * `isConfigured()` first — the static that exists for exactly this — and
 * reports `secretState: "unreadable"` rather than attempting the decrypt.
 *
 * `WebhookTransport` turns that state into a recorded `skipped_unconfigured`
 * and sends nothing, which is the right answer: an unsigned POST to an
 * operator's endpoint is worse than no POST.
 *
 * **The plan assigned this file to U7.** It is written here, in U6, because
 * the alternative was a dispatcher that reported every secret-bearing channel
 * as `unreadable` for one whole unit — a wrong state that the storm-control
 * tests would then have been written against. U7 adds the CRUD methods to this
 * same service.
 */

/** The shape the ciphertext holds. `CredentialCryptoService` stores objects. */
const SECRET_FIELD = "secret";

const sqlCount = sql<number>`count(*)::int`;

/** Postgres SQLSTATEs this service can produce and must not answer with a 500. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Turns the two constraint violations a channel write can raise into the
 * answers they are.
 *
 * Without this, `POST` with a code that already exists — the first mistake
 * anyone makes on the admin screen — is a 500, and so is a `kind` the
 * vocabulary does not declare. The schema comment says the foreign key
 * "refuses an undeclared kind at write time with a clear database error", and
 * that is only true if something translates it.
 *
 * The message names the field, never the constraint internals: a client should
 * be told "that code is taken", not the index name.
 */
async function translateConstraintErrors<T>(
  run: () => Promise<T>,
  /**
   * What a foreign-key violation means for THIS operation, given the raw
   * error (so a caller can tell one constraint from another by `.constraint`
   * — see `create`'s override below).
   *
   * The default assumes the only FK a write can hit is `kind`, true until
   * `E7.1c` gave `create` a second one: `body.organizationId`, checked
   * against `bms.organizations(id)` as `notification_channels_organization_
   * id_fkey` (verified against `pg_constraint`, not assumed). On a delete the
   * direction is the opposite one anyway — a row that still references the
   * channel — so its own override never reads `err`.
   */
  onForeignKey: (err: unknown) => Error = () =>
    new BadRequestException(
      "Unknown channel kind — it must be a code declared in bms.notification_channel_kinds",
    ),
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === UNIQUE_VIOLATION) {
      // E7.1c (0048): identity re-keyed from a bare `code` to `(organization_id,
      // code)`, so the same code is fine in two different organizations — the
      // message must say which scope the collision is in, not imply it is global.
      throw new ConflictException(
        "That code is already used in this organization (or as a fleet-managed global channel)",
      );
    }
    if (code === FOREIGN_KEY_VIOLATION) {
      throw onForeignKey(err);
    }
    throw err;
  }
}

/** The Postgres constraint name behind `create`'s `body.organizationId` FK. */
const ORGANIZATION_ID_FK = "notification_channels_organization_id_fkey";

/**
 * `E7.1b` (ADR 0043 §5) — `notification_channels` and `notification_deliveries`
 * gained a **nullable** `organization_id` that item and a `tenant_isolation`
 * policy + `FORCE` in `0047`.
 *
 * `E7.1c` (decision 7, `0048`) re-keys `notification_channels` identity to
 * `(organization_id, code)` and moves `create`/`update`/`remove` onto
 * `withTenant` for an org-scoped channel — a **global** (`organization_id ===
 * null`) channel is fleet-managed by decision 7, so its writes stay on
 * `fleetDb` (BYPASSRLS): `0048` narrows the tenant policies' `NULL` branch
 * `TO bms_fleet` alone, so `bms_tenant` can no longer write one at all. An
 * existing NULL-org row also stays invisible/unmodifiable from any tenant GUC
 * under `FORCE` — no `current_org` ever makes `NULL = current_org` true — so a
 * mixed org-scoped/global set genuinely needs the fork this item adds, not
 * just a permissions tightening.
 *
 * `list`, `loadById` and `listDeliveries` gain an organization filter for the
 * same reason `PointKeysAdminService.list` has one: `assertAdmin` came off
 * these routes this item (`canManageNotificationChannel` replaces it), and an
 * unfiltered read would hand one tenant's channel config, or another's
 * delivery/error metadata off the ledger, to any `organization_admin`. (Not
 * "alarm text" — the ledger select never carries a subject, message or body;
 * see `listDeliveries`' own comment.)
 *
 * `list` and `listDeliveries` gate on exactly the role `canManageNotification
 * Channel` would ever return `true` for — `admin` or `organization_admin` —
 * rather than merely on `isMasterDataRole`. Ruled 2026-08-27, after two
 * reviewers found the gap independently: `writableOrganizationIds` resolves a
 * `location_admin`/`asset_group_admin` to a real, non-empty set (through
 * `locationDerivedOrganizationIds`, the whole home organization), so a read
 * gated on it alone would disclose channel `config` and delivery/error
 * metadata that `loadById` then refuses with a 403 on the very same row —
 * read-then-403 on a payload that already leaked. A `location_admin` gets
 * `[]` from both reads, not a redacted or location-scoped view: `config`
 * cannot be redacted without losing the reason a read exists at all, and a
 * channel carries no location dimension to scope the second option to.
 *
 * The one exception is `setRuleChannels`: the `rule_notifications` junction's
 * tenant parent is the rule, which **does** carry a non-NULL org, and its route
 * is org-scoped (`assertRuleInScope`), so that write runs inside
 * `withTenant(rule.org)` and refuses a NULL-org rule rather than silently
 * no-op'ing the junction rewrite under `FORCE`. (`0047`'s `rule_notifications`
 * policy must therefore key on `automation_rules.organization_id`.)
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    private readonly crypto: CredentialCryptoService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * Every channel this caller may see, newest configuration first.
   *
   * `E7.1c` (item G): `assertAdmin` came off this route this item, so the
   * filter below is what stops it from handing every tenant's channel names
   * and `config` to any `organization_admin`. `admin` (and, generically, any
   * master-data role with unrestricted scope) sees everything, including
   * fleet-managed globals. Every other role sees only its own writable
   * organizations' channels — **not** the globals: the plan's own
   * recommendation (§9.5, not ruled by an ADR — a small, non-blocking call)
   * is that a fleet-managed row is fleet business, so an `organization_admin`
   * sees an unresolvable channel id on a rule wired to one until `E7.1d`
   * gives it its own picker.
   *
   * **The read gate is the write gate (ruling, 2026-08-27).** A
   * `location_admin`/`asset_group_admin` gets `[]` unconditionally — never a
   * `writableOrganizationIds`-filtered list — because `canManageNotification
   * Channel` returns `false` for both roles regardless of organization; the
   * class comment above has the incident this closes.
   */
  async list(jwt: JwtPayload): Promise<NotificationChannelDto[]> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      return [];
    }
    const writableOrgIds = await this.accessControl.writableOrganizationIds(jwt);
    if (writableOrgIds !== null && writableOrgIds.length === 0) {
      return [];
    }
    const rows = await this.fleetDb
      .select()
      .from(notificationChannels)
      .where(
        writableOrgIds === null
          ? undefined
          : inArray(notificationChannels.organizationId, writableOrgIds),
      )
      .orderBy(notificationChannels.code);
    return rows.map((row) => toDto(row));
  }

  /**
   * One channel as the transports see it, or `null` when it does not exist.
   *
   * `E7.1c` (item G): gated the same way `list` is, because this is the read
   * `testChannel` uses to decide what to send through — an unfiltered load
   * would let any master-data role send (and read the outcome of) a test
   * through another tenant's channel.
   */
  async loadById(jwt: JwtPayload, id: string): Promise<NotificationChannelRow | null> {
    await this.accessControl.requireMasterDataUser(jwt);
    const rows = await this.fleetDb
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    if (!(await this.accessControl.canManageNotificationChannel(jwt, row.organizationId))) {
      throw new ForbiddenException("Notification channel is outside your access scope");
    }
    return this.toChannelRow(row);
  }

  /**
   * Resolves who a create is for, before the gate runs.
   *
   * `body.organizationId` wins when supplied (Blocker 1's ruling: an `admin`
   * who supplies one creates an org-scoped channel; an `organization_admin`
   * who supplies their own org is explicit about it). Omitted, an
   * `organization_admin` with exactly one direct grant gets it implicitly —
   * more than one is ambiguous and must be named, zero is refused below by
   * the gate having nothing to approve. Omitted by anyone else (`admin`,
   * `location_admin`), the target is `null`: a global, fleet-managed channel,
   * exactly today's behaviour — the reason the web UI needs no change and
   * `E7.1d` stays out of this slice.
   */
  private async resolveCreateTargetOrg(
    jwt: JwtPayload,
    role: UserRole,
    bodyOrgId: string | undefined,
  ): Promise<string | null> {
    if (bodyOrgId !== undefined) return bodyOrgId;
    if (role !== "organization_admin") return null;
    const writable = (await this.accessControl.writableOrganizationIds(jwt)) ?? [];
    if (writable.length === 1) return writable[0] as string;
    if (writable.length === 0) {
      throw new ForbiddenException("You have no organization to create a channel in");
    }
    throw new BadRequestException(
      "You manage more than one organization — specify organizationId explicitly",
    );
  }

  /** Pre-GUC resolution (E7.1b's classification): the row's own organization_id,
   * read on fleetDb before any tenant GUC exists to read it under. `null` when
   * the channel does not exist. */
  private async loadExistingForWrite(
    id: string,
  ): Promise<{ organizationId: string | null } | null> {
    const rows = await this.fleetDb
      .select({ organizationId: notificationChannels.organizationId })
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    jwt: JwtPayload,
    body: CreateNotificationChannelBody,
  ): Promise<NotificationChannelDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    const targetOrgId = await this.resolveCreateTargetOrg(jwt, user.role, body.organizationId);
    if (!(await this.accessControl.canManageNotificationChannel(jwt, targetOrgId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }

    const secret = this.encryptSecret(body.secret ?? null);
    const values = {
      organizationId: targetOrgId,
      code: body.code,
      name: body.name,
      kind: body.kind,
      config: body.config,
      enabled: body.enabled,
      ...secret,
    };

    const row = await translateConstraintErrors(
      async () => {
        const rows =
          targetOrgId === null
            ? await this.fleetDb.insert(notificationChannels).values(values).returning()
            : await withTenant(this.db, targetOrgId, (tx) =>
                tx.insert(notificationChannels).values(values).returning(),
              );
        const inserted = rows[0];
        if (inserted === undefined) throw new Error("channel insert returned no row");
        return inserted;
      },
      (err) => {
        const constraint = (err as { constraint?: string } | null)?.constraint;
        if (constraint === ORGANIZATION_ID_FK) {
          return new BadRequestException(
            "organizationId does not name an existing organization",
          );
        }
        return new BadRequestException(
          "Unknown channel kind — it must be a code declared in bms.notification_channel_kinds",
        );
      },
    );

    await this.audit(jwt, "notification_channel_create", row.id, row.organizationId, {
      code: row.code,
      kind: row.kind,
      hasSecret: row.secretCiphertext !== null,
      enabled: row.enabled,
    });
    return toDto(row);
  }

  /**
   * Applies a PATCH.
   *
   * Three intentions stay distinct: omitting `secret` keeps the stored one,
   * `null` clears all three columns, and a string replaces it. A single
   * optional string could not express "clear it".
   */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateNotificationChannelBody,
  ): Promise<NotificationChannelDto | null> {
    await this.accessControl.requireMasterDataUser(jwt);
    const existing = await this.loadExistingForWrite(id);
    if (existing === null) return null;
    if (!(await this.accessControl.canManageNotificationChannel(jwt, existing.organizationId))) {
      throw new ForbiddenException("Notification channel is outside your access scope");
    }

    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) values.name = body.name;
    if (body.kind !== undefined) values.kind = body.kind;
    if (body.config !== undefined) values.config = body.config;
    if (body.enabled !== undefined) values.enabled = body.enabled;
    if (body.secret !== undefined) Object.assign(values, this.encryptSecret(body.secret));

    const row = await translateConstraintErrors(async () => {
      // A foreign-org row can never reach this point — the gate above already
      // refused it. If it ever did (a gate bug, or a race with a delete), an
      // UPDATE under FORCE matches ZERO ROWS WITHOUT ERRORING (no current_org
      // makes NULL/another-org's id equal this GUC's), which falls through to
      // `row === undefined` below and the existing 404 — never a corrupted
      // write. That silent zero is a backstop here, not the authorization; do
      // not "fix" it into a thrown error.
      const rows =
        existing.organizationId === null
          ? await this.fleetDb
              .update(notificationChannels)
              .set(values)
              .where(eq(notificationChannels.id, id))
              .returning()
          : await withTenant(this.db, existing.organizationId, (tx) =>
              tx
                .update(notificationChannels)
                .set(values)
                .where(eq(notificationChannels.id, id))
                .returning(),
            );
      return rows[0];
    });
    if (row === undefined) return null;
    await this.audit(jwt, "notification_channel_update", row.id, existing.organizationId, {
      code: row.code,
      // Which FIELDS changed, never their values — `secret` is one of them.
      changed: Object.keys(body).sort(),
      secretRotated: body.secret !== undefined && body.secret !== null,
      secretCleared: body.secret === null,
      enabled: row.enabled,
    });
    return toDto(row);
  }

  /**
   * Deletes a channel.
   *
   * The foreign keys decide what happens next, and they are not symmetrical:
   * `rule_notifications` rows go with the rule, not with the channel, so a
   * channel still joined to a rule cannot be deleted until it is detached, and
   * a channel with delivery history cannot be deleted at all. Both refusals are
   * Postgres's, and both are deliberate — history must outlive configuration
   * (migration 0038) — so both are translated into a 409 that says what to do
   * instead, rather than a 500 that says nothing.
   */
  async remove(jwt: JwtPayload, id: string): Promise<boolean> {
    await this.accessControl.requireMasterDataUser(jwt);
    const existing = await this.loadExistingForWrite(id);
    if (existing === null) return false;
    if (!(await this.accessControl.canManageNotificationChannel(jwt, existing.organizationId))) {
      throw new ForbiddenException("Notification channel is outside your access scope");
    }

    const rows = await translateConstraintErrors(
      () =>
        existing.organizationId === null
          ? this.fleetDb
              .delete(notificationChannels)
              .where(eq(notificationChannels.id, id))
              .returning({ id: notificationChannels.id })
          : withTenant(this.db, existing.organizationId as string, (tx) =>
              tx
                .delete(notificationChannels)
                .where(eq(notificationChannels.id, id))
                .returning({ id: notificationChannels.id }),
            ),
      // Found by clicking Delete in the browser: sending one test writes a
      // ledger row, and from then on the channel cannot be deleted. That
      // refusal is the design — history outlives configuration — but it
      // surfaced as "Internal server error", which tells an operator nothing
      // and looks like a fault in the screen.
      () =>
        new ConflictException(
          "This channel has delivery history and cannot be deleted. Disable it instead — " +
            "the ledger must keep the attempts it already recorded.",
        ),
    );
    if (rows.length === 0) return false;
    await this.audit(jwt, "notification_channel_delete", id, existing.organizationId, {});
    return true;
  }

  /**
   * Recent delivery attempts, newest first — the same bounded shape as
   * executions.
   *
   * `E7.1c` (item G, the security-critical one): the select below
   * (`:id, organizationId, ruleId, ruleCode, alarmId, channelId, channelCode,
   * status, attemptedAt, error`) carries no alarm text — no subject, message
   * or body — so the exposure the organization filter guards is channel
   * `config` (via `channelCode`/`channelId`, resolvable through `list()`) and
   * delivery/error metadata, not alarm content. `assertAdmin` came off this
   * route this item; `admin` is unfiltered, every other permitted role gets
   * `inArray(organizationId, writableOrganizationIds)` — deliveries are
   * `NOT NULL`-org since `0048`, so there is no global-delivery case to
   * reason about the way `list()` has one for channels.
   *
   * **The read gate is the write gate (ruling, 2026-08-27).** Same as
   * `list()`: a `location_admin`/`asset_group_admin` gets `{ items: [] }`
   * unconditionally, not a `writableOrganizationIds`-filtered read.
   */
  async listDeliveries(
    jwt: JwtPayload,
    query: ListDeliveriesQuery,
  ): Promise<{ items: NotificationDeliveryDto[] }> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      return { items: [] };
    }
    const writableOrgIds = await this.accessControl.writableOrganizationIds(jwt);
    if (writableOrgIds !== null && writableOrgIds.length === 0) {
      return { items: [] };
    }

    const filters = [
      query.channelId === undefined
        ? undefined
        : eq(notificationDeliveries.channelId, query.channelId),
      query.ruleId === undefined ? undefined : eq(notificationDeliveries.ruleId, query.ruleId),
      writableOrgIds === null
        ? undefined
        : inArray(notificationDeliveries.organizationId, writableOrgIds),
    ].filter((f): f is NonNullable<typeof f> => f !== undefined);

    const rows = await this.fleetDb
      .select({
        id: notificationDeliveries.id,
        organizationId: notificationDeliveries.organizationId,
        ruleId: notificationDeliveries.ruleId,
        ruleCode: automationRules.code,
        alarmId: notificationDeliveries.alarmId,
        channelId: notificationDeliveries.channelId,
        channelCode: notificationChannels.code,
        status: notificationDeliveries.status,
        attemptedAt: notificationDeliveries.attemptedAt,
        error: notificationDeliveries.error,
      })
      .from(notificationDeliveries)
      .innerJoin(
        notificationChannels,
        eq(notificationDeliveries.channelId, notificationChannels.id),
      )
      // LEFT, not INNER: rule_id is nullable — a send test has no rule.
      .leftJoin(automationRules, eq(notificationDeliveries.ruleId, automationRules.id))
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(notificationDeliveries.attemptedAt))
      .limit(query.limit);

    return {
      items: rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        ruleId: row.ruleId,
        ruleCode: row.ruleCode,
        alarmId: row.alarmId,
        channelId: row.channelId,
        channelCode: row.channelCode,
        status: row.status as NotificationDeliveryDto["status"],
        attemptedAt: row.attemptedAt.toISOString(),
        error: row.error,
      })),
    };
  }

  /**
   * Whether each kind can actually send (decision 5).
   *
   * Authenticated but not admin-only, and this is what makes that safe: one
   * boolean and one sentence per kind, with no host, no port and no credential
   * in either. A location-scoped operator editing a rule marked `notify` is
   * exactly the person who must learn that nothing is configured.
   *
   * **`configured` and `detail` never disagree.** The first draft reported
   * webhook as `configured: true` while the sentence said
   * `CREDENTIAL_ENCRYPTION_KEY` was missing — and decision 5 ties readiness to
   * "the same visible-when-absent treatment E8.4 specifies for an unconfigured
   * CREDENTIAL_ENCRYPTION_KEY", so a banner keyed on the boolean would have
   * shown nothing while every secret-bearing webhook channel skipped. The
   * boolean now costs one COUNT: webhooks are ready unless a channel actually
   * stores a secret that cannot be read. A deployment with no signed webhook
   * is genuinely unaffected by a missing key, and says so.
   */
  async readiness(config: NotificationsConfig): Promise<NotificationReadinessDto[]> {
    const keyReady = CredentialCryptoService.isConfigured();
    let secretBearingChannels = 0;
    if (!keyReady) {
      const rows = await this.fleetDb
        .select({ count: sqlCount })
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.enabled, true),
            isNotNull(notificationChannels.secretCiphertext),
          ),
        );
      secretBearingChannels = rows[0]?.count ?? 0;
    }
    const webhooksReady = keyReady || secretBearingChannels === 0;

    return [
      {
        kind: "email",
        configured: config.smtp !== null,
        detail:
          config.smtp === null
            ? "SMTP_HOST is not set, so email notifications are recorded as skipped."
            : "SMTP is configured.",
      },
      {
        kind: "webhook",
        configured: webhooksReady,
        detail: webhooksReady
          ? "Webhooks send over https to public addresses only."
          : `CREDENTIAL_ENCRYPTION_KEY is not set, so ${secretBearingChannels} webhook ` +
            "channel(s) with a stored secret cannot be signed and are recorded as skipped.",
      },
    ];
  }

  /**
   * Replaces the set of channels a rule notifies (plan D1).
   *
   * **The whole set, not a delta.** A join is a set, and "these are the
   * channels" survives a lost or repeated request in a way "add this one" does
   * not. Delete-then-insert inside one transaction, so a rule is never left
   * notifying nobody because the second statement failed.
   *
   * Returns `null` when the rule does not exist, so the caller can answer 404
   * rather than letting a foreign-key violation surface as a 500.
   *
   * This lives here rather than in `RulesService` for a mundane reason worth
   * recording: that file is at 953 lines against the AGENTS.md §4.5 cap of
   * 1000, and the join is notification state, not rule state. `RulesModule`
   * imports `NotificationsModule`, which imports nothing from rules — checked,
   * not assumed.
   */
  async setRuleChannels(
    ruleId: string,
    channelIds: string[],
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<string[] | null> {
    const [rule] = await this.fleetDb
      .select({ id: automationRules.id, organizationId: automationRules.organizationId })
      .from(automationRules)
      .where(eq(automationRules.id, ruleId))
      .limit(1);
    if (rule === undefined) return null;
    if (!rule.organizationId) {
      // E7.1b: the junction rewrite runs under the rule's org GUC; a NULL-org
      // rule would silently no-op it under FORCE. Refuse rather than corrupt.
      throw new BadRequestException("Rule has no organization; run the 0046 backfill");
    }
    const organizationId = rule.organizationId;

    const unique = [...new Set(channelIds)];
    if (unique.length > 0) {
      // The junction has no policy of its own to catch this (0047's
      // rule_notifications policy tests automation_rules.organization_id
      // alone — channel org was nullable when it was written, 0048 made it a
      // real key, and nothing enforces the pairing). Refuse before the
      // insert rather than silently wiring a rule to another tenant's
      // channel. A channel id this batch cannot resolve at all is left to the
      // existing foreign-key refusal at insert time; only a channel that
      // resolves to a DIFFERENT organization is rejected here — a
      // fleet-managed global (organizationId === null) stays shareable per
      // decision 7.
      const channelRows = await this.fleetDb
        .select({ id: notificationChannels.id, organizationId: notificationChannels.organizationId })
        .from(notificationChannels)
        .where(inArray(notificationChannels.id, unique));
      const orgById = new Map(channelRows.map((row) => [row.id, row.organizationId]));
      const wrongOrg = unique.filter((id) => {
        const channelOrg = orgById.get(id);
        return channelOrg !== undefined && channelOrg !== null && channelOrg !== organizationId;
      });
      if (wrongOrg.length > 0) {
        throw new BadRequestException(
          `Channel(s) belong to a different organization than this rule: ${wrongOrg.join(", ")}`,
        );
      }
    }
    await withTenant(this.db, organizationId, async (tx) => {
      await tx.delete(ruleNotifications).where(eq(ruleNotifications.ruleId, ruleId));
      if (unique.length > 0) {
        await tx
          .insert(ruleNotifications)
          .values(unique.map((channelId) => ({ ruleId, channelId })));
      }
    });
    await this.audit(actor, "rule_notifications_set", ruleId, organizationId, {
      ruleId,
      channelIds: unique,
      // The interesting case: emptying the set silences a rule, and without a
      // row that change is invisible once the rule simply stops notifying.
      cleared: unique.length === 0,
    });
    return unique;
  }

  /** The channel ids a rule currently notifies. */
  async ruleChannelIds(ruleId: string): Promise<string[]> {
    const rows = await this.fleetDb
      .select({ channelId: ruleNotifications.channelId })
      .from(ruleNotifications)
      .where(eq(ruleNotifications.ruleId, ruleId));
    return rows.map((row) => row.channelId);
  }

  /**
   * Writes one `bms.audit_log` row for a notification change.
   *
   * **Audits the action, never the request body.** `bms.audit_log.payload` is
   * returned verbatim by `GET /admin/audit`, and
   * `createNotificationChannelBodySchema` carries a `secret` field — so
   * spreading the body here, the obvious shortcut, would put a plaintext
   * webhook HMAC key in front of every auditor. That is ADR 0021 decision 6's
   * standing obligation, and it is the reason this takes named fields.
   *
   * Deciding who is told about an alarm is a configuration change of the same
   * class as editing the rule itself, and `rules.service.ts` audits six such
   * paths. Before this, creating a channel, rotating its secret, deleting it,
   * or emptying a rule's channel set left no trace at all — so silencing a
   * site's notifications was unattributable. Found by the `F3.8` security
   * review.
   *
   * **`organizationId` (E7.1c, closing the item-D hazard):** the channel's own
   * org for an org-scoped channel, `ruleOrg` for `rule_notifications_set` (a
   * tenant action on a rule that is always org-scoped since `0047`), and
   * `null` **only** for a genuinely fleet-managed global channel. Until this
   * item every row here was `null` because every channel was global, and that
   * was correct only for as long as it stayed true — `bms-schema.ts`'s own
   * comment on `audit_log.organization_id` states the rule this closes: "a
   * NULL on [a tenant-scoped row] is a defect, not a platform event." This
   * write stays on `fleetDb` regardless of the stamped org: `bms_fleet` is
   * BYPASSRLS, so it is not subject to `audit_log`'s policy either way, and the
   * actor-identity lookup just below is the same pre-tenant read it always was.
   */
  private async audit(
    actor: Pick<JwtPayload, "sub" | "email">,
    action: string,
    entityId: string | null,
    organizationId: string | null,
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
      entityType: "notification_channel",
      entityId,
      reason: null,
      payload: { ...payload, oidcSubject: actor.sub, actorEmail: actor.email },
    });
  }

  /** `{ secret }` encrypted, or all three columns cleared. */
  private encryptSecret(secret: string | null): {
    secretCiphertext: Buffer | null;
    secretIv: Buffer | null;
    secretKeyVersion: number | null;
  } {
    if (secret === null) {
      return { secretCiphertext: null, secretIv: null, secretKeyVersion: null };
    }
    const payload = this.crypto.encrypt({ [SECRET_FIELD]: secret });
    return {
      secretCiphertext: payload.ciphertext,
      secretIv: payload.iv,
      secretKeyVersion: payload.keyVersion,
    };
  }

  /** The enabled channels joined to a rule, in channel-code order. */
  async loadForRule(ruleId: string): Promise<NotificationChannelRow[]> {
    const rows = await this.fleetDb
      .select({
        id: notificationChannels.id,
        organizationId: notificationChannels.organizationId,
        code: notificationChannels.code,
        name: notificationChannels.name,
        kind: notificationChannels.kind,
        config: notificationChannels.config,
        enabled: notificationChannels.enabled,
        secretCiphertext: notificationChannels.secretCiphertext,
        secretIv: notificationChannels.secretIv,
      })
      .from(ruleNotifications)
      .innerJoin(notificationChannels, eq(ruleNotifications.channelId, notificationChannels.id))
      .where(and(eq(ruleNotifications.ruleId, ruleId), eq(notificationChannels.enabled, true)))
      .orderBy(notificationChannels.code);

    return rows.map((row) => this.toChannelRow(row));
  }

  /**
   * Turns a stored row into what the transports see.
   *
   * Never throws. Every failure to read a secret becomes `unreadable`, because
   * the caller is on a fire-and-forget path.
   */
  toChannelRow(row: {
    id: string;
    organizationId: string | null;
    code: string;
    name: string;
    kind: string;
    config: unknown;
    enabled: boolean;
    secretCiphertext: Buffer | null;
    secretIv: Buffer | null;
  }): NotificationChannelRow {
    const base = {
      id: row.id,
      organizationId: row.organizationId,
      code: row.code,
      name: row.name,
      kind: row.kind,
      config: (row.config ?? {}) as Record<string, unknown>,
      enabled: row.enabled,
    };

    if (row.secretCiphertext === null || row.secretIv === null) {
      return { ...base, secret: null, secretState: "none" };
    }
    if (!CredentialCryptoService.isConfigured()) {
      // Not an error worth a stack trace on every dispatch — it is a
      // configuration state the readiness route reports and the banner shows.
      return { ...base, secret: null, secretState: "unreadable" };
    }
    try {
      const payload = this.crypto.decrypt(row.secretCiphertext, row.secretIv);
      const secret = payload[SECRET_FIELD];
      if (typeof secret !== "string" || secret === "") {
        return { ...base, secret: null, secretState: "unreadable" };
      }
      return { ...base, secret, secretState: "ready" };
    } catch (err) {
      // A wrong key, a rotated key, or a corrupted row. The message never
      // carries the ciphertext or the key (§9.6).
      this.logger.warn(
        `channel=${row.code} secret could not be decrypted: ${
          err instanceof Error ? err.name : "unknown error"
        }`,
      );
      return { ...base, secret: null, secretState: "unreadable" };
    }
  }
}

/**
 * A stored row as the API returns it.
 *
 * `hasSecret`, never the secret — not the plaintext, not the ciphertext, not
 * the key version (§9.6, ADR 0041 decision 8). The boolean is the whole of what
 * the admin screen needs to render "secret set".
 */
function toDto(row: {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  kind: string;
  config: unknown;
  enabled: boolean;
  secretCiphertext: Buffer | null;
  createdAt: Date;
  updatedAt: Date;
}): NotificationChannelDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    kind: row.kind,
    config: (row.config ?? {}) as Record<string, unknown>,
    enabled: row.enabled,
    hasSecret: row.secretCiphertext !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
