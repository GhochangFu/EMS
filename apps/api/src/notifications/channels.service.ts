import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import {
  automationRules,
  notificationChannels,
  notificationDeliveries,
  ruleNotifications,
} from "@bms/db";
import type {
  JwtPayload,
  NotificationChannelDto,
  NotificationDeliveryDto,
  NotificationReadinessDto,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import { SECRET_FIELD, toDto } from "./channel-dto";
import { parseDeliveryEvent } from "./dedupe-key";
import type { NotificationChannelRow } from "./notification-transport";
import type { NotificationsConfig } from "./notifications.config";
import type { ListDeliveriesQuery } from "./notifications.schema";
import { notificationReadiness } from "./readiness";

/**
 * `F3.8` — reading channels, and the **only** place a channel secret is
 * decrypted (ADR 0041 decision 8).
 *
 * Keeping decryption here is what lets every transport be written without a
 * `try`/`catch` around a key. `decrypt` throws on two states this service can
 * meet — an unset `CREDENTIAL_ENCRYPTION_KEY` (`CredentialKeyConfigError`) and
 * a stored `secret_key_version` no loaded key answers
 * (`CredentialKeyVersionError`, ADR 0062 decision 4) — and dispatch is
 * fire-and-forget, so a throw down in a transport would land in an unhandled
 * rejection instead of in front of an operator. This service asks
 * `isConfigured()` first — the static that exists for exactly this — and
 * reports `secretState: "unreadable"` rather than attempting the decrypt.
 *
 * A key of the wrong *length* never reaches here at all since ADR 0062
 * Amendment 1: the API refuses to boot on it, so it is a deployment failure
 * rather than a per-channel state. This paragraph named
 * `CredentialCryptoService.getKey()` until E8.4 deleted that method; the
 * sentence outlived the code it described by one task.
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
 *
 * **`F4.279` moved the writes out again**, into `ChannelWritesService`
 * (`channel-writes.service.ts`): the writes audit through `MasterDataAuditService`
 * (ADR 0099 Amendment 8), which imports the copilot request context, and this
 * service is in the worker's import closure (`notifications.service.ts` imports
 * it; `tests/f4.24-worker-imports-no-api-loop.test.ts` rule 8). What stays here
 * is what the worker and the reads need.
 */

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
 * `location_admin` to a real, non-empty set (through
 * `locationDerivedOrganizationIds`, the whole home organization), so a read
 * gated on it alone would disclose channel `config` and delivery/error
 * metadata that `loadById` then refuses with a 403 on the very same row —
 * read-then-403 on a payload that already leaked. A `location_admin` gets
 * `[]` from both reads, not a redacted or location-scoped view: `config`
 * cannot be redacted without losing the reason a read exists at all, and a
 * channel carries no location dimension to scope the second option to.
 * (`asset_group_admin` never reaches this fork at all — `isMasterDataRole`,
 * `access-scope.ts`, does not include it, so `requireMasterDataUser` above
 * refuses it with a 403 before either read runs.)
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
    // `F4.279`: the tenant pool served the writes, which moved to `ChannelWritesService`.
    // The slot stays so every hand-built `new ChannelsService(fleet, tenant, …)` keeps
    // its meaning; nothing here reads it.
    @Inject(TENANT_DRIZZLE) _tenantDb: BmsDb,
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
   * `location_admin` gets `[]` unconditionally — never a
   * `writableOrganizationIds`-filtered list — because `canManageNotification
   * Channel` returns `false` for it regardless of organization; the class
   * comment above has the incident this closes. (`asset_group_admin` never
   * reaches this method's body: `requireMasterDataUser` above already
   * refuses it with a 403.)
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
   * Recent delivery attempts, newest first — the same bounded shape as
   * executions.
   *
   * `E7.1c` (item G, the security-critical one): the select below
   * (`:id, organizationId, ruleId, ruleCode, alarmId, channelId, channelCode,
   * status, attemptedAt, error`, and since `F3.56` an eleventh column,
   * `dedupeKey`, which is **consumed in the `.map()` and never returned**)
   * carries no alarm text — no subject, message
   * or body — so the exposure the organization filter guards is channel
   * `config` (via `channelCode`/`channelId`, resolvable through `list()`) and
   * delivery/error metadata, not alarm content. `assertAdmin` came off this
   * route this item; `admin` is unfiltered, every other permitted role gets
   * `inArray(organizationId, writableOrganizationIds)` — deliveries are
   * `NOT NULL`-org since `0048`, so there is no global-*delivery* case to
   * reason about the way `list()` has one for channels.
   *
   * **There is a global-*channel* case, though, and `E7.1g` is it.** The
   * delivery's own organization is not the joined channel's: decision 7 keeps
   * a fleet-managed global shareable, so a tenant's row can point at a
   * `NULL`-org channel. ADR 0043 Amendment 6 rules that `error` is blanked for
   * a non-`admin` caller on such a row and `channelCode` is not — see the
   * `errorProjection` comment in the body.
   *
   * **The read gate is the write gate (ruling, 2026-08-27).** Same as
   * `list()`: a `location_admin` gets `{ items: [] }` unconditionally, not a
   * `writableOrganizationIds`-filtered read. (`asset_group_admin` is refused
   * earlier still, by `requireMasterDataUser`'s `isMasterDataRole` check.)
   *
   * **`F3.56` (ADR 0041 Amendment 8) — the row says what the attempt was FOR.**
   * `dedupe_key` is selected only so `parseDeliveryEvent` can derive `event`
   * from it in the `.map()` below; the key itself is dropped there and never
   * reaches a client. That is deliberate and was measured. The key carries a
   * rule uuid, an alarm uuid and the severity code, and the first two are
   * already DTO fields selected a few lines below — so the **incremental**
   * exposure returning it would create is the severity code, which is exactly
   * what Amendment 8 means by "`NotificationDeliveryDto` carries no severity
   * today". A derived kind adds no identifier at all. (`errorProjection` above
   * is a narrower thing than a general redaction of alarm detail: it blanks the
   * `error` column only, only for a non-`admin` caller, and only on a NULL-org
   * channel row.) Nothing on the write path changes —
   * ADR 0057 decision 9's "the kind lives in the dedupe key, not in a new
   * column" still holds, and `event` is a projection rather than a stored value.
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

    // `E7.1g` (ADR 0043 Amendment 6): a fleet-managed channel's failure detail
    // is redacted for a tenant; its code is not. Decision 7 lets a global admin
    // wire a NULL-org channel onto a tenant's rule, and `record()` stamps the
    // RULE's organization, so the delivery is legitimately in the tenant's
    // scope while the joined channel is fleet business — the same posture
    // `list()` states at the top of this class.
    //
    // Keyed on the caller's ROLE, not on `writableOrgIds === null`. `list()`
    // deliberately treats "unrestricted scope" as equivalent to `admin`; the
    // amendment says non-`admin`. Should a future role ever resolve to a null
    // scope, the role-keyed test still redacts and the scope-keyed one would
    // silently stop. `error` is the only redacted column: `channelCode` stays,
    // because ADR 0041 decision 10 needs a failed delivery to be identifiable.
    //
    // Done in SQL rather than in the `.map()` below so the detail never leaves
    // Postgres for a tenant — a row that crosses the wire can reach a query log
    // or an error dump.
    const errorProjection =
      user.role === "admin"
        ? notificationDeliveries.error
        : sql<string | null>`CASE WHEN ${notificationChannels.organizationId} IS NULL
             THEN NULL ELSE ${notificationDeliveries.error} END`;

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
        error: errorProjection,
        // `F3.56` — read for the derivation below and dropped there. See the
        // method comment for why it is not returned.
        dedupeKey: notificationDeliveries.dedupeKey,
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
        // `row` already carries `dedupeKey`, `ruleId` and `alarmId` as
        // `string | null`, so it satisfies the parameter with no adapter and no
        // optional field — an optional parameter at an adapter goes inert while
        // `tsc` exits 0 and every fake-based suite stays green.
        event: parseDeliveryEvent(row),
      })),
    };
  }

  /** Delegates to `notificationReadiness` in `readiness.ts` — moved out by `F3.56` (AGENTS.md §2). */
  async readiness(config: NotificationsConfig): Promise<NotificationReadinessDto[]> {
    return notificationReadiness(this.fleetDb, config);
  }

  /** The channel ids a rule currently notifies. */
  async ruleChannelIds(ruleId: string): Promise<string[]> {
    const rows = await this.fleetDb
      .select({ channelId: ruleNotifications.channelId })
      .from(ruleNotifications)
      .where(eq(ruleNotifications.ruleId, ruleId));
    return rows.map((row) => row.channelId);
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
        secretKeyVersion: notificationChannels.secretKeyVersion,
        updatedAt: notificationChannels.updatedAt,
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
   *
   * `secretKeyVersion` is **required**, not optional (ADR 0062 decision 3).
   * This parameter type is the whole definition of the projection —
   * `channel-reads.ts` derives `StoredChannelRow` from it — so a required
   * property is what makes a select that stops carrying the column a
   * compile error rather than a row that silently decrypts at the wrong key.
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
    secretKeyVersion: number | null;
    updatedAt: Date;
  }): NotificationChannelRow {
    const base = {
      id: row.id,
      organizationId: row.organizationId,
      code: row.code,
      name: row.name,
      kind: row.kind,
      config: (row.config ?? {}) as Record<string, unknown>,
      enabled: row.enabled,
      updatedAt: row.updatedAt,
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
      // The STORED version, undefaulted (ADR 0062 decision 4). The column is
      // nullable, and a `?? 1` here would be a guess: a null on a row that
      // holds ciphertext means nobody recorded which key wrote it. `decrypt`
      // refuses it with `CredentialKeyVersionError`, the catch below turns
      // that into `unreadable`, and the operator gets a state to fix instead
      // of a secret decrypted under a key that happened to verify.
      const payload = this.crypto.decrypt(
        row.secretCiphertext,
        row.secretIv,
        row.secretKeyVersion,
      );
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

