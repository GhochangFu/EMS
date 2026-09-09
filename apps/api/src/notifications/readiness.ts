import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationChannels } from "@bms/db";
import type { NotificationReadinessDto } from "@bms/shared";

import { CredentialCryptoService } from "../security/credential-crypto.service";
import type { NotificationsConfig } from "./notifications.config";

// Moved out of `channels.service.ts` by `F3.56`: that file was 989 lines
// against the AGENTS.md §2/§4.5 cap, and this was the extraction the owner
// ruled (2026-09-10) to make room before the item added to it.
//
// A `//` header rather than a JSDoc block on purpose: a `/** */` here would
// bind to `sqlCount` below, about which it says nothing.

const sqlCount = sql<number>`count(*)::int`;

/**
 * Lives here, not in `ChannelsService`, so the 989-line file could add
 * `F3.56`'s ~10 lines without breaching the AGENTS.md §2 cap.
 *
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
export async function notificationReadiness(
  fleetDb: BmsDb,
  config: NotificationsConfig,
): Promise<NotificationReadinessDto[]> {
  const keyReady = CredentialCryptoService.isConfigured();
  let secretBearingChannels = 0;
  if (!keyReady) {
    const rows = await fleetDb
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
