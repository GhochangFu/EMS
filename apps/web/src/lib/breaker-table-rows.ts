import type { RuleListItem } from "@bms/shared";

import type {
  BreakerTableRow,
  BreakerVisualStatus,
} from "../components/control-room/breaker-table";
import type { CrBreakerBinding } from "../components/live-svg/control-room-bindings";
import { freshValue, type SchematicTelemetrySlice, STALE_VALUE } from "./schematic-telemetry";

/** What a page's `derive…RuleState` returns for one breaker. */
export type BreakerRowState = {
  status: BreakerVisualStatus;
  matchedRule: RuleListItem | null;
  /** True when the asset has stopped reporting (ADR 0027). */
  stale: boolean;
};

/**
 * One `BreakerTable` row from a breaker's binding, its slice and the status
 * the page derived for it (`F3.28` task 3.5).
 *
 * The status is taken, not computed: each page's derivation calls `isStale`
 * and the repo invariant scans that call where it is. What this adds is the
 * value gate — ADR 0027 decision 3, a stale breaker's readings are `null` —
 * and the trip cause, which reads `—` while stale, then the matched rule, and
 * the binding's configured cause only for an open breaker.
 */
export function breakerTableRow(
  binding: CrBreakerBinding,
  slice: SchematicTelemetrySlice,
  state: BreakerRowState,
): BreakerTableRow {
  return {
    code: binding.code,
    label: binding.label,
    position: binding.position,
    rating: binding.rating,
    status: state.status,
    current: freshValue(slice.current, state.stale),
    kw: freshValue(slice.kw, state.stale),
    kwhToday: freshValue(slice.kwhToday, state.stale),
    tripCause: state.stale
      ? STALE_VALUE
      : (state.matchedRule?.name ?? (state.status === "open" ? binding.tripCause : "-")),
  };
}
