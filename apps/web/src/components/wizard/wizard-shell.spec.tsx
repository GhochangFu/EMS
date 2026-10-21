import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

type Harness = {
  onSubmit: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  /** The page's own `onChange` of the `select` field, when one is asked for. */
  onSelect: ReturnType<typeof vi.fn>;
  values: () => Record<string, unknown>;
};

type HarnessOptions = {
  /** Passed through as the shell's `dirty` prop. */
  dirty?: boolean;
  /** This field renders as a controlled `<select>` (options `a` and `b`) instead of a text input. */
  select?: string;
  /** `F4.245`: the record's path parameters (`{}`, a create's, by default) and the page-fixed fields. */
  params?: Record<string, string>;
  fixedFields?: string[];
};

/** A page over the shell: one text input per field of the open step. */
function renderWizard(id: string, initial: Record<string, unknown> = {}, options: HarnessOptions = {}): Harness & { unmount: () => void } {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const onSelect = vi.fn();
  let latest = initial;
  function Page() {
    const [values, setValues] = useState<Record<string, unknown>>(initial);
    latest = values;
    return (
      <WizardShell
        entry={entry(id)}
        params={options.params ?? {}}
        fixedFields={options.fixedFields}
        values={values}
        onChange={setValues}
        onSubmit={onSubmit}
        onCancel={onCancel}
        submitting={false}
        dirty={options.dirty}
        renderStep={(step) =>
          step.fields.map((field) =>
            field === options.select ? (
              <select
                key={field}
                aria-label={field}
                value={typeof values[field] === "string" ? (values[field] as string) : "a"}
                onChange={(e) => {
                  onSelect(e.target.value);
                  setValues({ ...values, [field]: e.target.value });
                }}
              >
                <option value="a">a</option>
                <option value="b">b</option>
              </select>
            ) : (
              <input
                key={field}
                aria-label={field}
                value={typeof values[field] === "string" ? (values[field] as string) : ""}
                onChange={(e) => setValues({ ...values, [field]: e.target.value })}
              />
            ),
          )
        }
      />
    );
  }
  const { unmount } = render(<Page />);
  return { onSubmit, onCancel, onSelect, values: () => latest, unmount };
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

/** A copilot fill for this entry fills the named step's fields only. */
export function aFillForThisEntryFillsItsStep(): void {
  const h = renderWizard("dashboard.create");
  act(() => {
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "dashboard.create", params: {}, stepId: "basics", values: { name: "Main", organizationId: ORG } }, null);
  });
  expect(h.values()).toEqual({ name: "Main" });
  expect((screen.getByRole("textbox", { name: "name" }) as HTMLInputElement).value).toBe("Main");
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const nameFill = (id: string, name: string) => ({ catalogId: "dashboard.update", params: { id }, stepId: "basics", values: { name } });

/**
 * `F4.245` (ADR 0099 Amendment 4): A's wizard never takes B's fill; the fill for A lands. Mutation: the
 * store's `take` compares the catalog id only (the pre-F4.245 rule) → A's Name shows "B's".
 */
export function aFillForAnotherRecordIsNotTaken(): void {
  const h = renderWizard("dashboard.update", { name: "A" }, { params: { id: A } });
  act(() => useWizardStore.getState().receiveFill(nameFill(B, "B's"), "/admin/dashboards/b"));
  expect(h.values().name).toBe("A");
  act(() => useWizardStore.getState().receiveFill(nameFill(A, "A's"), null));
  expect((screen.getByRole("textbox", { name: "name" }) as HTMLInputElement).value).toBe("A's");
}

/** `F4.245`: a mounted wizard is open with its record, and is not after unmount. Mutation: drop the cleanup → red. */
export function aMountedWizardRegistersItsRecord(): void {
  const h = renderWizard("dashboard.update", {}, { params: { id: A } });
  expect(useWizardStore.getState().openWizards()).toEqual([{ catalogId: "dashboard.update", params: { id: A } }]);
  h.unmount();
  expect(useWizardStore.getState().openWizards()).toEqual([]);
}

