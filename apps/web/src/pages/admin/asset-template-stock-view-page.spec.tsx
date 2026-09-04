import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { expect, vi } from "vitest";

import { stockAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { StockAssetTemplateDto } from "@bms/shared";

import * as api from "../../api/admin/asset-templates";
import * as orgApi from "../../api/admin/organizations";
import * as pointKeyApi from "../../api/admin/point-keys";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { AssetTemplateStockViewPage } from "./asset-template-stock-view-page";

/**
 * `F2.14` — the read-only viewer for one stock catalog entry (ADR 0052
 * decisions 1 and 10). Assertions live here;
 * `asset-template-stock-view-page.test.tsx` is the Vitest entry point
 * (ADR 0014), and it carries `@vitest-environment jsdom` because that is the
 * file Vitest collects (ADR 0042 decision 2).
 *
 * **What this file exists to hold.** The viewer renders repository data through
 * the same seven authoring tabs with `editable={false}`. Two things can
 * silently stop being true: a field could render writable on a screen with no
 * save path, and the synthetic `status` in `lib/stock-template-view.ts` could
 * become `draft`, which leaves the Calculations and KPIs formula editors
 * writable even with `editable={false}` (`formulaFieldsAreReadOnly` reads
 * `status`, not the prop). Both fixtures below are built for that: `FEEDER`
 * mirrors the live `electrical-feeder` — 33 points, 11 alarms, no derived
 * point — and `WITH_FORMULA` carries the derived point and the KPI the feeder
 * structurally cannot, which is the only way to reach either formula editor.
 *
 * **`FEEDER` gained three maintenance plans in `F2.19`** (ADR 0038
 * Amendment 5 Part B). The seventh tab is what discharges the review problem
 * the amendment names: 101 authored plans across all 27 stock entries, ten of
 * them `safetyCritical`, and a global administrator could not see one of them.
 * The read-only floor is the minimum the amendment sets, so it is asserted
 * here on the viewer rather than only on the tab.
 *
 * The fixtures are parsed through `stockAssetTemplateDtoSchema`, so they are
 * real `StockAssetTemplateDto`s rather than hand-typed lookalikes.
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

/** `canAuthorTemplates` refuses `location_admin` — ADR 0015 §7. */
const locationAdmin: AuthUser = {
  id: "u2",
  email: "wc-admin@bms.local",
  displayName: "Location admin",
  role: "location_admin",
} as unknown as AuthUser;

const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const FEEDER_CODE = "electrical-feeder";
const FEEDER_NAME = "Feeder / incomer — multifunction energy meter";
const POINT_COUNT = 33;
const ALARM_COUNT = 11;

/** One measured point, tier alternating, `required` alternating. */
function stockPoint(index: number): unknown {
  return {
    pointKey: `p${index}`,
    label: `Point ${index}`,
    unit: "kW",
    sourceDataKeyPattern: `FEEDER_P${index}`,
    formula: null,
    formulaDialect: null,
    kind: "measured",
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    required: index % 2 === 0,
    sortOrder: index,
    meta: { tier: index % 2 === 0 ? "core" : "extended" },
  };
}

function stockAlarm(index: number): unknown {
  return {
    code: `ALARM_${index}`,
    pointKey: `p${index}`,
    operator: "gt",
    thresholdValue: index,
    severity: "warning",
    message: `Alarm ${index} fired.`,
    category: "operations",
  };
}

/**
 * Three plans in the shape the stock packs actually authored them: partial,
 * because the API's defaults are applied on write and never re-sent. One is
 * `safetyCritical` and one carries a `triggerSummary` — the two fields a reader
 * most needs and the two a collapsed or truncated render would lose.
 */
const MAINTENANCE_PLANS = [
  { title: "Thermographic scan of the feeder terminations", intervalDays: 180 },
  {
    title: "Protection relay secondary injection test",
    intervalDays: 730,
    category: "compliance",
    priority: "high",
    estimatedMinutes: 240,
    safetyCritical: true,
  },
  {
    title: "Breaker mechanism service",
    intervalDays: 365,
    triggerSummary: "Due on the operation counter or on the calendar, whichever comes first.",
  },
];

const MAINTENANCE_COUNT = MAINTENANCE_PLANS.length;

/**
 * The live `electrical-feeder`, by its measured shape: 33 points, 11 alarms,
 * zero derived points and zero KPIs. `p32` is what catches a truncated render.
 */
const FEEDER: StockAssetTemplateDto = stockAssetTemplateDtoSchema.parse({
  code: FEEDER_CODE,
  name: FEEDER_NAME,
  assetType: "feeder",
  domain: "electrical",
  description: "Authored from docs/electrical-derived-taglist-v1.md §1.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: Array.from({ length: ALARM_COUNT }, (_unused, index) => stockAlarm(index)),
    maintenance: MAINTENANCE_PLANS,
  },
  points: Array.from({ length: POINT_COUNT }, (_unused, index) => stockPoint(index)),
});

