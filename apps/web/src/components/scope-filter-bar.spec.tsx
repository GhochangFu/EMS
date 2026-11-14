import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { IDS, ONE_ORG, OPTIONS } from "../lib/scope-filter.spec";
import { ScopeFilterBar } from "./scope-filter-bar";

/**
 * `F4.361` U6 (ADR 0132 decision 6; plan D10, D11, D13) — the four scope pickers. The bar is
 * rendered with its props alone; the URL and the request are `useScopeFilter`'s. Pickers are found
 * by the name a person reads. `scope-filter-bar.test.tsx` is the Vitest entry point.
 */

function picker(name: string): HTMLSelectElement {
  return screen.getByRole("combobox", { name }) as HTMLSelectElement;
}

function optionTexts(name: string): string[] {
  return within(picker(name))
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

/** One organization is preselected and disabled; its locations are offered at once. */
export function aLockedOrganizationIsPreselectedAndDisabled(): void {
  render(<ScopeFilterBar filter={{}} options={ONE_ORG} unavailable={false} onChange={vi.fn()} />);
  expect(picker("Organization").disabled).toBe(true);
  expect(picker("Organization").value).toBe(IDS.ORG_X);
  expect(picker("Location").disabled).toBe(false);
  expect(optionTexts("Location")).toEqual(["All locations", "Site X"]);
}

/** Without an organization the other three pickers are disabled (D10); the organization is not. */
export function locationWaitsForAnOrganization(): void {
  render(<ScopeFilterBar filter={{}} options={OPTIONS} unavailable={false} onChange={vi.fn()} />);
  expect(picker("Organization").disabled).toBe(false);
  expect(optionTexts("Organization")).toEqual(["All organizations", "ORGA · Org A", "ORGX · Org X"]);
  for (const name of ["Location", "Asset group", "Asset"]) {
    expect(picker(name).disabled).toBe(true);
  }
}

/** The locations read as a tree, one dash per level, and the others are narrowed by the cascade. */
export function theLocationsReadAsATree(): void {
  render(
    <ScopeFilterBar
      filter={{ organizationId: IDS.ORG_A, locationId: IDS.SITE_A }}
      options={OPTIONS}
      unavailable={false}
      onChange={vi.fn()}
    />,
  );
  expect(optionTexts("Location")).toEqual(["All locations", "Site A", "— Site A1", "Site B"]);
  expect(picker("Location").value).toBe(IDS.SITE_A);
  expect(optionTexts("Asset group")).toEqual(["All asset groups", "Group A1"]);
  expect(optionTexts("Asset")).toEqual(["All assets", "A1-01 · Asset A1", "A1-02 · Asset A1 loose"]);
}

/** A choice reports its key and value; "All" reports an empty value. */
export async function aChoiceReportsItsKey(): Promise<void> {
  const onChange = vi.fn();
  render(<ScopeFilterBar filter={{ organizationId: IDS.ORG_A }} options={OPTIONS} unavailable={false} onChange={onChange} />);
  await userEvent.selectOptions(picker("Location"), IDS.SITE_B);
  expect(onChange).toHaveBeenLastCalledWith("locationId", IDS.SITE_B);
  await userEvent.selectOptions(picker("Organization"), "");
  expect(onChange).toHaveBeenLastCalledWith("organizationId", "");
}

/** A failed options read disables every picker and says so in one line (D13). */
export function unavailableDisablesEveryPicker(): void {
  render(<ScopeFilterBar filter={{}} options={undefined} unavailable onChange={vi.fn()} />);
  for (const name of ["Organization", "Location", "Asset group", "Asset"]) {
    expect(picker(name).disabled).toBe(true);
  }
  expect(screen.getByText(/filter options could not be loaded/)).toBeInTheDocument();
}
