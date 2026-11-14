import { afterEach, describe, it, vi } from "vitest";

import {
  fetchesTheBillWithAMonth,
  refusesABillOutsideTheContract,
  sendsNoMonthKeyWhenAbsent,
  throwsOnANonOkBill,
} from "./energy-bill.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.365 energy bill web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches GET /locations/:id/energy-bill with the month", async () => {
    await fetchesTheBillWithAMonth();
  });

  it("sends no month key when none is chosen", async () => {
    await sendsNoMonthKeyWhenAbsent();
  });

  it("refuses a bill outside the contract", async () => {
    await refusesABillOutsideTheContract();
  });

  it("throws on a non-OK status", async () => {
    await throwsOnANonOkBill();
  });
});