/**
 * The `electrical-transformer` class of entry, small: one derived point with a
 * formula and one KPI with an expression. Mandatory, not prophylactic — the
 * feeder renders Calculations' "no derived points" empty state and can never
 * reach a formula editor at all.
 */
const WITH_FORMULA: StockAssetTemplateDto = stockAssetTemplateDtoSchema.parse({
  code: "electrical-transformer",
  name: "Transformer",
  assetType: "transformer",
  domain: "electrical",
  description: null,
  stockVersion: 2,
  content: {
    contentVersion: 1,
    kpis: [
      {
        code: "load_factor",
        name: "Load factor",
        unit: "%",
        pointKeys: ["top_oil_temp_c"],
        expression: "{top_oil_temp_c} * 100",
        dialect: "bms-calc-v1",
        higherIsBetter: true,
      },
    ],
  },
  points: [
    {
      pointKey: "top_oil_temp_c",
      label: "Top oil temperature",
      unit: "degC",
      sourceDataKeyPattern: "TR{unit}_TOP_OIL_T",
      formula: null,
      formulaDialect: null,
      kind: "measured",
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: true,
      sortOrder: 0,
      meta: { tier: "core" },
    },
    {
      pointKey: "ambient_temp_c",
      label: "Ambient temperature",
      unit: "degC",
      sourceDataKeyPattern: "TR{unit}_AMBIENT_T",
      formula: null,
      formulaDialect: null,
      kind: "measured",
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: true,
      sortOrder: 1,
      meta: { tier: "core" },
    },
    {
      pointKey: "oil_rise_over_ambient_c",
      label: "Oil rise over ambient",
      unit: "degC",
      sourceDataKeyPattern: null,
      formula: "{top_oil_temp_c} - {ambient_temp_c}",
      formulaDialect: "bms-calc-v1",
      kind: "derived",
      calcTrigger: "streaming",
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: false,
      sortOrder: 2,
      meta: { tier: "extended" },
    },
  ],
});

const IMPORTED_DRAFT = {
  id: DRAFT_ID,
  organizationId: "org-1",
  organizationCode: "IX",
  organizationName: "Ion Exchange",
  code: FEEDER_CODE,
  version: 1,
  name: FEEDER_NAME,
  assetType: "feeder",
  domain: "electrical",
  description: null,
  status: "draft",
  content: {},
  publishedAt: null,
  archivedAt: null,
  stockCode: FEEDER_CODE,
  stockVersion: 1,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  points: [],
};

const ORGS = { items: [{ id: "org-1", code: "IX", name: "Ion Exchange" }] };

const VOCABULARIES = {
  ruleCategories: [{ code: "operations", label: "Operations", sortOrder: 10, active: true }],
  assetDomains: [],
  alarmSeverities: [{ code: "warning", label: "Warning", sortOrder: 10, active: true }],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
};

