import { Injectable } from "@nestjs/common";

import type { CalcRuntimeSkipReason } from "../observability/metrics.service";
import { defKey } from "./calc-batch";

/** What the engine did with one formula instance the last time it reached it. */
export type CalcRuntimeOutcome = "written" | "skipped";

/**
 * One formula instance's last evaluation outcome.
 *
 * `atMs` is the **evaluation** time — the sweep's own `nowMs`, or the streaming
 * batch's — and deliberately not the value's stored timestamp, which is
 * bucketed (ADR 0037 decision 8) and can be several seconds earlier. The pill
 * this feeds answers "when did the engine last look at this point", and a
 * bucketed time would answer a different question with the same number.
 *
 * `outcome: "written"` therefore means "this formula produced a value on that
 * pass", not "the row is in the database": both hosts batch their writes and
 * `writeValues` runs after the loop, so a write that throws leaves the entry
 * saying `written`. That is the honest reading of a per-formula record — the
 * write failure is one batch-level event, is logged, and is not this map's
 * subject.
 */
export interface CalcRuntimeStatus {
  readonly outcome: CalcRuntimeOutcome;
  /** Always `null` when `outcome` is `"written"`. */
  readonly reason: CalcRuntimeSkipReason | null;
  readonly atMs: number;
}

/**
 * The last outcome per formula instance, for the per-asset calc-points page
 * (`F2.9` Task 16 — ADR 0055 decision 8, plan design decision 9, layer 3).
 *
 * Layers 1 and 2 — `bms_api_calc_skipped_total{reason=…}` and the transition
 * `warn` — say *that* something was refused and how often. Neither says which
 * asset's point it was, and an operator who has just moved an asset into a
 * group looks at that asset, not at Prometheus. This map is what lets
 * `GET /admin/assets/:assetId/calc-points` answer for one point.
 *
 * ## This registry is in-process, and that is a limit, not an implementation detail
 *
 * There is no shared store behind it. A multi-instance API answers the read
 * from whichever instance served the HTTP request, which may not be the one
 * that ran the sweep — so the page can show `null` for a point that is being
 * computed every tick on a sibling instance, or a stale outcome from before the
 * last sweep elsewhere. It is empty after a restart for the same reason.
 *
 * That is acceptable **because this is an operator hint and nothing else**. It
 * is not an audit trail, nothing branches on it, and no refusal depends on it:
 * the authoritative records of a refusal are the counter (layer 1) and the log
 * (layer 2), both of which every instance emits. Anything that must be
 * authoritative across instances needs a real store, and must not be built on
 * this.
 *
 * ## Bounded by the estate, not by time
 *
 * One entry per `(assetId, templatePointId)` pair, last write wins — so the map
 * is bounded by the number of formula instances in the estate, the same set the
 * sweep already walks every tick. There is deliberately no eviction: a point
 * whose entry aged out would read `null`, which means "never evaluated", and
 * losing the difference between "not evaluated" and "not evaluated recently" is
 * exactly what this exists to show.
 */
@Injectable()
export class CalcStatusRegistry {
  /**
   * Keyed by {@link defKey}, never by `templatePointId` alone: one published
   * template is instantiated on many assets and each is a separate formula
   * instance, so a bare template point id would make the first asset written
   * answer for every other asset sharing it.
   */
  private readonly latest = new Map<string, CalcRuntimeStatus>();

  /** Records this pass's outcome, replacing whatever the previous pass left. */
  record(assetId: string, templatePointId: string, status: CalcRuntimeStatus): void {
    this.latest.set(defKey(assetId, templatePointId), status);
  }

  /** The last recorded outcome, or `null` when this process has not evaluated it. */
  get(assetId: string, templatePointId: string): CalcRuntimeStatus | null {
    return this.latest.get(defKey(assetId, templatePointId)) ?? null;
  }
}
