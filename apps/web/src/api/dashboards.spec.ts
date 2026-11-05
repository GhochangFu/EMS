import { expect, vi } from "vitest";

import type { AppendChartWidgetBody, AppendTrendStripWidgetsBody } from "@bms/shared";

import { appendChartWidget, appendTrendStripWidgets, fetchDashboards } from "./dashboards";
import { ResponseContractError } from "./validate";

/**
 * `F3.31` Task 3 — the dashboards web client's `assetId` argument (ADR 0068 decision 4).
 *
 * ## Environment
 *
 * `node`, like `asset-images.spec.ts` — that file settled empirically that importing a module
 * which reads `import.meta.env` at module scope is fine under the web project's merged Vite
 * config.
 *
 * ## Why the URL is the claim
 *
 * An optional parameter at an adapter is invisible to `tsc` and to every fake: a
 * `fetchDashboards(org?, assetId?)` that drops `assetId` on the floor compiles, and every
 * consumer spec that stubs `fetchDashboards` stays green. The only place the argument is
 * observable is the URL handed to `fetch`, so each row below pins the exact string. The
 * compiler proves only that the argument is accepted (`tsc --noEmit` reaches this file through
 * its `.test.ts` wrapper); that it reaches the wire is proven only here, at run time.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";

/** The base the client prepends — read the same way the client reads it. */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Captures the URL of the single request the call under test makes and answers with an
 * empty, contract-valid list. Per-call closure state, never a lifetime counter (§4.6).
 */
function captureUrl(): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
  return () => seen;
}

/** W1a — `assetId` alone is the only query key. */
export async function fetchDashboardsSendsAssetIdAlone(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(undefined, ASSET_ID);
  expect(seen()).toBe(`${BASE}/api/v1/dashboards?assetId=${ASSET_ID}`);
}

/** W1b — both keys, `organizationId` first (the insertion order the helper is given). */
export async function fetchDashboardsSendsOrganizationIdThenAssetId(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(ORG_ID, ASSET_ID);
  expect(seen()).toBe(`${BASE}/api/v1/dashboards?organizationId=${ORG_ID}&assetId=${ASSET_ID}`);
}

/** W1c — no argument, no `?` at all: the helper answers `""` when no key is defined. */
export async function fetchDashboardsSendsNoQueryWhenUnfiltered(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards();
  expect(seen()).toBe(`${BASE}/api/v1/dashboards`);
}

/**
 * `E4.2` U9 — `section` reaches the wire.
 *
 * The same trap this file's docblock names: `fetchDashboards` gained a third
 * optional argument, so a body that drops it on the floor compiles and every
 * consumer spec that stubs the function stays green. Only the captured URL says
 * it is wired.
 */
export async function fetchDashboardsSendsSectionAlone(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(undefined, undefined, "sustainability");
  expect(seen()).toBe(`${BASE}/api/v1/dashboards?section=sustainability`);
}

/** The three keys together, in the helper's insertion order. */
export async function fetchDashboardsSendsAllThreeKeysInOrder(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(ORG_ID, ASSET_ID, "sustainability");
  expect(seen()).toBe(
    `${BASE}/api/v1/dashboards?organizationId=${ORG_ID}&assetId=${ASSET_ID}&section=sustainability`,
  );
}

const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

/**
 * `F3.72` U1 (plan D7, OQ6) — `locationId` reaches the wire. The fourth optional argument is
 * the same trap again: only the captured URL says it is wired.
 */
export async function fetchDashboardsSendsLocationIdAlone(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(undefined, undefined, undefined, LOCATION_ID);
  expect(seen()).toBe(`${BASE}/api/v1/dashboards?locationId=${LOCATION_ID}`);
}

/** `organizationId` then `locationId` — the organization first, the location appended last. */
export async function fetchDashboardsSendsOrganizationIdThenLocationId(): Promise<void> {
  const seen = captureUrl();
  await fetchDashboards(ORG_ID, undefined, undefined, LOCATION_ID);
  expect(seen()).toBe(`${BASE}/api/v1/dashboards?organizationId=${ORG_ID}&locationId=${LOCATION_ID}`);
}

const DASHBOARD_ID = "44444444-4444-4444-8444-444444444444";

const APPEND_BODY: AppendChartWidgetBody = {
  tabKey: "ops",
  title: "CHL-01 · kw",
  gridW: 6,
  gridH: 4,
  config: { windowMinutes: 1440, aggregate: "avg" },
  points: [{ assetId: ASSET_ID, pointKey: "kw" }],
};

/** A contract-valid append answer: the new widget and the dashboard's new stamp. */
export const APPEND_ANSWER = {
  widget: {
    id: "55555555-5555-4555-8555-555555555555",
    dashboardId: DASHBOARD_ID,
    organizationId: ORG_ID,
    tabId: null,
    title: "CHL-01 · kw",
    gridX: 0,
    gridY: 6,
    gridW: 6,
    gridH: 4,
    points: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        pointId: "77777777-7777-4777-8777-777777777777",
        role: "series",
        sortOrder: 0,
        assetId: ASSET_ID,
        assetCode: "CHL-01",
        assetRtuName: null,
        assetLocationName: null,
        pointKey: "kw",
        unit: "kW",
      },
    ],
    sources: [],
    widgetType: "chart",
    config: { series: "line", windowMinutes: 1440, aggregate: "avg" },
  },
  updatedAt: "2026-11-03T10:00:00.000+00:00",
};

