import {
  alarmDetailsResponseSchema,
  alarmListItemSchema,
  alarmsListResponseSchema,
} from "@bms/shared/contracts";
import type { AlarmDetailsResponse, AlarmListItem } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type AlarmsListResponse = {
  items: AlarmListItem[];
  nextCursor: string | null;
};

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
