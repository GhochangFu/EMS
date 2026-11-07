import { expect } from "vitest";

import { editFlagText, heldCopyText } from "./site-layout-replace";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decision 9) — the edit flag's exact sentences. The times are
 * at 10:00 UTC, so the local date is the same day in every zone from UTC-10 to UTC+13.
 */

/** E1 — with the actor (an `admin` or `organization_admin` caller): count, date and "by". */
export function theFlagNamesTheActor(): void {
  expect(
    editFlagText({ count: 3, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: "phe-admin@bms.local" }),
  ).toBe("Edited 3 times since the copy, last on 2026-11-06 by phe-admin@bms.local");
  expect(editFlagText({ count: 1, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: "a@b.c" })).toBe(
    "Edited 1 time since the copy, last on 2026-11-06 by a@b.c",
  );
}

/** E2 — no actor (a `location_admin` gets none; an unknown actor is `null`): no "by". */
export function theFlagOmitsAnAbsentActor(): void {
  expect(editFlagText({ count: 2, lastEditedAt: "2026-11-06T10:00:00.000Z" })).toBe(
    "Edited 2 times since the copy, last on 2026-11-06",
  );
  expect(editFlagText({ count: 2, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: null })).toBe(
    "Edited 2 times since the copy, last on 2026-11-06",
  );
}

/** E3 — no edit row (a copy nobody touched, or no copy): "No recorded edit since the copy". */
export function noEditReadsAsNoRecordedEdit(): void {
  expect(editFlagText({ count: 0, lastEditedAt: null })).toBe("No recorded edit since the copy");
  expect(editFlagText(null)).toBe("No recorded edit since the copy");
}

/** E4 — the held copy in one phrase. */
export function theHeldCopyReadsAsCodeAndVersion(): void {
  const held = { dashboardId: "d", templateId: "t", templateCode: "pump-station-standard", version: 1 };
  expect(heldCopyText(held)).toBe("pump-station-standard v1");
  expect(heldCopyText(null)).toBe("No template copy");
}
