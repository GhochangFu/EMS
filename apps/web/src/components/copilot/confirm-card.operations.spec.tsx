import { render, screen } from "@testing-library/react";
import { expect } from "vitest";
import { cardOnlyKeysFor } from "@bms/shared/copilot";

import { withoutKeys } from "../../api/copilot-confirm";
import { ChangeCard } from "./change-card";
import { movesOf } from "./confirm-card";

/**
 * `F4.284` (ADR 0106 decision 2; owner ruling DC2) — a reorder card lists each
 * moved work order with its old and new position (the card-only `moves`), and the
 * body the Confirm sends leaves the moves out. Vitest entry point: the sibling
 * `.test.tsx` (jsdom).
 */

const MOVES = [
  { id: "w1", title: "Check the breaker", fromStatus: "open", fromSortOrder: 0, toStatus: "assigned", toSortOrder: 3 },
  { id: "w2", title: "Replace the lug", fromStatus: "assigned", fromSortOrder: 1, toStatus: "assigned", toSortOrder: 0 },
];

/** One line per move, naming the old and the new position. */
export function eachMoveIsOneLineWithItsOldAndNewPosition(): void {
  expect(movesOf(MOVES).map((move) => move.line)).toEqual([
    "Check the breaker: open #0 → assigned #3",
    "Replace the lug: assigned #1 → assigned #0",
  ]);
}

/** A value that is not a list of moves lists nothing. */
export function aMalformedMovesValueListsNothing(): void {
  expect([movesOf(undefined), movesOf("x"), movesOf([null])]).toEqual([[], [], []]);
}

/** The Confirm strips the card-only `moves` before it sends the body. */
export function theSentBodyHasNoMoves(): void {
  const body = { items: [{ id: "w1", status: "assigned", sortOrder: 3 }], moves: MOVES };
  expect(withoutKeys(body, cardOnlyKeysFor("workOrder.reorder"))).toEqual({ items: body.items });
}

/** An `operational` card (the acknowledge) renders red with the fixed line. */
export function anAckCardIsRedAndCannotBeUndone(): void {
  render(<ChangeCard title="Acknowledge an alarm" summary="Acknowledge." risk="operational" rows={[]} busy={false} confirmLabel="Confirm" busyLabel="…" onConfirm={() => {}} />);
  expect(screen.getByText("This cannot be undone.")).toBeTruthy();
  expect(document.querySelector('[data-risk="operational"]')?.className).toContain("border-critical-line");
}
