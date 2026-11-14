import {
  tariffLineVersionsResponseSchema,
  tariffLinesResponseSchema,
  tariffVersionDtoSchema,
} from "@bms/shared/contracts";
import type {
  CreateTariffVersionBody,
  TariffLineVersionsResponse,
  TariffLinesResponse,
  TariffVersionDto,
  UpdateTariffVersionBody,
} from "@bms/shared/contracts";

import { ApiError } from "../lib/api-error";
import { adminFetch } from "./admin/client";
import { clearSessionOnAuthFailure, withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.365` U8 (ADR 0134 decisions 8 and 9) — the tariff catalog reads and an
 * organization's own version writes.
 *
 * Every response is parsed through its `@bms/shared` contract (`adminFetch`,
 * ADR 0030). **A line's key travels as a query parameter, always through
 * `URLSearchParams`**: 104 of 316 catalog keys contain `/`, and others carry
 * `&`, `>` or `%` (ADR 0134 Amendment 1), so a key is never spliced into a URL.
 */

export type TariffLinesQuery = {
  readonly organizationId?: string;
  readonly state?: string;
  readonly segment?: string;
  readonly q?: string;
};

export function tariffLinesQueryKey(organizationId: string) {
  return ["tariffs", "lines", organizationId] as const;
}

export function tariffLineVersionsQueryKey(key: string, organizationId: string) {
  return ["tariffs", "versions", key, organizationId] as const;
}

/** `GET /tariffs/categories` — the catalog lines plus the named organization's own; a key left out is not sent. */
export async function fetchTariffLines(query: TariffLinesQuery = {}): Promise<TariffLinesResponse> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(name, value);
    }
  }
  const qs = params.toString();
  return adminFetch(`/tariffs/categories${qs === "" ? "" : `?${qs}`}`, tariffLinesResponseSchema);
}

/** `GET /tariffs/lines/versions?key=` — every version of one line, oldest first. */
export async function fetchTariffLineVersions(
  key: string,
  organizationId?: string,
): Promise<TariffLineVersionsResponse> {
  const params = new URLSearchParams({ key });
  if (organizationId) {
    params.set("organizationId", organizationId);
  }
  return adminFetch(`/tariffs/lines/versions?${params}`, tariffLineVersionsResponseSchema);
}

/** `POST /admin/tariffs/versions` — a revision of a line, or a new custom line. */
export async function createTariffVersion(body: CreateTariffVersionBody): Promise<TariffVersionDto> {
  return adminFetch("/admin/tariffs/versions", tariffVersionDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** `PATCH /admin/tariffs/versions/:id` — only a version not yet in force; a 409 otherwise. */
export async function updateTariffVersion(id: string, body: UpdateTariffVersionBody): Promise<TariffVersionDto> {
  return adminFetch(`/admin/tariffs/versions/${encodeURIComponent(id)}`, tariffVersionDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * `DELETE /admin/tariffs/versions/:id?reason=` — 204, no body; the reason is the
 * audit row's. `deleteAdminCalcParameter`'s shape (`adminFetch` reads a body).
 */
export async function deleteTariffVersion(id: string, reason: string): Promise<void> {
  const sent = withAuth({ method: "DELETE" });
  const params = new URLSearchParams({ reason });
  const res = await fetch(`${base}/api/v1/admin/tariffs/versions/${encodeURIComponent(id)}?${params}`, sent);
  if (res.status === 204) {
    return;
  }
  clearSessionOnAuthFailure(res, sent);
  const text = await res.text();
  throw new ApiError(text || `admin /admin/tariffs/versions/:id ${res.status}`, res.status);
}
