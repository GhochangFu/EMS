import { screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotPendingChangeDto } from "@bms/shared";

import * as currentApi from "../../api/copilot-current";
import { localMinuteOf, localZoneLabel } from "../../lib/maintenance-window-time";
import { answered, openPanel, renderDock, send, stub } from "./copilot-dock.spec";
import { change } from "./confirm-card.spec";

/**
 * `F4.362` leftover 1 (AWS check, 2026-11-14) — a maintenance-window card's Field table names the targets
 * and says each time in the browser's zone, as the page's Review does; the summary sentence is the server's,
 * unchanged. Vitest entry point: the sibling `.test.tsx`, which pins `TZ=Asia/Kolkata`.
 */

const WINDOW = "40000000-0000-4000-8000-000000000001";
const ASSET = "30000000-0000-4000-8000-00000000000c";
const END = "2026-11-14T06:31:00.000Z";
const NEW_END = "2026-11-14T10:30:00.000Z";
/** An ISO date-time ("2026-11-14T06:31"), or a JSON target list. */
const RAW = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|"kind"|assetId/;
const local = (iso: string): string => `${localMinuteOf(iso)} (${localZoneLabel(new Date(iso))})`;

async function proposed(pending: CopilotPendingChangeDto, title: string): Promise<HTMLElement> {
  stub().turn.mockResolvedValueOnce(answered("ask", "Confirm the card.", null, [pending]));
  renderDock("admin");
  await openPanel();
  await send("ask");
  return screen.findByRole("region", { name: title });
}

const table = (card: HTMLElement): string => within(card).getByRole("table").textContent ?? "";

/**
 * A create card's Targets row lists the stored names (the card-only `targetLabels`, itself no row) and its End
 * row the local time; no raw ISO or JSON in the table. Mutation: drop the card's `shown` rows → red.
 */
export async function aCreateCardNamesTheTargetsAndSaysLocalTimes(): Promise<void> {
  const card = await proposed(
    change({
      catalogId: "maintenanceWindow.create",
      path: "/api/v1/maintenance-windows",
      risk: "create",
      body: { reason: "Chiller overhaul", endsAt: END, targets: [{ kind: "asset", assetId: ASSET }], targetLabels: ["GOAT_Chiller_1"] },
      summary: "Create a maintenance window in Org A from now to 2026-11-14 06:31 (UTC) on 1 target: GOAT_Chiller_1.",
    }),
    "Create a maintenance window",
  );
  expect(table(card)).not.toMatch(RAW);
  expect(table(card)).toContain("TargetsGOAT_Chiller_1");
  expect(table(card)).toContain(`End${local(END)}`);
  expect(table(card)).not.toContain("Target labels");
  expect(within(card).getByText(/on 1 target: GOAT_Chiller_1\./)).toBeInTheDocument();
}

/** An extend card says the record's end now and the new end, both in local time. */
export async function anExtendCardSaysBothEndsInLocalTime(): Promise<void> {
  vi.spyOn(currentApi, "fetchCopilotCurrent").mockResolvedValue({ endsAt: END, reason: "Chiller overhaul" });
  const card = await proposed(
    change({
      catalogId: "maintenanceWindow.extend",
      path: `/api/v1/maintenance-windows/${WINDOW}/extend`,
      risk: "edit",
      body: { endsAt: NEW_END },
      summary: 'Extend the maintenance window "Chiller overhaul" (GOAT_Chiller_1) from … to …',
    }),
    "Extend a maintenance window",
  );
  await within(card).findByText(local(END));
  expect(table(card)).not.toMatch(RAW);
  expect(table(card)).toContain(`End${local(END)}${local(NEW_END)}`);
}

/** A create stored before `targetLabels` existed keeps the raw Targets row: nothing is invented. */
export async function aCreateWithoutStoredNamesKeepsTheRawRow(): Promise<void> {
  const card = await proposed(
    change({
      catalogId: "maintenanceWindow.create",
      path: "/api/v1/maintenance-windows",
      risk: "create",
      body: { reason: "Chiller overhaul", endsAt: END, targets: [{ kind: "asset", assetId: ASSET }] },
      summary: "Create a maintenance window.",
    }),
    "Create a maintenance window",
  );
  expect(table(card)).toContain(ASSET);
  expect(table(card)).toContain(`End${local(END)}`);
}
