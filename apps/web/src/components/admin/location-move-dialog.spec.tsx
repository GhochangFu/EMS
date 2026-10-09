import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import type { AdminLocationDto, ReportScheduleDto } from "@bms/shared";

import * as reportsApi from "../../api/reports";
import { LocationMoveDialog } from "./location-move-dialog";

/**
 * `F2.10` (ADR 0098 Drafter choice 12, ruling 16, B3, B7) — the move dialog states who loses
 * and who gains the node, and names the report schedules on the new parent and its ancestors.
 * Assertions live here; `location-move-dialog.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock.
 */

const ORG = "33333333-3333-3333-3333-333333333333";
const OTHER_ORG = "44444444-4444-4444-4444-444444444444";
const R = "10000000-0000-0000-0000-000000000001";
const C = "10000000-0000-0000-0000-000000000002";
const S = "10000000-0000-0000-0000-000000000003";
const T = "10000000-0000-0000-0000-000000000004";

function location(id: string, name: string, parentId: string | null): AdminLocationDto {
  return {
    id,
    parentId,
    organizationId: ORG,
    organizationCode: "F210",
    organizationName: "F2.10 org",
    code: name.toUpperCase(),
    slug: name.toLowerCase(),
    name,
    type: "site",
    typeLabel: "Site",
    province: null,
    capital: null,
    timezone: null,
    latitude: 0,
    longitude: 0,
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** R holds C; T holds S. C moves from R to S, whose ancestor is T. */
const NODES = [
  location(C, "Child", R),
  location(R, "Root", null),
  location(S, "Sibling", T),
  location(T, "Top", null),
];

let scheduleSeq = 0;

function schedule(name: string, locationIds: string[], organizationId = ORG): ReportScheduleDto {
  scheduleSeq += 1;
  return {
    id: `20000000-0000-0000-0000-${String(scheduleSeq).padStart(12, "0")}`,
    organizationId,
    name,
    templateId: "energy_consumption",
    formats: ["pdf"],
    cadence: "daily",
    runAtLocal: "06:00",
    timezone: "Asia/Kolkata",
    locationIds,
    channelId: null,
    enabled: true,
    nextRunAt: new Date(0).toISOString(),
    lastRunAt: null,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

type Props = {
  toParentId?: string | null;
  fromParentId?: string | null;
  onConfirm?: () => void;
  onClose?: () => void;
};

function renderDialog(props: Props = {}): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("a spec reached the network"))));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LocationMoveDialog
        node={{ id: C, name: "Child", organizationId: ORG }}
        fromParentId={props.fromParentId === undefined ? R : props.fromParentId}
        toParentId={props.toParentId === undefined ? S : props.toParentId}
        nodes={NODES}
        onConfirm={props.onConfirm ?? vi.fn()}
        onClose={props.onClose ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/** M1 — the title, which is also the dialog's name, names the new parent. */
export async function theTitleNamesTheNewParent(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([]);
  renderDialog();
  expect(screen.getByRole("dialog", { name: "Move Child under Sibling" })).toBeTruthy();
}

/** M2 — a move to no parent says "top level". */
export async function theTitleSaysTopLevelForNoParent(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([]);
  renderDialog({ toParentId: null });
  expect(screen.getByRole("dialog", { name: "Move Child to the top level" })).toBeTruthy();
}

/** M3 — the body names the old chain as losing the node and the new chain as gaining it. */
export async function theBodyNamesBothChains(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([]);
  renderDialog();
  expect(
    screen.getByText("Users granted Root lose access to Child and every node under it."),
  ).toBeTruthy();
  expect(screen.getByText("Users granted Sibling, Top gain it.")).toBeTruthy();
}

/** M4 — only this organization's schedules that cover the new parent or an ancestor. */
export async function listsOnlyTheSchedulesOnTheNewAncestors(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([
    schedule("On the new parent", [S]),
    schedule("On its ancestor T", [T]),
    schedule("On the old parent", [R]),
    schedule("Another org, same id", [S], OTHER_ORG),
  ]);
  renderDialog();
  await screen.findByText("On the new parent");
  expect(screen.getByText("On its ancestor T")).toBeTruthy();
  expect(screen.queryByText("On the old parent")).toBeNull();
  expect(screen.queryByText("Another org, same id")).toBeNull();
}

/** M5 — no schedule covers the new parent: the empty sentence, once the read is done. */
export async function noMatchingScheduleShowsTheEmptySentence(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([schedule("Old", [R])]);
  renderDialog();
  expect(
    await screen.findByText("No report schedule covers the new parent or its ancestors."),
  ).toBeTruthy();
}

/** M6 — Confirm is disabled while the schedules load and enabled once they resolve. */
export async function confirmWaitsForTheScheduleRead(): Promise<void> {
  let resolve: (rows: ReportScheduleDto[]) => void = () => undefined;
  vi.spyOn(reportsApi, "fetchReportSchedules").mockReturnValue(
    new Promise<ReportScheduleDto[]>((r) => {
      resolve = r;
    }),
  );
  renderDialog();
  const pending = screen.getByRole("button", { name: "Checking schedules…" }) as HTMLButtonElement;
  expect(screen.getByText("Checking report schedules…")).toBeTruthy();
  expect(pending.disabled).toBe(true);
  expect(pending.getAttribute("aria-busy")).toBe("true");
  resolve([]);
  const move = (await screen.findByRole("button", { name: "Move" })) as HTMLButtonElement;
  expect(move.disabled).toBe(false);
  expect(move.getAttribute("aria-busy")).toBe("false");
}

/** M7 — a failed read enables Confirm and says the schedules could not be read. */
export async function aFailedReadEnablesConfirmWithTheErrorLine(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportSchedules").mockRejectedValue(
    new Error('{"statusCode":500,"message":"Internal server error"}'),
  );
  renderDialog();
  expect(await screen.findByText(/^Report schedules could not be read\./)).toBeTruthy();
  const move = screen.getByRole("button", { name: "Move" }) as HTMLButtonElement;
  expect(move.disabled).toBe(false);
}

/** M7b (O4) — a move to the top level reads no schedule and Confirm is enabled at once. */
export async function aTopLevelMoveReadsNothingAndConfirmIsEnabled(): Promise<void> {
  const read = vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([]);
  renderDialog({ toParentId: null });
  const move = screen.getByRole("button", { name: "Move" }) as HTMLButtonElement;
  expect(move.disabled).toBe(false);
  expect(screen.getByText("No report schedule covers the new parent or its ancestors.")).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
}

/** M8 — Escape closes, as Cancel does; Move confirms. */
export async function escapeCallsOnClose(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([]);
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  renderDialog({ onClose, onConfirm });
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
}
