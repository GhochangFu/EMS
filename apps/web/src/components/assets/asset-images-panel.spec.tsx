import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { assetImageDtoSchema } from "@bms/shared/contracts";
import type { AssetImageDto } from "@bms/shared";

import * as assetImagesApi from "../../api/asset-images";
import { ApiError } from "../../lib/api-error";
import { AssetImagesPanel } from "./asset-images-panel";

/**
 * `F3.4` Unit 8 — the admin "Images" side panel (owner rulings Q-0 and Q-2,
 * R-7).
 *
 * Assertions live here; `asset-images-panel.test.tsx` is the Vitest entry
 * point and carries `@vitest-environment jsdom` (ADR 0014 / ADR 0042
 * decision 2).
 *
 * ## Why every file is chosen through `fireEvent`, never `userEvent.upload`
 *
 * `userEvent@14` filters the files it hands an `<input type="file">` against
 * that input's `accept` attribute. This panel sets `accept={ASSET_IMAGE_ACCEPT}`
 * — the three image types — so `userEvent.upload` would silently drop the
 * `.gif` fixture, the panel would never see a file, and the row asserting the
 * type sentence would fail while claiming the opposite of what it measured.
 * Defining `files` and firing `change` is the one shape used by **every** row
 * here, valid and invalid alike: two shapes would mean the "enables it" and
 * "disables it" claims take different paths through the same `onChange`.
 *
 * Every spy is installed per assert (`vi.restoreAllMocks()` in the wrapper), so
 * a `mock.calls.length` read is that assert's own delta and never a lifetime
 * counter (§4.6).
 */

const ASSET = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "TRF-01",
  name: "Transformer 1",
};

/** A DTO the contract accepts — an off-shape fixture would fail somewhere else. */
function dto(overrides: Partial<AssetImageDto> & Pick<AssetImageDto, "id">): AssetImageDto {
  return assetImageDtoSchema.parse({
    assetId: ASSET.id,
    contentType: "image/png",
    byteSize: 2048,
    sha256: "a".repeat(64),
    originalFilename: "panel.png",
    caption: null,
    createdBy: null,
    createdAt: "2026-09-16T10:00:00.000Z",
    ...overrides,
  });
}

const FIRST = dto({ id: "22222222-2222-4222-8222-222222222222", caption: "Front panel" });
const SECOND = dto({ id: "33333333-3333-4333-8333-333333333333", originalFilename: "rear.png" });

/** Twenty distinct images — the cap, as the API counts it. */
function twentyImages(): AssetImageDto[] {
  return Array.from({ length: 20 }, (_unused, index) =>
    dto({ id: `4${String(index).padStart(3, "0")}0000-4444-4444-8444-444444444444` }),
  );
}

/** A `File` the panel should accept. */
function pngFile(name = "front.png"): File {
  return new File(["PNG"], name, { type: "image/png" });
}

/** A `File` whose reported size is over `MAX_ASSET_IMAGE_BYTES`, without allocating 12 MiB. */
function oversizePngFile(): File {
  const file = pngFile("huge.png");
  Object.defineProperty(file, "size", { value: 12 * 1024 * 1024 });
  return file;
}

function stubList(images: AssetImageDto[]): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue(images);
}

