import { cleanup, screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotPendingChangeDto } from "@bms/shared";

import { answered, openPanel, renderDock, send, stub } from "./copilot-dock.spec";

/**
 * `F3.87` PR 6b (ADR 0099 Amendment 3 A3, plan D14) — a symbol upload card in the dock: the
 * stored SVG text is drawn as an `<img>` from a blob URL, never as inline SVG, and is never a
 * row. jsdom has no `URL.createObjectURL`, so each case installs a recording stub
 * ({@link stubBlobUrls}). One claim per `it()`. Vitest entry point: the sibling `.test.tsx`
 * (jsdom).
 */

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
const BLOB_URL = "blob:http://localhost/f387-symbol";

export const UPLOAD_CARD: CopilotPendingChangeDto = {
  id: "44444444-4444-4444-8444-444444444444",
  catalogId: "mimicSymbol.upload",
  method: "POST",
  path: "/api/v1/mimic-symbol-libraries/66666666-6666-4666-8666-666666666666/symbols",
  body: { name: "pump-x", label: "Pump X", filename: "pump-x.svg", fileSha256: "a".repeat(64), svgText: SVG_TEXT },
  summary: 'Upload the symbol "Pump X" (pump-x) to the library "Plant".',
  risk: "create",
  proposedAt: "2026-10-16T10:00:00.000Z",
  expiresAt: "2026-10-16T10:15:00.000Z",
};

/** Installs `URL.createObjectURL` / `revokeObjectURL` stubs that record the blobs made and the URLs revoked. */
export function stubBlobUrls() {
  const made: Blob[] = [];
  const revoked: string[] = [];
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      made.push(blob);
      return BLOB_URL;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  }));
  return { made, revoked };
}

async function uploadCard(): Promise<HTMLElement> {
  const stubs = stub();
  stubs.turn.mockResolvedValueOnce(answered("upload the pump symbol", "Confirm the card.", null, [UPLOAD_CARD]));
  renderDock("admin");
  await openPanel();
  await send("upload the pump symbol");
  return screen.findByRole("region", { name: "Upload a symbol" });
}

/** The card shows the symbol as an `<img>` whose `src` is a blob URL of the stored text, typed SVG. */
export async function anUploadCardDrawsTheSymbolFromABlobUrl(): Promise<void> {
  const blobs = stubBlobUrls();
  const card = await uploadCard();
  const image = await within(card).findByRole("img", { name: "Pump X" });
  expect(image.getAttribute("src")?.startsWith("blob:")).toBe(true);
  expect(blobs.made).toHaveLength(1);
  expect(blobs.made[0]?.type).toBe("image/svg+xml");
  expect(await blobs.made[0]?.text()).toBe(SVG_TEXT);
}

/** The stored SVG never reaches the document as markup: no `<circle>` from the body, no inline copy of it. */
export async function anUploadCardHasNoInlineSvgFromTheBody(): Promise<void> {
  stubBlobUrls();
  const card = await uploadCard();
  await within(card).findByRole("img", { name: "Pump X" });
  expect(document.querySelector("circle")).toBeNull();
  expect(document.body.innerHTML).not.toContain("<circle");
}

/** No row is the SVG text; the stored fields still are rows (the absence beside a positive). */
export async function anUploadCardHasNoSvgTextRow(): Promise<void> {
  stubBlobUrls();
  const card = await uploadCard();
  const headers = within(card).getAllByRole("rowheader").map((cell) => cell.textContent);
  expect(headers).toContain("Label");
  expect(headers).toContain("Filename");
  expect(headers).not.toContain("Svg text");
}

/** Unmounting the card revokes the blob URL it made. */
export async function anUploadCardRevokesItsBlobUrl(): Promise<void> {
  const blobs = stubBlobUrls();
  const card = await uploadCard();
  await within(card).findByRole("img", { name: "Pump X" });
  expect(blobs.revoked).toEqual([]);
  cleanup();
  expect(blobs.revoked).toEqual([BLOB_URL]);
}
