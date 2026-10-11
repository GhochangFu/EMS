import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, vi } from "vitest";

import { catalogEntry } from "@bms/shared/copilot";

import * as confirmApi from "../../api/copilot-confirm";
import { useWizardStore } from "../../stores/wizard-store";
import { WizardShell } from "./wizard-shell";

/**
 * `F3.85` PR 8 / ADR 0099 decision 6 (plan §10.3, ruling Q6) — the shared
 * wizard shell. Assertions here; `wizard-shell.test.tsx` is the Vitest entry
 * point (jsdom).
 */

const ORG = "11111111-1111-4111-8111-111111111111";

function entry(id: string) {
  const found = catalogEntry(id);
  if (!found) throw new Error(id);
  return found;
}

type Harness = { onSubmit: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn>; values: () => Record<string, unknown> };

/** A page over the shell: one text input per field of the open step. */
function renderWizard(id: string, initial: Record<string, unknown> = {}): Harness {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  let latest = initial;
  function Page() {
    const [values, setValues] = useState<Record<string, unknown>>(initial);
    latest = values;
    return (
      <WizardShell
        entry={entry(id)}
        values={values}
        onChange={setValues}
        onSubmit={onSubmit}
        onCancel={onCancel}
        submitting={false}
        renderStep={(step) =>
          step.fields.map((field) => (
            <input
              key={field}
              aria-label={field}
              value={typeof values[field] === "string" ? (values[field] as string) : ""}
              onChange={(e) => setValues({ ...values, [field]: e.target.value })}
            />
          ))
        }
      />
    );
  }
  render(<Page />);
  return { onSubmit, onCancel, values: () => latest };
}

const stepNames = () => screen.getAllByRole("listitem").map((li) => li.textContent);
const current = () => screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")?.textContent;

/** Ruling Q6: the entry's steps, then Review; the first is current. */
export function showsTheEntrysStepsThenReview(): void {
  renderWizard("dashboard.create");
  expect(stepNames()).toEqual(["1. Basics", "2. Scope", "3. Review"]);
  expect(current()).toBe("1. Basics");
}

/** Next checks the open step's fields and stays on a wrong one. */
export function nextStaysOnAWrongStep(): void {
  renderWizard("dashboard.create");
  fireEvent.change(screen.getByRole("textbox", { name: "slug" }), { target: { value: "Bad Slug" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("alert").textContent).toContain("slug");
  expect(current()).toBe("1. Basics");
  fireEvent.change(screen.getByRole("textbox", { name: "slug" }), { target: { value: "main" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(current()).toBe("2. Scope");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(current()).toBe("1. Basics");
}

/**
 * Review shows the body as a card and Submit sends the plain request: the
 * page's own submit, never the copilot executor (no `X-Copilot-Change`).
 */
export function reviewSubmitsThePlainBody(): void {
  const executor = vi.spyOn(confirmApi, "confirmCopilotChange");
  const h = renderWizard("dashboard.create");
  fireEvent.change(screen.getByRole("textbox", { name: "name" }), { target: { value: "Main" } });
  fireEvent.change(screen.getByRole("textbox", { name: "slug" }), { target: { value: "main" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByRole("textbox", { name: "organizationId" }), { target: { value: ORG } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(current()).toBe("3. Review");
  const card = screen.getByRole("region", { name: "Create a dashboard" });
  expect(card.textContent).toContain("Main");
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(h.onSubmit).toHaveBeenCalledWith({ name: "Main", slug: "main", organizationId: ORG });
  expect(executor).not.toHaveBeenCalled();
}

/** Review parses the whole body: a body the route would refuse is not submitted. */
export function reviewRefusesABodyTheRouteWouldRefuse(): void {
  const h = renderWizard("dashboard.create", { name: "Main", slug: "main" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(current()).toBe("3. Review");
  expect(screen.getByRole("alert").textContent).toContain("organizationId");
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(h.onSubmit).not.toHaveBeenCalled();
}

/** A route with no body fields is the Review step alone, and sends `{}`. */
export function aBodylessRouteIsReviewAlone(): void {
  const h = renderWizard("dashboardTemplate.publish");
  expect(stepNames()).toEqual(["1. Review"]);
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(h.onSubmit).toHaveBeenCalledWith({});
}

/** A copilot fill for this entry fills the named step's fields; a fill for another entry waits. */
export function aFillForThisEntryFillsItsStep(): void {
  const h = renderWizard("dashboard.create");
  act(() => {
    useWizardStore.getState().receiveFill({ catalogId: "dashboard.update", stepId: "basics", values: { name: "Other" } });
  });
  expect(h.values().name).toBeUndefined();
  expect(useWizardStore.getState().fill?.catalogId).toBe("dashboard.update");
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "dashboard.create", stepId: "basics", values: { name: "Main", organizationId: ORG } });
  });
  expect(h.values()).toEqual({ name: "Main" });
  expect((screen.getByRole("textbox", { name: "name" }) as HTMLInputElement).value).toBe("Main");
}

/** Cancel leaves a clean wizard at once and asks before leaving a changed one. */
export function cancelAsksOnlyWhenChanged(): void {
  const clean = renderWizard("dashboard.create");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(clean.onCancel).toHaveBeenCalledTimes(1);
}

export function cancelAsksBeforeLeavingAChangedWizard(): void {
  const h = renderWizard("dashboard.create");
  fireEvent.input(screen.getByRole("textbox", { name: "name" }), { target: { value: "Main" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog", { name: "Leave the wizard" }).textContent).toContain("Create a dashboard");
  fireEvent.click(screen.getByRole("button", { name: "Stay in the wizard" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
  expect(h.onCancel).toHaveBeenCalledTimes(1);
}
