import { expect, vi } from "vitest";

import { fetchLoadTrend } from "./dashboard";

/**
 * `F3.72` U1 (plan D3, OQ1) — `fetchLoadTrend`'s optional `organizationId` reaches the wire.
 *
 * The organization level stubs `fetchLoadTrend` in its own spec, so a body that dropped the
 * argument would stay green there; the URL handed to `fetch` is the only place it is
 * observable. The no-organization case pins the executive dashboard's call byte for byte.
 * `node` environment, as `dashboards.spec.ts`.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function captureUrl(): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify({ points: [] }), { status: 200 });
  });
  return () => seen;
}

/** The executive dashboard's call — `window` only, unchanged by this row. */
export async function loadTrendSendsTheWindowAlone(): Promise<void> {
  const seen = captureUrl();
  await fetchLoadTrend("60m");
  expect(seen()).toBe(`${BASE}/api/v1/dashboard/load-trend?window=60m`);
}

/** With an organization: the window, then `organizationId`. */
export async function loadTrendSendsTheOrganizationId(): Promise<void> {
  const seen = captureUrl();
  await fetchLoadTrend("60m", ORG_ID);
  expect(seen()).toBe(`${BASE}/api/v1/dashboard/load-trend?window=60m&organizationId=${ORG_ID}`);
}
