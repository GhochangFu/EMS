import { alarmKbResponseSchema } from "@bms/shared/contracts";
import type { AlarmKbResponse } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * One shared key, so the page and anything that later links into it read the
 * same cache entry. The list is reference content — one row per published asset
 * class — so it is stale-tolerant in a way the alarm list is not.
 */
export const alarmKbQueryKey = ["alarm-kb"] as const;

/** `GET /api/v1/alarm-kb` (`E2.2` PR 2, ADR 0059 decision 4). */
export async function fetchAlarmKb(): Promise<AlarmKbResponse> {
  const res = await fetch(`${base}/api/v1/alarm-kb`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`alarm-kb ${res.status}`);
  }
  return checkResponse(alarmKbResponseSchema, await res.json(), "alarm-kb");
}
