import { sectionTemplateWidgetSchema } from "./contracts/dashboard-templates";
import { planTemplateWidget, type GroupMember } from "./template-instantiation";

/**
 * `F3.73` plan Task 2.2 — the four claims `planTemplateWidget`'s docblocks record, moved with
 * the code from `DashboardTemplatesInstantiateService`. The integration suite
 * (`dashboard-templates-instantiate.integration.spec.ts`) still proves the same outcomes
 * against real rows; these prove each correction alone, with no database.
 *
 * Assertions live here; `template-instantiation.test.ts` is the Vitest entry point (ADR 0014).
 * One claim per exported function, so a mutation reddens the `it` that owns it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function widget(overrides: Record<string, unknown>) {
  return sectionTemplateWidgetSchema.parse({
    key: "w",
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 4,
    bindings: [],
    sources: [],
    widgetType: "chart",
    config: { series: "line" },
    ...overrides,
  });
}

/** Three chillers, `C-1`..`C-3`; each carries `kVA`, only `C-1` and `C-2` carry `kW`. */
const CHILLERS: GroupMember[] = [
  { assetId: "a1", code: "C-1" },
  { assetId: "a2", code: "C-2" },
  { assetId: "a3", code: "C-3" },
];
const POINTS = new Map<string, string>([
  ["a1::kVA", "p1-kva"],
  ["a2::kVA", "p2-kva"],
  ["a3::kVA", "p3-kva"],
  ["a1::kW", "p1-kw"],
  ["a2::kW", "p2-kw"],
]);

/**
 * Claim 1 — per binding, then combined. One role resolves every member; the other matches
 * nothing. The summed resolver called this `bound`; it is `partial`.
 */
export function aWidgetWithOneDeadRoleIsPartial(): void {
  const plan = planTemplateWidget(
    widget({
      bindings: [
        { assetRoleCode: "chiller", pointKey: "kVA" },
        { assetRoleCode: "cooling-tower", pointKey: "kW" },
      ],
    }),
    new Map([["chiller", CHILLERS]]),
    POINTS,
  );
  assert(
    plan.resolution.outcome === "partial",
    `a widget with one dead role must report partial, got ${plan.resolution.outcome}`,
  );
  assert(plan.points.length === 3, `the live role's three points must bind, got ${plan.points.length}`);
}

/** Claim 2 — `matchedMembers` is the size of the UNION: two bindings over one role of three. */
export function matchedMembersCountsEachMemberOnce(): void {
  const plan = planTemplateWidget(
    widget({
      bindings: [
        { assetRoleCode: "chiller", pointKey: "kVA" },
        { assetRoleCode: "chiller", pointKey: "kW" },
      ],
    }),
    new Map([["chiller", CHILLERS]]),
    POINTS,
  );
  assert(
    plan.resolution.matchedMembers === 3,
    `two bindings over one role of three members must match 3, got ${plan.resolution.matchedMembers}`,
  );
}

/**
 * Claim 3 — the tie-break is global by `assets.code`. A `max = 1` gauge names `pump` first and
 * `chiller` second; the first member by code across BOTH roles is `A-9`, a chiller.
 */
export function theTieBreakIsTheFirstMemberByCodeAcrossBindings(): void {
  const plan = planTemplateWidget(
    widget({
      widgetType: "radial_gauge",
      gridW: 3,
      gridH: 3,
      config: { min: 0, max: 100 },
      bindings: [
        { assetRoleCode: "pump", pointKey: "kW" },
        { assetRoleCode: "chiller", pointKey: "kW" },
      ],
    }),
    new Map([
      ["pump", [{ assetId: "pz", code: "Z-1" }]],
      ["chiller", [{ assetId: "ca", code: "A-9" }]],
    ]),
    new Map([
      ["pz::kW", "pz-kw"],
      ["ca::kW", "ca-kw"],
    ]),
  );
  assert(
    plan.points.length === 1 && plan.points[0]?.pointId === "ca-kw",
    `the gauge must bind A-9's point (first by code), got ${JSON.stringify(plan.points)}`,
  );
  assert(
    plan.resolution.outcome === "truncated",
    `a resolved point dropped by the cap is truncated, got ${plan.resolution.outcome}`,
  );
}

/** Claim 4 — a widget that names no role (a catalog tile) is `bound`, never a shortfall. */
export function aWidgetWithNoRoleIsBound(): void {
  const plan = planTemplateWidget(
    widget({
      widgetType: "value_tile",
      gridW: 3,
      gridH: 2,
      config: {},
      sources: [{ catalogKey: "alarms.active.count", params: {} }],
    }),
    new Map(),
    new Map(),
  );
  assert(
    plan.resolution.outcome === "bound",
    `a role-free widget must report bound, got ${plan.resolution.outcome}`,
  );
  assert(plan.points.length === 0, `a role-free widget binds no point, got ${plan.points.length}`);
}
