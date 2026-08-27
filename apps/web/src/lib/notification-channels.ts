import type {
  NotificationChannelDto,
  NotificationDeliveryStatus,
  NotificationTestResult,
  UserRole,
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
  /**
   * `E7.1d`. The organization the channel belongs to; `""` means fleet-wide
   * (`organization_id IS NULL`), which is what an omitted `organizationId`
   * resolves to for an `admin` in `ChannelsService.resolveCreateTargetOrg`.
   *
   * Create-only. `updateNotificationChannelBodySchema` carries no
   * `organizationId`, so a channel cannot move between organizations after it
   * exists — the edit form renders this field disabled, the same way it
   * disables `code`.
   */
  organizationId: string;
};

export function blankChannelForm(): ChannelForm {
  return {
    code: "",
    name: "",
    kind: "email",
    target: "",
    secret: "",
    enabled: true,
    organizationId: "",
  };
}

/** The label a fleet-wide (`organization_id IS NULL`) channel renders under. */
export const FLEET_WIDE_LABEL = "Fleet-wide";

/**
 * Why **Send test** cannot fire for this channel, or `null` when it can.
 *
 * `NotificationsService.sendTest` throws a 400 on a fleet-wide channel: a
 * delivery row has carried `organization_id NOT NULL` since migration `0048`,
 * and there is no organization to attribute the attempt to. The button is
 * therefore disabled with this reason beside it rather than left live — a
 * click that lands on a documented refusal teaches nothing, and the refusal
 * arrives after the operator has already assumed the test ran.
 */
export function sendTestRefusal(channel: NotificationChannelDto): string | null {
  if (channel.organizationId === null) {
    return "A fleet-wide channel has no organization to attribute a delivery to. Create an org-scoped channel to test one.";
  }
  return null;
}

/**
 * The organization column's text for a channel or a delivery.
 *
 * Looks the name up rather than printing the uuid, and falls back to the uuid
 * only when the list does not carry it — which happens for a channel in a
 * deactivated organization, so the lookup list is fetched with `"all"` rather
 * than `"true"`. Printing "Unknown" there would hide a real row behind a word
 * that reads like a bug.
 */
export function organizationLabel(
  organizationId: string | null,
  organizations: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (organizationId === null) return FLEET_WIDE_LABEL;
  return organizations.find((org) => org.id === organizationId)?.name ?? organizationId;
}

/** One entry of the create form's organization selector. */
export type ChannelOrganizationOption = { value: string; label: string };

/**
 * What the create form's organization selector offers, per role.
 *
 * An `admin` gets **Fleet-wide** plus every active organization: `null` is a
 * legitimate ongoing state, not a pre-migration artifact, so it stays
 * creatable. An `organization_admin` gets its organizations and **no**
 * fleet-wide entry — `canManageNotificationChannel` returns `false` for a
 * `null` organization on that role, so offering it would be an option that
 * always answers 403.
 *
 * Deactivated organizations are filtered out: a channel in one could never
 * dispatch, and the picker is the wrong place to resurrect it.
 *
 * Every other role gets `[]`. `ChannelsService.list` returns `[]` for a
 * `location_admin` unconditionally ("the read gate is the write gate"), so
 * there is nothing for it to pick between.
 */
export function channelOrganizationOptions(
  role: UserRole,
  organizations: ReadonlyArray<{ id: string; name: string; active: boolean }>,
): ChannelOrganizationOption[] {
  if (role !== "admin" && role !== "organization_admin") return [];
  const active = organizations
    .filter((org) => org.active)
    .map((org) => ({ value: org.id, label: org.name }));
  if (role === "admin") {
    return [{ value: "", label: `${FLEET_WIDE_LABEL} (all organizations)` }, ...active];
  }
  return active;
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
    // `E7.1d`. Round-trips `null` as `""` so the disabled edit field shows
    // Fleet-wide rather than an empty box. The PATCH never sends it.
    organizationId: channel.organizationId ?? "",
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
 *
 * **`organizationId` follows the same omit-means-something rule** (`E7.1d`).
 * `""` omits the field, which `resolveCreateTargetOrg` reads as "fleet-wide"
 * for an `admin` and as "my one organization" for a single-grant
 * `organization_admin`. Sending `""` as a value would fail the API's
 * `z.string().uuid()` instead, turning a deliberate choice into a 400.
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
  if (form.organizationId !== "") payload.organizationId = form.organizationId;
  return payload;
}

/**
 * The same form as a `PATCH` body (`E7.1d`).
 *
 * Drops the two fields an update cannot change — `code` and `organizationId`.
 * `updateNotificationChannelBodySchema` declares neither, so Zod strips both
 * regardless; sending them anyway and relying on that is a contract this
 * client should not have. `organizationId` in particular decides which tenant
 * owns the row, and a field that is sent, ignored and answered `200` reads
 * from the client's side exactly like a field that worked.
 */
export function channelFormToPatch(
  form: ChannelForm,
): Omit<Partial<NotificationChannelPayload>, "organizationId"> {
  const { code: _code, organizationId: _organizationId, ...patch } = channelFormToPayload(form);
  return patch;
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
