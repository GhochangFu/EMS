import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import * as vocabApi from "../../api/vocabularies";
import { AssetRoleBindingPicker } from "./asset-role-binding-picker";

/**
 * `F3.36` Part F — the role-plus-point-key binding picker, rendered (ADR 0042).
 *
 * Assertions live here; `asset-role-binding-picker.test.tsx` is the Vitest
 * entry point (ADR 0014).
 */

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  // Deliberately not the seeded 26 — see `asset-groups-page.spec.tsx`'s
  // identical fixture. If the component read a hardcoded list this would
  // still pass, and that is exactly what the assertion below rules out.
  assetRoles: [
    { code: "f336-spec-alpha", label: "Spec Alpha Role", sortOrder: 10, active: true },
    { code: "f336-spec-beta", label: "Spec Beta Role", sortOrder: 20, active: true },
  ],
  dashboardSections: [],
};

function renderPicker(onAdd = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AssetRoleBindingPicker onAdd={onAdd} />
    </QueryClientProvider>,
  );
  return onAdd;
}

/** The `F4.43` guard, in its component form — same shape as `asset-groups-page.spec.tsx`. */
export async function roleOptionsComeFromTheVocabularyFetch(): Promise<void> {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  renderPicker();

  const select = await screen.findByRole("combobox", { name: "Asset role" });
  await waitFor(() => {
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Select a role…",
      "Spec Alpha Role",
      "Spec Beta Role",
    ]);
  });
}

/** Adding a binding sends both fields, and clears only the point key. */
export async function addingABindingSendsBothFields(): Promise<void> {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  const onAdd = renderPicker();

  const select = await screen.findByRole("combobox", { name: "Asset role" });
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBe(3);
  });
  await userEvent.selectOptions(select, "f336-spec-beta");

  const pointKeyInput = screen.getByRole("textbox", { name: "Point key" });
  await userEvent.type(pointKeyInput, "kW");
  await userEvent.click(screen.getByRole("button", { name: "Add binding" }));

  expect(onAdd).toHaveBeenCalledWith({ assetRoleCode: "f336-spec-beta", pointKey: "kW" });
  expect((pointKeyInput as HTMLInputElement).value).toBe("");
}

/** The add button stays disabled until both a role and a point key are set. */
export async function addIsDisabledUntilBothFieldsAreSet(): Promise<void> {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  renderPicker();

  const button = await screen.findByRole("button", { name: "Add binding" });
  expect(button).toBeDisabled();

  const select = screen.getByRole("combobox", { name: "Asset role" });
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBe(3);
  });
  await userEvent.selectOptions(select, "f336-spec-alpha");
  expect(button).toBeDisabled();

  await userEvent.type(screen.getByRole("textbox", { name: "Point key" }), "kWh");
  expect(button).not.toBeDisabled();
}