/**
 * The point-key catalog is stubbed so the Points tab's `<select>` offers each
 * declared key as a real option. Left unstubbed, every row falls back to its
 * "(inactive)" option and the assertion would be reading a fallback path.
 */
function stubApi(entries: readonly StockAssetTemplateDto[] = [FEEDER]): void {
  const keys = entries.flatMap((entry) => entry.points.map((point) => point.pointKey));
  vi.spyOn(api, "fetchAdminStockAssetTemplates").mockResolvedValue({ items: entries } as never);
  vi.spyOn(api, "importAdminStockAssetTemplate").mockResolvedValue(IMPORTED_DRAFT as never);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue(ORGS as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  vi.spyOn(pointKeyApi, "fetchAdminPointKeys").mockResolvedValue({
    items: keys.map((code) => ({ code })),
  } as never);
}

/** Where a successful import must land — decision 10's "landing on the new draft". */
function DraftLanding() {
  const { id } = useParams();
  return <div>landed on draft {id}</div>;
}

function renderViewer(path: string, user: AuthUser = admin): HTMLElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/asset-templates/stock/:code"
            element={<AssetTemplateStockViewPage user={user} />}
          />
          <Route path="/admin/asset-templates/:id" element={<DraftLanding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return container;
}

const IMPORT_ORG_LABEL = "Import into organization";

/**
 * Every writable-looking control on the page, except the one control that is
 * genuinely writable — the header's organization picker.
 *
 * Scoping by exclusion rather than by a tab-panel test id makes the stronger
 * claim: the picker is the *only* field on the whole screen that accepts input.
 */
function fieldsOutsideTheImportPicker(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("input, select, textarea")].filter(
    (field) => field.getAttribute("aria-label") !== IMPORT_ORG_LABEL,
  );
}

function enabledFieldNames(container: HTMLElement): string[] {
  return fieldsOutsideTheImportPicker(container)
    .filter((field) => !(field as HTMLInputElement).disabled)
    .map((field) => `${field.tagName.toLowerCase()}[${field.getAttribute("aria-label") ?? ""}]`);
}

/**
 * Case 1 — every declared point renders, and nothing on the Points tab accepts
 * input. `p32` is the assertion that catches a truncated or paged render; the
 * disabled sweep is what catches an `editable` that stopped being `false`.
 */
export async function everyPointRendersAndNoFieldAcceptsInput(): Promise<void> {
  stubApi();
  const container = renderViewer(`/admin/asset-templates/stock/${FEEDER_CODE}?tab=points`);

  await screen.findByText(FEEDER_NAME);
  await waitFor(() => {
    expect(screen.getAllByRole("row").length).toBeGreaterThan(POINT_COUNT);
  });

  const pointKeys = [...container.querySelectorAll<HTMLSelectElement>("select")]
    .map((select) => select.value)
    .filter((value) => /^p\d+$/.test(value));
  expect(pointKeys).toContain("p0");
  expect(pointKeys, "the last declared point must render — a truncated grid is silent").toContain(
    `p${POINT_COUNT - 1}`,
  );
  expect(pointKeys).toHaveLength(POINT_COUNT);

  const fields = fieldsOutsideTheImportPicker(container);
  expect(fields.length, "the Points tab rendered no fields at all — an empty sweep is vacuous").
    toBeGreaterThan(POINT_COUNT);
  expect(
    enabledFieldNames(container),
    "a field on the read-only stock viewer accepts input. There is no save path on this screen, " +
      "so anything typed here is lost the moment the tab changes.",
  ).toEqual([]);

  expect(
    screen.queryByRole("button", { name: /^Save / }),
    "a Save control rendered on the stock viewer. ADR 0052 decision 1 makes the catalog " +
      "repository data — it is imported, never edited here.",
  ).toBeNull();
}

/**
 * Case 2 — every stored alarm renders, disabled, with neither the Save control
 * nor the "content cannot be written back" banner that belongs to authoring.
 */
