import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import { aFile, answered, chips, CONVERSATION_ID, choose, openPanel, READY_WITH_FILES, renderDock, send, stub } from "./copilot-dock.spec";

/**
 * `F4.269` (ADR 0105) — the dock sends a picked PDF's first page as a PNG, in
 * place of the PDF. `pdfjs-dist` is stubbed at the module seam by
 * `copilot-dock-pdf.test.tsx` (`vi.mock`), delegating to `PDFJS_FAKE` below;
 * jsdom has no canvas, so `toBlob` is a spy on the prototype (the fake never draws).
 * The real `renderPdfFirstPage` and `prepareChosenFiles` run.
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ORG_2 = "44444444-4444-4444-8444-444444444444";
const ATTACH = /AI provider as it is, unscrubbed/;

/** What the stubbed document does: its page count, whether it opens, and a gate a case can hold it on. */
const control = { numPages: 2, fails: false, gate: Promise.resolve() };

const PAGE = {
  getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
  render: () => ({ promise: Promise.resolve() }),
};

/** The `pdfjs-dist` module the test file's `vi.mock` returns. */
export const PDFJS_FAKE = {
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: control.gate.then(() =>
      control.fails
        ? Promise.reject(new Error("Invalid PDF structure."))
        : { numPages: control.numPages, getPage: async () => PAGE },
    ),
    destroy: async () => undefined,
  }),
};

function stubPdf(numPages = 2, fails = false, gate: Promise<void> = Promise.resolve()): void {
  control.numPages = numPages;
  control.fails = fails;
  control.gate = gate;
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
    callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })),
  );
}

async function attachReady(role: "organization_admin" | "admin" = "organization_admin"): Promise<void> {
  renderDock(role);
  await openPanel();
  await screen.findByLabelText(ATTACH);
}

/**
 * A picked PDF reaches the wire as one PNG part and no PDF (decision 1).
 * Mutation: `prepareChosenFiles` keeps the PDF on a rendered page → red.
 */
export async function sendsAPickedPdfAsOnePngPart(): Promise<void> {
  const stubs = stub(READY_WITH_FILES);
  stubs.turn.mockRestore();
  stubPdf();
  let body: unknown = null;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    body = init.body;
    return new Response(JSON.stringify(answered("read it", "A single-line diagram.")), { status: 200 });
  });
  await attachReady();
  choose(aFile("sld.pdf", 3, "application/pdf"));
  await waitFor(() => expect(chips()).toEqual(["sld-page-1.png"]));
  await send("read it");
  await waitFor(() => expect(body).not.toBeNull());
  const files = (body as FormData).getAll("files") as File[];
  expect(files.map((f) => [f.name, f.type])).toEqual([["sld-page-1.png", "image/png"]]);
}

/**
 * The chip of a rendered page says what goes (decision 2); an image picked beside it says nothing.
 * Mutation: drop the chip's page span → red.
 */
export async function saysPageOneOfNOnTheChip(): Promise<void> {
  stub(READY_WITH_FILES);
  stubPdf(7);
  await attachReady();
  choose(aFile("plant.png"), aFile("layout.PDF", 3, "application/pdf"));
  await waitFor(() => expect(chips()).toEqual(["plant.png", "layout-page-1.png"]));
  const list = screen.getByRole("list", { name: "Files to attach" });
  const [image, page] = within(list).getAllByRole("listitem");
  expect(page).toHaveTextContent("page 1 of 7, sent as an image");
  expect(image).not.toHaveTextContent("sent as an image");
}

/**
 * A PDF that cannot be opened is refused at the picker with the one sentence, and an image in the
 * same pick is still attached (decision 4). Mutation: attach the PDF on a failed render → red.
 */
export async function bannersAPdfThatCannotBeRead(): Promise<void> {
  stub(READY_WITH_FILES);
  stubPdf(1, true);
  await attachReady();
  choose(aFile("broken.pdf", 3, "application/pdf"), aFile("plant.png"));
  expect(await screen.findByRole("alert")).toHaveTextContent('"broken.pdf" could not be read as a PDF.');
  expect(chips()).toEqual(["plant.png"]);
}

/**
 * A render still in flight when another organization is picked is dropped: the user agreed to
 * send the file to the first organization's provider only. Mutation: drop the epoch check → red.
 */
