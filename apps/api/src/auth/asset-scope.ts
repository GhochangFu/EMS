/**
 * `F3.28` (ADR 0074, plan decision 2, task 1.4) — narrows a caller's readable
 * asset scope by a requested subset, without ever widening it.
 *
 * `readable` is `AccessControlService.readableAssetIds`'s own contract:
 * `null` means unrestricted (a global admin), never "no assets". `requested`
 * is whatever a caller asked for on a query (`assetIdsQueryField`) — absent
 * when they asked for nothing in particular.
 *
 * The result is always the caller's actual scope for the request:
 *
 * - No request, unrestricted reader → still unrestricted (`null`).
 * - No request, a bounded reader → their own bound, untouched.
 * - A request, an unrestricted reader → exactly what they asked for — there
 *   is nothing to narrow against.
 * - A request, a bounded reader → the **intersection**, which can be empty.
 *   An id outside the reader's scope is silently dropped rather than
 *   widening what they can see or raising an error the caller cannot act on
 *   — the route itself decides what an empty result means (an empty list, a
 *   403, or a 200 with nothing in it).
 */
export function intersectReadable(
  readable: readonly string[] | null,
  requested?: readonly string[],
): string[] | null {
  if (requested === undefined) {
    return readable === null ? null : [...readable];
  }
  if (readable === null) {
    return [...requested];
  }
  const readableSet = new Set(readable);
  return requested.filter((id) => readableSet.has(id));
}
