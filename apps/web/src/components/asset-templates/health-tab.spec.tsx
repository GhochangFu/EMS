import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto } from "@bms/shared";

import * as api from "../../api/admin/asset-templates";
import { HealthTab } from "./health-tab";

/**
 * The Health tab (`F4.355`, ADR 0038 Amendment 7, ADR 0050 Amendment 4).
 * Assertions live here; `health-tab.test.tsx` is the Vitest entry point and
 * carries `@vitest-environment jsdom` (ADR 0042 decision 2).
 */

const ONE_ALARM = {
  code: "OVERLOAD",
  pointKey: "flow_rate",
  operator: "gt",
  thresholdValue: 112,
  severity: "warning",
  message: "Flow above rating",
};

const FIVE = {
  bands: [
    { code: "excellent", label: "Excellent", minScore: 0.95 },
    { code: "good", label: "Good", minScore: 0.85 },
    { code: "fair", label: "Fair", minScore: 0.7 },
    { code: "poor", label: "Poor", minScore: 0.5 },
    { code: "critical", label: "Critical", minScore: 0 },
  ],
};

function point(pointKey: string, label: string | null, kind: "measured" | "derived", sortOrder: number) {
  return {
    id: `p-${pointKey}`,
    templateId: "t1",
    pointKey,
    label,
    unit: null,
    kind,
    sourceDataKeyPattern: null,
    formula: kind === "derived" ? "{flow_rate} * 2" : null,
    formulaDialect: kind === "derived" ? "bms-calc-v1" : null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    required: true,
    sortOrder,
    meta: null,
    createdAt: "2026-11-11T00:00:00.000Z",
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
  };
}

function template(
  status: "draft" | "published",
  health: Record<string, unknown> | undefined,
): AdminAssetTemplateDto {
  return adminAssetTemplateDtoSchema.parse({
    id: "t1",
    organizationId: "o1",
    organizationCode: "IONEX",
    organizationName: "Ion Exchange",
    code: "WATER-PUMP",
    version: 2,
    name: "Pump",
    assetType: "pump",
    domain: "water",
    description: null,
    status,
    content: { contentVersion: 1, alarms: [ONE_ALARM], kpis: [], ...(health ? { health } : {}) },
    publishedAt: status === "published" ? "2026-11-11T00:00:00.000Z" : null,
    archivedAt: null,
    workOrderPrefix: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    points: [point("flow_rate", "Flow rate", "measured", 0), point("efficiency", null, "derived", 1)],
  });
}

function renderTab(
  dto: AdminAssetTemplateDto,
  editable: boolean,
  onDirtyChange: (dirty: boolean) => void = vi.fn(),
): HTMLElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <HealthTab template={dto} editable={editable} onSaved={vi.fn()} onDirtyChange={onDirtyChange} />
    </QueryClientProvider>,
  );
  return container;
}

function sentContent(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const [id, body] = spy.mock.calls[0] as [string, { content: Record<string, unknown> }];
  expect(id).toBe("t1");
  return body.content;
}

/** A published version: every value shown, no field enabled, no button to change anything. */
export function readOnlyShowsTheBandsWithNoWritePath(): void {
  const container = renderTab(template("published", { ...FIVE, weights: { flow_rate: 2 } }), false);
  const inputs = [...container.querySelectorAll<HTMLInputElement>("input")];
  expect(inputs.length, "five bands × three fields + two weights").toBe(17);
  expect(inputs.every((input) => input.disabled), "no enabled field on a read-only version").toBe(true);
  expect(
    inputs.filter((input) => input.getAttribute("aria-label")?.endsWith("minimum score (%)")).map((input) => input.value),
  ).toEqual(["95", "85", "70", "50", "0"]);
  expect((screen.getByLabelText("Weight of flow_rate") as HTMLInputElement).value).toBe("2");
  expect((screen.getByLabelText("Weight of efficiency") as HTMLInputElement).value).toBe("1");
  expect(container.querySelectorAll("button")).toHaveLength(0);
}

