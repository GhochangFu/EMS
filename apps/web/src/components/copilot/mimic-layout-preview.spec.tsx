import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import { FLOW_WRITE_BODY, HT_LT_WRITE_BODY } from "../../lib/mimic-editor.write-body.spec";
import { MimicLayoutPreview } from "./mimic-layout-preview";

/**
 * `F3.87` PR 5 (ADR 0099 Amendment 3 A2) — the copilot layout card's drawing, from the write
 * body alone. Vitest entry point: the sibling `.test.tsx` (jsdom).
 */

/** The `F3.80` flow network draws its eight units and seven pipes. */
export function theFlowFixtureDrawsEachUnitAndPipe(): void {
  render(<MimicLayoutPreview body={FLOW_WRITE_BODY} orgSymbols={[]} />);
  const preview = screen.getByTestId("copilot-layout-preview");
  const keys = within(preview)
    .getAllByTestId("mimic-node")
    .map((node) => node.getAttribute("data-node-key"));
  expect(keys.sort()).toEqual(FLOW_WRITE_BODY.nodes.map((node) => node.key).sort());
  expect(within(preview).getAllByTestId("mimic-pipe")).toHaveLength(FLOW_WRITE_BODY.pipes.length);
}

/** The box keeps the layout's own aspect ratio, and the drawing is named after the layout. */
export function thePreviewKeepsTheCanvasRatio(): void {
  render(<MimicLayoutPreview body={HT_LT_WRITE_BODY} orgSymbols={[]} />);
  const preview = screen.getByTestId("copilot-layout-preview");
  expect(preview.style.aspectRatio).toBe("240 / 160");
  expect(within(preview).getByRole("img").getAttribute("aria-label") ?? "").toContain("RSMOC-WC HT/LT network preview");
  expect(within(preview).getAllByTestId("mimic-node")).toHaveLength(14);
}
