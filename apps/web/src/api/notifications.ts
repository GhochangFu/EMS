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

import { apiErrorMessage } from "../lib/api-error-message";
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

/**
 * The server's message, when it sent one — a 409 on a duplicate code says so.
 *
 * Reads the body through the shared `apiErrorMessage` (`F4.204`), which also
 * handles an array `message` (a Zod validation refusal) that a private parse
 * here used to miss. An empty body keeps the `label status` fallback. `sent` is
 * the request's `RequestInit`, so a 401 clears only its own session (`F4.206`).
 */
async function failure(
  res: Response,
  sent: Pick<RequestInit, "headers">,
  label: string,
): Promise<Error> {
  clearSessionOnAuthFailure(res, sent);
  const text = await res.text();
  return new Error(text.trim() === "" ? `${label} ${res.status}` : apiErrorMessage(text));
}

/** GET /api/v1/notifications/channels */
export async function fetchNotificationChannels(): Promise<NotificationChannelsResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/notifications/channels`, sent);
  if (!res.ok) throw await failure(res, sent, "notification-channels");
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
  const sent = {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  };
  const res = await fetch(`${base}/api/v1/notifications/channels`, sent);
  if (!res.ok) throw await failure(res, sent, "notification-channel-create");
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
  const sent = {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.patch),
    }),
  };
  const res = await fetch(`${base}/api/v1/notifications/channels/${input.id}`, sent);
  if (!res.ok) throw await failure(res, sent, "notification-channel-update");
  return checkResponse(
    notificationChannelResponseSchema,
    await res.json(),
    "notifications/channels/:id",
  );
}

/** DELETE /api/v1/notifications/channels/:id */
export async function deleteNotificationChannel(id: string): Promise<{ deleted: true }> {
  const sent = {
    ...withAuth({ method: "DELETE" }),
  };
  const res = await fetch(`${base}/api/v1/notifications/channels/${id}`, sent);
  if (!res.ok) throw await failure(res, sent, "notification-channel-delete");
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
  const sent = {
    ...withAuth({ method: "POST" }),
  };
  const res = await fetch(`${base}/api/v1/notifications/channels/${id}/test`, sent);
  if (!res.ok) throw await failure(res, sent, "notification-channel-test");
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
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/notifications/deliveries?${params}`, sent);
  if (!res.ok) throw await failure(res, sent, "notification-deliveries");
  return checkResponse(
    notificationDeliveriesResponseSchema,
    await res.json(),
    "notifications/deliveries",
  );
}

/** GET /api/v1/notifications/readiness — authenticated, not admin-only. */
export async function fetchNotificationReadiness(): Promise<NotificationReadinessResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/notifications/readiness`, sent);
  if (!res.ok) throw await failure(res, sent, "notification-readiness");
  return checkResponse(
    notificationReadinessResponseSchema,
    await res.json(),
    "notifications/readiness",
  );
}

/** GET /api/v1/rules/:id/notifications */
export async function fetchRuleNotifications(ruleId: string): Promise<{ channelIds: string[] }> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/rules/${ruleId}/notifications`, sent);
  if (!res.ok) throw await failure(res, sent, "rule-notifications");
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
  const sent = {
    ...withAuth({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelIds: input.channelIds }),
    }),
  };
  const res = await fetch(`${base}/api/v1/rules/${input.ruleId}/notifications`, sent);
  if (!res.ok) throw await failure(res, sent, "rule-notifications-set");
  return checkResponse(
    ruleNotificationsResponseSchema,
    await res.json(),
    "rules/:id/notifications",
  );
}
