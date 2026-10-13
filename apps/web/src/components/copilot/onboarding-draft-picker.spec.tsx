import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { OnboardingDraftListDto, OnboardingDraftSummaryDto } from "@bms/shared";

import * as onboardingApi from "../../api/admin/onboarding";
import { OnboardingDraftPicker, type OnboardingDraftsOf } from "./onboarding-draft-picker";

/**
 * `F4.255` PR 3 (plan §6.2, ADR 0099 Amendment 2 A1) — the copilot dock's list
 * of the organization's open onboarding drafts, with Resume per row and the
 * start button below.
 *
 * Assertions live here; `onboarding-draft-picker.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042). The list read is a spy: an unstubbed fetch reaches a local API on
 * `:4000` (`F4.160`).
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const ME = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const MINE = "33333333-3333-4333-8333-333333333331";
const THEIRS = "33333333-3333-4333-8333-333333333332";

function item(over: Partial<OnboardingDraftSummaryDto>): OnboardingDraftSummaryDto {
  return {
    id: MINE,
    organizationId: ORG,
    currentPhase: "location",
    locationName: "Lotapata",
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    createdBy: { id: ME, displayName: "Me" },
    ...over,
  };
}

/** Two drafts: the caller's own at the location step, another user's at the RTU step. */
const TWO: OnboardingDraftListDto = {
  items: [
    item({}),
    item({ id: THEIRS, currentPhase: "rtu", locationName: "Pune WTP", createdBy: { id: OTHER, displayName: "Priya" } }),
  ],
};

function stubDrafts(list: OnboardingDraftListDto) {
  return vi.spyOn(onboardingApi, "fetchOnboardingDrafts").mockResolvedValue(list);
}

function renderPicker(
  over: {
    onResume?: (id: string) => void;
    onStartNew?: () => void;
    draftsOf?: OnboardingDraftsOf;
    starting?: boolean;
    resuming?: string | null;
  } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OnboardingDraftPicker
        draftsOf={over.draftsOf === undefined ? { organizationId: ORG } : over.draftsOf}
        currentUserId={ME}
        startLabel="Onboard a site"
        disabled={false}
        starting={over.starting ?? false}
        resuming={over.resuming ?? null}
        onStartNew={over.onStartNew ?? (() => {})}
        onResume={over.onResume ?? (() => {})}
      />
    </QueryClientProvider>,
  );
}

const list = () => screen.findByRole("list", { name: "Onboarding drafts" });

/** P1 — each row names its location and phase; the caller's own draft reads "by you", another's names its author. */
export async function theRowsNameTheirPhaseAndAuthor(): Promise<void> {
  stubDrafts(TWO);
  renderPicker();
  const rows = within(await list()).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Lotapata");
  expect(rows[0]).toHaveTextContent("phase: location");
  expect(rows[0]).toHaveTextContent("by you");
  expect(rows[1]).toHaveTextContent("Pune WTP");
  expect(rows[1]).toHaveTextContent("phase: rtu");
  expect(rows[1]).toHaveTextContent("by Priya");
  expect(rows[1]).not.toHaveTextContent("by you");
}

/** P1 — a draft before the location step has no name: it reads "Untitled draft". */
export async function aDraftWithNoLocationReadsUntitled(): Promise<void> {
  stubDrafts({ items: [item({ locationName: null })] });
  renderPicker();
  const row = within(await list()).getByRole("listitem");
  expect(row).toHaveTextContent("Untitled draft");
}

/** P2 — a row from before `F4.255` has no author: "by an unknown user". */
export async function aDraftWithNoAuthorReadsUnknownUser(): Promise<void> {
  stubDrafts({ items: [item({ createdBy: null })] });
  renderPicker();
  const row = within(await list()).getByRole("listitem");
  expect(row).toHaveTextContent("by an unknown user");
  expect(row).not.toHaveTextContent("by you");
}

/** P3 — Resume on a row resumes that row's draft, and not the other's. */
export async function resumeCallsBackWithThatRowsId(): Promise<void> {
  stubDrafts(TWO);
  const onResume = vi.fn();
  renderPicker({ onResume });
  const rows = within(await list()).getAllByRole("listitem");
  fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Resume" }));
  expect(onResume).toHaveBeenCalledTimes(1);
  expect(onResume).toHaveBeenCalledWith(THEIRS);
  expect(onResume).not.toHaveBeenCalledWith(MINE);
}

