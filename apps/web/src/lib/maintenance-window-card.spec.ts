import { expect } from "vitest";

import { maintenanceWindowCardShown } from "./maintenance-window-card";
import { localTime } from "./maintenance-window-time";

/** `F4.362` leftover 1 — the card's `shown` rows. Vitest entry point: the sibling `.test.ts`. */

const END = "2026-11-14T06:31:00.000Z";

/** Another entry gets no rows, whatever its body holds. */
export function anotherEntryGetsNoRows(): void {
  expect(maintenanceWindowCardShown("location.update", { endsAt: END, targetLabels: ["A"] })).toEqual({});
}

/** Times say local; a time that is not one, and labels that are not strings, keep their raw rows. */
export function onlyValidValuesAreReplaced(): void {
  expect(maintenanceWindowCardShown("maintenanceWindow.create", { startsAt: END, endsAt: "soon", targetLabels: ["A", 2] })).toEqual({
    startsAt: { label: "Start", after: localTime(END) },
  });
  expect(maintenanceWindowCardShown("maintenanceWindow.create", { targetLabels: [] })).toEqual({});
}

/** An extend's new end says local; no "Now" is invented. */
export function anExtendSaysItsNewEndOnly(): void {
  const later = "2026-11-14T10:00:00.000Z";
  expect(maintenanceWindowCardShown("maintenanceWindow.extend", { endsAt: later })).toEqual({
    endsAt: { label: "End", after: localTime(later) },
  });
}
