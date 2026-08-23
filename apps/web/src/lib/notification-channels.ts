import type {
  NotificationChannelDto,
  NotificationDeliveryStatus,
  NotificationTestResult,
} from "@bms/shared";

import type { NotificationChannelPayload } from "../api/notifications";

/**
 * `F3.8` — the decisions the notification screens make, as pure functions
 * (ADR 0041, ADR 0042 decision 7).
 *
 * A component test proves the text reaches the screen; these prove the text is
 * right. Both matter and they are cheapest apart.
 */

export type ChannelForm = {
  code: string;
  name: string;
  kind: string;
  /** Recipients for `email`, the URL for `webhook`. One box, two meanings. */
  target: string;
  /** Always empty when a form is opened — a stored secret is never readable. */
  secret: string;
  enabled: boolean;
};

export function blankChannelForm(): ChannelForm {
  return { code: "", name: "", kind: "email", target: "", secret: "", enabled: true };
}

/**
 * Opens an existing channel for editing.
 *
 * `secret` is always `""`, never a placeholder that looks like a value. The DTO
 * carries `hasSecret` and nothing else about it, so there is nothing to
 * populate the box with — and a fake value would teach an operator that the
 * stored secret is retrievable, which is exactly what §9.6 and ADR 0041
 * decision 8 arrange for it not to be.
 */
export function formFromChannel(channel: NotificationChannelDto): ChannelForm {
  return {
    code: channel.code,
    name: channel.name,
    kind: channel.kind,
    target: targetFromConfig(channel),
    secret: "",
    enabled: channel.enabled,
  };
}

/** The recipient list or the URL, whichever this kind keeps in `config`. */
export function targetFromConfig(channel: NotificationChannelDto): string {
  const url = channel.config.url;
  if (typeof url === "string" && url !== "") return url;
  const to = channel.config.to;
  if (Array.isArray(to)) {
    return to.filter((entry): entry is string => typeof entry === "string").join(", ");
  }
  return typeof to === "string" ? to : "";
}

/**
 * Turns the form into a request body.
 *
 * **An untouched secret box omits `secret` entirely**, which is what tells the
 * API to keep the stored one. Sending `""` would clear it, so an operator who
 * renames a channel would silently unsign every webhook it serves. The three
 * intentions the API distinguishes — keep, clear, replace — are only reachable
 * if the client stops flattening two of them into one.
 */
export function channelFormToPayload(form: ChannelForm): NotificationChannelPayload {
  const target = form.target.trim();
  const config =
    form.kind === "email"
      ? {
          to: target
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
        }
      : { url: target };

  const payload: NotificationChannelPayload = {
    code: form.code.trim(),
    name: form.name.trim(),
    kind: form.kind,
    config,
    enabled: form.enabled,
  };
  if (form.secret !== "") payload.secret = form.secret;
  return payload;
}

/** The five delivery statuses, as an operator reads them. */
export function deliveryStatusLabel(status: NotificationDeliveryStatus): string {
  switch (status) {
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "skipped_unconfigured":
      return "Skipped — not configured";
    case "skipped_deduped":
      return "Skipped — already open";
    case "skipped_rate_limited":
      return "Skipped — rate limited";
    default:
      // The status set is closed in the contract and in the database, so this
      // is unreachable today. It exists because `F3.9` may add a status before
      // it adds a label, and an unlabelled row must still render.
      return status;
  }
}

/**
 * The pill colour per status.
 *
 * A skip is `warning`, not `offline`: three of the five statuses are skips, and
 * the two an operator most needs to notice — nothing configured, over the
 * ceiling — mean a person was NOT told about an alarm. Rendering those in the
 * same grey as "disabled" is how they get scrolled past.
 *
 * `skipped_deduped` is the exception and is deliberately calm: it means the
 * alarm was already open and somebody was already told. That is the system
 * working.
 */
export function deliveryStatusTone(
  status: NotificationDeliveryStatus,
): "ok" | "warning" | "critical" | "offline" | "info" {
  switch (status) {
    case "sent":
      return "ok";
    case "failed":
      return "critical";
    case "skipped_deduped":
      return "info";
    case "skipped_unconfigured":
    case "skipped_rate_limited":
      return "warning";
    default:
      return "offline";
  }
}

/**
 * What the Send test button reports.
 *
 * A refusal must read as a refusal. The plan's acceptance criterion for this
 * screen is that a webhook the egress guard blocks does not look like a silent
 * no-op, so the failure text carries the reason the API gave — which is the
 * host, never the URL (`webhook-guard.ts` keeps the path out of it).
 */
export function testResultMessage(
  result: NotificationTestResult & { channelCode: string },
): string {
  switch (result.status) {
    case "sent":
      return `Test notification sent through ${result.channelCode}.`;
    case "failed":
      return `Test failed for ${result.channelCode}: ${result.error ?? "no reason given"}.`;
    case "skipped_rate_limited":
      return `Test skipped for ${result.channelCode}: this channel is over its hourly limit.`;
    case "skipped_unconfigured":
      return `Test skipped for ${result.channelCode}: ${
        result.error ?? "no transport is configured for this kind"
      }.`;
    case "skipped_deduped":
      // Unreachable: a test carries no alarm, so the transition dedupe cannot
      // fire. Handled rather than defaulted so the switch stays exhaustive.
      return `Test skipped for ${result.channelCode}.`;
    default:
      return `Test finished for ${result.channelCode}: ${String(result.status)}.`;
  }
}
