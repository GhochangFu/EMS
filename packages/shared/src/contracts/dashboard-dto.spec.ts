import { DASHBOARD_GRID } from "./dashboard-builder";
import { dashboardDtoSchema, dashboardSummaryDtoSchema, dashboardWidgetDtoSchema } from "./dashboard-dto";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectRejects(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown, message: string): void {
  assert(schema.safeParse(value).success === false, `${message} — expected a refusal, got success`);
}

function expectAccepts(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown, message: string): void {
  const result = schema.safeParse(value);
  assert(result.success === true, `${message} — expected success, got a refusal`);
}

/**
 * The dashboard read DTOs, moved out of `dashboard-builder.ts` by `F3.73` (plan D0) together with
 * their claims. Assertions live here; `dashboard-dto.test.ts` is the vitest entry point (ADR 0014).
 */

/**
 * `F3.1d` Unit 2 — `DASHBOARD_GRID` is the single source for the canvas
 * bounds, and `dashboardWidgetIdentitySchema`'s four fields plus its
 * `.refine()` must read it rather than restate `11`/`12`/`24`.
 * `tests/f3.1d-grid-bounds-single-source.test.ts` is the scan that keeps a
 * fifth TypeScript copy from appearing; this is the pin that proves THIS
 * schema is one of the wired sites rather than a fourth private copy.
 */
export function runDashboardGridTests(): void {
  assert(DASHBOARD_GRID.columns === 12, "the canvas is 12 columns");
  assert(DASHBOARD_GRID.minWidgetW === 1, "a widget is at least 1 column wide");
  assert(DASHBOARD_GRID.minWidgetH === 1, "a widget is at least 1 row tall");
  assert(DASHBOARD_GRID.maxWidgetH === 24, "a widget is at most 24 rows tall");

  const gridFixture = {
    id: "11111111-1111-4111-8111-111111111111",
    dashboardId: "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    tabId: null,
    title: null,
    gridY: 0,
    gridH: 1,
    points: [],
    // `F3.35` Stage C widened the identity schema. A widget as read always carries both
    // binding arrays, and an empty one is the normal state for the kind it does not use.
    sources: [],
    widgetType: "value_tile",
    config: {},
  };

  // The pin the mutation table names: "set DASHBOARD_GRID.columns = 16" must
  // flip this red. At columns=16 the field's legitimate max becomes 15 and
  // gridX:15 parses — so today, with columns=12, this must still be refused.
  // gridW is 1 so only the field-level .max() on gridX is exercised, not the
  // .refine() cross-check (15 + 1 = 16, already over today's bound either way).
  expectRejects(
    dashboardWidgetDtoSchema,
    { ...gridFixture, gridX: 15, gridW: 1 },
    "gridX 15 exceeds DASHBOARD_GRID.columns - 1 today — refused unless the constant has drifted",
  );
  expectAccepts(
    dashboardWidgetDtoSchema,
    { ...gridFixture, gridX: 11, gridW: 1 },
    "gridX at DASHBOARD_GRID.columns - 1 (the last column) is accepted",
  );

  // The .refine() cross-check, isolated from the field-level .max(): both
  // gridX (11) and gridW (2) are individually legal, but their sum (13)
  // exceeds today's 12-column canvas. Flips at the same mutation, since a
  // properly wired .refine() reads DASHBOARD_GRID.columns too.
  expectRejects(
    dashboardWidgetDtoSchema,
    { ...gridFixture, gridX: 11, gridW: 2 },
    "gridX 11 + gridW 2 (13) exceeds the 12-column canvas though both individual bounds are legal",
  );
  expectAccepts(
    dashboardWidgetDtoSchema,
    { ...gridFixture, gridX: 11, gridW: 1 },
    "gridX 11 + gridW 1 (12) exactly fills the canvas and is accepted",
  );
}


const validSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  slug: "tx-01-overview",
  name: "TX-01 · Overview",
  description: null,
  locationId: null,
  assetGroupId: null,
  assetId: "33333333-3333-4333-8333-333333333333",
  assetTemplateId: "44444444-4444-4444-8444-444444444444",
  assetCode: "TX-01",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  widgetCount: 3,
};

