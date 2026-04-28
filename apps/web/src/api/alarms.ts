import type { AlarmListItem } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";

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
  return res.json() as Promise<AlarmsListResponse>;
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
  return res.json() as Promise<AlarmListItem>;
}