/** ADR 0050 Amendment 4: an empty draft stays empty until the author clicks the preset. */
export async function anEmptyDraftStaysEmptyUntilThePresetIsClicked(): Promise<void> {
  const onDirtyChange = vi.fn();
  const saved = vi.spyOn(api, "updateAdminAssetTemplate").mockResolvedValue(template("draft", FIVE));
  renderTab(template("draft", undefined), true, onDirtyChange);

  expect(screen.getByText(/has no health bands/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Band 1 code"), "nothing is pre-filled").toBeNull();
  expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  const save = screen.getByRole("button", { name: "Save health" }) as HTMLButtonElement;
  expect(save.disabled, "an untouched empty draft has nothing to save").toBe(true);
  expect(screen.queryByRole("button", { name: "Remove health bands" }), "nothing stored to remove").toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Use the standard five bands" }));
  expect((screen.getByLabelText("Band 1 minimum score (%)") as HTMLInputElement).value).toBe("95");
  await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

  await userEvent.click(screen.getByRole("button", { name: "Save health" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const content = sentContent(saved);
  expect(content.health, "the five bands in 0..1, and no weights key").toEqual(FIVE);
  expect(content.alarms, "other sections are carried unchanged").toEqual([ONE_ALARM]);
  expect(content.kpis).toEqual([]);
}

/** A weight edit is written; a weight of 1 is not. */
export async function aWeightEditIsWrittenAndOnesAreNot(): Promise<void> {
  const saved = vi.spyOn(api, "updateAdminAssetTemplate").mockResolvedValue(template("draft", FIVE));
  renderTab(template("draft", FIVE), true);

  const weight = screen.getByLabelText("Weight of flow_rate");
  await userEvent.clear(weight);
  await userEvent.type(weight, "2.5");
  await userEvent.click(screen.getByRole("button", { name: "Save health" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(sentContent(saved).health).toEqual({ ...FIVE, weights: { flow_rate: 2.5 } });
}

/** A refusal is shown on its row in percent, and Save waits for the fix. */
export async function aRefusalIsShownInPercentAndBlocksSave(): Promise<void> {
  renderTab(template("draft", FIVE), true);
  const last = screen.getByLabelText("Band 5 minimum score (%)");
  await userEvent.clear(last);
  await userEvent.type(last, "10");
  expect(screen.getByText(/must start at 0%.*10%/)).toBeInTheDocument();
  expect((screen.getByRole("button", { name: "Save health" }) as HTMLButtonElement).disabled).toBe(true);
}

/** Moving a band reorders it; removing one drops it. */
export async function bandsMoveAndRemove(): Promise<void> {
  renderTab(template("draft", FIVE), true);
  await userEvent.click(screen.getByRole("button", { name: "Move band 2 up" }));
  expect((screen.getByLabelText("Band 1 code") as HTMLInputElement).value).toBe("good");
  expect(screen.getByText(/not below the band above it/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Move band 1 down" }));
  expect((screen.getByLabelText("Band 1 code") as HTMLInputElement).value).toBe("excellent");
  await userEvent.click(screen.getByRole("button", { name: "Remove band 1" }));
  expect((screen.getByLabelText("Band 1 code") as HTMLInputElement).value).toBe("good");
  expect(screen.queryByLabelText("Band 5 code")).toBeNull();
}

/** B4: Remove asks first; confirmed and saved, the content has no health key and keeps the rest. */
export async function removeAsksFirstAndSavesWithoutHealth(): Promise<void> {
  const saved = vi.spyOn(api, "updateAdminAssetTemplate").mockResolvedValue(template("draft", undefined));
  renderTab(template("draft", { ...FIVE, weights: { flow_rate: 2 } }), true);

  await userEvent.click(screen.getByRole("button", { name: "Remove health bands" }));
  const dialog = screen.getByRole("dialog", { name: "Remove health bands" });
  expect(dialog).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/will be removed when you save/), "Cancel changes nothing").toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Remove health bands" }));
  const buttons = screen.getAllByRole("button", { name: "Remove health bands" });
  await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
  expect(screen.getByText(/will be removed when you save/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Save health" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const content = sentContent(saved);
  expect(Object.prototype.hasOwnProperty.call(content, "health"), "no health key").toBe(false);
  expect(content.alarms).toEqual([ONE_ALARM]);
}

/** A stored weight on a key that is no point is shown and flagged, never dropped silently. */
export function anUndeclaredWeightIsShownAndFlagged(): void {
  renderTab(template("draft", { ...FIVE, weights: { ghost_tag: 3 } }), true);
  expect((screen.getByLabelText("Weight of ghost_tag") as HTMLInputElement).value).toBe("3");
  expect(screen.getByText(/Not a point on this version/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove the weight of ghost_tag" })).toBeInTheDocument();
}

/** The server's refusal is shown verbatim. */
export async function aServerRefusalIsShownVerbatim(): Promise<void> {
  vi.spyOn(api, "updateAdminAssetTemplate").mockRejectedValue(
    new Error("health.weights references a point this template does not declare"),
  );
  renderTab(template("draft", FIVE), true);
  const weight = screen.getByLabelText("Weight of flow_rate");
  await userEvent.clear(weight);
  await userEvent.type(weight, "3");
  await userEvent.click(screen.getByRole("button", { name: "Save health" }));
  expect(
    await screen.findByText("health.weights references a point this template does not declare"),
  ).toBeInTheDocument();
}

/** An untouched stored block is clean: no dirty report and Save disabled. */
export function anUntouchedStoredBlockIsClean(): void {
  const onDirtyChange = vi.fn();
  renderTab(template("draft", { ...FIVE, weights: { flow_rate: 1 } }), true, onDirtyChange);
  expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  expect((screen.getByRole("button", { name: "Save health" }) as HTMLButtonElement).disabled).toBe(true);
}
