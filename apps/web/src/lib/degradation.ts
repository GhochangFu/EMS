import { DEGRADATION_CARD_MAX } from "@bms/shared/contracts";
import type {
  DegradationAsset,
  DegradationIndicator,
  DegradationResponse,
  DegradationScheduleNote,
} from "@bms/shared/contracts";

/**
 * `E1.5b` / ADR 0138 (plan T2.1) — pure helpers over the degradation response. The server orders
 * assets and, inside an asset, indicators (crossing first, nearest first), so these only pick.
 */

/** The web keeps a list for 15 minutes per scope (R-q). */
export const DEGRADATION_STALE_MS = 15 * 60_000;

/** One control-room card row: an asset and its nearest crossing indicator. */
export type DegradationCardRow = {
  readonly asset: DegradationAsset;
  readonly indicator: DegradationIndicator;
};

/** The asset's health indicator when it is crossing, else `undefined`. */
export function healthCrossingOf(asset: DegradationAsset): DegradationIndicator | undefined {
  return asset.indicators.find((i) => i.kind === "health" && i.status === "crossing");
}

/** The first `DEGRADATION_CARD_MAX` assets with a crossing, in the server's order, each with its nearest indicator. */
export function cardRowsOf(response: DegradationResponse): DegradationCardRow[] {
  const rows: DegradationCardRow[] = [];
  for (const asset of response.assets) {
    const indicator = asset.indicators.find((i) => i.status === "crossing");
    if (indicator) {
      rows.push({ asset, indicator });
      if (rows.length === DEGRADATION_CARD_MAX) {
        break;
      }
    }
  }
  return rows;
}

/** `Showing 200 of N assets.` when the server looked at fewer assets than were candidates, else `null`. */
export function shownOfSentence(considered: number, candidates: number): string | null {
  return considered < candidates ? `Showing ${considered} of ${candidates} assets.` : null;
}

/** The schedule note for `scheduleId`, from any asset, else `undefined`. */
export function noteForSchedule(response: DegradationResponse, scheduleId: string): DegradationScheduleNote | undefined {
  for (const asset of response.assets) {
    const note = asset.scheduleNotes.find((n) => n.scheduleId === scheduleId);
    if (note) {
      return note;
    }
  }
  return undefined;
}