/** P4 — with drafts listed, the start button reads "Start new". */
export async function withDraftsTheStartButtonReadsStartNew(): Promise<void> {
  stubDrafts(TWO);
  renderPicker();
  await list();
  expect(screen.getByRole("button", { name: "Start new" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Onboard a site" })).not.toBeInTheDocument();
}

/** P4 — with no draft, the start button keeps the dock's own label, and no list renders. */
export async function withNoDraftTheStartButtonReadsOnboardASite(): Promise<void> {
  const read = stubDrafts({ items: [] });
  const onStartNew = vi.fn();
  renderPicker({ onStartNew });
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  const start = await screen.findByRole("button", { name: "Onboard a site" });
  expect(screen.queryByRole("button", { name: "Start new" })).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Onboarding drafts" })).not.toBeInTheDocument();
  fireEvent.click(start);
  expect(onStartNew).toHaveBeenCalledTimes(1);
}

/** P5 — the list is read once, for the organization the dock names. */
export async function theListIsReadOnceForTheOrganization(): Promise<void> {
  const read = stubDrafts(TWO);
  renderPicker();
  await list();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(ORG);
}

/** While the dock does not know the organization yet, nothing is read and the start button shows alone. */
export async function withNoOrganizationNothingIsRead(): Promise<void> {
  const read = stubDrafts(TWO);
  const onStartNew = vi.fn();
  renderPicker({ draftsOf: null, onStartNew });
  fireEvent.click(await screen.findByRole("button", { name: "Onboard a site" }));
  expect(onStartNew).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByRole("list", { name: "Onboarding drafts" })).not.toBeInTheDocument();
}

/** A pending resume: that row reads "Resuming…" and is busy. */
export async function aResumingRowReadsResuming(): Promise<void> {
  stubDrafts(TWO);
  renderPicker({ resuming: THEIRS });
  const rows = within(await list()).getAllByRole("listitem");
  const busy = within(rows[1] as HTMLElement).getByRole("button", { name: "Resuming…" });
  expect(busy).toHaveAttribute("aria-busy", "true");
}

/** A pending resume leaves the other row named "Resume", not busy, and every button disabled. */
export async function aResumeLeavesTheOtherRowIdleAndAllDisabled(): Promise<void> {
  stubDrafts(TWO);
  renderPicker({ resuming: THEIRS });
  const rows = within(await list()).getAllByRole("listitem");
  const other = within(rows[0] as HTMLElement).getByRole("button", { name: "Resume" });
  expect(other).toHaveAttribute("aria-busy", "false");
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
}

/** A pending start reads "Starting…" and is busy. */
export async function aPendingStartReadsStarting(): Promise<void> {
  stubDrafts(TWO);
  renderPicker({ starting: true });
  await list();
  const start = screen.getByRole("button", { name: "Starting…" });
  expect(start).toHaveAttribute("aria-busy", "true");
  expect(start).toBeDisabled();
}

/** P5b — the caller's home organization ("home"): the list is read once, naming no organization. */
export async function theHomeListIsReadWithNoOrganization(): Promise<void> {
  const read = stubDrafts(TWO);
  renderPicker({ draftsOf: "home" });
  await list();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0]).toEqual([undefined]);
}

/** P7 — each Resume is described by its own row's label; its accessible name stays "Resume". */
export async function eachResumeIsDescribedByItsRow(): Promise<void> {
  stubDrafts(TWO);
  renderPicker();
  const rows = within(await list()).getAllByRole("listitem");
  const first = within(rows[0] as HTMLElement).getByRole("button", { name: "Resume" });
  const second = within(rows[1] as HTMLElement).getByRole("button", { name: "Resume" });
  expect(first).toHaveAccessibleDescription(/^Lotapata\s*· phase: location · .* · by you$/);
  expect(second).toHaveAccessibleDescription(/^Pune WTP\s*· phase: rtu · .* · by Priya$/);
}
