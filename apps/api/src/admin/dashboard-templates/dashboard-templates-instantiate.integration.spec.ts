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
 * four are genuinely distinguishable.** Four members share the `chiller` role
 * and only three carry the `kW` point, so the same role produces `truncated` on
 * a one-point widget and `partial` on a many-point one — the pair Amendment 2
 * had to rule and the pair a happy-path fixture would collapse into one.
 *
 * Two assertions here exist because the `F3.36` correctness review found them
 * missing, and both were **false green** rather than wrong: the `assets.code`
 * tie-break was asserted by nothing (deleting the `ORDER BY` left the suite
 * green), and `boundPoints` was never compared against the rows actually
 * written. A third, `mixed-chart`, pins a real defect the review found — a
 * widget whose second role matched nothing reported `bound`.
 */

/**
 * The fixture's widget keys and their titles.
 *
 * The read-back dashboard widget carries no template key, so the title is the
 * only join between a resolution entry and the rows that were written. Declared
 * here rather than inferred, so a renamed widget fails loudly.
 */
const TITLE_BY_WIDGET_KEY: Readonly<Record<string, string>> = {
  "chiller-gauge": "Lead chiller load",
  "chiller-chart": "Chiller load trend",
  "chiller-full": "Chiller apparent power",
  "mixed-chart": "Chillers and cooling tower",
  "tower-tile": "Cooling tower",
  "alarms-tile": "Active alarms",
};

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
  /** The asset whose `code` sorts FIRST among the members — what Amendment 2
   * decision 2's tie-break must pick. */
  expectedFirstAssetId: string,
): Promise<{ dashboardId: string }> {
  const response = await service.instantiate(actor, templateId, {
    assetGroupId,
    slug,
    name: "F3.36 resolution report proof",
  } as Parameters<DashboardTemplatesInstantiateService["instantiate"]>[2]);

  expect(
    response.resolutions.length,
    "one resolution entry per widget — Amendment 2 decision 1",
  ).toBe(6);

  /**
   * **Every reported `boundPoints` must equal the rows actually written.**
   *
   * The report is computed from the plan, BEFORE the insert. Nothing compared
   * the two, so a change to the insert loop that dropped rows would leave the
   * whole suite green while the report claimed points that do not exist. Found
   * by the `F3.36` correctness review.
   *
   * The read-back widget carries no template key, so the fixture's titles are
   * the join — they are unique by construction, and `TITLE_BY_WIDGET_KEY` is
   * asserted exhaustive below so a renamed widget cannot quietly drop out.
   */
  for (const [widgetKey, title] of Object.entries(TITLE_BY_WIDGET_KEY)) {
    const reported = resolutionFor(response, widgetKey);
    const written = response.dashboard.widgets.find((w) => w.title === title);
    expect(written, `no widget titled "${title}" came back`).toBeDefined();
    expect(
      written?.points.length,
      `widget "${widgetKey}" reported boundPoints ${reported.boundPoints} but ` +
        `${written?.points.length} point rows were written. The report is computed from the ` +
        "plan and the rows come from the insert; nothing else compares them.",
    ).toBe(reported.boundPoints);
  }

  // 1. Three members carry the role, two carry the point, the widget holds one.
  //    The cap bites, so this is `truncated` (Amendment 2 decision 2) and the
  //    bound member is the FIRST by assets.code.
  const gauge = resolutionFor(response, "chiller-gauge");
  expect(gauge.matchedMembers, "four members carry the chiller role").toBe(4);
  expect(gauge.boundPoints, "a radial_gauge holds exactly one point").toBe(1);
  expect(
    gauge.outcome,
    "an over-match into a max=1 widget is `truncated`, not a silent success — Amendment 2 " +
      "decision 2. F3.37 shipped roleCounts because 'two-of-three renders a widget that looks " +
      "right and is one short'.",
  ).toBe("truncated");

  /**
   * **WHICH member won, not merely how many.**
   *
   * Amendment 2 decision 2 rules the tie-break as *the first member by
   * `assets.code`* — and nothing asserted it. Deleting `.orderBy(asc(assets.code))`
   * from `loadMembersByRole` left the entire suite green, so the one ruling this
   * row exists to implement was ungated. §4.4: assume the new guard has this
   * defect and mutate the code to prove it fails. Found by the `F3.36`
   * correctness review.
   */
  const gaugeWidget = response.dashboard.widgets.find(
    (w) => w.title === TITLE_BY_WIDGET_KEY["chiller-gauge"],
  );
  expect(
    gaugeWidget?.points[0]?.assetId,
    "the single bound point must belong to the member whose assets.code sorts FIRST — " +
      "Amendment 2 decision 2. assets.code is NOT NULL UNIQUE, so this is a total order and " +
      "the answer is deterministic rather than whatever the planner returned.",
  ).toBe(expectedFirstAssetId);

  // 2. Same role, same point key, a widget that holds eight. Nothing is
  //    truncated; the shortfall is that one member has no such point.
  const chart = resolutionFor(response, "chiller-chart");
  expect(chart.matchedMembers).toBe(4);
  expect(chart.boundPoints, "only three of the four members carry a kW point").toBe(3);
  expect(
    chart.outcome,
    "a role that matches N members of which only M carry the point key is `partial` — " +
      "Amendment 2 decision 3. It binds what resolves and never refuses (ADR 0047's rule that " +
      "cardinality `min` is an authoring rule, never a stored invariant).",
  ).toBe("partial");

  // 3. Same role, a point key every member carries. Nothing is short.
  const full = resolutionFor(response, "chiller-full");
  expect(full.matchedMembers).toBe(4);
  expect(full.boundPoints).toBe(4);
  expect(
    full.outcome,
    "every matching member bound is `bound` — migration 0051's header: one role still maps to " +
      "one widget however many members match.",
  ).toBe("bound");

  /**
   * **The regression case: one role of two matched nothing.**
   *
   * `chiller/kVA` resolves all four members; `cooling-tower/kW` matches none.
   * The first implementation summed across bindings and decided from the sums,
   * so this reported `matched 4, bound 4, bound` — a widget that is one whole
   * ROLE short, described as complete. That is the silent success Amendment 2
   * decision 1 exists to prevent, and the widget then never appeared in the list
   * decision 6 calls "a page that can list exactly which ones need it". Found by
   * the `F3.36` correctness review; this assertion is what keeps it fixed.
   */
  const mixed = resolutionFor(response, "mixed-chart");
  expect(mixed.assetRoleCodes).toEqual(["chiller", "cooling-tower"]);
  expect(mixed.matchedMembers, "the union of members, not the sum per binding").toBe(4);
  expect(mixed.boundPoints).toBe(4);
  expect(
    mixed.outcome,
    "a widget with a dead role is `partial`, never `bound` — even when its OTHER role resolved " +
      "every member it matched.",
  ).toBe("partial");

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
  ).toBe(6);

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
