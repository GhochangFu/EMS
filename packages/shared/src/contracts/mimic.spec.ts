import {
  MIMIC_HEADLINE_POINTS,
  dashboardMimicNodesResponseSchema,
  mimicNodeSchema,
} from "./mimic";

/**
 * `F3.32` / ADR 0079 — the `GET /dashboards/:id/mimic-nodes` response contract.
 *
 * Assertions live here; `mimic.test.ts` is the Vitest entry point (ADR 0014). One claim per
 * exported function, so a mutation reddens the `it` that owns it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const WIDGET_ID = "11111111-1111-4111-8111-111111111111";
const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "33333333-3333-4333-8333-333333333333";

const assignedNode = {
  key: "wtp",
  label: "WTP",
  roleCode: "wtp",
  asset: {
    id: ASSET_ID,
    code: "WTR-WTP-01",
    name: "Water treatment plant",
    domain: "water",
    latestTelemetryAt: "2026-09-28T10:00:00.000Z",
    freshness: "live",
    points: [
      {
        pointKey: "flow_m3h",
        name: "Flow",
        unit: "m3/h",
        headlineRank: 1,
        latest: { value: 42.5, time: "2026-09-28T10:00:00.000Z" },
      },
    ],
  },
  memberCount: 2,
  activeAlarms: 1,
};

const unassignedNode = {
  key: "softener",
  label: "Softener",
  roleCode: "softener",
  asset: null,
  memberCount: 0,
  activeAlarms: 0,
};

const response = (preset: string, nodes: unknown[]) => ({
  dashboardId: DASHBOARD_ID,
  resolvedAt: "2026-09-28T10:00:05.000Z",
  widgets: [{ widgetId: WIDGET_ID, preset, nodes }],
});

/** One assigned node and one unassigned node, under the one preset that exists. */
export function mimicResponseParsesAssignedAndUnassignedNodes(): void {
  const result = dashboardMimicNodesResponseSchema.safeParse(
    response("water_train", [assignedNode, unassignedNode]),
  );
  assert(
    result.success,
    `an assigned and an unassigned node must parse, got ${JSON.stringify(
      result.success ? null : result.error.issues,
    )}`,
  );
}

/** The preset on a response is the closed vocabulary, not a free string. */
export function mimicResponseRefusesAnUndeclaredPreset(): void {
  const result = dashboardMimicNodesResponseSchema.safeParse(
    response("gas_train", [assignedNode]),
  );
  assert(!result.success, "a response naming the undeclared gas_train preset must be refused");
}

/** `memberCount` is required: the `+N` badge reads it, and absent is not zero. */
export function mimicNodeRefusesAMissingMemberCount(): void {
  const { memberCount: _dropped, ...withoutCount } = unassignedNode;
  const result = mimicNodeSchema.safeParse(withoutCount);
  assert(!result.success, "a node without memberCount must be refused");
}

/** A node shows the top three points by headline rank (ADR 0079). */
export function mimicHeadlinePointsIsThree(): void {
  assert(
    MIMIC_HEADLINE_POINTS === 3,
    `a mimic node shows three headline points, got ${MIMIC_HEADLINE_POINTS}`,
  );
}
