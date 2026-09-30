import { expect, vi } from "vitest";

import { fetchSiteWidgets } from "./dashboard-site-widgets";

/**
 * `F3.73` — what the site-widgets fetcher sends. The request carries the query's own abort
 * signal: an invalidation that cancels a read must abort its request, or the cancelled read still
 * runs at the server and its answer is discarded.
 */
export async function fetchSiteWidgetsForwardsTheQuerySignal(): Promise<void> {
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    signal = init.signal;
    return new Promise<Response>(() => undefined);
  });
  const query = new AbortController();
  void fetchSiteWidgets("22222222-2222-4222-8222-222222222222", "ups", query.signal);
  expect(signal?.aborted, "control: the request signal starts unaborted").toBe(false);
  query.abort();
  expect(signal?.aborted, "aborting the query signal did not abort the request").toBe(true);
}
