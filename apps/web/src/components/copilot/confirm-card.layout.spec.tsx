import { screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotPendingChangeDto } from "@bms/shared";

import * as currentApi from "../../api/copilot-current";
import type { MimicLayoutWriteBody } from "../../api/mimic-layouts";
import * as symbolLibrariesApi from "../../api/mimic-symbol-libraries";
import { editorLayoutFromWriteBody } from "../../lib/mimic-editor";
import { FLOW_WRITE_BODY } from "../../lib/mimic-editor.write-body.spec";
import { answered, openPanel, renderDock, send, stub } from "./copilot-dock.spec";

/**
 * `F3.87` PR 5 (ADR 0099 Amendment 3 A2, owner rulings Q1, Q5) — a layout card in the dock:
 * the drawing from the body alone, the editor's warnings (Confirm stays enabled), the node diff
 * against the baseline the row stored at propose time, and the live-version note. One claim per
 * `it()`. Every read is a spy (an unstubbed fetch reaches `:4000`, `F4.160`). Vitest entry
 * point: the sibling `.test.tsx` (jsdom).
 */

const LAYOUT = "66666666-6666-4666-8666-666666666666";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

/** The flow body with `edit` applied to each node; pipes and the rest as they are. */
function flowWith(edit: (node: MimicLayoutWriteBody["nodes"][number]) => MimicLayoutWriteBody["nodes"][number]): MimicLayoutWriteBody {
  return { ...FLOW_WRITE_BODY, nodes: FLOW_WRITE_BODY.nodes.map(edit) };
}

/**
 * The baseline a replace was built from: the flow network with the pump one cell to the left,
 * no `zone` unit and no `damper→zone` pipe, and a unit `old` piped from the pump.
 */
function baseline() {
  const nodes = editorLayoutFromWriteBody(FLOW_WRITE_BODY)
    .nodes.filter((node) => node.key !== "zone")
    .map((node) => (node.key === "pump" ? { ...node, x: 9 } : node));
  return {
    version: 2,
    nodes: [...nodes, { ...nodes[1]!, key: "old", label: "Old tank", x: 160, y: 0 }],
    pipes: [
      ...FLOW_WRITE_BODY.pipes.filter((pipe) => pipe.toKey !== "zone"),
      { fromKey: "pump", toKey: "old" },
    ],
  };
}

function replaceChange(body: MimicLayoutWriteBody = FLOW_WRITE_BODY, version = 2): CopilotPendingChangeDto {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    catalogId: "mimicLayout.replace",
    method: "PUT",
    path: `/api/v1/mimic-layouts/${LAYOUT}`,
    body: { version, ...body, baseline: baseline() },
    summary: 'Replace the layout "RSMOC-WC flow network" (version 2): 8 units, 0 panels, 7 pipes.',
    risk: "edit",
    proposedAt: "2026-10-15T10:00:00.000Z",
    expiresAt: "2026-10-15T10:15:00.000Z",
  };
}

function createChange(body: MimicLayoutWriteBody): CopilotPendingChangeDto {
  return {
    ...replaceChange(),
    catalogId: "mimicLayout.create",
    method: "POST",
    path: "/api/v1/mimic-layouts",
    body: { organizationId: ORG_ID, ...body },
    summary: 'Create the layout "RSMOC-WC flow network" in PHE Water: 8 units, 0 panels, 7 pipes.',
    risk: "create",
  };
}

/** The dock with `pending` proposed; the live layout answers `current`, and the catalog has no organization symbols. */
async function cardFor(pending: CopilotPendingChangeDto, current: Record<string, unknown> = { version: 2, organizationId: ORG_ID }) {
  const stubs = stub();
  const read = vi.spyOn(currentApi, "fetchCopilotCurrent").mockResolvedValue(current);
  const symbols = vi.spyOn(symbolLibrariesApi, "fetchMimicSymbolLibraries").mockResolvedValue({ global: [], organization: [] } as never);
  stubs.turn.mockResolvedValueOnce(answered("draw the flow network", "Confirm the card.", null, [pending]));
  renderDock("admin");
  await openPanel();
  await send("draw the flow network");
  const title = pending.catalogId === "mimicLayout.replace" ? "Replace a mimic layout" : "Create a mimic layout";
  return { card: await screen.findByRole("region", { name: title }), read, symbols };
}

/**
 * A replace's organization comes only from `current.data`, so the symbol read with that
 * organization proves `current.data` reached the render — not just that its query started.
 */
async function currentRendered(symbols: { mock: { calls: unknown[][] } }): Promise<void> {
  await vi.waitFor(() => expect(symbols.mock.calls.some(([organizationId]) => organizationId === ORG_ID)).toBe(true));
}

