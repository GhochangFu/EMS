import type { CalcWindow, CalcWindowRead } from "./ast";
import { CALC_CALENDAR_WINDOWS, CALC_ROLLING_UNITS, MAX_ROLLING_WINDOW_DAYS, type CalcCalendarWindow } from "./limits";

const CALENDAR: ReadonlySet<string> = new Set(CALC_CALENDAR_WINDOWS);
const ROLLING = /^(\d+)([mhd])$/;
const MAX_ROLLING_MINUTES = MAX_ROLLING_WINDOW_DAYS * CALC_ROLLING_UNITS.d;

/**
 * Reads the SHAPE of a `window` token's text (ADR 0070 decisions 5 and 6;
 * `E4.1b` plan design decision 6). The lexer guarantees one of two forms —
 * an integer glued to `m|h|d`, or a calendar word — and this function turns
 * the first into minutes and the second into its period. The amount and the
 * cap are decided here, not in the lexer, so the parser can name the fault:
 * `"malformed"` is a zero amount (`0h`), `"too_long"` is more than
 * `MAX_ROLLING_WINDOW_DAYS` whatever the unit (`8785h` and `367d` alike). A
 * string that is neither form is `"malformed"` rather than a throw, so a
 * caller outside the parser (the editor's preview) never sees an exception.
 */
export function parseWindowLiteral(text: string): CalcWindow | "malformed" | "too_long" {
  if (CALENDAR.has(text)) {
    return { kind: "calendar", period: text as CalcCalendarWindow };
  }
  const match = ROLLING.exec(text);
  if (match === null) {
    return "malformed";
  }
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof CALC_ROLLING_UNITS;
  if (!Number.isFinite(amount) || amount < 1) {
    return "malformed";
  }
  const minutes = amount * CALC_ROLLING_UNITS[unit];
  if (minutes > MAX_ROLLING_MINUTES) {
    return "too_long";
  }
  return { kind: "rolling", minutes };
}

/**
 * The ONE canonical key for a window read — the `crossRefKey` pattern (ADR
 * 0055 design decision 4, reused). Three consumers build or look up this
 * string and never see each other do it: the parser's `windowReads` dedupe,
 * the evaluator's fifth-map lookup, and the api host that fills that map
 * after it read the aggregates. All three go through this function, so the
 * form is defined exactly once.
 *
 * Forms — the source spelling, with a rolling window normalised to minutes so
 * `24h` and `1440m` over the same point are one read:
 * - `delta({kwh}, today)`      → `delta({kwh}, today)`
 * - `avg({TX_01.kw}, 24h)`     → `avg({TX_01.kw}, 1440m)`
 * - `hours(this_week)`         → `hours(this_week)`
 *
 * Injective by construction: the function name and the window come from the
 * grammar's fixed vocabularies, the point key is quoted by its braces (the
 * lexer admits neither `{` nor `}` inside them), and a `hours` key has no
 * braces at all. `position` is deliberately not part of the key: the same
 * read at two offsets is one input.
 */
export function windowKey(node: CalcWindowRead): string {
  const window = windowLiteralKey(node.window);
  if (node.kind === "hours") {
    return `hours(${window})`;
  }
  const ref = node.ref.kind === "qref" ? `{${node.ref.assetCode}.${node.ref.pointKey}}` : `{${node.ref.pointKey}}`;
  return `${node.fn}(${ref}, ${window})`;
}

function windowLiteralKey(window: CalcWindow): string {
  return window.kind === "rolling" ? `${window.minutes}m` : window.period;
}
