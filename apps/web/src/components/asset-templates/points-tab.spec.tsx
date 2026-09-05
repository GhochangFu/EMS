import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto } from "@bms/shared";

import * as templateApi from "../../api/admin/asset-templates";
import * as pointKeyApi from "../../api/admin/point-keys";
import { PointsTab } from "./points-tab";

/**
 * `F2.15` / ADR 0038 Amendment 5 Part A — the Points tab's Tier column.
 *
 * Assertions live here; `points-tab.test.tsx` is the Vitest entry point
 * (ADR 0014) and carries `@vitest-environment jsdom` because that is the file
 * Vitest collects (ADR 0042 decision 2). This is the Points tab's first spec:
 * the grid rules have been covered by `lib/template-points-grid.spec.ts` since
 * `F2.5`, but nothing has ever rendered the tab.
 *
 * Two claims, and they are different claims:
 *
 * - **The lifecycle rule** (decision 3, unchanged by the amendment) — a select
 *   on a draft, read-only *text* on a frozen version. Text, not a disabled
 *   select, because the amendment says "read-only text".
 * - **The save carries every row's `meta`, including the rows the author never
 *   touched.** `replacePoints` writes `meta: point.meta ?? {}` for every point
 *   on every save, so a payload that dropped an untouched row's tier would
 *   erase it with a 200 and nothing on screen to say so. `p2` in case 2 is
 *   that row.
 *
 * The point-key catalog is stubbed with all three declared keys so no row falls
 * back to its "(inactive)" option — otherwise the assertions would be reading a
 * fallback path rather than the ordinary one.
 */

const TIER_SELECT = /^Tier for /;

function point(index: number, meta: unknown): unknown {
  return {
    id: `id-p${index}`,
    templateId: "t1",
    pointKey: `p${index}`,
    label: `Point ${index}`,
    unit: "kW",
    kind: "measured",
    sourceDataKeyPattern: `FEEDER_P${index}`,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    required: true,
    sortOrder: index - 1,
    meta,
    createdAt: "2026-09-04T00:00:00.000Z",
  };
}

/** One point per tier state: `core`, `extended`, and none at all. */
const TEMPLATE: AdminAssetTemplateDto = adminAssetTemplateDtoSchema.parse({
  id: "t1",
  organizationId: "o1",
  organizationCode: "IONEX",
  organizationName: "Ion Exchange",
  code: "ELECTRICAL-FEEDER",
  version: 1,
  name: "Feeder",
  assetType: "feeder",
  domain: "electrical",
  description: null,
  status: "draft",
  content: {},
  publishedAt: null,
  archivedAt: null,
  stockCode: null,
  stockVersion: null,
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
  points: [
    point(1, { tier: "core" }),
    point(2, { tier: "extended" }),
    point(3, null),
  ],
});

/** The twelve carried fields of one point, as `buildPointsPayload` sends them. */
function expectedPoint(index: number): Record<string, unknown> {
  return {
    pointKey: `p${index}`,
    label: `Point ${index}`,
    unit: "kW",
    kind: "measured",
    sourceDataKeyPattern: `FEEDER_P${index}`,
    required: true,
    sortOrder: index - 1,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    // `F2.9` Task 15 — `buildPointsPayload` carries ADR 0055 decision 11's
    // ratio, so the whole-payload comparison below sees it on every point.
    // `null` on a measured one: only a `bms-calc-v2` derived point may hold a
    // value, and the server refuses it anywhere else.
    minCoverageRatio: null,
  };
}

function renderTab(editable: boolean, onDirtyChange = vi.fn()): void {
  vi.spyOn(pointKeyApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [{ code: "p1" }, { code: "p2" }, { code: "p3" }],
  } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PointsTab
        template={TEMPLATE}
        editable={editable}
        onSaved={vi.fn()}
        onDirtyChange={onDirtyChange}
      />
    </QueryClientProvider>,
  );
}

/** The catalog has settled once every row offers all three real keys. */
async function catalogSettles(): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByRole("option", { name: "p1" })).toHaveLength(3);
  });
}

/**
 * Case 1 — a frozen version shows the tier and offers no control.
 *
 * Text rather than a disabled select is what
 * `asset-template-stock-view-page.spec.tsx`'s enabled-field sweep depends on
 * staying true: it lists every `input, select, textarea` on the viewer and
 * requires the list to be empty, and a select would fail it whether or not it
 * were disabled.
 */
export async function readOnlyRendersTheTierAsText(): Promise<void> {
  renderTab(false);
  await catalogSettles();

  expect(screen.getByRole("columnheader", { name: "Tier" })).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: TIER_SELECT })).toBeNull();

  expect(screen.getByText("core")).toBeInTheDocument();
  expect(screen.getByText("extended")).toBeInTheDocument();
  // Exactly one, so a placeholder leaking into the two tiered rows fails here.
  expect(screen.getAllByText("—")).toHaveLength(1);

  expect(screen.queryByRole("button", { name: "Save points" })).toBeNull();
}

/**
 * Case 2 — a draft offers the select, and a save carries every row's `meta`.
 *
 * `p2` is never touched. Its `{ tier: "extended" }` reaching the payload is the
 * assertion that a tier-aware save does not erase the tiers it was not asked
 * to change.
 */
export async function draftRendersASelectPerRowAndSaveCarriesEveryMeta(): Promise<void> {
  const save = vi
    .spyOn(templateApi, "updateAdminAssetTemplate")
    .mockResolvedValue(TEMPLATE);
  const onDirtyChange = vi.fn();
  renderTab(true, onDirtyChange);
  await catalogSettles();

  const tierFor = (key: string) =>
    screen.getByRole("combobox", { name: `Tier for ${key}` }) as HTMLSelectElement;

  expect(tierFor("p1").value).toBe("core");
  expect(tierFor("p2").value).toBe("extended");
  // The stored "no tier" state is expressible, so opening the tab and saving
  // cannot assign one.
  expect(tierFor("p3").value).toBe("");

  await userEvent.selectOptions(tierFor("p3"), "manual");
  await userEvent.selectOptions(tierFor("p1"), "");

  expect(onDirtyChange).toHaveBeenCalledWith(true);
  expect(screen.queryByText("Fix the problems above to save.")).toBeNull();

  const saveButton = screen.getByRole("button", { name: "Save points" });
  expect(saveButton).toBeEnabled();
  await userEvent.click(saveButton);

  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });

  const [id, body] = save.mock.calls[0];
  expect(id).toBe(TEMPLATE.id);
  const points = body.points ?? [];
  expect(points).toHaveLength(3);
  // A cleared tier omits the key. `toEqual` treats `{ meta: undefined }` as
  // equal to no key at all, so the absence is asserted directly first.
  expect("meta" in points[0]).toBe(false);
  expect(points[1].meta).toEqual({ tier: "extended" });
  expect(points[2].meta).toEqual({ tier: "manual" });
  // And nothing else about any point moved.
  expect(points[0]).toEqual(expectedPoint(1));
  expect(points[1]).toEqual({ ...expectedPoint(2), meta: { tier: "extended" } });
  expect(points[2]).toEqual({ ...expectedPoint(3), meta: { tier: "manual" } });
}
