import {
  alarmDetailsResponseSchema,
  alarmListItemSchema,
  alarmsListResponseSchema,
  alarmSummaryResponseSchema,
} from "@bms/shared/contracts";
import type {
  AlarmDetailsResponse,
  AlarmEnrichmentUpsertBody as SharedAlarmEnrichmentUpsertBody,
  AlarmListItem,
  AlarmsListResponse,
  AlarmSummaryResponse,
} from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function fetchAlarmsPage(
  cursor?: string,
  limit = 25,
  state?: "suppressed",
): Promise<AlarmsListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  // `F4.359`: absent is the API's own default (`all`); only the suppressed read names a state.
  if (state) {
    params.set("state", state);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/alarms?${params}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`alarms ${res.status}`);
  }
  return checkResponse(alarmsListResponseSchema, await res.json(), "alarms");
}

/**
 * What the alarms rail reads about: the given asset ids (`F3.28`), or one
 * organization (`F3.66` step-5 fix). The organization form sends a single
 * `organizationId` and no `assetIds`, so the request does not grow with the
 * organization's asset count — the API caps `assetIds` at 200. Either way the
 * API intersects with the caller's readable assets, so it only narrows.
 */
export type AlarmScope = readonly string[] | { readonly organizationId: string };

/**
 * `F4.357` (ADR 0130 decision 15) — what the alarm bar reads about: an
 * {@link AlarmScope}, or one location and every location under it. A separate
 * type, so `AlarmScope` (whose id-list form the rail reads `.length` of) does
 * not widen.
 */
export type AlarmReadScope = AlarmScope | { readonly locationId: string };

function appendScope(params: URLSearchParams, scope: AlarmReadScope): void {
  if ("locationId" in scope) {
    params.set("locationId", scope.locationId);
    return;
  }
  if ("organizationId" in scope) {
    params.set("organizationId", scope.organizationId);
    return;
  }
  for (const id of scope) {
    params.append("assetIds", id);
  }
}

/**
 * The alarms rail's rows on `/cr-overview` (`F3.28`, ADR 0074 decision 4):
 * active alarms (`cleared_at IS NULL`) in the given {@link AlarmScope}, newest
 * first. An id list is one repeated `assetIds` parameter per id.
 */
export async function fetchActiveAlarms(
  scope: AlarmReadScope,
  limit = 8,
): Promise<AlarmsListResponse> {
  const params = new URLSearchParams({ state: "active", limit: String(limit) });
  appendScope(params, scope);
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/alarms?${params}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`alarms ${res.status}`);
  }
  return checkResponse(alarmsListResponseSchema, await res.json(), "alarms");
}

/**
 * `F4.357` U2b (plan Q1 ruling) — the alarm bar's read: the active,
 * unacknowledged alarms of `minRank` and above in the given scope, highest
 * rank first, then newest. One page of at most `limit` rows (no cursor).
 */
export async function fetchUnacknowledgedAlarms(
  scope: AlarmReadScope,
  options: { readonly minRank: number; readonly limit: number },
): Promise<AlarmsListResponse> {
  const params = new URLSearchParams({
    state: "unacknowledged",
    minSeverityRank: String(options.minRank),
    limit: String(options.limit),
  });
  appendScope(params, scope);
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/alarms?${params}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`alarms ${res.status}`);
  }
  return checkResponse(alarmsListResponseSchema, await res.json(), "alarms");
}

/**
 * `GET /api/v1/alarms/summary` — active-alarm counts per severity, every
 * active severity present (`count: 0` allowed), in ascending rank.
 */
export async function fetchAlarmSummary(scope: AlarmReadScope): Promise<AlarmSummaryResponse> {
  const params = new URLSearchParams();
  appendScope(params, scope);
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/alarms/summary?${params}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`alarms/summary ${res.status}`);
  }
  return checkResponse(alarmSummaryResponseSchema, await res.json(), "alarms/summary");
}

export async function ackAlarm(
  id: string,
  reason: string,
): Promise<AlarmListItem> {
  const sent = {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  };
  const res = await fetch(`${base}/api/v1/alarms/${id}/ack`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `ack ${res.status}`);
  }
  return checkResponse(alarmListItemSchema, await res.json(), "alarms/:id/ack");
}

/** GET /api/v1/alarms/:id/details (ADR 0034 decision 5). */
export async function fetchAlarmDetails(id: string): Promise<AlarmDetailsResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/alarms/${id}/details`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`alarms/:id/details ${res.status}`);
  }
  return checkResponse(alarmDetailsResponseSchema, await res.json(), "alarms/:id/details");
}

/**
 * The `PUT .../enrichment` request payload: the route's own `z.infer` from
 * `@bms/shared` (`contracts/operations-writes.ts`, `F4.284`, ADR 0030).
 */
export type AlarmEnrichmentUpsertBody = SharedAlarmEnrichmentUpsertBody;

/** PUT /api/v1/alarms/:id/enrichment (ADR 0034 decision 6). */
export async function saveAlarmEnrichment(
  id: string,
  body: AlarmEnrichmentUpsertBody,
): Promise<AlarmDetailsResponse> {
  const sent = {
    ...withAuth({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
  const res = await fetch(`${base}/api/v1/alarms/${id}/enrichment`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new Error(text || `alarms/:id/enrichment ${res.status}`);
  }
  return checkResponse(alarmDetailsResponseSchema, await res.json(), "alarms/:id/enrichment");
}
