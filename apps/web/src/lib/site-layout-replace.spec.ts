import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { expect, vi, type Mock } from "vitest";

import {
  DASHBOARD_ID_KEYED_READS,
  dashboardsAfterReplaceFilters,
  editFlagText,
  heldCopyText,
  isStaleAfterReplace,
} from "./site-layout-replace";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decision 9) — the edit flag's exact sentences. The times are
 * at 10:00 UTC, so the local date is the same day in every zone from UTC-10 to UTC+13.
 */

/** E1 — with the actor (an `admin` or `organization_admin` caller): count, date and "by". */
export function theFlagNamesTheActor(): void {
  expect(
    editFlagText({ count: 3, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: "phe-admin@bms.local" }),
  ).toBe("Edited 3 times since the copy, last on 2026-11-06 by phe-admin@bms.local");
  expect(editFlagText({ count: 1, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: "a@b.c" })).toBe(
    "Edited 1 time since the copy, last on 2026-11-06 by a@b.c",
  );
}

/** E2 — no actor (a `location_admin` gets none; an unknown actor is `null`): no "by". */
export function theFlagOmitsAnAbsentActor(): void {
  expect(editFlagText({ count: 2, lastEditedAt: "2026-11-06T10:00:00.000Z" })).toBe(
    "Edited 2 times since the copy, last on 2026-11-06",
  );
  expect(editFlagText({ count: 2, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: null })).toBe(
    "Edited 2 times since the copy, last on 2026-11-06",
  );
}

/** E3 — no edit row (a copy nobody touched, or no copy): "No recorded edit since the copy". */
export function noEditReadsAsNoRecordedEdit(): void {
  expect(editFlagText({ count: 0, lastEditedAt: null })).toBe("No recorded edit since the copy");
  expect(editFlagText(null)).toBe("No recorded edit since the copy");
}

/** E4 — the held copy in one phrase. */
export function theHeldCopyReadsAsCodeAndVersion(): void {
  const held = { dashboardId: "d", templateId: "t", templateCode: "pump-station-standard", version: 1 };
  expect(heldCopyText(held)).toBe("pump-station-standard v1");
  expect(heldCopyText(null)).toBe("No template copy");
}

/** The id a canvas still holds after a Replace deleted its dashboard, and the new copy's id. */
export const OLD_DASHBOARD_ID = "0b0b0b0b-0000-4000-8000-000000000001";
export const NEW_DASHBOARD_ID = "0b0b0b0b-0000-4000-8000-000000000002";

export interface SeededDashboardReads {
  /** The old id's reads — the API answers 404 for each once the Replace deleted the dashboard. */
  readonly siteWidgets: Mock;
  readonly catalogValues: Mock;
  readonly mimicNodes: Mock;
  /** The slug and list reads, which must re-read to reach the new id. */
  readonly detail: Mock;
  readonly list: Mock;
  /** Unsubscribes every observer. */
  readonly stop: () => void;
}

/**
 * Seeds `client` with the reads a mounted site canvas holds — each with an active observer, so an
 * invalidation refetches it — and waits until each has fetched once.
 */
export async function seedDashboardReads(client: QueryClient): Promise<SeededDashboardReads> {
  const reads = {
    siteWidgets: vi.fn(() => Promise.resolve({ widgets: [] })),
    catalogValues: vi.fn(() => Promise.resolve({ values: [] })),
    mimicNodes: vi.fn(() => Promise.resolve([])),
    detail: vi.fn(() => Promise.resolve({ id: NEW_DASHBOARD_ID, slug: "site-layout-lotapata" })),
    list: vi.fn(() => Promise.resolve([])),
  };
  const observed: [QueryKey, Mock][] = [
    [["dashboards", "site-widgets", OLD_DASHBOARD_ID, "main"], reads.siteWidgets],
    [["dashboards", "catalog-values", OLD_DASHBOARD_ID], reads.catalogValues],
    [["dashboards", "mimic-nodes", OLD_DASHBOARD_ID], reads.mimicNodes],
    [["dashboards", "detail", "site-layout-lotapata", "org-1"], reads.detail],
    [["dashboards", "list", { section: null }], reads.list],
  ];
  const unsubscribe = observed.map(([queryKey, queryFn]) =>
    new QueryObserver(client, { queryKey, queryFn: queryFn as () => Promise<unknown> }).subscribe(() => undefined),
  );
  await vi.waitFor(() => {
    for (const [, read] of observed) expect(read).toHaveBeenCalledTimes(1);
  });
  return { ...reads, stop: () => unsubscribe.forEach((stop) => stop()) };
}

/**
 * Asserts the refresh after a Replace re-read the slug and list reads and none of the old id's reads
 * (each answers 404: the Replace deleted that dashboard).
 */
export async function expectOnlySlugAndListReadsRefetched(reads: SeededDashboardReads): Promise<void> {
  await vi.waitFor(() => {
    expect(reads.detail).toHaveBeenCalledTimes(2);
    expect(reads.list).toHaveBeenCalledTimes(2);
  });
  expect(reads.siteWidgets).toHaveBeenCalledTimes(1);
  expect(reads.catalogValues).toHaveBeenCalledTimes(1);
  expect(reads.mimicNodes).toHaveBeenCalledTimes(1);
}

/** R1 — the Replace filters re-read the slug and list reads, never the deleted dashboard's id-keyed reads. */
export async function theReplaceFiltersSkipTheOldIdsReads(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const reads = await seedDashboardReads(client);
  try {
    await client.invalidateQueries(dashboardsAfterReplaceFilters());
    await expectOnlySlugAndListReadsRefetched(reads);
  } finally {
    reads.stop();
    client.clear();
  }
}

/** R2 — the id-keyed list names every `["dashboards", kind, <id>, …]` read; other kinds are stale. */
export function theIdKeyedReadsAreNamed(): void {
  expect([...DASHBOARD_ID_KEYED_READS].sort()).toEqual(["catalog-values", "mimic-nodes", "site-widgets"]);
  expect(isStaleAfterReplace({ queryKey: ["dashboards", "site-widgets", OLD_DASHBOARD_ID, "main"] })).toBe(false);
  expect(isStaleAfterReplace({ queryKey: ["dashboards", "detail", "slug", "org"] })).toBe(true);
  expect(isStaleAfterReplace({ queryKey: ["dashboards", "control-room", null, null] })).toBe(true);
  expect(isStaleAfterReplace({ queryKey: ["dashboards"] })).toBe(true);
  expect(isStaleAfterReplace({ queryKey: ["control-room", "site-view"] })).toBe(false);
}