export async function everyAlarmRendersDisabledWithNoSavePath(): Promise<void> {
  stubApi();
  const container = renderViewer(`/admin/asset-templates/stock/${FEEDER_CODE}?tab=alarms`);

  await screen.findByText(FEEDER_NAME);
  await waitFor(() => {
    expect(screen.getAllByDisplayValue(/^ALARM_/)).toHaveLength(ALARM_COUNT);
  });

  const values = [...container.querySelectorAll<HTMLInputElement>("input")].map(
    (input) => input.value,
  );
  for (let index = 0; index < ALARM_COUNT; index += 1) {
    expect(values, `alarm ALARM_${index} did not render`).toContain(`ALARM_${index}`);
  }

  expect(
    enabledFieldNames(container),
    "an alarm field on the read-only stock viewer accepts input.",
  ).toEqual([]);
  expect(screen.queryByRole("button", { name: "Save alarms" })).toBeNull();
  // No assertion on the "Saving alarms is blocked" banner: `AlarmsTab` renders
  // it from the content, not from `editable`, and this fixture carries no
  // reserved key — so a "does not render" check here passed vacuously (the
  // F2.14 code review proved it with `optimisation: {}` in the fixture). The
  // page does not suppress the banner, and the API rejects reserved keys, so
  // the claim belongs to neither the page nor this spec.
}

/**
 * Case 2b — every maintenance plan renders, disabled, with no save path.
 *
 * This is the case ADR 0038 Amendment 5 Part B exists for. The amendment's
 * minimum scope is a read-only Maintenance tab on this viewer, because the
 * client cannot redline what the client cannot see — the review posture ADR
 * 0040 set for Track B — and 101 authored plans were reachable only through the
 * API. The `safetyCritical` badge is asserted because ten of those plans are
 * safety critical and the badge is the one thing on the card a reader must not
 * have to open a field to find.
 */
export async function everyMaintenancePlanRendersDisabledWithNoSavePath(): Promise<void> {
  stubApi();
  const container = renderViewer(`/admin/asset-templates/stock/${FEEDER_CODE}?tab=maintenance`);

  await screen.findByText(FEEDER_NAME);
  for (const plan of MAINTENANCE_PLANS) {
    expect(
      await screen.findByDisplayValue(plan.title),
      `the plan "${plan.title}" did not render`,
    ).toBeInTheDocument();
  }
  expect(
    screen.getByDisplayValue(MAINTENANCE_PLANS[2].triggerSummary as string),
    "the trigger summary must render — it is the field that says when a plan is due",
  ).toBeInTheDocument();

  // The floor case 2 had to learn: `enabledFieldNames` maps over `aria-label`,
  // so `toEqual([])` also passes on a tab that rendered nothing at all.
  expect(
    fieldsOutsideTheImportPicker(container).length,
    "the Maintenance tab rendered too few fields for the sweep below to mean anything",
  ).toBeGreaterThan(MAINTENANCE_COUNT * 10);
  expect(
    enabledFieldNames(container),
    "a maintenance field on the read-only stock viewer accepts input. ADR 0052 decision 1 makes " +
      "the catalog repository data — it is imported, never edited here.",
  ).toEqual([]);
  expect(screen.queryByRole("button", { name: "Save maintenance" })).toBeNull();

  expect(
    screen.getAllByText("Safety critical"),
    "exactly one of the three plans is safety critical, and the badge must render read-only",
  ).toHaveLength(1);

  expect(
    screen.getByRole("tab", { name: "Maintenance" }).getAttribute("aria-selected"),
    "?tab=maintenance must select the Maintenance tab in the strip",
  ).toBe("true");
}

