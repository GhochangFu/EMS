import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationChannels, ruleNotifications } from "@bms/db";

import { DRIZZLE } from "../database/database.tokens";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import type { NotificationChannelRow } from "./notification-transport";

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

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly crypto: CredentialCryptoService,
  ) {}

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
