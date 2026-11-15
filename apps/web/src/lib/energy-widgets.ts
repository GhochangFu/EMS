/**
 * `F4.375` (ADR 0133 Amendment 2 ruling 2, plan U5, D8, rulings Q2–Q5) — which widgets a site
 * with no energy shown does not draw, and how a row of tiles closes the gap they leave.
 *
 * **The predicate (D8, Q2).** A widget is *kW-only* when the list of point keys it binds — each
 * point's `pointKey`, and each catalog source's `params.pointKey` when that is a string — is
 * **not empty** and every entry is exactly {@link KW_POINT_KEY}. A source with no string
 * `pointKey` parameter counts as "not kW". The not-empty guard matters: `every` over an empty
 * list is `true`, and a mimic, trend strip, alarm rail or legend binds nothing. Exact match keeps
 * `it_kw`, `site_kw`, `kwh_today` drawn. "Energy shown" is itself defined by `kw` (ADR 0133
 * decision 2), so a hidden widget never had fresh data to show.
 *
 * Nothing stored changes: the site page and its wall filter at render; the Dashboards viewer and
 * the builder draw every widget (Q3).
 */

/** The one point key the predicate counts. */
export const KW_POINT_KEY = "kw";

/** True when `pointKeys` is not empty and every entry is exactly `kw`. */
export function isKwOnly(pointKeys: readonly (string | null)[]): boolean {
  return pointKeys.length > 0 && pointKeys.every((key) => key === KW_POINT_KEY);
}

/** A dashboard widget's bound point keys: its points', then its sources' string `params.pointKey` (else `null`). */
export function widgetPointKeys(widget: {
  readonly points: readonly { readonly pointKey: string }[];
  readonly sources: readonly { readonly params: Readonly<Record<string, string | number | boolean>> }[];
}): (string | null)[] {
  return [
    ...widget.points.map((point) => point.pointKey),
    ...widget.sources.map((source) => (typeof source.params.pointKey === "string" ? source.params.pointKey : null)),
  ];
}

/** An organization strip tile's bound point keys: each source's `pointKey` (Q5). */
export function stripTilePointKeys(tile: { readonly sources: readonly { readonly pointKey: string | null }[] }): (string | null)[] {
  return tile.sources.map((source) => source.pointKey);
}

/** The grid fields the gap rule reads. */
export interface EnergyGridTile {
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
}

/**
 * Drops the tiles `isHidden` names when energy is not shown, and closes each gap **inside a
 * uniform row** (Q4): when every tile whose rows overlap a hidden tile's rows has that tile's
 * `gridY` and `gridH`, and no drawn tile still covers its columns, the tiles of the row wholly to
 * its right move left by its width (two gaps add up). Any other arrangement is left as stored, so
 * a hole may remain, but a tile is never moved onto another one. With energy shown, or nothing to hide,
 * the same array comes back.
 */
export function visibleTiles<T extends EnergyGridTile>(
  tiles: readonly T[],
  energyShown: boolean,
  isHidden: (tile: T) => boolean,
): { tiles: readonly T[]; hidden: number } {
  if (energyShown) return { tiles, hidden: 0 };
  const hidden = tiles.filter(isHidden);
  if (hidden.length === 0) return { tiles, hidden: 0 };

  const shift = new Map<T, number>();
  for (const gap of hidden) {
    const overlapping = tiles.filter((t) => t.gridY < gap.gridY + gap.gridH && gap.gridY < t.gridY + t.gridH);
    const uniform = overlapping.every((t) => t.gridY === gap.gridY && t.gridH === gap.gridH);
    // A drawn tile still covering the gap's columns: the gap is not a hole, so nothing moves.
    const covered = overlapping.some(
      (t) => !isHidden(t) && t.gridX < gap.gridX + gap.gridW && gap.gridX < t.gridX + t.gridW,
    );
    if (!uniform || covered) continue;
    for (const t of overlapping) {
      if (t.gridX >= gap.gridX + gap.gridW) shift.set(t, (shift.get(t) ?? 0) + gap.gridW);
    }
  }
  const kept = tiles
    .filter((t) => !isHidden(t))
    .map((t) => {
      const by = shift.get(t) ?? 0;
      return by === 0 ? t : { ...t, gridX: t.gridX - by };
    });
  return { tiles: kept, hidden: hidden.length };
}