/** Captures the one request's URL and init, and answers with `answer`. Per-call state. */
function captureRequest(answer: unknown): () => { url: string; init: RequestInit | undefined } {
  let seen: { url: string; init: RequestInit | undefined } = { url: "", init: undefined };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(answer), { status: 201 });
  });
  return () => seen;
}

/** `F4.303` U15 — `appendChartWidget` posts to the append route of the dashboard id. */
export async function appendChartWidgetPostsToTheAppendRoute(): Promise<void> {
  const seen = captureRequest(APPEND_ANSWER);
  await appendChartWidget(DASHBOARD_ID, APPEND_BODY);
  expect(seen().url).toBe(`${BASE}/api/v1/dashboards/${DASHBOARD_ID}/widgets/append`);
  expect(seen().init?.method).toBe("POST");
}

/** `F4.303` U15 — the body is sent as given, JSON. */
export async function appendChartWidgetSendsTheBody(): Promise<void> {
  const seen = captureRequest(APPEND_ANSWER);
  await appendChartWidget(DASHBOARD_ID, APPEND_BODY);
  expect(JSON.parse(String(seen().init?.body))).toEqual(APPEND_BODY);
}

/** `F4.303` U15 — the answer is the parsed response: the widget and the stamp. */
export async function appendChartWidgetAnswersTheParsedResponse(): Promise<void> {
  captureRequest(APPEND_ANSWER);
  const answer = await appendChartWidget(DASHBOARD_ID, APPEND_BODY);
  expect(answer.updatedAt).toBe(APPEND_ANSWER.updatedAt);
  expect(answer.widget.id).toBe(APPEND_ANSWER.widget.id);
}

/** `F4.303` U15 — the answer goes through `appendChartWidgetResponseSchema`: one without the stamp is refused. */
export async function appendChartWidgetRefusesAnAnswerWithoutTheStamp(): Promise<void> {
  captureRequest({ widget: APPEND_ANSWER.widget });
  await expect(appendChartWidget(DASHBOARD_ID, APPEND_BODY)).rejects.toBeInstanceOf(ResponseContractError);
}

const STRIPS_BODY: AppendTrendStripWidgetsBody = {
  widgetType: "trend_strip",
  strips: [
    { config: { defaultRange: "24h", segments: ["seg_a"], points: ["seg_a:pt_x"], colors: { "seg_a:pt_x": "series-2" } } },
  ],
};

/** A contract-valid trend arm answer: one widget per strip, and the stamp. */
const STRIPS_ANSWER = {
  widgets: [
    {
      ...APPEND_ANSWER.widget,
      title: null,
      points: [],
      widgetType: "trend_strip",
      config: { defaultRange: "24h", segments: ["seg_a"], points: ["seg_a:pt_x"], colors: { "seg_a:pt_x": "series-2" } },
    },
  ],
  updatedAt: "2026-11-04T10:00:00.000+00:00",
};

/** `F4.306` U12 — `appendTrendStripWidgets` posts to the same append route of the dashboard id. */
export async function appendTrendStripWidgetsPostsToTheAppendRoute(): Promise<void> {
  const seen = captureRequest(STRIPS_ANSWER);
  await appendTrendStripWidgets(DASHBOARD_ID, STRIPS_BODY);
  expect(seen().url).toBe(`${BASE}/api/v1/dashboards/${DASHBOARD_ID}/widgets/append`);
  expect(seen().init?.method).toBe("POST");
}

/** `F4.306` U12 — the trend arm's body is sent as given, JSON. */
export async function appendTrendStripWidgetsSendsTheBody(): Promise<void> {
  const seen = captureRequest(STRIPS_ANSWER);
  await appendTrendStripWidgets(DASHBOARD_ID, STRIPS_BODY);
  expect(JSON.parse(String(seen().init?.body))).toEqual(STRIPS_BODY);
}

/** `F4.306` U12 — the answer is the parsed `{ widgets, updatedAt }`. */
export async function appendTrendStripWidgetsAnswersTheParsedResponse(): Promise<void> {
  captureRequest(STRIPS_ANSWER);
  const answer = await appendTrendStripWidgets(DASHBOARD_ID, STRIPS_BODY);
  expect(answer.updatedAt).toBe(STRIPS_ANSWER.updatedAt);
  expect(answer.widgets.map((widget) => widget.id)).toEqual([APPEND_ANSWER.widget.id]);
}

/** `F4.306` U12 — the chart arm's answer (`widget`, not `widgets`) is refused. */
export async function appendTrendStripWidgetsRefusesTheChartAnswer(): Promise<void> {
  captureRequest(APPEND_ANSWER);
  await expect(appendTrendStripWidgets(DASHBOARD_ID, STRIPS_BODY)).rejects.toBeInstanceOf(ResponseContractError);
}
