import { describe, it } from "vitest";

import {
  assertACoveredAlarmIsStamped,
  assertAFailingOrganizationDoesNotStopTheNext,
  assertAnIngestHostAlarmIsNeverStamped,
  assertAnUncoveredStampIsLifted,
  assertAQuietFleetCostsOneRead,
  assertARecoveredAlarmTakesTheNewWindow,
  assertOneOfTwoWindowsEndingWritesNothing,
  assertASuppressedAlarmDoesNotEscalate,
  assertASuppressedAlarmsRaiseIsNotReoffered,
  assertASuppressedAlarmClearsSilently,
  assertALiftedAlarmIsSentTheWithheldRaise,
  assertARaiseSentBeforeTheWindowIsNotRepeated,
  assertAnAcknowledgedLiftedAlarmGetsNothing,
  assertTheEscalationClockRestartsAtTheLift,
  assertAStepSentBeforeTheWindowKeepsItsKey,
  assertADeviceAlarmObeysTheStamps,
  assertASuppressedDeviceAlarmClearsSilently,
} from "./alarm-lifecycle-suppression.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One
 * `it()` per case: `assert` throws, so a shared `it()` would hide the case that
 * owns a claim behind an earlier failure.
 */
describe("F4.359 U8 — the sweep stamps and lifts", () => {
  it("1. stamps an active alarm the cover names, with that window, and broadcasts it once", async () => {
    await assertACoveredAlarmIsStamped();
  });

  it("2. lifts a stamped alarm with no cover: unsuppressedAt = now, the window id kept", async () => {
    await assertAnUncoveredStampIsLifted();
  });

  it("3. writes nothing when one of two covering windows ends", async () => {
    await assertOneOfTwoWindowsEndingWritesNothing();
  });

  it("4. reads the cover once and writes nothing on a quiet fleet", async () => {
    await assertAQuietFleetCostsOneRead();
  });

  it("5. a failing organization warns once and the next still lands; its stamp still applies", async () => {
    await assertAFailingOrganizationDoesNotStopTheNext();
  });

  it("6. never stamps an ingest_host alarm", async () => {
    await assertAnIngestHostAlarmIsNeverStamped();
  });

  it("7. a lifted alarm covered again takes the later window's id", async () => {
    await assertARecoveredAlarmTakesTheNewWindow();
  });
});

describe("F4.359 U9 — the phases obey the stamps", () => {
  it("8. a suppressed alarm with a due step sends nothing", async () => {
    await assertASuppressedAlarmDoesNotEscalate();
  });

  it("9. a suppressed alarm with a failed raise row is not re-offered", async () => {
    await assertASuppressedAlarmsRaiseIsNotReoffered();
  });

  it("10. a suppressed alarm clears: the broadcast goes out, no cleared message", async () => {
    await assertASuppressedAlarmClearsSilently();
  });

  it("11. a lifted alarm is sent the withheld raise in the same tick, and only once", async () => {
    await assertALiftedAlarmIsSentTheWithheldRaise();
  });

  it("12. a raise sent before the window is not sent again", async () => {
    await assertARaiseSentBeforeTheWindowIsNotRepeated();
  });

  it("13. an acknowledged lifted alarm gets neither the raise nor a step", async () => {
    await assertAnAcknowledgedLiftedAlarmGetsNothing();
  });

  it("14. the escalation clock restarts at the lift: not due at 14 min, due and not stale at 15", async () => {
    await assertTheEscalationClockRestartsAtTheLift();
  });

  it("15. a step re-offered after the lift keeps the key it was sent under", async () => {
    await assertAStepSentBeforeTheWindowKeepsItsKey();
  });

  it("16. a device alarm obeys the stamps: no escalation while suppressed, the clock from the lift", async () => {
    await assertADeviceAlarmObeysTheStamps();
  });

  it("16b. a suppressed device alarm clears with no cleared message", async () => {
    await assertASuppressedDeviceAlarmClearsSilently();
  });
});
