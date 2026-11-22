import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi, type Mock } from "vitest";

import type { AdminOrganizationDto } from "@bms/shared";

import * as api from "../../api/admin/organizations";
import { ApiError } from "../../lib/api-error";
import { POLL_INTERVAL_RANGE_MESSAGE, POLL_INTERVAL_SLOW_WARNING } from "../../lib/poll-interval-input";
import { OrganizationPollIntervalDialog } from "./organization-poll-interval-dialog";

/**
 * `F1.2` (ADR 0141 decision 10, Amendment 1 (c), plan T7.4, P4) — the organization's **Poll
 * interval** dialog. Assertions live here; `organization-poll-interval-dialog.test.tsx` is the
 * Vitest entry point (ADR 0014, ADR 0042).
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
  energyFeatures: "auto",
  cardPrimaryMetric: "auto",
  defaultPollIntervalMs: 45_000,
  meta: null,
  createdAt: new Date(0).toISOString(),
};

const LABEL = "Default poll interval (seconds)";

function renderDialog(organization: AdminOrganizationDto = ORG): { onClose: Mock; queryClient: QueryClient } {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OrganizationPollIntervalDialog organization={organization} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, queryClient };
}

/** I1 — a modal named for the organization, opened on the stored value in seconds, saying what empty means. */
export async function theDialogOpensOnTheStoredValue(): Promise<void> {
  renderDialog();
  const dialog = screen.getByRole("dialog", { name: "Poll interval — Cold chain" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect((screen.getByLabelText(LABEL) as HTMLInputElement).value).toBe("45");
  expect(dialog.textContent).toContain("Empty uses each adapter's own default");
  expect(dialog.textContent).toContain("MQTT is not affected");
}

/** I2 — an empty field sends `null`, refreshes the organization list and closes. */
export async function anEmptyFieldSendsNull(): Promise<void> {
  const write = vi.spyOn(api, "setOrganizationPollInterval").mockResolvedValue({ ...ORG, defaultPollIntervalMs: null });
  const { onClose, queryClient } = renderDialog();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  await userEvent.clear(screen.getByLabelText(LABEL));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(write.mock.calls).toEqual([[ORG.id, { defaultPollIntervalMs: null }]]);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "organizations"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "rtus"] });
}

/** I3 — P4: a value over 360 s shows the warning (and still saves, in milliseconds); 360 does not. */
export async function overSixMinutesWarns(): Promise<void> {
  const write = vi.spyOn(api, "setOrganizationPollInterval").mockResolvedValue(ORG);
  const { onClose } = renderDialog();
  const field = screen.getByLabelText(LABEL);
  await userEvent.clear(field);
  await userEvent.type(field, "360");
  expect(screen.queryByText(POLL_INTERVAL_SLOW_WARNING)).toBeNull();
  await userEvent.type(field, "0");
  expect(screen.getByText(POLL_INTERVAL_SLOW_WARNING)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(write.mock.calls).toEqual([[ORG.id, { defaultPollIntervalMs: 3_600_000 }]]);
}

/** I4 — a value outside the bound says so and sends nothing; a refusal shows inline and the dialog stays. */
export async function aBadValueOrARefusalStays(): Promise<void> {
  const write = vi
    .spyOn(api, "setOrganizationPollInterval")
    .mockRejectedValue(new ApiError('{"message":"Only an administrator of this organization can change its poll interval","statusCode":403}', 403));
  const { onClose } = renderDialog();
  const field = screen.getByLabelText(LABEL);
  await userEvent.clear(field);
  await userEvent.type(field, "0.5");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText(POLL_INTERVAL_RANGE_MESSAGE)).toBeInTheDocument();
  expect(write).not.toHaveBeenCalled();
  await userEvent.clear(field);
  await userEvent.type(field, "30");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Only an administrator of this organization can change its poll interval")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
}
