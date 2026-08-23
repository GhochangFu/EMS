import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import {
  automationRules,
  notificationChannels,
  notificationDeliveries,
  ruleNotifications,
} from "@bms/db";
import type {
  NotificationChannelDto,
  NotificationDeliveryDto,
  NotificationReadinessDto,
} from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
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
   * What a foreign-key violation means for THIS operation.
   *
   * On a write it is always an undeclared `kind`. On a delete it is the
   * opposite direction — a row that still references the channel — and the two
   * need different sentences, because the actions they imply are different:
   * fix the kind, versus disable the channel instead of deleting it.
   */
  onForeignKey: () => Error = () =>
    new BadRequestException(
      "Unknown channel kind — it must be a code declared in bms.notification_channel_kinds",
    ),
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === UNIQUE_VIOLATION) {
      throw new ConflictException("A notification channel with that code already exists");
    }
    if (code === FOREIGN_KEY_VIOLATION) {
      throw onForeignKey();
    }
    throw err;
  }
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly crypto: CredentialCryptoService,
  ) {}

  /** Every channel, newest configuration first, as the admin screen shows them. */
  async list(): Promise<NotificationChannelDto[]> {
    const rows = await this.db
      .select()
      .from(notificationChannels)
      .orderBy(notificationChannels.code);
    return rows.map((row) => toDto(row));
  }

  /** One channel as the transports see it, or `null` when it does not exist. */
  async loadById(id: string): Promise<NotificationChannelRow | null> {
    const rows = await this.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : this.toChannelRow(row);
  }

  async create(body: CreateNotificationChannelBody): Promise<NotificationChannelDto> {
    const secret = this.encryptSecret(body.secret ?? null);
    const rows = await translateConstraintErrors(() =>
      this.db
        .insert(notificationChannels)
        .values({
          code: body.code,
          name: body.name,
          kind: body.kind,
          config: body.config,
          enabled: body.enabled,
          ...secret,
        })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new Error("channel insert returned no row");
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
    id: string,
    body: UpdateNotificationChannelBody,
  ): Promise<NotificationChannelDto | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) values.name = body.name;
    if (body.kind !== undefined) values.kind = body.kind;
    if (body.config !== undefined) values.config = body.config;
    if (body.enabled !== undefined) values.enabled = body.enabled;
    if (body.secret !== undefined) Object.assign(values, this.encryptSecret(body.secret));

    const rows = await translateConstraintErrors(() =>
      this.db
        .update(notificationChannels)
        .set(values)
        .where(eq(notificationChannels.id, id))
        .returning(),
    );
    const row = rows[0];
    return row === undefined ? null : toDto(row);
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
  async remove(id: string): Promise<boolean> {
    const rows = await translateConstraintErrors(
      () =>
        this.db
          .delete(notificationChannels)
          .where(eq(notificationChannels.id, id))
          .returning({ id: notificationChannels.id }),
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
    return rows.length > 0;
  }

  /** Recent delivery attempts, newest first — the same bounded shape as executions. */
  async listDeliveries(query: ListDeliveriesQuery): Promise<{ items: NotificationDeliveryDto[] }> {
    const filters = [
      query.channelId === undefined
        ? undefined
        : eq(notificationDeliveries.channelId, query.channelId),
      query.ruleId === undefined ? undefined : eq(notificationDeliveries.ruleId, query.ruleId),
    ].filter((f): f is NonNullable<typeof f> => f !== undefined);

    const rows = await this.db
      .select({
        id: notificationDeliveries.id,
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
      const rows = await this.db
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
  async setRuleChannels(ruleId: string, channelIds: string[]): Promise<string[] | null> {
    const rule = await this.db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(eq(automationRules.id, ruleId))
      .limit(1);
    if (rule.length === 0) return null;

    const unique = [...new Set(channelIds)];
    await this.db.transaction(async (tx) => {
      await tx.delete(ruleNotifications).where(eq(ruleNotifications.ruleId, ruleId));
      if (unique.length > 0) {
        await tx
          .insert(ruleNotifications)
          .values(unique.map((channelId) => ({ ruleId, channelId })));
      }
    });
    return unique;
  }

  /** The channel ids a rule currently notifies. */
  async ruleChannelIds(ruleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ channelId: ruleNotifications.channelId })
      .from(ruleNotifications)
      .where(eq(ruleNotifications.ruleId, ruleId));
    return rows.map((row) => row.channelId);
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
    const rows = await this.db
      .select({
        id: notificationChannels.id,
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
