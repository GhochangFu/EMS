import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, vi } from "vitest";

import { assetImageDtoSchema } from "@bms/shared/contracts";
import type { AssetImageDto } from "@bms/shared";

import * as assetImagesApi from "../../api/asset-images";
import { AssetImagesRow, AssetImagesToggleButton } from "./asset-images-row-toggle";

/**
 * `F3.4` Unit 9 — the reader's "Images" row toggle (owner ruling Q-1, option A).
 *
 * Assertions live here; `asset-images-row-toggle.test.tsx` is the Vitest entry
 * point and carries `@vitest-environment jsdom` (ADR 0014 / ADR 0042
 * decision 2).
 *
 * ## What this file gates, and what it deliberately does not
 *
 * The two exports are a **pair**, because a `<tr>` cannot contain a sibling
 * `<tr>` from inside one of its cells: the button goes in the asset row's first
 * cell, the gallery row is a second `<tr>` after it. The open id is therefore
 * the parent's state, and the harness below reproduces exactly the three lines
 * `location-dashboard-page.tsx` uses to hold it. That the **page** wires those
 * three lines is asserted in `pages/location-dashboard-page.spec.tsx`; this
 * file would pass on a page that never rendered either export.
 *
 * ## Laziness is the claim, and it is measured as a delta
 *
 * Q-1 asks for a page of 50 assets to issue **no** image request until a reader
 * asks for one. That is `AssetImagesRow` returning `null` while closed, so the
 * gallery — and with it `useAssetImages` — never mounts. Every count below is
 * read around the interaction, never as the spy's lifetime total (§4.6), and
 * every absence row asserts its positive control first, because `expect` throws
 * and an absence check placed ahead of one passes on a tree that rendered
 * nothing at all.
 *
 * The blob read and `URL.createObjectURL` are stubbed the way
 * `asset-image-gallery.spec.tsx` stubs them: without the blob stub a thumbnail
 * attempts a real `fetch`, renders "Image unavailable" and the `<img>` count is
 * 0 — a failure that looks like a toggle bug and is not one.
 */

const ASSET_ID = "11111111-1111-4111-8111-111111111111";

/** A DTO the contract accepts — an off-shape fixture would fail somewhere else. */
const IMAGE: AssetImageDto = assetImageDtoSchema.parse({
  id: "22222222-2222-4222-8222-222222222222",
  assetId: ASSET_ID,
  contentType: "image/png",
  byteSize: 2048,
  sha256: "a".repeat(64),
  originalFilename: "panel.png",
  caption: "Front panel",
  createdBy: null,
  createdAt: "2026-09-16T10:00:00.000Z",
});

/**
 * The harness holds the open id exactly as the page does: one id, not a set,
 * and the same press-again-to-close reducer.
 */
function Harness(): JSX.Element {
  const [openImagesFor, setOpenImagesFor] = useState<string | null>(null);

  return (
    <table>
      <tbody>
        <tr>
          <td>
            <AssetImagesToggleButton
              assetId={ASSET_ID}
              open={openImagesFor === ASSET_ID}
              onToggle={(id) => setOpenImagesFor((current) => (current === id ? null : id))}
            />
          </td>
        </tr>
        <AssetImagesRow assetId={ASSET_ID} colSpan={1} open={openImagesFor === ASSET_ID} />
      </tbody>
    </table>
  );
}

function renderHarness(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

/** Every thumbnail answers with the same bytes; the assertions are about the elements. */
function stubGalleryReads(images: AssetImageDto[]): ReturnType<typeof vi.spyOn> {
  const list = vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue(images);
  vi.spyOn(assetImagesApi, "fetchAssetImageBlob").mockResolvedValue(
    new Blob(["x"], { type: "image/png" }),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:asset-image-1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  return list;
}

function pressImages(): Promise<void> {
  return userEvent.click(screen.getByRole("button", { name: "Images" }));
}

/**
 * T1 — a closed row fetches nothing.
 *
 * The rendered button is the positive control and is asserted **first**: a
 * count of 0 is also what a harness that rendered no toggle at all would
 * report.
 */
export async function nothingIsFetchedBeforeTheToggleIsPressed(): Promise<void> {
  const list = stubGalleryReads([]);
  const before = list.mock.calls.length;

  renderHarness();

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Images" })).toBeInTheDocument();
  });
  expect(list.mock.calls.length - before).toBe(0);
}

/**
 * T2 — pressing it lists **that** asset's images exactly once.
 *
 * The delta and the argument are one claim, not two: a count of 1 is satisfied
 * by a gallery mounted for some other row's id, which is the wiring mistake
 * this row exists to catch.
 */
export async function pressingTheToggleListsThatAssetsImagesOnce(): Promise<void> {
  const list = stubGalleryReads([]);
  const before = list.mock.calls.length;

  renderHarness();
  await pressImages();

  await waitFor(() => {
    expect(list.mock.calls.length - before).toBe(1);
  });
  expect(list).toHaveBeenCalledWith(ASSET_ID);
}

/** T3 — the gallery itself is on screen after the press, in its own row. */
export async function pressingTheToggleShowsTheGallery(): Promise<void> {
  stubGalleryReads([]);

  renderHarness();
  await pressImages();

  expect(await screen.findByText("No images for this asset yet.")).toBeInTheDocument();
}

/**
 * T4 — a reader sees the image and no way to delete it (Q-0: the reader surface
 * passes no `onDelete`).
 *
 * The `<img>` is the positive control and is asserted **first**. Without it the
 * row passes on a gallery that rendered nothing, which is precisely the state
 * an unstubbed blob read produces.
 */
export async function theReaderSeesTheImageAndNoDeleteButton(): Promise<void> {
  stubGalleryReads([IMAGE]);

  renderHarness();
  await pressImages();

  expect(await screen.findAllByRole("img")).toHaveLength(1);
  expect(screen.queryAllByRole("button", { name: "Delete" })).toHaveLength(0);
}

/**
 * T5 — a second press takes the gallery row away.
 *
 * The sentence after the first press is the positive control and is asserted
 * **first**, so a toggle that never opened cannot satisfy the absence.
 */
export async function aSecondPressHidesTheGalleryRow(): Promise<void> {
  stubGalleryReads([]);

  renderHarness();
  await pressImages();
  const opened = await screen.findByText("No images for this asset yet.");
  expect(opened).toBeInTheDocument();

  await pressImages();

  expect(screen.queryByText("No images for this asset yet.")).toBeNull();
}
