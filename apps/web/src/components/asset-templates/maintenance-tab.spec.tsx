import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto, TemplateMaintenancePlan } from "@bms/shared";

import * as api from "../../api/admin/asset-templates";
import {
  buildMaintenancePayload,
  maintenanceRowsFrom,
} from "../../lib/template-maintenance-form";
import { MaintenanceTab } from "./maintenance-tab";

/**
 * The Maintenance tab (`F2.19`, ADR 0038 Amendment 5 Part B). Assertions live
 * here; `maintenance-tab.test.tsx` is the Vitest entry point (ADR 0014) and
 * carries `@vitest-environment jsdom`, because that is the file Vitest collects
 * (ADR 0042 decision 2).
 *
 * **No vocabulary fetch.** The three vocabularies are closed enums in the
 * contract, not rows behind `GET /api/v1/vocabularies`, so this tab has no
 * `useQuery`. `QueryClientProvider` is still required, because `useMutation`
 * needs a client.
 *
 * **The `<details>` assertion in case 1 is not decoration.** `F2.20` exists
 * because closed `<details>` content is absent from `innerText` altogether,
 * which made a browser pass report a present feature as missing. This tab has
 * no collapse anywhere, and the assertion is what stops the next author adding
 * one to tidy up a long card.
 */

const ONE_ALARM = {
  code: "OVERLOAD",
  pointKey: "current_a",
  operator: "gt",
  thresholdValue: 112,
  severity: "warning",
  message: "Load above the feeder's rating",
};

/** A minimal stored plan: it omits every field the API defaults. */
const PLAN_A = { title: "Membrane CIP", intervalDays: 90 };

/** A fully specified plan, safety critical, with a trigger summary. */
const PLAN_B = {
  title: "Pressure vessel statutory inspection",
  description: "Third-party inspection under the statutory regime.",
  category: "compliance",
  generationMode: "calendar",
  ownerTeam: "Water team",
  vendorName: "Ion Exchange",
  complianceRef: "IS 2825",
  triggerSummary: "Book the inspector eight weeks before the certificate expires.",
  safetyCritical: true,
  priority: "high",
  estimatedMinutes: 240,
  intervalDays: 365,
};

const CONTENT = {
  contentVersion: 1,
  alarms: [ONE_ALARM],
  kpis: [],
  maintenance: [PLAN_A, PLAN_B],
};

function template(): AdminAssetTemplateDto {
  return adminAssetTemplateDtoSchema.parse({
    id: "t1",
    organizationId: "o1",
    organizationCode: "IONEX",
    organizationName: "Ion Exchange",
    code: "WATER-RO-SKID",
    version: 1,
    name: "RO skid",
    assetType: "ro_skid",
    domain: "water",
    description: null,
    status: "draft",
    content: CONTENT,
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    points: [
      {
        id: "p1",
        templateId: "t1",
        pointKey: "current_a",
        label: "Current",
        unit: "A",
        kind: "measured",
        sourceDataKeyPattern: null,
        formula: null,
        formulaDialect: null,
        calcTrigger: null,
        calcIntervalSeconds: null,
        maxInputAgeSeconds: null,
        minCoverageRatio: null,
        required: true,
        sortOrder: 0,
        meta: { tier: "core" },
        createdAt: "2026-09-04T00:00:00.000Z",
      },
    ],
  });
}

function renderTab(
  editable: boolean,
  onDirtyChange: (dirty: boolean) => void = vi.fn(),
): HTMLElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <MaintenanceTab
        template={template()}
        editable={editable}
        onSaved={vi.fn()}
        onDirtyChange={onDirtyChange}
      />
    </QueryClientProvider>,
  );
  return container;
}

function fields(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("input, select, textarea")];
}

/**
 * Case 1 — the read-only floor ADR 0038 Amendment 5 sets.
 *
 * Every plan readable, nothing writable, and no save path at all. This is the
 * case that discharges the review problem the amendment names: a global
 * administrator could not see a single one of the 101 authored plans.
 */