/** The card draws the proposed layout: one unit per body node. */
export async function aLayoutCardDrawsTheBody(): Promise<void> {
  const { card } = await cardFor(replaceChange());
  const preview = within(card).getByTestId("copilot-layout-preview");
  expect(within(preview).getAllByTestId("mimic-node")).toHaveLength(FLOW_WRITE_BODY.nodes.length);
  expect(within(card).getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", false);
}

const warningsOf = (card: HTMLElement): string[] =>
  within(within(card).getByRole("list", { name: "Layout warnings" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");

/** d14 "no source": no unit is a source; the warning shows and Confirm stays enabled. */
export async function aLayoutCardWarnsOfNoSource(): Promise<void> {
  const { card } = await cardFor(createChange(flowWith((node) => ({ ...node, isSource: undefined }))));
  expect(warningsOf(card)).toEqual(["No unit is marked as an energy source, so nothing is energised."]);
  expect(within(card).getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", false);
}

/** d14 "no role": a switching unit with no role. */
export async function aLayoutCardWarnsOfASwitchingUnitWithNoRole(): Promise<void> {
  const { card } = await cardFor(createChange(flowWith((node) => (node.key === "iso_v1" ? { ...node, roleCode: undefined } : node))));
  expect(warningsOf(card)).toEqual(['"Isolation valve" switches but has no role, so it shows no state.']);
}

/** d14 "unreached": no source reaches a switching unit along the pipes. */
export async function aLayoutCardWarnsOfAnUnreachedSwitchingUnit(): Promise<void> {
  const body = { ...FLOW_WRITE_BODY, pipes: FLOW_WRITE_BODY.pipes.filter((pipe) => pipe.toKey !== "iso_v1") };
  const { card } = await cardFor(createChange(body));
  expect(warningsOf(card)).toEqual(['"Isolation valve" switches but no source reaches it along the pipes.']);
}

const graphRows = (card: HTMLElement) =>
  within(card)
    .getAllByRole("row")
    .map((row) => [...row.children].map((cell) => cell.textContent ?? ""))
    .filter(([heading]) => heading?.startsWith("Node ") || heading?.startsWith("Pipe "));

/**
 * The node diff is against the stored baseline, never the layout now: a `current` that carries
 * an extra node changes no row.
 */
export async function aReplaceCardDiffsAgainstTheBaselineNotTheLayoutNow(): Promise<void> {
  const { card, symbols } = await cardFor(replaceChange(), {
    version: 2,
    organizationId: ORG_ID,
    nodes: [{ key: "intruder", kind: "unit", label: "Not in the baseline" }],
  });
  await currentRendered(symbols);
  expect(graphRows(card)).toEqual([
    ["Node pump", "x 9", "x 10"],
    ["Node zone", "—", 'added: unit "Zone"'],
    ["Node old", 'unit "Old tank"', "removed"],
    ["Pipe damper→zone", "—", "added"],
    ["Pipe pump→old", "present", "removed"],
  ]);
  expect(within(card).queryByText(/intruder|Not in the baseline/)).toBeNull();
  expect(within(card).queryByText(/^Baseline$/)).toBeNull();
}

/**
 * The scalar rows of a replace are not compared with the layout now: they say so rather than
 * showing a dash that reads as "empty"; `version` is compared with the baseline's.
 */
export async function aReplaceCardsScalarRowsSayNotCompared(): Promise<void> {
  const { card, symbols } = await cardFor(replaceChange());
  await currentRendered(symbols);
  const scalar = within(card)
    .getAllByRole("row")
    .map((row) => [...row.children].map((cell) => cell.textContent ?? ""))
    .filter(([heading]) => heading === "Name" || heading === "Version");
  expect(scalar).toEqual([
    ["Version", "2", "2"],
    ["Name", "not compared", FLOW_WRITE_BODY.name],
  ]);
}

/** The live version moved past the card's: the card says Confirm will give 409. */
export async function aReplaceCardSaysConfirmWillGive409WhenTheVersionMoved(): Promise<void> {
  const { card } = await cardFor(replaceChange(), { version: 3, organizationId: ORG_ID });
  expect((await within(card).findByTestId("copilot-layout-version-note")).textContent).toBe(
    "Built against version 2; the layout is now at version 3 — Confirm will give 409.",
  );
}

/** Positive control: the live version is the card's own, and no note shows. */
export async function aReplaceCardAtTheLiveVersionHasNoNote(): Promise<void> {
  const { card, symbols } = await cardFor(replaceChange());
  await currentRendered(symbols);
  expect(within(card).getByTestId("copilot-layout-preview")).toBeTruthy();
  expect(within(card).queryByTestId("copilot-layout-version-note")).toBeNull();
}
