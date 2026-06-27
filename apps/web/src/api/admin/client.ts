import type { MasterDataActiveFilter } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "../http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** Performs an authenticated admin API request. */
export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, withAuth(init));
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text || `admin ${path} ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Builds an active filter query param. */
export function activeQuery(active: MasterDataActiveFilter): string {
  return `active=${active}`;
}
