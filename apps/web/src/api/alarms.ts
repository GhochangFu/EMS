import {
  alarmDetailsResponseSchema,
  alarmListItemSchema,
  alarmsListResponseSchema,
  alarmSummaryResponseSchema,
} from "@bms/shared/contracts";
import type {
  AlarmDetailsResponse,
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
): Promise<AlarmsListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    params.set("cursor", cursor);
  }
  const res = await fetch(`${base}/api/v1/alarms?${params}`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
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

function appendScope(params: URLSearchParams, scope: AlarmScope): void {
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
  scope: AlarmScope,
  limit = 8,
): Promise<AlarmsListResponse> {
  const params = new URLSearchParams({ state: "active", limit: String(limit) });
  appendScope(params, scope);
  const res = await fetch(`${base}/api/v1/alarms?${params}`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`alarms ${res.status}`);
  }
  return checkResponse(alarmsListResponseSchema, await res.json(), "alarms");
}

/**
 * `GET /api/v1/alarms/summary` — active-alarm counts per severity, every
 * active severity present (`count: 0` allowed), in ascending rank.
 */
export async function fetchAlarmSummary(scope: AlarmScope): Promise<AlarmSummaryResponse> {
  const params = new URLSearchParams();
  appendScope(params, scope);
  const res = await fetch(`${base}/api/v1/alarms/summary?${params}`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`alarms/summary ${res.status}`);
  }
  return checkResponse(alarmSummaryResponseSchema, await res.json(), "alarms/summary");
}

export async function ackAlarm(
  id: string,
  reason: string,
): Promise<AlarmListItem> {
  const res = await fetch(`${base}/api/v1/alarms/${id}/ack`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `ack ${res.status}`);
  }
  return checkResponse(alarmListItemSchema, await res.json(), "alarms/:id/ack");
}

/** GET /api/v1/alarms/:id/details (ADR 0034 decision 5). */
export async function fetchAlarmDetails(id: string): Promise<AlarmDetailsResponse> {
  const res = await fetch(`${base}/api/v1/alarms/${id}/details`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`alarms/:id/details ${res.status}`);
  }
  return checkResponse(alarmDetailsResponseSchema, await res.json(), "alarms/:id/details");
}

/**
 * The `PUT .../enrichment` request payload. Typed locally rather than
 * imported from `@bms/shared` — request schemas live in `apps/api`
 * (AGENTS.md §3), matching how `ackAlarm` above types its own body.
 */
export type AlarmEnrichmentUpsertBody = {
  rootCause?: string | null;
  impact?: string | null;
  correctiveActions?: string | null;
  energyImpact?: string | null;
  waterImpact?: string | null;
  productionImpact?: string | null;
  etrAt?: string | null;
  skillCode?: string | null;
  affectedAssetIds?: string[];
};

/** PUT /api/v1/alarms/:id/enrichment (ADR 0034 decision 6). */
export async function saveAlarmEnrichment(
  id: string,
  body: AlarmEnrichmentUpsertBody,
): Promise<AlarmDetailsResponse> {
  const res = await fetch(`${base}/api/v1/alarms/${id}/enrichment`, {
    ...withAuth({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `alarms/:id/enrichment ${res.status}`);
  }
  return checkResponse(alarmDetailsResponseSchema, await res.json(), "alarms/:id/enrichment");
}
