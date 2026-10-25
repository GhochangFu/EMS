import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import * as api from "../../api/escalation";
import { EscalationDefaultsWizard } from "./escalation-defaults-wizard";

/**
 * `F4.279` (ADR 0099 Amendment 8 D3; owner ruling Q2) — the severity map's save
 * flips between `escalationDefaults.set` and the red `escalationDefaults.clear`
 * on the items. Vitest entry point: the sibling `.test.tsx` (jsdom).
 */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const PROFILE = "bbbbbbbb-0000-4000-8000-000000000002";

function mount(items: { severity: string; profileId: string }[]): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EscalationDefaultsWizard
        organizationId={ORG}
        organizationName="Ion Exchange"
        items={items}
        severityLabel={(code) => code}
        profileLabel={(id) => id}
        onCancel={() => undefined}
        onDone={() => undefined}
      />
    </QueryClientProvider>,
  );
}

/** An empty map mounts the clear entry, and its Review card is red. */
export async function anEmptyMapMountsTheRedClear(): Promise<void> {
  mount([]);
  expect(screen.getByRole("dialog", { name: "Clear the severity map" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  const card = await screen.findByRole("region", { name: "Clear the severity map" });
  expect(card.getAttribute("data-risk")).toBe("deactivate");
}

/** A map with a pair mounts the set entry, and Submit sends the map. */
export async function aMapWithAPairSendsTheSet(): Promise<void> {
  const set = vi.spyOn(api, "setEscalationDefaults").mockResolvedValue({ organizationId: ORG, items: [] });
  mount([{ severity: "critical", profileId: PROFILE }]);
  expect(screen.getByRole("dialog", { name: "Set the severity map" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(set).toHaveBeenCalledWith({ organizationId: ORG, items: [{ severity: "critical", profileId: PROFILE }] }));
}