/** Every thumbnail answers with the same bytes; no row here asserts on them. */
function stubThumbnails(): void {
  vi.spyOn(assetImagesApi, "fetchAssetImageBlob").mockResolvedValue(
    new Blob(["x"], { type: "image/png" }),
  );
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation(() => `blob:asset-image-${create.mock.calls.length}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
}

function renderPanel(onClose: () => void = vi.fn()): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AssetImagesPanel asset={ASSET} onClose={onClose} />
    </QueryClientProvider>,
  );
}

/**
 * Hands the file input a `File` the way the browser does.
 *
 * `input.files` is read-only in jsdom, so it is redefined and the event fired
 * by hand. See this file's docblock for why `userEvent.upload` cannot be used.
 */
function chooseFile(file: File): void {
  const input = screen.getByLabelText("Image file") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

function uploadButton(): HTMLElement {
  return screen.getByRole("button", { name: "Upload" });
}

/** A1 — with no file chosen, Upload is disabled and says what is missing. */
export async function uploadIsDisabledAndAsksForAFileFirst(): Promise<void> {
  stubList([]);
  stubThumbnails();

  renderPanel();

  // Waited for: the count the sentence depends on arrives with the list.
  await screen.findByText("No images for this asset yet.");
  expect(uploadButton()).toBeDisabled();
  expect(screen.getByText("Choose an image to upload.")).toBeInTheDocument();
}

/**
 * A2 — a file over the byte cap disables Upload and names the limit.
 *
 * The disabled flag is asserted **after** the sentence is found, so the row
 * cannot pass on a panel that renders nothing at all.
 */
export async function anOversizeFileDisablesUploadAndNamesTheLimit(): Promise<void> {
  stubList([]);
  stubThumbnails();

  renderPanel();
  await screen.findByText("No images for this asset yet.");
  chooseFile(oversizePngFile());

  expect(screen.getByText(/limit is 10 MB/)).toBeInTheDocument();
  expect(uploadButton()).toBeDisabled();
}

/** A3 — a type outside the closed vocabulary disables Upload and names the allowlist. */
export async function aGifDisablesUploadAndNamesTheAcceptedTypes(): Promise<void> {
  stubList([]);
  stubThumbnails();

  renderPanel();
  await screen.findByText("No images for this asset yet.");
  chooseFile(new File(["GIF89a"], "photo.gif", { type: "image/gif" }));

  expect(screen.getByText("Only JPEG, PNG or WebP images are accepted.")).toBeInTheDocument();
  expect(uploadButton()).toBeDisabled();
}

/**
 * A4 — at the cap the panel says so and will not take a file at all.
 *
 * The sentence has to be reachable with **no** file chosen, which is why the
 * cap is asked before "choose a file" (`assetImageCapReason`). The disabled
 * input is the second half: telling an operator the asset is full while still
 * accepting a file is an invitation to a 409.
 */
export async function atTheCapTheSentenceShowsAndTheFileInputIsDisabled(): Promise<void> {
  stubList(twentyImages());
  stubThumbnails();

  renderPanel();

  expect(
    await screen.findByText(
      "This asset already has 20 images; delete one before uploading another.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Image file")).toBeDisabled();
  expect(uploadButton()).toBeDisabled();
}

/** A5 — a valid image under the cap enables Upload. */
export async function aValidFileEnablesUpload(): Promise<void> {
  stubList([]);
  stubThumbnails();

  renderPanel();
  await screen.findByText("No images for this asset yet.");
  chooseFile(pngFile());

  expect(uploadButton()).toBeEnabled();
  // The positive control for the absence: the blocked sentence is gone, and
  // the button above proves the panel still rendered its form.
  expect(screen.queryByText("Choose an image to upload.")).toBeNull();
}

/** A6 — pressing Upload posts that file and that caption, exactly once. */
export async function pressingUploadPostsTheFileAndCaptionOnce(): Promise<void> {
  stubList([]);
  stubThumbnails();
  const upload = vi.spyOn(assetImagesApi, "uploadAssetImage").mockResolvedValue(FIRST);

  renderPanel();
  await screen.findByText("No images for this asset yet.");
  const file = pngFile();
  chooseFile(file);
  await userEvent.type(screen.getByLabelText("Caption"), "Front panel");

  const before = upload.mock.calls.length;
  await userEvent.click(uploadButton());

  await waitFor(() => {
    expect(upload.mock.calls.length - before).toBe(1);
  });
  expect(upload).toHaveBeenCalledWith(ASSET.id, file, "Front panel");
}

/**
 * A7 — a successful upload refetches the list.
 *
 * The delta is read around the click, not as a lifetime total: the first
 * render already fetched once. Nothing else in jsdom refetches an active query
 * — no window focus, no new observer, and the panel and its gallery share one
 * query key — so this row is exactly the `invalidateQueries` call.
 */
export async function aSuccessfulUploadRefetchesTheList(): Promise<void> {
  const list = stubList([]);
  stubThumbnails();
  vi.spyOn(assetImagesApi, "uploadAssetImage").mockResolvedValue(FIRST);

  renderPanel();
  await screen.findByText("No images for this asset yet.");
  chooseFile(pngFile());

  const before = list.mock.calls.length;
  await userEvent.click(uploadButton());

  await waitFor(() => {
    expect(list.mock.calls.length - before).toBe(1);
  });
}

/** A8 — a 413 from the API is rendered as the 10 MB sentence, not as raw JSON. */
export async function aRefusedOversizeUploadRendersTheTenMbSentence(): Promise<void> {
  stubList([]);
  stubThumbnails();
  vi.spyOn(assetImagesApi, "uploadAssetImage").mockRejectedValue(
    new ApiError('{"statusCode":413,"message":"File too large"}', 413),
  );

  renderPanel();
  await screen.findByText("No images for this asset yet.");
  chooseFile(pngFile());
  await userEvent.click(uploadButton());

  expect(await screen.findByText("Image is too large — the limit is 10 MB.")).toBeInTheDocument();
  // The server's own words for a 413 are generic; the negative proves the
  // status branch ran rather than the envelope unwrapper.
  expect(screen.queryByText("File too large")).toBeNull();
}

/**
 * A9 — a 409 is rendered as the API's own sentence, unwrapped.
 *
 * Deliberately rendered with **one** image, not twenty: at the cap the panel
 * already shows its own sentence, and the two strings differ only by a final
 * full stop. With a non-cap list the sentence on screen can only have come from
 * the refusal. The negative below pins that difference.
 */
export async function aConflictRendersTheApiSentenceUnwrapped(): Promise<void> {
  stubList([FIRST]);
  stubThumbnails();
  vi.spyOn(assetImagesApi, "uploadAssetImage").mockRejectedValue(
    new ApiError(
      JSON.stringify({
        message: "This asset already has 20 images; delete one before uploading another",
      }),
      409,
    ),
  );

  renderPanel();
  await screen.findByText("Front panel");
  chooseFile(pngFile());
  await userEvent.click(uploadButton());

  expect(
    await screen.findByText(
      "This asset already has 20 images; delete one before uploading another",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("This asset already has 20 images; delete one before uploading another."),
  ).toBeNull();
}

/** A10 — Delete on a thumbnail deletes that image of that asset, once. */
export async function deletingAThumbnailCallsTheApiOnceForThatImage(): Promise<void> {
  stubList([FIRST, SECOND]);
  stubThumbnails();
  const remove = vi.spyOn(assetImagesApi, "deleteAssetImage").mockResolvedValue(undefined);

  renderPanel();
  const buttons = await screen.findAllByRole("button", { name: "Delete" });
  const before = remove.mock.calls.length;
  await userEvent.click(buttons[1] as HTMLElement);

  await waitFor(() => {
    expect(remove.mock.calls.length - before).toBe(1);
  });
  expect(remove).toHaveBeenCalledWith(ASSET.id, SECOND.id);
}

/** A11 — a delete refetches the list, so the grid cannot keep showing a deleted image. */
export async function aDeleteRefetchesTheList(): Promise<void> {
  const list = stubList([FIRST]);
  stubThumbnails();
  vi.spyOn(assetImagesApi, "deleteAssetImage").mockResolvedValue(undefined);

  renderPanel();
  const button = await screen.findByRole("button", { name: "Delete" });
  const before = list.mock.calls.length;
  await userEvent.click(button);

  await waitFor(() => {
    expect(list.mock.calls.length - before).toBe(1);
  });
}

/**
 * A12 — the pill counts this asset's images against the shared cap.
 *
 * Two images, not one: `1 / 20` would also be produced by a panel that
 * rendered the length of a hardcoded single-element array.
 */
export async function thePillCountsTheImagesAgainstTheCap(): Promise<void> {
  stubList([FIRST, SECOND]);
  stubThumbnails();

  renderPanel();

  expect(await screen.findByText("2 / 20")).toBeInTheDocument();
}

/** A13 — the heading names the asset the row was opened from. */
export async function theHeadingNamesTheAssetCodeAndName(): Promise<void> {
  stubList([]);
  stubThumbnails();

  renderPanel();

  expect(await screen.findByRole("heading", { name: "Images · TRF-01" })).toBeInTheDocument();
  expect(screen.getByText("Transformer 1")).toBeInTheDocument();
}

/** A14 — Close hands control back to the page; the panel does not close itself. */
export async function closeCallsOnClose(): Promise<void> {
  stubList([]);
  stubThumbnails();
  const onClose = vi.fn();

  renderPanel(onClose);
  await screen.findByText("No images for this asset yet.");
  await userEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(onClose).toHaveBeenCalledTimes(1);
}
