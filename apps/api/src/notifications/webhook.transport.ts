import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Injectable, Logger } from "@nestjs/common";

import { notificationsConfig, type NotificationsConfig } from "./notifications.config";
import type {
  DeliveryResult,
  NotificationMessage,
  NotificationTransport,
} from "./notification-transport";
import {
  assertWebhookTargetAllowed,
  WebhookRefusedError,
  type ResolveHost,
} from "./webhook-guard";

/**
 * `F3.8` — the webhook transport (ADR 0041 decisions 2 and 6).
 *
 * A `POST` through the global `fetch` already used in `jwt-auth.guard.ts`, so
 * the webhook half of `F3.8` adds **no dependency** and keeps the `Depends`
 * cell at `—`.
 *
 * Every egress restriction lives here rather than in input validation, because
 * only the resolved address answers the question — see `webhook-guard.ts`.
 *
 * ## A residual risk this transport does not close
 *
 * The guard resolves the host, and then `fetch` resolves it again. Nothing
 * carries the vetted address down to the socket, so a name whose DNS answer
 * changes between the two calls (a DNS-rebinding attack) reaches an address
 * the guard never saw. Closing that properly means pinning the connect address
 * with a custom undici dispatcher, which is a new dependency and therefore an
 * AGENTS.md §9.4 decision the owner makes, not one this unit can take. The
 * window is small and the attacker must already control the DNS for a channel
 * an admin configured, but it is real and it is named here rather than
 * discovered later.
 */

/** Never follow a redirect: it is the standard way around an egress allowlist. */
const REDIRECT_MODE = "manual" as const;
const TIMEOUT_MS = 5_000;
/** How much of the endpoint's response is read for the `error` column. */
const MAX_ERROR_BODY_BYTES = 2_048;
/** The header carrying the HMAC of the exact bytes sent. */
export const SIGNATURE_HEADER = "x-trinetra-signature";

export type WebhookTransportDeps = {
  fetch: typeof globalThis.fetch;
  resolve: ResolveHost;
  config: NotificationsConfig;
};

/**
 * `dns.lookup`, not `dns.resolve4`/`resolve6`: it honours the hosts file and
 * the platform resolver, which is what `fetch` itself will use. `all: true`
 * returns every address, which is what makes "refuse if ANY is private"
 * possible.
 */
const defaultResolve: ResolveHost = async (host) => {
  const results = await lookup(host, { all: true });
  return results.map((r) => r.address);
};

@Injectable()
export class WebhookTransport implements NotificationTransport {
  readonly kind = "webhook";

  private readonly logger = new Logger(WebhookTransport.name);
  private readonly deps: WebhookTransportDeps;

  constructor(deps: Partial<WebhookTransportDeps> = {}) {
    this.deps = {
      // Bound: `fetch` throws "Illegal invocation" when called detached.
      fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
      resolve: deps.resolve ?? defaultResolve,
      config: deps.config ?? notificationsConfig,
    };
  }

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const { channel } = message;

    // The secret arrives decrypted (U3). This transport never touches
    // `CredentialCryptoService`, so it cannot throw on a missing key — it
    // reads the state and skips. An UNSIGNED post to an operator's endpoint is
    // worse than no post: the receiver cannot tell it from anyone else's.
    if (channel.secretState === "unreadable") {
      return { status: "skipped_unconfigured", error: "encryption key unavailable" };
    }

    const url = typeof channel.config.url === "string" ? channel.config.url.trim() : "";
    if (url === "") {
      return { status: "skipped_unconfigured", error: "channel has no url configured" };
    }

    try {
      await assertWebhookTargetAllowed(url, {
        allowInsecure: this.deps.config.webhookAllowInsecure,
        resolve: this.deps.resolve,
      });
    } catch (err) {
      if (err instanceof WebhookRefusedError) {
        // A refusal is a `failed` delivery, not a skip: a skip means "we chose
        // not to send", and this is "we tried and the target is not allowed".
        // The operator must see it in the deliveries view.
        this.logger.warn(
          `webhook refused for channel=${channel.code}: ${err.message}`,
        );
        return { status: "failed", error: err.message };
      }
      throw err;
    }

    // Signed over the exact bytes sent, not over a re-serialised object: two
    // serialisations of the same object can differ, and then the receiver's
    // HMAC never matches ours.
    const rawBody = JSON.stringify({
      ruleId: message.ruleId,
      ruleCode: message.ruleCode,
      alarmId: message.alarmId,
      severity: message.severity,
      subject: message.subject,
      body: message.body,
      channelCode: channel.code,
    });

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (channel.secret !== null && channel.secret !== "") {
      headers[SIGNATURE_HEADER] = createHmac("sha256", channel.secret)
        .update(rawBody, "utf8")
        .digest("hex");
    }

    try {
      const res = await this.deps.fetch(url, {
        method: "POST",
        headers,
        body: rawBody,
        redirect: REDIRECT_MODE,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // 2xx is a send; EVERYTHING else is a failure, including a 3xx and
      // including the `status: 0` an opaque redirect can arrive as. Written
      // this way rather than as an explicit 3xx branch so it is correct under
      // either behaviour of the client.
      if (res.status >= 200 && res.status < 300) {
        return { status: "sent", error: null };
      }

      const detail = await readBounded(res);
      return {
        status: "failed",
        // The status and a bounded excerpt — never the URL, which for Slack,
        // Teams and most SaaS endpoints is a bearer credential in its entirety.
        error: `webhook responded ${res.status}${detail === "" ? "" : `: ${detail}`}`,
      };
    } catch (err) {
      const reason = err instanceof Error ? (err.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS}ms` : err.message) : String(err);
      return { status: "failed", error: truncate(`webhook request failed: ${reason}`) };
    }
  }
}

/**
 * Reads at most {@link MAX_ERROR_BODY_BYTES} from the response.
 *
 * From the stream, not `await res.text()` followed by a slice: by the time
 * `text()` resolves the whole body is already in memory, and the only other
 * bound on it is the 5-second timeout. Nothing read here is parsed, trusted or
 * acted on — it exists so an operator can see what their endpoint said.
 */
async function readBounded(res: Response): Promise<string> {
  const body = res.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } catch {
    // A truncated or broken body is not worth failing over — the status is
    // already the answer.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(
    0,
    MAX_ERROR_BODY_BYTES,
  );
  return truncate(merged.toString("utf8").replace(/\s+/g, " ").trim());
}

function truncate(text: string): string {
  return text.length > MAX_ERROR_BODY_BYTES ? text.slice(0, MAX_ERROR_BODY_BYTES) : text;
}
