import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi, type Mock } from "vitest";

import type { AdminOrganizationDto } from "@bms/shared";

import * as api from "../../api/admin/organizations";
import { ApiError } from "../../lib/api-error";
import { OrganizationEnergySettingsDialog } from "./organization-energy-settings-dialog";

/**
 * `F4.375` (ADR 0133 Amendment 2 ruling 3, plan-gate ruling Q6, plan U9, D12) — the **Energy
 * settings** dialog: the organization's two settings on their own route. Assertions live here;
 * `organization-energy-settings-dialog.test.tsx` is the Vitest entry point (ADR 0014, ADR 0042).
 */

const ORG: AdminOrganizationDto = {
  id: "22222222-2222-4222-8222-222222222222",
  code: "WBLDC",
  name: "Cold chain",
  active: true,
  currency: "INR",
  timezone: "Asia/Kolkata",
  colourProfile: null,
  designSystem: null,
  ingestEnabled: true,
  // Not the defaults, so a prefill cannot pass by accident.
  energyFeatures: "off",
  cardPrimaryMetric: "health",
  defaultPollIntervalMs: null,
  meta: null,
  createdAt: new Date(0).toISOString(),
};

function renderDialog(): { onClose: Mock; queryClient: QueryClient } {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OrganizationEnergySettingsDialog organization={ORG} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, queryClient };
}

/** D1 — a modal dialog named for the organization, opened on the stored values with the plan's labels. */
export async function theDialogOpensOnTheStoredValues(): Promise<void> {
  renderDialog();
  const dialog = screen.getByRole("dialog", { name: "Energy settings — Cold chain" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  const energy = screen.getByLabelText("Energy features") as HTMLSelectElement;
  const card = screen.getByLabelText("Location card first figure") as HTMLSelectElement;
  expect([energy.value, card.value]).toEqual(["off", "health"]);
  expect([...energy.options].map((o) => [o.value, o.textContent])).toEqual([
    ["auto", "Auto — show where there is energy data"],
    ["on", "On"],
    ["off", "Off"],
  ]);
  expect([...card.options].map((o) => [o.value, o.textContent])).toEqual([
    ["auto", "Auto — kW with energy, asset health without"],
    ["kw", "kW"],
    ["health", "Asset health %"],
    ["critical_alarms", "Critical alarms"],
    ["none", "None"],
  ]);
}

/** D2 — Save sends both keys to the new route, invalidates the three queries (D12) and closes. */
export async function saveSendsBothKeysAndRefreshes(): Promise<void> {
  const write = vi.spyOn(api, "setOrganizationEnergySettings").mockResolvedValue({ ...ORG, energyFeatures: "on" });
  const { onClose, queryClient } = renderDialog();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  await userEvent.selectOptions(screen.getByLabelText("Energy features"), "on");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(write.mock.calls).toEqual([[ORG.id, { energyFeatures: "on", cardPrimaryMetric: "health" }]]);
  for (const queryKey of [["admin", "organizations"], ["dashboard", "locations"], ["dashboard", "kpis"]]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  }
}

/** D3 — a refusal (403) shows the server's sentence inline and the dialog stays open. */
export async function aRefusalShowsInlineAndStays(): Promise<void> {
  vi.spyOn(api, "setOrganizationEnergySettings").mockRejectedValue(
    new ApiError(
      '{"message":"Only an administrator of this organization can change its energy settings","statusCode":403}',
      403,
    ),
  );
  const { onClose } = renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText("Only an administrator of this organization can change its energy settings"),
  ).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
}

/** D4 — Save is busy while the write is pending; Cancel closes without a write. */
export async function saveIsBusyAndCancelWritesNothing(): Promise<void> {
  const write = vi.spyOn(api, "setOrganizationEnergySettings").mockImplementation(() => new Promise(() => undefined));
  const { onClose } = renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(write).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Saving/ })).toHaveAttribute("aria-busy", "true"));
}