export async function dropsARenderInFlightOnAPickOfAnotherOrganization(): Promise<void> {
  const stubs = stub(READY_WITH_FILES);
  stubs.organizations.mockResolvedValue({
    items: [
      { id: ORG_ID, code: "PHE", name: "PHE Water", active: true, currency: "INR", timezone: "Asia/Kolkata", meta: null },
      { id: ORG_2, code: "ION", name: "Ion Plant", active: true, currency: "INR", timezone: "Asia/Kolkata", meta: null },
    ],
  } as never);
  let release = (): void => undefined;
  stubPdf(1, false, new Promise<void>((resolve) => (release = resolve)));
  renderDock("admin");
  await openPanel();
  const picker = await screen.findByRole("combobox", { name: "Organization" });
  await within(picker).findByRole("option", { name: "Ion Plant" });
  fireEvent.change(picker, { target: { value: ORG_ID } });
  await screen.findByTitle("The file goes to PHE Water's AI provider as it is, unscrubbed.");
  choose(aFile("sld.pdf", 3, "application/pdf"), aFile("plant.png"));
  fireEvent.change(picker, { target: { value: ORG_2 } });
  await screen.findByTitle("The file goes to Ion Plant's AI provider as it is, unscrubbed.");
  // The positive control: a pick in the new organization lands.
  choose(aFile("valve.png"));
  expect(chips()).toEqual(["valve.png"]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(chips()).toEqual(["valve.png"]);
}

/** Holds the stubbed document until the returned `release` is called. */
function holdPdf(): () => void {
  let release = (): void => undefined;
  stubPdf(2, false, new Promise<void>((resolve) => (release = resolve)));
  return () => release();
}

/**
 * A PDF whose page is still rendering shows a "Rendering <name>…" chip, gone once it lands.
 * Mutation: drop the chip → red.
 */
export async function showsARenderingChipWhileThePageRenders(): Promise<void> {
  stub(READY_WITH_FILES);
  const release = holdPdf();
  await attachReady();
  choose(aFile("sld.pdf", 3, "application/pdf"));
  expect(await screen.findByText("Rendering sld.pdf…")).toBeInTheDocument();
  release();
  await waitFor(() => expect(chips()).toEqual(["sld-page-1.png"]));
  expect(screen.queryByText("Rendering sld.pdf…")).toBeNull();
}

/**
 * Send waits for a page render in flight, so the turn cannot leave without the page.
 * Mutation: drop `rendering.length > 0` from the button's `disabled` → red.
 */
export async function disablesSendWhileARenderIsPending(): Promise<void> {
  stub(READY_WITH_FILES);
  const release = holdPdf();
  await attachReady();
  choose(aFile("sld.pdf", 3, "application/pdf"));
  fireEvent.change(screen.getByRole("textbox", { name: "Message the copilot" }), { target: { value: "read it" } });
  await screen.findByText("Rendering sld.pdf…");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  release();
  // The positive control: the same button is enabled once the page lands.
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
}

/**
 * Enter does not send while a page render is in flight.
 * Mutation: drop `rendering.length > 0` from `submit`'s guard → red.
 */
export async function holdsEnterWhileARenderIsPending(): Promise<void> {
  const stubs = stub(READY_WITH_FILES);
  const release = holdPdf();
  await attachReady();
  choose(aFile("sld.pdf", 3, "application/pdf"));
  await screen.findByText("Rendering sld.pdf…");
  await send("read it");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(stubs.turn).not.toHaveBeenCalled();
  release();
  await waitFor(() => expect(chips()).toEqual(["sld-page-1.png"]));
  // The positive control: the same Enter sends once the page lands.
  await send("read it");
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledTimes(1));
}

/**
 * A page that lands while a turn is in flight stays for the next turn; only the sent files go.
 * The Attach input is disabled during a send, so the pick is a `change` dispatched on it: this
 * holds `onSuccess` itself, as defence in depth. Mutation: `setFiles([])` in `onSuccess` → red.
 */
export async function keepsAPageThatLandsDuringASend(): Promise<void> {
  const stubs = stub(READY_WITH_FILES);
  // Bound to the organization, so the thread the send seeds keeps the Attach control.
  stubs.create.mockResolvedValue({
    id: CONVERSATION_ID,
    organizationId: ORG_ID,
    title: null,
    createdAt: "2026-10-22T10:00:00.000Z",
    lastTurnAt: "2026-10-22T10:00:00.000Z",
  });
  let answer = (): void => undefined;
  stubs.turn.mockImplementation(
    () => new Promise((resolve) => (answer = () => resolve(answered("read it", "A diagram.")))),
  );
  stubPdf();
  await attachReady();
  choose(aFile("plant.png"));
  await send("read it");
  await waitFor(() => expect(stubs.turn).toHaveBeenCalledTimes(1));
  choose(aFile("sld.pdf", 3, "application/pdf"));
  await waitFor(() => expect(chips()).toEqual(["plant.png", "sld-page-1.png"]));
  answer();
  await waitFor(() => expect(chips()).toEqual(["sld-page-1.png"]));
}

/**
 * A page that lands later never clears a banner another pick set.
 * Mutation: `setBanner(problems.length > 0 ? … : null)` on the late path → red.
 */
export async function keepsAnotherBannerWhenAPageLands(): Promise<void> {
  stub(READY_WITH_FILES);
  const release = holdPdf();
  await attachReady();
  choose(aFile("sld.pdf", 3, "application/pdf"));
  choose(aFile("notes.exe"));
  expect(await screen.findByRole("alert")).toHaveTextContent('"notes.exe" is not a PNG, JPEG, WebP, PDF or SVG file.');
  release();
  await waitFor(() => expect(chips()).toEqual(["sld-page-1.png"]));
  expect(screen.getByRole("alert")).toHaveTextContent('"notes.exe" is not a PNG, JPEG, WebP, PDF or SVG file.');
}
