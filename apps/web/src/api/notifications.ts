import {
  notificationChannelDeletedResponseSchema,
  notificationChannelResponseSchema,
  notificationChannelsListResponseSchema,
  notificationDeliveriesResponseSchema,
  notificationReadinessResponseSchema,
  notificationTestResultResponseSchema,
  ruleNotificationsResponseSchema,
} from "@bms/shared/contracts";
import type {
  NotificationChannelDto,
  NotificationDeliveryDto,
  NotificationReadinessDto,
  NotificationTestResult,
} from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

/**
 * `F3.8` notifications client (ADR 0041).
 *
 * Follows `rules.ts`: schemas from `@bms/shared/contracts`, `withAuth`, and
 * `checkResponse` for every read. `checkResponse` validates and returns the
 * **original** payload — see `validate.ts` for why it must never return
 * `result.data`.
 */

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type NotificationChannelsResponse = { items: NotificationChannelDto[] };
export type NotificationDeliveriesResponse = { items: NotificationDeliveryDto[] };
export type NotificationReadinessResponse = { items: NotificationReadinessDto[] };

/** The write shape. `secret` is write-only: no read ever returns it. */
export type NotificationChannelPayload = {
  code: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  /** Omit to keep the stored secret; `null` clears it; a string replaces it. */
  secret?: string | null;
  enabled?: boolean;
  /**
   * `E7.1d`. Create-only, and optional exactly as
   * `createNotificationChannelBodySchema` has it since `E7.1c`: omitted, an
   * `admin` gets a fleet-wide channel and a single-grant `organization_admin`
   * gets its own organization implicitly.
   *
   * `PATCH` never carries it — `updateNotificationChannelBodySchema` has no
   * such field, so a channel's organization is fixed at create.
   */
  organizationId?: string;
};

/** The server's message, when it sent one — a 409 on a duplicate code says so. */
async function failure(res: Response, label: string): Promise<Error> {
  clearSessionOnAuthFailure(res);
  const text = await res.text();
  try {
    const parsed: unknown = JSON.parse(text);
    const message = (parsed as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return new Error(text || `${label} ${res.status}`);
}

/** GET /api/v1/notifications/channels */
export async function fetchNotificationChannels(): Promise<NotificationChannelsResponse> {
  const res = await fetch(`${base}/api/v1/notifications/channels`, withAuth());
  if (!res.ok) throw await failure(res, "notification-channels");
  return checkResponse(
    notificationChannelsListResponseSchema,
    await res.json(),
    "notifications/channels",
  );
}

/** POST /api/v1/notifications/channels */
export async function createNotificationChannel(
  payload: NotificationChannelPayload,
): Promise<NotificationChannelDto> {
  const res = await fetch(`${base}/api/v1/notifications/channels`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });
  if (!res.ok) throw await failure(res, "notification-channel-create");
  return checkResponse(
    notificationChannelResponseSchema,
    await res.json(),
    "notifications/channels",
  );
}

/**
 * PATCH /api/v1/notifications/channels/:id
 *
 * `organizationId` and `code` are excluded from the patch **type**, not merely
 * omitted at the call site (`E7.1d`). `updateNotificationChannelBodySchema`
 * carries neither key, so Zod would strip either silently — and a field that
 * is accepted, ignored and answered `200` is how a client comes to believe it
 * can move a channel between organizations, or rename its code. The compiler
 * refuses both instead.
 */
export async function updateNotificationChannel(input: {
  id: string;
  patch: Omit<Partial<NotificationChannelPayload>, "organizationId" | "code">;
}): Promise<NotificationChannelDto> {
  const res = await fetch(`${base}/api/v1/notifications/channels/${input.id}`, {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.patch),
    }),
  });
  if (!res.ok) throw await failure(res, "notification-channel-update");
  return checkResponse(
    notificationChannelResponseSchema,
    await res.json(),
    "notifications/channels/:id",
  );
}

/** DELETE /api/v1/notifications/channels/:id */
export async function deleteNotificationChannel(id: string): Promise<{ deleted: true }> {
  const res = await fetch(`${base}/api/v1/notifications/channels/${id}`, {
    ...withAuth({ method: "DELETE" }),
  });
  if (!res.ok) throw await failure(res, "notification-channel-delete");
  return checkResponse(
    notificationChannelDeletedResponseSchema,
    await res.json(),
    "notifications/channels/:id",
  );
}

/**
 * POST /api/v1/notifications/channels/:id/test
 *
 * A real send through the real transport, so a webhook the egress guard refuses
 * comes back as `failed` with the reason. That refusal is the point: it is the
 * 3am failure met at configuration time.
 */
export async function testNotificationChannel(id: string): Promise<NotificationTestResult> {
  const res = await fetch(`${base}/api/v1/notifications/channels/${id}/test`, {
    ...withAuth({ method: "POST" }),
  });
  if (!res.ok) throw await failure(res, "notification-channel-test");
  return checkResponse(
    notificationTestResultResponseSchema,
    await res.json(),
    "notifications/channels/:id/test",
  );
}

/** GET /api/v1/notifications/deliveries */
export async function fetchNotificationDeliveries(
  limit = 100,
): Promise<NotificationDeliveriesResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${base}/api/v1/notifications/deliveries?${params}`, withAuth());
  if (!res.ok) throw await failure(res, "notification-deliveries");
  return checkResponse(
    notificationDeliveriesResponseSchema,
    await res.json(),
    "notifications/deliveries",
  );
}

/** GET /api/v1/notifications/readiness — authenticated, not admin-only. */
export async function fetchNotificationReadiness(): Promise<NotificationReadinessResponse> {
  const res = await fetch(`${base}/api/v1/notifications/readiness`, withAuth());
  if (!res.ok) throw await failure(res, "notification-readiness");
  return checkResponse(
    notificationReadinessResponseSchema,
    await res.json(),
    "notifications/readiness",
  );
}

/** GET /api/v1/rules/:id/notifications */
export async function fetchRuleNotifications(ruleId: string): Promise<{ channelIds: string[] }> {
  const res = await fetch(`${base}/api/v1/rules/${ruleId}/notifications`, withAuth());
  if (!res.ok) throw await failure(res, "rule-notifications");
  return checkResponse(
    ruleNotificationsResponseSchema,
    await res.json(),
    "rules/:id/notifications",
  );
}

/** PUT /api/v1/rules/:id/notifications — the whole set, not a delta. */
export async function setRuleNotifications(input: {
  ruleId: string;
  channelIds: string[];
}): Promise<{ channelIds: string[] }> {
  const res = await fetch(`${base}/api/v1/rules/${input.ruleId}/notifications`, {
    ...withAuth({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelIds: input.channelIds }),
    }),
  });
  if (!res.ok) throw await failure(res, "rule-notifications-set");
  return checkResponse(
    ruleNotificationsResponseSchema,
    await res.json(),
    "rules/:id/notifications",
  );
}
