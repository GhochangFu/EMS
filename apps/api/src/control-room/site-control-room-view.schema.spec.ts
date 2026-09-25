import { putSiteControlRoomViewBodySchema } from "./site-control-room-view.schema";

/**
 * `F3.67` U4 — the write body's pair rule and strictness (ADR 0076 decision 5).
 * Assertions live here; the Vitest wrapper is the sibling `.test.ts` (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DASHBOARD = "11111111-1111-4111-8111-111111111111";

function issuePaths(result: {
  success: boolean;
  error?: { issues: { path: (string | number)[] }[] };
}): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

export function assertGeneratedShapeParses(): void {
  const parsed = putSiteControlRoomViewBodySchema.parse({ kind: "generated" });
  assert(
    parsed.dashboardId === undefined && parsed.builtinKey === undefined,
    "a generated body sets neither field",
  );
  const withNulls = putSiteControlRoomViewBodySchema.parse({
    kind: "generated",
    dashboardId: null,
    builtinKey: null,
  });
  assert(
    withNulls.dashboardId === null && withNulls.builtinKey === null,
    "explicit null is accepted for a generated body",
  );
}

export function assertDashboardShapeParses(): void {
  const parsed = putSiteControlRoomViewBodySchema.parse({ kind: "dashboard", dashboardId: DASHBOARD });
  assert(parsed.dashboardId === DASHBOARD, "a dashboard body carries its dashboardId");
  assert(parsed.builtinKey === undefined, "no builtinKey rides along a dashboard body");
}

export function assertBuiltinShapeParses(): void {
  const parsed = putSiteControlRoomViewBodySchema.parse({ kind: "builtin", builtinKey: "smoc" });
  assert(parsed.builtinKey === "smoc", "a builtin body carries its key");
  assert(parsed.dashboardId === undefined, "no dashboardId rides along a builtin body");
}

export function assertMismatchedPairIsRefused(): void {
  const missingDashboardId = putSiteControlRoomViewBodySchema.safeParse({ kind: "dashboard" });
  assert(!missingDashboardId.success, "dashboard without a dashboardId must be refused");
  assert(issuePaths(missingDashboardId).includes("dashboardId"), "the issue sits at dashboardId");

  const strayBuiltinKey = putSiteControlRoomViewBodySchema.safeParse({
    kind: "dashboard",
    dashboardId: DASHBOARD,
    builtinKey: "smoc",
  });
  assert(!strayBuiltinKey.success, "a dashboard body carrying builtinKey must be refused");
  assert(issuePaths(strayBuiltinKey).includes("builtinKey"), "the issue sits at builtinKey");

  const missingBuiltinKey = putSiteControlRoomViewBodySchema.safeParse({ kind: "builtin" });
  assert(!missingBuiltinKey.success, "builtin without a builtinKey must be refused");

  const strayDashboardId = putSiteControlRoomViewBodySchema.safeParse({
    kind: "generated",
    dashboardId: DASHBOARD,
  });
  assert(!strayDashboardId.success, "a generated body carrying dashboardId must be refused");

  // Positive control: the matched pair for each kind is admitted.
  assert(
    putSiteControlRoomViewBodySchema.safeParse({ kind: "dashboard", dashboardId: DASHBOARD }).success,
    "dashboard + dashboardId parses",
  );
  assert(
    putSiteControlRoomViewBodySchema.safeParse({ kind: "builtin", builtinKey: "smoc" }).success,
    "builtin + builtinKey parses",
  );
}

export function assertBuiltinCannotCarryDashboardId(): void {
  const strayDashboardId = putSiteControlRoomViewBodySchema.safeParse({
    kind: "builtin",
    builtinKey: "smoc",
    dashboardId: DASHBOARD,
  });
  assert(!strayDashboardId.success, "a builtin body carrying dashboardId must be refused");
  assert(issuePaths(strayDashboardId).includes("dashboardId"), "the issue sits at dashboardId");
  // Positive control: the same body without the stray key parses.
  assert(
    putSiteControlRoomViewBodySchema.safeParse({ kind: "builtin", builtinKey: "smoc" }).success,
    "the same body without dashboardId parses",
  );
}

export function assertGeneratedCannotCarryBuiltinKey(): void {
  const strayBuiltinKey = putSiteControlRoomViewBodySchema.safeParse({
    kind: "generated",
    builtinKey: "smoc",
  });
  assert(!strayBuiltinKey.success, "a generated body carrying builtinKey must be refused");
  assert(issuePaths(strayBuiltinKey).includes("builtinKey"), "the issue sits at builtinKey");
  // Positive control: the same body without the stray key parses.
  assert(
    putSiteControlRoomViewBodySchema.safeParse({ kind: "generated" }).success,
    "the same body without builtinKey parses",
  );
}

export function assertUnknownKeyIsRefused(): void {
  const result = putSiteControlRoomViewBodySchema.safeParse({ kind: "generated", extra: "nope" });
  assert(!result.success, "an unknown top-level key must be refused");
  // Positive control: the same body without the stray key parses.
  assert(
    putSiteControlRoomViewBodySchema.safeParse({ kind: "generated" }).success,
    "the same body without the stray key parses",
  );
}
