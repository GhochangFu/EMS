import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { assetImageDtoSchema } from "@bms/shared/contracts";
import type { AssetImageDto } from "@bms/shared";

import * as assetImagesApi from "../../api/asset-images";
import { ApiError } from "../../lib/api-error";
import { AssetImageGallery } from "./asset-image-gallery";

/**
 * `F3.4` Unit 7 — the read-only asset image gallery (ADR 0066 decision 4,
 * R-7's four states).
 *
 * The api module is stubbed with `vi.spyOn` (the `mapping-sheet-panel.spec.tsx`
 * pattern), so nothing here touches `fetch`. Assertions live here;
 * `asset-image-gallery.test.tsx` is the Vitest entry point and carries
 * `@vitest-environment jsdom` (ADR 0014 / ADR 0042 decision 2).
 *
 * ## The object-URL stub, measured rather than assumed
 *
 * The plan (§7) expected `URL.createObjectURL` to be missing under jsdom and
 * asked the builder to try `vi.stubGlobal` first. **It is not missing.** A
 * throwaway probe in this project measured `typeof URL.createObjectURL ===
 * "function"` and `vi.spyOn(URL, "createObjectURL")` succeeding, so neither
 * `vi.stubGlobal` nor an `Object.defineProperty` was needed: the ordinary spy
 * is enough, and `vi.restoreAllMocks()` in the wrapper undoes it.
 *
 * `onboarding.spec.ts:20` is not contradicted — it only says that spec never
 * reaches the call, not that the method is absent.
 *
 * Both spies are re-installed per assert, so `mock.calls.length` is that
 * assert's count and never the lifetime counter AGENTS.md §4.6 forbids.
 */

const ASSET_ID = "11111111-1111-4111-8111-111111111111";

/** A DTO the contract accepts — an off-shape fixture would fail somewhere else. */
function dto(overrides: Partial<AssetImageDto> & Pick<AssetImageDto, "id">): AssetImageDto {
  return assetImageDtoSchema.parse({
    assetId: ASSET_ID,
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

/**
 * Two images that differ on the branch the `alt` is computed from: one has a
 * caption, one does not. With two captioned fixtures the
 * `caption ?? originalFilename` fallback would never be rendered and "the right
 * alts" would prove half of what it claims.
 */
const CAPTIONED = dto({
  id: "22222222-2222-4222-8222-222222222222",
  caption: "Front panel",
  byteSize: 3072,
});
const UNCAPTIONED = dto({
  id: "33333333-3333-4333-8333-333333333333",
  originalFilename: "rear.png",
  caption: null,
});

type ObjectUrlStub = { created: () => number; revoked: () => number };

/**
 * Spies on the real `createObjectURL`/`revokeObjectURL`, replacing the bodies
 * so no jsdom blob store is involved and every URL is identifiable.
 */
function stubObjectUrls(): ObjectUrlStub {
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation(() => `blob:asset-image-${create.mock.calls.length}`);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  return {
    created: () => create.mock.calls.length,
    revoked: () => revoke.mock.calls.length,
  };
}

function renderGallery(props: {
  onDelete?: (image: AssetImageDto) => void;
  deletingIds?: readonly string[];
}): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssetImageGallery assetId={ASSET_ID} {...props} />
    </QueryClientProvider>,
  );
}

/** Every thumbnail answers with the same bytes; the assertions are about the elements. */
function stubBlobReads(): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(assetImagesApi, "fetchAssetImageBlob")
    .mockResolvedValue(new Blob(["x"], { type: "image/png" }));
}

/** A1 — the loading sentence is on screen before the list resolves. */
export async function theLoadingSentenceShowsBeforeTheListResolves(): Promise<void> {
  let release: (value: AssetImageDto[]) => void = () => {};
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockReturnValue(
    new Promise<AssetImageDto[]>((resolve) => {
      release = resolve;
    }),
  );
  stubBlobReads();
  stubObjectUrls();

  renderGallery({});

  expect(screen.getByText("Loading images...")).toBeInTheDocument();
  // Settle the promise so the test does not leave a pending query behind.
  release([]);
  await screen.findByText("No images for this asset yet.");
}

/**
 * A2 — two DTOs render two `<img>` with the right `alt`s, and the content route
 * is read exactly once per image.
 *
 * The blob count is a delta read around the render, not the spy's lifetime
 * total.
 */
export async function twoImagesRenderWithTheirAltsAndOneBlobReadEach(): Promise<void> {
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([CAPTIONED, UNCAPTIONED]);
  const blobs = stubBlobReads();
  stubObjectUrls();
  const before = blobs.mock.calls.length;

  renderGallery({});

  const images = await screen.findAllByRole("img");
  expect(images.map((img) => img.getAttribute("alt"))).toEqual(["Front panel", "rear.png"]);
  expect(blobs.mock.calls.length - before).toBe(2);
}

/**
 * A3 — each cell names its image and its size.
 *
 * Separate from A2 because A2 reads `alt` attributes and this reads text
 * nodes, and because the size string is the one piece of arithmetic in this
 * component (`byteSize / 1024`, one decimal) that no other gate can see:
 * components are outside the coverage `include` (`apps/web/src/lib/**`), and
 * the step-6 browser pass checks the thumbnail's `src` and `naturalWidth`, not
 * this line. Without this row a wrong divisor ships silently.
 *
 * `getByText` matches the label element only — `alt` and `title` are
 * attributes, not text — so the two label assertions are unambiguous. The two
 * fixtures carry different `byteSize` values so one shared number could not
 * satisfy both.
 */
