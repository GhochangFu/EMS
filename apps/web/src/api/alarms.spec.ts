import { expect, vi } from "vitest";

import { fetchActiveAlarms, fetchAlarmsPage, fetchAlarmSummary, fetchUnacknowledgedAlarms } from "./alarms";

/**
 * `F3.28` (ADR 0074 decision 4) — what the `/cr-overview` alarms rail's two
 * fetchers put on the wire.
 *
 * Both consumer specs (the rail's and the page's) replace this module with
 * `vi.fn`s, so a fetcher that dropped `state=active` or its `assetIds` would
 * keep every one of them green. The URL handed to `fetch` is the only place
 * that is observable, so each function below reads one part of it. The URL is
 * parsed rather than compared whole, so a mutation to one parameter reddens
 * the claim about that parameter and no other.
 *
 * `node` environment, like `dashboards.spec.ts`: importing a module that reads
 * `import.meta.env` at module scope is fine under the web project's config.
 */

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const IDS = [ID_A, ID_B, ID_C];

/** The base the client prepends — read the same way the client reads it. */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Captures the URL of the single request the call makes and answers with
 * `body`, which must pass the fetcher's `checkResponse`. Per-call closure
 * state, never a lifetime counter (§4.6).
 */
function captureUrl(body: unknown): () => URL {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return () => new URL(seen);
}

const EMPTY_LIST = { items: [], nextCursor: null };
const EMPTY_SUMMARY = { items: [], total: 0, suppressed: 0 };

/** The active read asks for `state=active` — raised and not yet cleared. */
export async function activeAlarmsSendsStateActive(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms(IDS);
  expect(seen().searchParams.get("state")).toBe("active");
}

/** The active read sends one `assetIds` per id, in the order given. */
export async function activeAlarmsSendsOneAssetIdsPerIdInOrder(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms(IDS);
  expect(seen().searchParams.getAll("assetIds")).toEqual(IDS);
}

/** With no `limit` argument the active read asks for the rail's 8 rows. */
export async function activeAlarmsSendsLimitEightByDefault(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms(IDS);
  expect(seen().searchParams.get("limit")).toBe("8");
}

/** The active read goes to the list route. */
export async function activeAlarmsHitsTheListPath(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms(IDS);
  expect(`${seen().origin}${seen().pathname}`).toBe(`${BASE}/api/v1/alarms`);
}

/** The summary read goes to `/api/v1/alarms/summary`. */
export async function alarmSummaryHitsTheSummaryPath(): Promise<void> {
  const seen = captureUrl(EMPTY_SUMMARY);
  await fetchAlarmSummary(IDS);
  expect(`${seen().origin}${seen().pathname}`).toBe(`${BASE}/api/v1/alarms/summary`);
}

/** The summary read sends one `assetIds` per id, in the order given. */
export async function alarmSummarySendsOneAssetIdsPerIdInOrder(): Promise<void> {
  const seen = captureUrl(EMPTY_SUMMARY);
  await fetchAlarmSummary(IDS);
  expect(seen().searchParams.getAll("assetIds")).toEqual(IDS);
}

/*
 * `F3.66` (step-5 fix) — the organization scope: one `organizationId` and no
 * `assetIds`, so the request no longer grows with the organization's asset
 * count against the API's 200-id cap. The two consumer specs mock this module,
 * so these URL reads are the only proof of what goes on the wire.
 */

const ORG = "44444444-4444-4444-8444-444444444444";

/** The active read for an organization sends its `organizationId`. */
export async function activeAlarmsForAnOrganizationSendsItsId(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms({ organizationId: ORG });
  expect(seen().searchParams.getAll("organizationId")).toEqual([ORG]);
}

/** The active read for an organization sends no `assetIds`. */
export async function activeAlarmsForAnOrganizationSendsNoAssetIds(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms({ organizationId: ORG });
  expect(seen().searchParams.getAll("assetIds")).toEqual([]);
}

/** The active read for an organization still asks for `state=active`. */
export async function activeAlarmsForAnOrganizationSendsStateActive(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms({ organizationId: ORG });
  expect(seen().searchParams.get("state")).toBe("active");
}

/** The id-scoped active read sends no `organizationId` — the F3.28 path is unchanged. */
export async function activeAlarmsForIdsSendsNoOrganizationId(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms(IDS);
  expect(seen().searchParams.has("organizationId")).toBe(false);
}

