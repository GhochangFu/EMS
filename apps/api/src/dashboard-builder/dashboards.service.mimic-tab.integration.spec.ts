import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import { MIMIC_TAB_MESSAGE } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { putDashboardWidgetsBodySchema } from "./dashboards.schema";
import type { DashboardsService } from "./dashboards.service";
import type { MimicNodesService } from "./mimic-nodes.service";

/**
 * `F3.74` (plan D7, Task 2.3) — the write guard for a mimic that names the tab it resolves
 * through, against a real database. A new sibling (plan D13): `dashboards.service.rls.integration.spec.ts`
 * sits at 981 lines. Assertions live here; `dashboards.service.mimic-tab.integration.test.ts` is
 * the Vitest entry point (ADR 0014) and owns the fixture, the pools and the cleanup.
 */

export type MimicTabFixture = {
  readonly service: DashboardsService;
  readonly mimicNodes: MimicNodesService;
  readonly actor: JwtPayload;
  readonly organizationId: string;
  /** A site dashboard with no group of its own. */
  readonly dashboardId: string;
  /** The `sld` tab's group; its one `main-breaker` member is `mainBreakerAssetId`. */
  readonly sldGroupId: string;
  readonly mainBreakerAssetId: string;
};

const ABSENT_KEY = "f374-no-such-tab";

const mimic = (tabKey: string, namedTab: string) => ({
  tabKey,
  widgetType: "mimic",
  title: "SLD",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 6,
  config: { source: "preset", preset: "lv_single_line", tabKey: namedTab },
  points: [],
});

const tabs = (f: MimicTabFixture) => [
  { key: "overview", label: "Overview", sortOrder: 0 },
  { key: "sld", label: "SLD", sortOrder: 1, assetGroupId: f.sldGroupId },
];

const put = (f: MimicTabFixture, widgets: unknown[]) =>
  f.service.putWidgets(f.actor, f.dashboardId, putDashboardWidgetsBodySchema.parse({ tabs: tabs(f), widgets }));

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return undefined;
}

function messageOf(err: unknown): string {
  const response = err instanceof BadRequestException ? err.getResponse() : null;
  return typeof response === "object" && response !== null && "message" in response
    ? String((response as { message: unknown }).message)
    : String(err);
}

/** An Overview mimic naming the group-bound `sld` tab saves, and `mimic-nodes` resolves it there. */
export async function anOverviewMimicNamingAGroupTabSavesAndResolves(f: MimicTabFixture): Promise<void> {
  const dto = await put(f, [mimic("overview", "sld")]);
  const saved = dto.widgets.find((widget) => widget.widgetType === "mimic");
  expect(saved?.config, "the stored config keeps tabKey").toMatchObject({ tabKey: "sld" });

  const nodes = await f.mimicNodes.read(f.organizationId, f.dashboardId, null, Date.now());
  const mainBreaker = nodes.widgets[0]?.nodes.find((node) => node.key === "main_breaker");
  expect(mainBreaker?.asset?.id, "main_breaker resolves through the sld tab's group").toBe(f.mainBreakerAssetId);
}

/** An Overview mimic naming the Overview (no group) is a 400 with `MIMIC_TAB_MESSAGE`. */
export async function anOverviewMimicNamingTheOverviewIsRefused(f: MimicTabFixture): Promise<void> {
  const err = await refusal(() => put(f, [mimic("overview", "overview")]));
  expect(err, "naming a group-less tab must be a 400").toBeInstanceOf(BadRequestException);
  expect(messageOf(err)).toBe(MIMIC_TAB_MESSAGE);
}

/** An Overview mimic naming a key that is no tab of the body is a 400 that never echoes the key. */
export async function anAbsentTabKeyIsRefusedWithoutEchoingIt(f: MimicTabFixture): Promise<void> {
  const err = await refusal(() => put(f, [mimic("overview", ABSENT_KEY)]));
  expect(err, "naming an absent tab must be a 400").toBeInstanceOf(BadRequestException);
  expect(messageOf(err)).toBe(MIMIC_TAB_MESSAGE);
  expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain(ABSENT_KEY);
}

/** A mimic on the group-bound tab that also names another tab saves: its own tab wins. */
export async function aGroupTabMimicNamingATabKeepsItsOwnTab(f: MimicTabFixture): Promise<void> {
  const dto = await put(f, [mimic("sld", "overview")]);
  expect(dto.widgets.filter((widget) => widget.widgetType === "mimic")).toHaveLength(1);
  const nodes = await f.mimicNodes.read(f.organizationId, f.dashboardId, null, Date.now());
  const mainBreaker = nodes.widgets[0]?.nodes.find((node) => node.key === "main_breaker");
  expect(mainBreaker?.asset?.id, "main_breaker resolves through the widget's own tab").toBe(f.mainBreakerAssetId);
}
