import { describe, it } from "vitest";

import {
  assertAnUnreadAlarmIsDecidedAboutNothingEvenWhenARowCameBack,
  assertNoEvidenceMeansNoChannelRead,
  assertTheGuardReadsTheOrganizationFilteredGroup,
} from "./alarm-lifecycle-raise-retry-evidence-guard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per numbered case, by `F4.105`: `assert` throws, so a single
 * `it()` over three cases stops at the first failure and every later block is
 * decoration a mutation can never redden. That is also why these three are not
 * in `alarm-lifecycle-raise-retry.spec.ts`, whose wrapper is one `it()` over
 * nineteen.
 */
describe("alarm lifecycle: the raise-retry phase reads a rule's channels only for an alarm with evidence", () => {
  it("R20 — spends no channel read on a rule whose only alarm holds no ledger row", async () => {
    await assertNoEvidenceMeansNoChannelRead();
  });

  it("R21 — treats a row stamped with another organization as no evidence at all", async () => {
    await assertTheGuardReadsTheOrganizationFilteredGroup();
  });

  it("R22 — decides nothing about an unread alarm, even when the read returned a row for it", async () => {
    await assertAnUnreadAlarmIsDecidedAboutNothingEvenWhenARowCameBack();
  });
});