/**
 * Case 3 — both formula surfaces render read-only.
 *
 * This is the case that fails if `stockEntryAsTemplate` ever stamps `draft`:
 * `formulaFieldsAreReadOnly(status)` is `!capabilities(status).editable`, and
 * `capabilities("draft").editable` is `true`, so `editable={false}` alone would
 * leave a writable CodeMirror on a screen with no save path. Calculations and
 * KPIs are the two call sites, so both are checked.
 */
export async function bothFormulaEditorsRenderReadOnly(): Promise<void> {
  stubApi([WITH_FORMULA]);
  renderViewer("/admin/asset-templates/stock/electrical-transformer?tab=calculations");

  const formula = await screen.findByRole("group", {
    name: "Formula for oil_rise_over_ambient_c",
  });
  expect(
    formula.getAttribute("data-formula-readonly"),
    "the derived-point formula editor is writable on the read-only viewer. Check the synthetic " +
      "status in lib/stock-template-view.ts — `draft` reads as editable.",
  ).toBe("true");

  await userEvent.click(screen.getByRole("tab", { name: "KPIs" }));
  const expression = await screen.findByRole("group", { name: "Expression for load_factor" });
  expect(
    expression.getAttribute("data-formula-readonly"),
    "the KPI expression editor is writable on the read-only viewer — the second call site of " +
      "formulaFieldsAreReadOnly, and it fails for the same reason.",
  ).toBe("true");
}

/**
 * Case 4 — Import lands on the new draft, exactly as the card's does. The code
 * sent is the **resolved entry's**, never the raw URL parameter.
 */
export async function importLandsOnTheNewDraft(): Promise<void> {
  stubApi();
  renderViewer(`/admin/asset-templates/stock/${FEEDER_CODE}`);

  await screen.findByText(FEEDER_NAME);
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: IMPORT_ORG_LABEL }),
    "org-1",
  );
  await userEvent.click(screen.getByRole("button", { name: `Import ${FEEDER_NAME}` }));

  await waitFor(() => {
    expect(api.importAdminStockAssetTemplate).toHaveBeenCalledWith(FEEDER_CODE, "org-1");
  });
  expect(await screen.findByText(`landed on draft ${DRAFT_ID}`)).toBeInTheDocument();
}

/** Case 5 — the card's rule, restated because this is a different component. */
export async function importIsDisabledUntilAnOrganizationIsChosen(): Promise<void> {
  stubApi();
  renderViewer(`/admin/asset-templates/stock/${FEEDER_CODE}`);

  await screen.findByText(FEEDER_NAME);
  const importButton = screen.getByRole("button", { name: `Import ${FEEDER_NAME}` });
  expect(importButton).toBeDisabled();

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: IMPORT_ORG_LABEL }),
    "org-1",
  );
  expect(importButton).not.toBeDisabled();
}

/**
 * Case 6 — the lookup is the validation (§5.2). An absent code is a panel that
 * names it, not a crash on `entry.points`.
 */
export async function anUnknownCodeRendersTheNotFoundPanel(): Promise<void> {
  stubApi();
  renderViewer("/admin/asset-templates/stock/not-a-real-code");

  expect(await screen.findByText(/not-a-real-code/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /all templates/i })).toHaveAttribute(
    "href",
    "/admin/asset-templates",
  );
  expect(screen.queryByRole("tab", { name: "Points" })).toBeNull();
}

/**
 * Case 7 — the analogue of `cardIsAbsentForARoleThatCannotAuthor`. The server
 * refuses `GET /admin/asset-templates/stock` to a non-author, so an ungated
 * viewer would show whoever typed the URL a raw 403 envelope.
 */
export async function aRoleThatCannotAuthorSeesTheRefusal(): Promise<void> {
  stubApi();
  renderViewer(`/admin/asset-templates/stock/${FEEDER_CODE}`, locationAdmin);

  expect(await screen.findByText(/does not author templates/i)).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Points" })).toBeNull();
  expect(
    api.fetchAdminStockAssetTemplates,
    "the viewer fetched the catalog for a role the server refuses it to.",
  ).not.toHaveBeenCalled();
}