/** Critique C7: a wizard whose params are not its entry's says so and is not open; it never throws. Mutation: drop the alert. */
export function aWizardThatDoesNotNameItsRecordSaysSo(): void {
  renderWizard("dashboard.update", {}, { params: {} });
  expect(screen.getByRole("alert").textContent).toBe("This form does not name its record, so the copilot cannot fill it.");
  expect(useWizardStore.getState().openWizards()).toEqual([]);
}

/** Critique C2: a page-fixed field is never filled. Mutation: the shell drops `fixedFields` from `applyFill` → red. */
export function aPageFixedFieldIsNotFilled(): void {
  const h = renderWizard("dashboard.create", { name: "Fixed" }, { fixedFields: ["name"] });
  act(() => useWizardStore.getState().receiveFill({ catalogId: "dashboard.create", params: {}, stepId: "basics", values: { name: "X", slug: "x" } }, null));
  expect(h.values()).toEqual({ name: "Fixed", slug: "x" });
}

/** Review C2: a fill that sets no field leaves the wizard clean. Mutation: `applyFill` returns the copy → Cancel asks. */
export function aFillThatSetsNothingLeavesTheWizardClean(): void {
  const h = renderWizard("dashboard.create", { name: "Fixed" }, { fixedFields: ["name"] });
  act(() => useWizardStore.getState().receiveFill({ catalogId: "dashboard.create", params: {}, stepId: "basics", values: { name: "X" } }, null));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.onCancel).toHaveBeenCalledTimes(1);
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

/**
 * `F3.85` PR 9 shell fix — the first edit in a fresh wizard is a select pick, and the page's
 * `onChange` gets the NEW value. The shell marked itself changed on `input`; that re-render landed
 * between the select's `input` and `change` events and gave the controlled select its old value
 * back before `change` read it. Mutation: mark changed on `onInput` again => red.
 */
export async function aSelectFirstPickReachesThePage(): Promise<void> {
  const h = renderWizard("dashboard.create", {}, { select: "name" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "name" }), "b");
  expect(h.onSelect).toHaveBeenCalledWith("b");
}

/** The display half: the select shows the picked value, and the page's values hold it. */
export async function aSelectFirstPickStaysPicked(): Promise<void> {
  const h = renderWizard("dashboard.create", {}, { select: "name" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "name" }), "b");
  expect((screen.getByRole("combobox", { name: "name" }) as HTMLSelectElement).value).toBe("b");
  expect(h.values().name).toBe("b");
}

/** A select pick arms the leave prompt too (it is a `change`, which the shell now marks). */
export async function aSelectPickArmsTheLeavePrompt(): Promise<void> {
  const h = renderWizard("dashboard.create", {}, { select: "name" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "name" }), "b");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog", { name: "Leave the wizard" })).toBeInTheDocument();
}

/**
 * The page's own `dirty` (work done by clicks, which no field event reports) arms the leave
 * prompt with no input at all. Mutation: ignore the prop in Cancel => red.
 */
export function aDirtyPageAsksBeforeLeaving(): void {
  const h = renderWizard("dashboard.create", {}, { dirty: true });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog", { name: "Leave the wizard" })).toBeInTheDocument();
}

/** The positive control: `dirty={false}` and no input leaves at once. */
export function aCleanPageLeavesAtOnce(): void {
  const h = renderWizard("dashboard.create", {}, { dirty: false });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.onCancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alertdialog")).toBeNull();
}

/**
 * `F4.246` (ADR 0099 §3) — the Review card passes the entry's `formulas` to `changeRows`, so a
 * template edit's derived point gets its own full-text formula row. Mutation: drop that argument
 * in `wizard-shell.tsx` → this reddens.
 */
export function reviewShowsATemplatePointsFormulaRow(): void {
  renderWizard("assetTemplate.update", {
    points: [
      { pointKey: "kw", kind: "measured" },
      { pointKey: "eff", kind: "derived", formula: "{kw} * 2", formulaDialect: "bms-calc-v1", calcTrigger: "streaming" },
    ],
  }, { params: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } });
  for (let step = 0; step < 3; step += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(current()).toBe("4. Review");
  const card = screen.getByRole("region", { name: "Edit an asset template" });
  expect(within(card).getByRole("rowheader", { name: "Formula eff (points)" })).toBeTruthy();
}
