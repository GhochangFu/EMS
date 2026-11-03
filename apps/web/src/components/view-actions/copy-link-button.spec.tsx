import { fireEvent, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import { COPY_FAILED_SENTENCE, CopyLinkButton } from "./copy-link-button";

/**
 * `F4.303` U6 (ADR 0108 Amendment 6 item 2) — "Copy link" copies `window.location.href`; a
 * refusal or a missing clipboard is one fixed sentence, and nothing is written to the console.
 * `fireEvent`, not `userEvent`: `userEvent.setup()` installs its own clipboard over the stub.
 * Entry point: `copy-link-button.test.tsx`.
 */

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  const spy = writeText === undefined ? undefined : vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: spy === undefined ? undefined : { writeText: spy },
  });
  return spy;
}

export function restoreClipboard(): void {
  if (original === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", original);
  }
}

function spyConsole() {
  return { error: vi.spyOn(console, "error"), warn: vi.spyOn(console, "warn") };
}

/** B1: a click copies the address and the label reads "Copied". */
export async function aClickCopiesTheAddress(): Promise<void> {
  const writeText = stubClipboard(() => Promise.resolve());
  render(<CopyLinkButton />);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith(window.location.href);
}

/** B2: a refused write is the fixed sentence, and the console stays silent. */
export async function aRefusedWriteIsTheFixedSentence(): Promise<void> {
  stubClipboard(() => Promise.reject(new Error("NotAllowedError: secret")));
  const console_ = spyConsole();
  render(<CopyLinkButton />);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect((await screen.findByRole("status")).textContent).toBe(COPY_FAILED_SENTENCE);
  expect(COPY_FAILED_SENTENCE).toBe("Copy failed. Copy the address from the browser bar.");
  expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  expect(console_.error).not.toHaveBeenCalled();
  expect(console_.warn).not.toHaveBeenCalled();
}

/** B3: no clipboard (an insecure origin) is the same sentence. */
export async function noClipboardIsTheFixedSentence(): Promise<void> {
  stubClipboard(undefined);
  render(<CopyLinkButton />);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect((await screen.findByRole("status")).textContent).toBe("Copy failed. Copy the address from the browser bar.");
}

/** The label returns to "Copy link" two seconds after a copy. */
export async function theLabelReturnsAfterTwoSeconds(): Promise<void> {
  stubClipboard(() => Promise.resolve());
  vi.useFakeTimers();
  try {
    render(<CopyLinkButton />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
}
