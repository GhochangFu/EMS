import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { WORDMARK_NAME, Wordmark } from "./wordmark";

/**
 * `F3.33` U2 (ADR 0083 decision 2, OQ7) — the `IONSiTE NEXUS` text wordmark: "IONSiTE" bold in
 * `on-dark`, "NEXUS" in `accent`, two lines, ADR 0078 role classes only. The wrapper is a
 * `role="img"` named `IONSiTE NEXUS`; there is no `<img>`.
 *
 * Assertions live here; `wordmark.test.tsx` is the Vitest entry point (ADR 0014).
 */

function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function mark(): HTMLElement {
  return screen.getByRole("img", { name: "IONSiTE NEXUS" });
}

function part(word: string): HTMLElement {
  const el = [...mark().querySelectorAll("span")].find((s) => textOf(s) === word);
  if (!el) throw new Error(`no span holding ${word}`);
  return el as HTMLElement;
}

/** W1 — the header variant is one image named IONSiTE NEXUS. */
export function namesTheHeaderWordmarkAsAnImage(): void {
  render(<Wordmark variant="header" />);
  expect(mark()).toBeTruthy();
  expect(WORDMARK_NAME).toBe("IONSiTE NEXUS");
}

/** W2 — the two words read as one name with a single space. */
export function readsIonsiteNexus(): void {
  render(<Wordmark variant="header" />);
  expect(textOf(mark())).toBe("IONSiTE NEXUS");
}

/** W3 — IONSiTE is bold on-dark. */
export function drawsIonsiteBoldOnDark(): void {
  render(<Wordmark variant="header" />);
  const el = part("IONSiTE");
  expect(el.className).toContain("font-bold");
  expect(el.className).toContain("text-on-dark");
  expect(el.className).not.toContain("text-accent");
}

/** W4 — NEXUS is accent, not on-dark. */
export function drawsNexusInAccent(): void {
  render(<Wordmark variant="header" />);
  const el = part("NEXUS");
  expect(el.className).toContain("text-accent");
  expect(el.className).not.toContain("text-on-dark");
}

/** W5 — the hero variant carries the same name and text. */
export function givesTheHeroTheSameNameAndText(): void {
  render(<Wordmark variant="hero" />);
  expect(textOf(mark())).toBe("IONSiTE NEXUS");
}

/** W6 — no `<img>` element; W1's lookup is the positive control. */
export function rendersNoImgElement(): void {
  const { container } = render(<Wordmark variant="hero" />);
  expect(mark()).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
}