export async function eachCellNamesItsImageAndItsSize(): Promise<void> {
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([CAPTIONED, UNCAPTIONED]);
  stubBlobReads();
  stubObjectUrls();

  renderGallery({});

  expect(await screen.findByText("Front panel")).toBeInTheDocument();
  expect(screen.getByText("rear.png")).toBeInTheDocument();
  expect(screen.getByText("3.0 KB")).toBeInTheDocument();
  expect(screen.getByText("2.0 KB")).toBeInTheDocument();
}

/**
 * A4 — a thumbnail whose bytes cannot be read says so, and renders no `<img>`.
 *
 * The list read succeeds here, so this is the per-image failure and not the
 * gallery-level one A5 and A6 cover. The absent `<img>` matters: an element
 * with a `null` `src` would render a broken-image icon with no words.
 */
export async function aFailedBlobReadRendersTheUnavailableBox(): Promise<void> {
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([CAPTIONED]);
  vi.spyOn(assetImagesApi, "fetchAssetImageBlob").mockRejectedValue(
    new ApiError("Object storage is unreachable", 503),
  );
  stubObjectUrls();

  renderGallery({});

  expect(await screen.findByText("Image unavailable")).toBeInTheDocument();
  expect(screen.queryAllByRole("img")).toHaveLength(0);
}

/**
 * A5 — a 503 renders the API's own sentence, not the generic one.
 *
 * The negative on the neighbour is the point: without it, a component that
 * rendered both sentences would pass.
 */
export async function aFiveOhThreeRendersTheApiSentence(): Promise<void> {
  const body = JSON.stringify({ statusCode: 503, message: "Object storage is unreachable" });
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockRejectedValue(new ApiError(body, 503));
  stubBlobReads();
  stubObjectUrls();

  renderGallery({});

  expect(await screen.findByText("Object storage is unreachable")).toBeInTheDocument();
  expect(screen.queryByText("Images unavailable.")).toBeNull();
}

/** A6 — every other refusal renders the generic sentence. */
export async function aFiveHundredRendersTheGenericSentence(): Promise<void> {
  const body = JSON.stringify({ statusCode: 500, message: "Internal server error" });
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockRejectedValue(new ApiError(body, 500));
  stubBlobReads();
  stubObjectUrls();

  renderGallery({});

  expect(await screen.findByText("Images unavailable.")).toBeInTheDocument();
  expect(screen.queryByText("Internal server error")).toBeNull();
}

/** A7 — an empty list is a sentence, not an empty grid. */
export async function anEmptyListRendersTheEmptySentence(): Promise<void> {
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([]);
  stubBlobReads();
  stubObjectUrls();

  renderGallery({});

  expect(await screen.findByText("No images for this asset yet.")).toBeInTheDocument();
}

/**
 * A8 — without `onDelete` there is no Delete affordance.
 *
 * The two rendered `<img>` are the positive control and are asserted **first**:
 * `expect` throws, so an absence check placed ahead of it would pass on a
 * gallery that rendered nothing at all.
 */
export async function withoutOnDeleteThereIsNoDeleteButton(): Promise<void> {
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([CAPTIONED, UNCAPTIONED]);
  stubBlobReads();
  stubObjectUrls();

  renderGallery({});

  expect(await screen.findAllByRole("img")).toHaveLength(2);
  expect(screen.queryAllByRole("button", { name: "Delete" })).toHaveLength(0);
}

/** A9 — with `onDelete`, pressing Delete hands back that image's DTO. */
export async function withOnDeleteTheButtonPassesTheDto(): Promise<void> {
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([CAPTIONED, UNCAPTIONED]);
  stubBlobReads();
  stubObjectUrls();
  const onDelete = vi.fn();

  renderGallery({ onDelete });

  const buttons = await screen.findAllByRole("button", { name: "Delete" });
  await userEvent.click(buttons[1] as HTMLElement);

  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onDelete).toHaveBeenCalledWith(UNCAPTIONED);
}

/**
 * A10 — an image named in `deletingIds` is disabled and says so; its
 * neighbour is not.
 *
 * The prop is a list since the post-merge sweep (C2): the panel can hold two
 * deletes open at once. One id is passed here, so the neighbour stays the
 * positive control for the membership test.
 */
export async function aMatchingDeletingIdDisablesThatButton(): Promise<void> {
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([CAPTIONED, UNCAPTIONED]);
  stubBlobReads();
  stubObjectUrls();

  renderGallery({ onDelete: vi.fn(), deletingIds: [CAPTIONED.id] });

  const busy = await screen.findByRole("button", { name: "Deleting…" });
  expect(busy).toBeDisabled();
  // The neighbour is the positive control: it proves the sentence and the
  // disabled flag followed `deletingIds`, not the presence of `onDelete`.
  expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
}

/**
 * A11 — unmounting revokes every object URL the gallery created.
 *
 * `created === 2` is asserted **before** the equality, because `0 === 0` is
 * true and would let a gallery that loaded no image at all — or a hook that
 * revokes nothing — pass this row.
 */
export async function unmountRevokesEveryUrlItCreated(): Promise<void> {
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([CAPTIONED, UNCAPTIONED]);
  stubBlobReads();
  const urls = stubObjectUrls();

  const view = renderGallery({});

  await screen.findAllByRole("img");
  await waitFor(() => {
    expect(urls.created()).toBe(2);
  });

  view.unmount();

  expect(urls.revoked()).toBe(urls.created());
}
