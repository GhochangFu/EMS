import { expect } from "vitest";

import { mimicMiddleCut } from "./mimic";
import {
  BREAKER_PILL,
  FANOUT_BAND,
  FANOUT_ROOMY_MAX,
  FANOUT_ROW_SIZES,
  breakerLook,
  fanOutRows,
  fanOutSwitchX,
} from "./mimic-breaker";

/**
 * `F3.80` / ADR 0101 d10, d11 — the pill text and the look of the two flow tones. `flowing` takes
 * the `closed` look and `shut` the `open` look by mapping; `BreakerLook` gains no key.
 *
 * Assertions live here; `mimic-breaker.test.ts` is the vitest entry point (ADR 0014). One claim
 * per exported function.
 */

/** A flowing valve or damper reads OPEN — the plant word for a passing valve. */
export function flowingPillIsOpen(): void {
  expect(BREAKER_PILL.flowing).toBe("OPEN");
}

/** A shut valve or damper reads SHUT. */
export function shutPillIsShut(): void {
  expect(BREAKER_PILL.shut).toBe("SHUT");
}

/** The breaker pills are byte-identical to `F3.74`'s. */
export function theBreakerPillsAreUnchanged(): void {
  expect({
    closed: BREAKER_PILL.closed,
    open: BREAKER_PILL.open,
    tripped: BREAKER_PILL.tripped,
    offline: BREAKER_PILL.offline,
    unknown: BREAKER_PILL.unknown,
  }).toEqual({ closed: "CLOSED", open: "OPEN", tripped: "TRIPPED", offline: "OFFLINE", unknown: "—" });
}

/** `shut` outranks the alarm tone, as `open` does, and draws the `open` look. */
export function shutWithACriticalAlarmLooksOpen(): void {
  expect(breakerLook("shut", "critical")).toBe("open");
}

/** `flowing` yields to the alarm tone, as `closed` does. */
export function flowingWithAWarningLooksWarning(): void {
  expect(breakerLook("flowing", "warning")).toBe("warning");
}

/** `flowing` with no alarm draws the `closed` look (there is no `flowing` look). */
export function flowingWithNoAlarmLooksClosed(): void {
  expect(breakerLook("flowing", null)).toBe("closed");
}

/**
 * `F4.322` M1 (owner ruling 2026-11-07) — a long code is cut in the MIDDLE: the head and the tail
 * stay, so the train number shows. Short and exact-length codes are unchanged; the cut counts code
 * points, so it never splits a surrogate pair.
 */
export function aLongCodeIsCutInTheMiddle(): void {
  expect(mimicMiddleCut("PHE-PUMP-M-000000004", 17)).toBe("PHE-PUMP…00000004");
  expect(mimicMiddleCut("PHE-AIRSP1051M-000000004", 17)).toBe("PHE-AIRS…00000004");
  expect(mimicMiddleCut("PHE-PUMP-M-000000004", 18)).toBe("PHE-PUMP-…00000004");
  expect(mimicMiddleCut("CR-Q6", 9)).toBe("CR-Q6");
  expect(mimicMiddleCut("PHE-MFM-000000005", 17)).toBe("PHE-MFM-000000005");
  expect(mimicMiddleCut("\u{1F600}\u{1F600}\u{1F600}\u{1F600}", 3)).toBe("\u{1F600}…\u{1F600}");
  expect(mimicMiddleCut("abc", 1)).toBe("…");
}

/**
 * `F4.322` M2 — up to `FANOUT_ROOMY_MAX` members the rows are roomy (24 tall), and four of them end
 * exactly at the dense band's foot, so no unit or slot moves. Five or more stay dense (12 tall,
 * eight to a column). Mutation: `<=` -> `<` on the roomy test => four members dense => red.
 */
export function upToFourMembersDrawRoomyRowsInTheSameBand(): void {
  const two = fanOutRows(2, 2, 200).rows;
  expect(two.map((r) => [r.y, r.size.rowH])).toEqual([
    [136, 24],
    [160, 24],
  ]);
  const four = fanOutRows(FANOUT_ROOMY_MAX, FANOUT_ROOMY_MAX, 200).rows;
  expect(four.every((r) => r.size === FANOUT_ROW_SIZES.roomy)).toBe(true);
  const last = four[3];
  expect(last === undefined ? NaN : last.y + last.size.rowH).toBe(FANOUT_BAND.top + FANOUT_BAND.perColumn * FANOUT_BAND.rowH);
  const five = fanOutRows(5, 5, 200).rows;
  expect(five.map((r) => r.y)).toEqual([136, 148, 160, 172, 184]);
  expect(five.every((r) => r.size === FANOUT_ROW_SIZES.dense)).toBe(true);
  const nine = fanOutRows(9, 9, 200).rows;
  expect(nine.map((r) => r.x)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 100]);
  expect(FANOUT_ROW_SIZES.roomy).toMatchObject({ codeWide: 12, text: 10, switchSize: 14 });
  expect(FANOUT_ROW_SIZES.dense).toMatchObject({ rowH: 12, codeWide: 9, text: 7.5, switchSize: 10 });
}

/**
 * `F4.322` M3 — the switch sits right of the widest code the row draws and left of the room kept
 * for a 7-character pill, on a roomy 200-wide PHE row and on dense 200- and 100-wide rows. It was
 * `0.58 w - 5`, which a 17-character roomy code (about 130 units) would run under. The bounds reuse
 * the 0.62 estimate, so this holds the formula, not real glyph widths: the clip (R3) holds those.
 */
export function theSwitchClearsTheCodeAndThePill(): void {
  const { roomy, dense } = FANOUT_ROW_SIZES;
  const cases = [
    { w: 200, size: roomy, font: roomy.codeWide, chars: roomy.charsWide },
    { w: 200, size: dense, font: dense.codeWide, chars: dense.charsWide },
    { w: 100, size: dense, font: dense.codeNarrow, chars: dense.charsNarrow },
  ];
  for (const { w, size, font, chars } of cases) {
    const x = fanOutSwitchX(w, size);
    const codeEnd = 4 + chars * font * 0.62;
    const pillStart = w - 4 - 7 * size.text * 0.62;
    expect(x, `w ${w} rowH ${size.rowH}: switch left edge`).toBeGreaterThanOrEqual(codeEnd);
    expect(x + size.switchSize, `w ${w} rowH ${size.rowH}: switch right edge`).toBeLessThanOrEqual(pillStart);
  }
}