export async function readOnlyRendersEveryPlanWithNoSavePath(): Promise<void> {
  const container = renderTab(false);

  expect(screen.getByDisplayValue(PLAN_A.title)).toBeInTheDocument();
  expect(screen.getByDisplayValue(PLAN_B.title)).toBeInTheDocument();
  expect(
    screen.getByDisplayValue(PLAN_B.triggerSummary),
    "the trigger summary must render — it is the field that says when a plan fires",
  ).toBeInTheDocument();

  const all = fields(container);
  expect(
    all.length,
    "the tab rendered no fields at all, so the disabled sweep below would be vacuous",
  ).toBeGreaterThan(20);
  expect(
    all.filter((field) => !(field as HTMLInputElement).disabled).map((field) => field.outerHTML),
    "a maintenance field is writable on a read-only template. There is no save path on this " +
      "screen, so anything typed here is lost the moment the tab changes.",
  ).toEqual([]);

  expect(screen.queryByRole("button", { name: "Save maintenance" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add a plan" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

  expect(
    screen.getAllByText("Safety critical"),
    "exactly one of the two plans is safety critical, and the badge must render on a " +
      "read-only view — it is the single most important thing on this screen",
  ).toHaveLength(1);

  expect(
    container.querySelector("details"),
    "this tab must contain no <details>. F2.20 exists because closed <details> content is " +
      "absent from innerText, which made a browser check report a present feature as missing.",
  ).toBeNull();
}

/**
 * Case 2 — a draft edit, and the write that carries every other section.
 *
 * The interval is set out of range first, so the disabled Save is proved to be
 * the validation and not the absence of a change. The merged content is then
 * checked section by section: `PATCH` replaces `content` wholesale, so an
 * alarms array that did not survive this write would have been deleted from
 * the template by someone opening the Maintenance tab.
 */
export async function draftEditsAPlanAndSaveSendsTheMergedContent(): Promise<void> {
  const onDirtyChange = vi.fn();
  const saved = vi.spyOn(api, "updateAdminAssetTemplate").mockResolvedValue(template());
  const container = renderTab(true, onDirtyChange);

  const cards = [...container.querySelectorAll("section")];
  const interval = within(cards[0]).getByLabelText("Interval days");

  await userEvent.clear(interval);
  await userEvent.type(interval, "0");
  expect(
    screen.getByText(/1–730/),
    "an out-of-range interval must render a problem naming the range, or the author sees a " +
      "disabled Save with nothing on screen to fix",
  ).toBeInTheDocument();
  expect(
    (screen.getByRole("button", { name: "Save maintenance" }) as HTMLButtonElement).disabled,
    "Save must be disabled while a plan is invalid",
  ).toBe(true);

  await userEvent.clear(interval);
  await userEvent.type(interval, "45");

  await waitFor(() => {
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
  const save = screen.getByRole("button", { name: "Save maintenance" }) as HTMLButtonElement;
  expect(save.disabled, "Save must be enabled once the edit is valid and differs").toBe(false);

  await userEvent.click(save);

  await waitFor(() => {
    expect(saved).toHaveBeenCalledTimes(1);
  });
  const [id, body] = saved.mock.calls[0] as [string, { content: Record<string, unknown> }];
  expect(id).toBe("t1");
  const content = body.content;

  expect(
    content.alarms,
    "the stored alarms must survive a maintenance write byte for byte. PATCH replaces content " +
      "wholesale, so a section this tab omitted would be destroyed.",
  ).toEqual(CONTENT.alarms);
  expect(content.kpis).toEqual([]);
  expect(content.contentVersion).toBe(1);

  const plans = content.maintenance as Record<string, unknown>[];
  expect(plans).toHaveLength(2);
  expect(
    plans[0].intervalDays,
    "the interval must be sent as a number, not as the string the input holds",
  ).toBe(45);
  expect(typeof plans[0].intervalDays).toBe("number");
  expect(plans[0].title).toBe(PLAN_A.title);
  // The untouched plan, compared against what a read-back of it sends — not
  // against the raw fixture. The read DTO's `content` is a loose record and
  // applies no defaults, so the stored object carries only the keys it was
  // written with, while the payload carries the five the API would default.
  expect(plans[1]).toEqual(
    buildMaintenancePayload(
      maintenanceRowsFrom([PLAN_B] as unknown as TemplateMaintenancePlan[]),
    )[0],
  );
}

/**
 * Case 3 — Add, then Remove, and the tab is clean again.
 *
 * The added card must be blank enough to be invalid (a plan with no title is
 * not a plan), and removing it must return the section to exactly what is
 * stored. A comparator that read the rebuilt rows as different would leave the
 * author with a permanent unsaved-changes prompt.
 */
export async function addAndRemoveAPlan(): Promise<void> {
  const onDirtyChange = vi.fn();
  const container = renderTab(true, onDirtyChange);

  expect(container.querySelectorAll("section")).toHaveLength(2);

  await userEvent.click(screen.getByRole("button", { name: "Add a plan" }));

  const cards = [...container.querySelectorAll("section")];
  expect(cards).toHaveLength(3);
  const added = cards[2];
  expect((within(added).getByLabelText("Category") as HTMLSelectElement).value).toBe("preventive");
  // A prefix match, not the exact label: `Field` renders the problem inside the
  // same `<label>`, so a failing field's accessible name is "Interval days" plus
  // the message. That is correct — the error is announced with the field — and
  // it is why this query cannot be an exact one.
  expect((within(added).getByLabelText(/^Interval days/) as HTMLInputElement).value).toBe("");
  expect(
    (screen.getByRole("button", { name: "Save maintenance" }) as HTMLButtonElement).disabled,
    "a new plan has no title, so Save must stay disabled",
  ).toBe(true);
  await waitFor(() => {
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  await userEvent.click(within(added).getByRole("button", { name: "Remove" }));

  expect(container.querySelectorAll("section")).toHaveLength(2);
  expect(
    (screen.getByRole("button", { name: "Save maintenance" }) as HTMLButtonElement).disabled,
    "nothing differs from what is stored, so Save must be disabled again",
  ).toBe(true);
  await waitFor(() => {
    expect(
      onDirtyChange.mock.lastCall,
      "removing the added plan must report the tab clean, or every tab click prompts about " +
        "unsaved changes the author never made",
    ).toEqual([false]);
  });
}
