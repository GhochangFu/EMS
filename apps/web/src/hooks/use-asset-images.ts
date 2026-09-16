import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchAssetImageBlob, fetchAssetImages } from "../api/asset-images";

/**
 * `F3.4` Unit 7 — the two hooks behind the galleries (ADR 0066 decision 4).
 */

/**
 * `GET /api/v1/assets/:assetId/images` (the `use-asset-health.ts` shape).
 *
 * Disabled on an empty `assetId` rather than firing a request that can only
 * 404. **The cost of that, recorded because R-7 does not enumerate it:** a
 * disabled query stays `isPending` with `fetchStatus: "idle"`, so a caller that
 * passes `""` renders the loading sentence and never leaves it. Every caller in
 * this row (the row toggle in U9, the admin panel in U8) mounts the gallery
 * from a row that already has an id, so the state is unreachable there; a
 * future caller that can pass `""` should not mount the gallery at all.
 */
export function useAssetImages(assetId: string) {
  return useQuery({
    queryKey: ["asset-images", assetId],
    queryFn: () => fetchAssetImages(assetId),
    enabled: assetId.length > 0,
  });
}

/** What a thumbnail knows about its bytes. */
export type AssetImageObjectUrl = {
  /** The `blob:` URL, or `null` while loading and after a failure. */
  url: string | null;
  status: "loading" | "ready" | "error";
};

/**
 * Fetches one image's bytes and holds a `blob:` URL for them.
 *
 * **Deliberately not a react-query cache entry.** A cached object URL outlives
 * its revocation: react-query would keep the string after the component that
 * created it unmounted and ran `URL.revokeObjectURL`, and the next mount would
 * hand a revoked URL to an `<img>` that then renders nothing. The lifetime of
 * this value is exactly the lifetime of the effect that created it, which is
 * what `useEffect` + cleanup expresses and a cache does not. The cost is one
 * refetch per mount; the bytes are immutable and the browser's HTTP cache is
 * the layer that should absorb it.
 *
 * The `cancelled` flag covers the unmount-before-resolve race: without it a
 * late resolve creates a URL **after** the cleanup has run, so nothing ever
 * revokes it and `setState` fires on an unmounted tree.
 */
export function useAssetImageObjectUrl(assetId: string, imageId: string): AssetImageObjectUrl {
  const [state, setState] = useState<AssetImageObjectUrl>({ url: null, status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setState({ url: null, status: "loading" });

    fetchAssetImageBlob(assetId, imageId)
      .then((blob) => {
        if (cancelled) {
          return;
        }
        created = URL.createObjectURL(blob);
        setState({ url: created, status: "ready" });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setState({ url: null, status: "error" });
      });

    return () => {
      cancelled = true;
      if (created !== null) {
        URL.revokeObjectURL(created);
      }
    };
  }, [assetId, imageId]);

  return state;
}
