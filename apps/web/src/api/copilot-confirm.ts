import type { CopilotPendingChangeDto } from "@bms/shared";
import { cardOnlyKeysFor, COPILOT_CHANGE_HEADER } from "@bms/shared/copilot";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
/** An API path on the API's own origin: `/api/v1/` then no second slash, backslash or `@` that could move the host. */
const API_PATH = /^\/api\/v1\/[^/\\@][^\\@]*$/;

/** `body` without `keys`: a filtered copy, so the stored change is never touched. */
export function withoutKeys(body: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)));
}

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
 * The path must be an `/api/v1/` path: the executor joins it to the API base
 * and sends the bearer token, so anything else is refused before `fetch`.
 *
 * `F3.86` PR 2 / ADR 0099 decision 3: `clientOnly` holds the values the user
 * typed on the card (a temporary password). They are added to the sent body
 * only — never to `change.body`, the store or any log — and the server's
 * hash leaves them out.
 *
 * `F3.87` PR 5 (D15): the entry's `cardOnly` keys (a layout replace's
 * `baseline`) were stored for the card alone; they are stripped before the
 * send, because the route's strict body would refuse them, and the server's
 * hash leaves them out too (`hashExcludedKeysFor`, one rule both sides).
 *
 * Returns the parsed response, or `null` for a `204`. The response shape
 * belongs to the catalog entry, so it stays `unknown` here; the caller that
 * knows the entry parses it.
 */
export async function confirmCopilotChange(
  change: CopilotPendingChangeDto,
  clientOnly: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  if (!API_PATH.test(change.path)) {
    throw new ApiError(`copilot change path is not an API path`, 400);
  }
  const sent = withAuth({
    method: change.method,
    headers: { "Content-Type": "application/json", [COPILOT_CHANGE_HEADER]: change.id },
    body: JSON.stringify({ ...withoutKeys(change.body, cardOnlyKeysFor(change.catalogId)), ...clientOnly }),
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
