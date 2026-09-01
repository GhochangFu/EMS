import { expect } from "vitest";

import type pg from "pg";

import type { InstantiateSectionTemplateResponse, JwtPayload } from "@bms/shared";

import type { DashboardTemplatesInstantiateService } from "./dashboard-templates-instantiate.service";

/**
 * `F3.36` Part E4 — what instantiation does with a real asset group, real
 * members and real points. ADR 0049 decision 4 and 6, and **Amendment 2**.
 *
 * Assertions live here; `dashboard-templates-instantiate.integration.test.ts` is
 * the Vitest entry point (ADR 0014) and owns the fixtures and cleanup.
 *
 * **Every outcome gets its own fixture, and the fixtures are built so that the
 * four are genuinely distinguishable.** Three members share one role and only
 * two of them carry the `kW` point, so the same role produces `truncated` on a
 * one-point widget and `partial` on a many-point one — which is the pair
 * Amendment 2 had to rule and the pair a happy-path test would never separate.
 */

const resolutionFor = (
  response: InstantiateSectionTemplateResponse,
  widgetKey: string,
): InstantiateSectionTemplateResponse["resolutions"][number] => {
  const found = response.resolutions.find((entry) => entry.widgetKey === widgetKey);
  if (!found) {
    throw new Error(
      `no resolution reported for widget "${widgetKey}". Amendment 2 decision 1: instantiation ` +
        "returns a per-widget report and never a silent success — a missing entry is the defect.",
    );
  }
  return found;
};

/**
 * The whole report, in one call, so the four outcomes are asserted against ONE
 * instantiation rather than four that could each be right in isolation.
 */
export async function assertResolutionReportCoversEveryOutcome(
  service: DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  templateId: string,
  assetGroupId: string,
  slug: string,
): Promise<{ dashboardId: string }> {
  const response = await service.instantiate(actor, templateId, {
    assetGroupId,
    slug,
    name: "F3.36 resolution report proof",
  } as Parameters<DashboardTemplatesInstantiateService["instantiate"]>[2]);

  expect(
    response.resolutions.length,
    "one resolution entry per widget — Amendment 2 decision 1",
  ).toBe(5);

  // 1. Three members carry the role, two carry the point, the widget holds one.
  //    The cap bites, so this is `truncated` (Amendment 2 decision 2) and the
  //    bound member is the FIRST by assets.code.
  const gauge = resolutionFor(response, "chiller-gauge");
  expect(gauge.matchedMembers, "three members carry the chiller role").toBe(3);
  expect(gauge.boundPoints, "a radial_gauge holds exactly one point").toBe(1);
  expect(
    gauge.outcome,
    "an over-match into a max=1 widget is `truncated`, not a silent success — Amendment 2 " +
      "decision 2. F3.37 shipped roleCounts because 'two-of-three renders a widget that looks " +
      "right and is one short'.",
  ).toBe("truncated");

  // 2. Same role, same point key, a widget that holds eight. Nothing is
  //    truncated; the shortfall is that one member has no such point.
  const chart = resolutionFor(response, "chiller-chart");
  expect(chart.matchedMembers).toBe(3);
  expect(chart.boundPoints, "only two of the three members carry a kW point").toBe(2);
  expect(
    chart.outcome,
    "a role that matches N members of which only M carry the point key is `partial` — " +
      "Amendment 2 decision 3. It binds what resolves and never refuses (ADR 0047's rule that " +
      "cardinality `min` is an authoring rule, never a stored invariant).",
  ).toBe("partial");

  // 3. Same role, a point key every member carries. Nothing is short.
  const full = resolutionFor(response, "chiller-full");
  expect(full.matchedMembers).toBe(3);
  expect(full.boundPoints).toBe(3);
  expect(
    full.outcome,
    "every matching member bound is `bound` — migration 0051's header: one role still maps to " +
      "one widget however many members match.",
  ).toBe("bound");

  // 4. A role no member carries. ADR 0049 decision 6: the widget arrives with
  //    zero bindings and the import SUCCEEDS.
  const missing = resolutionFor(response, "tower-tile");
  expect(missing.matchedMembers).toBe(0);
  expect(missing.boundPoints).toBe(0);
  expect(
    missing.outcome,
    "a role that matches nothing is `unresolved`, and the instantiate still succeeds — ADR 0049 " +
      "decision 6. Refusing would give a plant with five of six sections nothing at all.",
  ).toBe("unresolved");

  // 5. A metric-catalog tile binds no role at all. It asked for nothing and got
  //    nothing, which is success — reporting it as a shortfall would put an
  //    amber flag beside every correctly-bound tile.
  const metric = resolutionFor(response, "alarms-tile");
  expect(metric.assetRoleCodes, "a catalog tile names no role").toEqual([]);
  expect(
    metric.outcome,
    "a widget with no role bindings is `bound`, not `unresolved` — it inherits the dashboard's " +
      "own scope and asked for no member.",
  ).toBe("bound");

  expect(
    response.dashboard.widgets.length,
    "every widget is created, including the unresolved one — F3.1c renders zero bindings as " +
      "'no data bound', which is a state the schema can report and a person can fix.",
  ).toBe(5);

  return { dashboardId: response.dashboard.id };
}

/** The version stamp lands on the row, not only in the response — ADR 0049
 * decision 2. Read on a separate connection. */
export async function assertTemplateStampIsOnTheDashboardRow(
  ownerPool: pg.Pool,
  dashboardId: string,
  templateId: string,
): Promise<void> {
  const rows = await ownerPool.query<{ template_id: string | null }>(
    `SELECT template_id FROM bms.dashboards WHERE id = $1`,
    [dashboardId],
  );
  expect(
    rows.rows[0]?.template_id,
    "the instantiated dashboard must record the template VERSION it came from, or nobody can " +
      "tell which plants are running the previous one when the template is revised.",
  ).toBe(templateId);
}

/**
 * A target group in another organization is refused, and **no half-built
 * dashboard is left behind**.
 *
 * The second half is the one worth asserting: the whole instantiation is one
 * transaction, and a dashboard row with no widgets is worse than no dashboard,
 * because it looks like a template that produces nothing.
 */
export async function assertForeignGroupIsRefusedAndLeavesNothing(
  service: DashboardTemplatesInstantiateService,
  ownerPool: pg.Pool,
  actor: JwtPayload,
  templateId: string,
  foreignAssetGroupId: string,
  slug: string,
): Promise<void> {
  await expect(
    service.instantiate(actor, templateId, {
      assetGroupId: foreignAssetGroupId,
      slug,
      name: "F3.36 foreign group proof",
    } as Parameters<DashboardTemplatesInstantiateService["instantiate"]>[2]),
  ).rejects.toThrow(/outside your access scope/i);

  const landed = await ownerPool.query(`SELECT id FROM bms.dashboards WHERE slug = $1`, [slug]);
  expect(landed.rowCount, "a refused instantiate must leave no dashboard behind").toBe(0);
}

/** A draft cannot be instantiated: it is still being authored, and pinning a
 * dashboard to it would pin it to a version nobody intends to support. */
export async function assertDraftCannotBeInstantiated(
  service: DashboardTemplatesInstantiateService,
  actor: JwtPayload,
  draftTemplateId: string,
  assetGroupId: string,
  slug: string,
): Promise<void> {
  await expect(
    service.instantiate(actor, draftTemplateId, {
      assetGroupId,
      slug,
      name: "F3.36 draft instantiate proof",
    } as Parameters<DashboardTemplatesInstantiateService["instantiate"]>[2]),
  ).rejects.toThrow(/Only a published template can be instantiated/i);
}