/** The summary read for an organization sends its `organizationId`. */
export async function alarmSummaryForAnOrganizationSendsItsId(): Promise<void> {
  const seen = captureUrl(EMPTY_SUMMARY);
  await fetchAlarmSummary({ organizationId: ORG });
  expect(seen().searchParams.getAll("organizationId")).toEqual([ORG]);
}

/** The summary read for an organization sends no `assetIds`. */
export async function alarmSummaryForAnOrganizationSendsNoAssetIds(): Promise<void> {
  const seen = captureUrl(EMPTY_SUMMARY);
  await fetchAlarmSummary({ organizationId: ORG });
  expect(seen().searchParams.getAll("assetIds")).toEqual([]);
}

/** The id-scoped summary read sends no `organizationId` — the F3.28 path is unchanged. */
export async function alarmSummaryForIdsSendsNoOrganizationId(): Promise<void> {
  const seen = captureUrl(EMPTY_SUMMARY);
  await fetchAlarmSummary(IDS);
  expect(seen().searchParams.has("organizationId")).toBe(false);
}

/**
 * `F4.357` U2b (plan Q1) — the alarm bar's read: `state=unacknowledged`, the
 * minimum rank and the page size, in the given scope.
 */
export async function unacknowledgedAlarmsSendsStateRankAndLimit(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchUnacknowledgedAlarms({ organizationId: ORG }, { minRank: 20, limit: 50 });
  const url = seen();
  expect({
    path: url.pathname,
    state: url.searchParams.get("state"),
    minSeverityRank: url.searchParams.get("minSeverityRank"),
    limit: url.searchParams.get("limit"),
    organizationId: url.searchParams.get("organizationId"),
    cursor: url.searchParams.get("cursor"),
  }).toEqual({ path: "/api/v1/alarms", state: "unacknowledged", minSeverityRank: "20", limit: "50", organizationId: ORG, cursor: null });
}

/** `F4.357`: a location scope sends one `locationId` and nothing else, on both reads. */
export async function aLocationScopeSendsItsIdOnly(): Promise<void> {
  const LOCATION = "55555555-5555-4555-8555-555555555555";
  const list = captureUrl(EMPTY_LIST);
  await fetchActiveAlarms({ locationId: LOCATION }, 50);
  const summary = captureUrl(EMPTY_SUMMARY);
  await fetchAlarmSummary({ locationId: LOCATION });
  for (const url of [list(), summary()]) {
    expect({
      locationId: url.searchParams.get("locationId"),
      organizationId: url.searchParams.get("organizationId"),
      assetIds: url.searchParams.getAll("assetIds"),
    }).toEqual({ locationId: LOCATION, organizationId: null, assetIds: [] });
  }
}

/** `F4.359` U12 — the page read sends `state` when given, and none otherwise. */
export async function alarmsPageSendsTheStateOnlyWhenGiven(): Promise<void> {
  const seen = captureUrl(EMPTY_LIST);
  await fetchAlarmsPage(undefined, 25, { state: "suppressed" });
  expect(seen().searchParams.get("state")).toBe("suppressed");
  await fetchAlarmsPage();
  expect(seen().searchParams.has("state")).toBe(false);
}

/**
 * `F4.361` U7 (ADR 0132 decision 3) — the page read carries every filter key it is given, the asset
 * as one `assetIds`, and nothing for a key left out.
 */
export async function alarmsPageSendsEveryFilterKey(): Promise<void> {
  const ids = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    locationId: "22222222-2222-4222-8222-222222222222",
    assetGroupId: "33333333-3333-4333-8333-333333333333",
    assetId: "44444444-4444-4444-8444-444444444444",
  };
  const seen = captureUrl(EMPTY_LIST);
  await fetchAlarmsPage("c1", 25, { state: "active", severity: "critical", ...ids });
  const url = seen();
  expect({
    state: url.searchParams.get("state"),
    severity: url.searchParams.get("severity"),
    organizationId: url.searchParams.get("organizationId"),
    locationId: url.searchParams.get("locationId"),
    assetGroupId: url.searchParams.get("assetGroupId"),
    assetIds: url.searchParams.getAll("assetIds"),
    assetId: url.searchParams.get("assetId"),
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  }).toEqual({
    state: "active",
    severity: "critical",
    organizationId: ids.organizationId,
    locationId: ids.locationId,
    assetGroupId: ids.assetGroupId,
    assetIds: [ids.assetId],
    assetId: null,
    cursor: "c1",
    limit: "25",
  });
  await fetchAlarmsPage(undefined, 25, {});
  expect([...seen().searchParams.keys()]).toEqual(["limit"]);
}