const validDashboard = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  slug: "tx-01-overview",
  name: "TX-01 · Overview",
  description: null,
  locationId: null,
  assetGroupId: null,
  assetId: "33333333-3333-4333-8333-333333333333",
  assetTemplateId: "44444444-4444-4444-8444-444444444444",
  templateId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  tabs: [],
  widgets: [],
};

/**
 * `F3.2` / ADR 0067 decision 1, §13 — `dashboardSummaryDtoSchema` and
 * `dashboardDtoSchema` both gain the asset scope arm (`assetId`,
 * `assetTemplateId`); the summary DTO alone also gains `assetCode` so the list
 * badge can read "Asset · <code>" without a second fetch.
 */
export function runDashboardAssetScopeFieldsTests(): void {
  expectAccepts(
    dashboardSummaryDtoSchema,
    validSummary,
    "a summary row with both asset stamps and an asset code",
  );
  const { assetId: _assetId, ...summaryWithoutAssetId } = validSummary;
  expectRejects(
    dashboardSummaryDtoSchema,
    summaryWithoutAssetId,
    "a summary row missing assetId",
  );
  // A missing `assetCode` key is a required-field violation, not silently
  // accepted — this is the assertion that reddens if the field is ever
  // dropped from the schema (an accept-only test with an extra unused key in
  // the fixture would not: `dashboardSummaryDtoSchema` is not `.strict()`,
  // so a schema missing the field simply ignores it rather than refusing).
  const { assetCode: _assetCode, ...summaryWithoutAssetCode } = validSummary;
  expectRejects(
    dashboardSummaryDtoSchema,
    summaryWithoutAssetCode,
    "a summary row missing assetCode",
  );
  expectAccepts(
    dashboardSummaryDtoSchema,
    { ...validSummary, assetId: null, assetTemplateId: null, assetCode: null },
    "an organization-wide summary row — every asset field null",
  );

  expectAccepts(
    dashboardDtoSchema,
    validDashboard,
    "a dashboard with both asset stamps present",
  );
  const { assetId: _dashAssetId, ...dashboardWithoutAssetId } = validDashboard;
  expectRejects(
    dashboardDtoSchema,
    dashboardWithoutAssetId,
    "a dashboard missing assetId",
  );
}


const validTab = {
  id: "55555555-5555-4555-8555-555555555555",
  dashboardId: validDashboard.id,
  organizationId: validDashboard.organizationId,
  key: "sld",
  label: "SLD",
  sortOrder: 0,
  assetGroupId: null,
};

/**
 * `F3.73` (plan D1) — a dashboard as read carries `tabs` (empty for a legacy single canvas) and
 * the `templateId` stamp. Both are required: a schema that made either optional would let a
 * service that forgets to read them typecheck and ship an unlabelled dashboard.
 */
export function runDashboardTabsFieldsTests(): void {
  const { tabs: _tabs, ...withoutTabs } = validDashboard;
  expectRejects(dashboardDtoSchema, withoutTabs, "a dashboard without tabs");
  const { templateId: _templateId, ...withoutTemplateId } = validDashboard;
  expectRejects(dashboardDtoSchema, withoutTemplateId, "a dashboard without templateId");
  expectAccepts(
    dashboardDtoSchema,
    { ...validDashboard, templateId: "66666666-6666-4666-8666-666666666666", tabs: [validTab] },
    "a dashboard with a template stamp and one tab",
  );
  expectRejects(
    dashboardDtoSchema,
    { ...validDashboard, tabs: [{ ...validTab, assetGroupId: "not-a-uuid" }] },
    "a tab whose assetGroupId is not a uuid",
  );
}

/** A widget as read names its tab (`null` on the legacy canvas); the key is required. */
export function runWidgetTabIdTests(): void {
  const widget = {
    id: "11111111-1111-4111-8111-111111111111",
    dashboardId: validDashboard.id,
    organizationId: validDashboard.organizationId,
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 4,
    points: [],
    sources: [],
    widgetType: "value_tile",
    config: {},
  };
  expectRejects(dashboardWidgetDtoSchema, widget, "a widget without tabId");
  expectAccepts(dashboardWidgetDtoSchema, { ...widget, tabId: null }, "a legacy-canvas widget, tabId null");
  expectAccepts(dashboardWidgetDtoSchema, { ...widget, tabId: validTab.id }, "a widget on a tab");
}
