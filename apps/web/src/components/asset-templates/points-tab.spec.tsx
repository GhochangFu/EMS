import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    // `F2.7` / ADR 0056 decision 1 — the five metadata defaults, read-side,
    // `null` = none set. Required on the DTO, so the parse below forces them.
    // `p1` carries values so the draft case has something non-null to render
    // and to leave untouched (the `p2` pattern this file already uses for
    // `meta`, extended to the five).
    scaleMultiplier: index === 1 ? 1.5 : null,
    scaleOffset: index === 1 ? -2 : null,
    engMin: index === 1 ? 0 : null,
    engMax: index === 1 ? 100 : null,
    qualityPolicy: index === 1 ? "accept_bad" : null,
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

/** The seventeen carried fields of one point, as `buildPointsPayload` sends them. */
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
    // `F2.7` / ADR 0056 decision 9 — sent as the row holds them, never
    // omitted. `p1`'s fixture carries values; `p2` and `p3` carry null.
    scaleMultiplier: index === 1 ? 1.5 : null,
    scaleOffset: index === 1 ? -2 : null,
    engMin: index === 1 ? 0 : null,
    engMax: index === 1 ? 100 : null,
    qualityPolicy: index === 1 ? "accept_bad" : null,
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
 * The text of one data-row's cell under a named column header — scoped, so a
 * read-only "—" placeholder in one column (the five metadata defaults) does
 * not get counted alongside another column's (the Tier column) by a bare
 * `getAllByText`.
 */
function cellText(rowIndex: number, columnName: string): string | null {
  const table = screen.getByRole("table");
  const headers = within(table)
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
  const columnIndex = headers.indexOf(columnName);
  const rows = within(table).getAllByRole("row").slice(1);
  const cells = within(rows[rowIndex]).getAllByRole("cell");
  return cells[columnIndex]?.textContent ?? null;
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
  // Scoped to the Tier column: a placeholder leaking into the two tiered
  // rows' Tier cells fails here. The five metadata columns have their own
  // "—" cells, asserted by `readOnlyRendersMetadataAsText`.
  expect(cellText(0, "Tier")).toBe("core");
  expect(cellText(1, "Tier")).toBe("extended");
  expect(cellText(2, "Tier")).toBe("—");

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

/**
 * `F2.7` / ADR 0056 decision 9 — the Points tab edits the five template
 * defaults on a draft.
 *
 * Same shape as the Tier assertions above: a draft renders one control per
 * field per row, a frozen version renders text, and a save carries every
 * row's five — including `p2`'s, which this test never touches, the same
 * "untouched row is not silently erased" claim `F2.13` made for `meta`.
 */
export async function draftRendersFiveMetadataControlsAndSaveCarriesThem(): Promise<void> {
  const save = vi
    .spyOn(templateApi, "updateAdminAssetTemplate")
    .mockResolvedValue(TEMPLATE);
  renderTab(true);
  await catalogSettles();

  const numberFor = (label: string, key: string) =>
    screen.getByRole("spinbutton", { name: `${label} for ${key}` }) as HTMLInputElement;
  const qualityFor = (key: string) =>
    screen.getByRole("combobox", { name: `Quality policy for ${key}` }) as HTMLSelectElement;

  expect(numberFor("Scale multiplier", "p1").value).toBe("1.5");
  expect(numberFor("Scale offset", "p1").value).toBe("-2");
  expect(numberFor("Engineering minimum", "p1").value).toBe("0");
  expect(numberFor("Engineering maximum", "p1").value).toBe("100");
  expect(qualityFor("p1").value).toBe("accept_bad");
  // `p3` carries no default — the inherit state is expressible.
  expect(numberFor("Scale multiplier", "p3").value).toBe("");
  expect(qualityFor("p3").value).toBe("");

  await userEvent.clear(numberFor("Engineering maximum", "p1"));
  await userEvent.type(numberFor("Engineering maximum", "p1"), "150");

  const saveButton = screen.getByRole("button", { name: "Save points" });
  await waitFor(() => expect(saveButton).toBeEnabled());
  await userEvent.click(saveButton);

  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });

  const [, body] = save.mock.calls[0];
  const points = body.points ?? [];
  // `p1`'s edit landed, and `p2` — never touched — still carries its own
  // null five rather than losing them to the whole-array replace. `meta` is
  // untouched too, carried the way `F2.13`'s save already proved.
  expect(points[0]).toEqual({ ...expectedPoint(1), engMax: 150, meta: { tier: "core" } });
  expect(points[1]).toEqual({ ...expectedPoint(2), meta: { tier: "extended" } });
  expect(points[2]).toEqual(expectedPoint(3));
}

/**
 * Case 1's sibling — the five render as read-only text on a frozen version,
 * matching the Tier column's rule and keeping the stock viewer's "no field on
 * this screen accepts input" sweep true.
 */
export async function readOnlyRendersMetadataAsText(): Promise<void> {
  renderTab(false);
  await catalogSettles();

  expect(screen.getByRole("columnheader", { name: "Scale ×" })).toBeInTheDocument();
  expect(screen.queryByRole("spinbutton", { name: /^Scale multiplier for / })).toBeNull();
  expect(screen.getByText("1.5")).toBeInTheDocument();
  expect(screen.getByText("accept_bad")).toBeInTheDocument();
}

/**
 * A `derived` row has no instrument to scale (ADR 0056 decision 3), so the
 * five controls are disabled on a draft the same way the source-key pattern
 * input already is.
 */
export async function derivedRowMetadataControlsAreDisabled(): Promise<void> {
  const derivedTemplate = adminAssetTemplateDtoSchema.parse({
    ...TEMPLATE,
    points: [
      {
        ...(point(1, null) as Record<string, unknown>),
        kind: "derived",
        sourceDataKeyPattern: null,
        formula: "{p1} * 2",
        formulaDialect: "bms-calc-v1",
        calcTrigger: "streaming",
      },
    ],
  });
  vi.spyOn(pointKeyApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [{ code: "p1" }],
  } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PointsTab template={derivedTemplate} editable onSaved={vi.fn()} onDirtyChange={vi.fn()} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(screen.getAllByRole("option", { name: "p1" })).toHaveLength(1);
  });

  expect(screen.getByRole("spinbutton", { name: "Scale multiplier for p1" })).toBeDisabled();
  expect(screen.getByRole("spinbutton", { name: "Scale offset for p1" })).toBeDisabled();
  expect(screen.getByRole("spinbutton", { name: "Engineering minimum for p1" })).toBeDisabled();
  expect(screen.getByRole("spinbutton", { name: "Engineering maximum for p1" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Quality policy for p1" })).toBeDisabled();
}
