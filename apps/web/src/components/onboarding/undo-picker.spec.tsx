import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { UNDO_NO_HASH, UNDO_WAIT_FOR_TURN, UndoPicker } from "./undo-picker";

/**
 * `F4.339` (ADR 0117 decision 11, plan T8.2) — Undo says why it is disabled.
 * Assertions here; `undo-picker.test.tsx` is the Vitest entry point (ADR 0014, ADR 0042).
 */

const CHECKPOINTS = [{ id: "cp1", seq: 1, label: "Added RTU-1", takenAt: "2026-11-09T00:00:00.000Z" }];

function mount(over: { blocked?: boolean; canUndo?: boolean; undoing?: boolean }): void {
  render(
    <UndoPicker
      checkpoints={CHECKPOINTS}
      value="cp1"
      onChange={() => undefined}
      onUndo={() => undefined}
      undoing={over.undoing ?? false}
      blocked={over.blocked ?? false}
      canUndo={over.canUndo ?? true}
    />,
  );
}

const button = () => screen.getByTestId("undo-button") as HTMLButtonElement;
const reason = () => screen.queryByTestId("undo-reason")?.textContent ?? null;

/** A turn in flight: disabled, and the wait sentence. */
export function aTurnInFlightSaysWait(): void {
  mount({ blocked: true });
  expect(button().disabled).toBe(true);
  expect(reason()).toBe(UNDO_WAIT_FOR_TURN);
}

/** No draft hash: disabled, and the hash sentence. */
export function noHashSaysUnavailable(): void {
  mount({ canUndo: false });
  expect(button().disabled).toBe(true);
  expect(reason()).toBe(UNDO_NO_HASH);
}

/** Enabled: no sentence. */
export function enabledHasNoReason(): void {
  mount({});
  expect(button().disabled).toBe(false);
  expect(reason()).toBeNull();
}

/** An undo in flight reads "Undoing…" on the button; no sentence beside it. */
export function undoingHasNoReason(): void {
  mount({ undoing: true, blocked: true });
  expect(button().textContent).toBe("Undoing…");
  expect(reason()).toBeNull();
}
