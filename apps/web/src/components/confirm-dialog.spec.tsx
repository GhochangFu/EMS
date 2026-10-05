import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";

/**
 * `F4.202` — the shared confirm dialog (Deactivate, grant Remove, member Remove). Assertions live
 * here; `confirm-dialog.test.tsx` is the Vitest entry point and carries the jsdom docblock
 * (ADR 0042 decision 2). One claim per exported function.
 */

const TITLE = "Deactivate Ada Linked";
const BODY = "This ends the user's sessions and closes its live connections.";

function renderDialog() {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      title={TITLE}
      body={BODY}
      confirmLabel="Confirm deactivate"
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { onConfirm, onClose };
}

/** The dialog is named by its title, so a screen reader hears what it is about to do. */
export function rendersTheTitleAndTheBody(): void {
  renderDialog();
  const dialog = screen.getByRole("dialog", { name: TITLE });
  expect(dialog).toHaveTextContent(TITLE);
  expect(dialog).toHaveTextContent(BODY);
}

export async function cancelCallsOnCloseAndNeverOnConfirm(): Promise<void> {
  const { onConfirm, onClose } = renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
}

export async function confirmCallsOnConfirmOnce(): Promise<void> {
  const { onConfirm, onClose } = renderDialog();
  await userEvent.click(screen.getByRole("button", { name: "Confirm deactivate" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
}
