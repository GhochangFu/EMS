import type { CopilotPendingChangeDto } from "@bms/shared";
import { COPILOT_CHANGE_HEADER } from "@bms/shared/copilot";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5 — sends a confirmed copilot change as
 * the real API request: the stored method and path (which already carry the
 * `/api/v1` prefix, so `adminFetch` cannot serve it), the stored body, and the
 * `X-Copilot-Change` header naming the change. The server applies it only if
 * all three match what it stored.
 *
 * `change.body` is `{}` for a catalog entry that takes no body, and `{}` is
 * what is sent (plan §6.4) — never an empty request. The one executor serves
 * every catalog entry; the per-route wrappers are untouched.
 *
 * Returns the parsed response, or `null` for a `204`. The response shape
 * belongs to the catalog entry, so it stays `unknown` here; the caller that
 * knows the entry parses it.
 */
export async function confirmCopilotChange(change: CopilotPendingChangeDto): Promise<unknown> {
  const sent = withAuth({
    method: change.method,
    headers: { "Content-Type": "application/json", [COPILOT_CHANGE_HEADER]: change.id },
    body: JSON.stringify(change.body),
  });
  const res = await fetch(`${base}${change.path}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new ApiError(text || `copilot change ${res.status}`, res.status);
  }
  if (res.status === 204) return null;
  const parsed: unknown = await res.json();
  return parsed;
}
