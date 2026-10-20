import { describe, it } from "vitest";

import {
  assertB1TheBoundsArePinned,
  assertB2SixtyFiveKeysAreRefusedInEveryRecord,
  assertB3NestedKeysCount,
  assertB4TheByteBoundIsInclusive,
  assertB5BytesAreUtf8,
  assertB6TheCountCheckCarriesTheRecordBound,
  assertB7AToolWriteIsRefused,
} from "./onboarding-draft-record-bound.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the draft record bound (F4.116)", () => {
  it("B1 pins 64 keys and 8 KB", () => {
    assertB1TheBoundsArePinned();
  });

  it("B2 refuses 65 keys in every record and passes 64", () => {
    assertB2SixtyFiveKeysAreRefusedInEveryRecord();
  });

  it("B3 counts keys at every nesting level", () => {
    assertB3NestedKeysCount();
  });

  it("B4 passes exactly 8,192 bytes and refuses one more", () => {
    assertB4TheByteBoundIsInclusive();
  });

  it("B5 counts UTF-8 bytes", () => {
    assertB5BytesAreUtf8();
  });

  it("B6 draftCountProblem carries the record bound", () => {
    assertB6TheCountCheckCarriesTheRecordBound();
  });

  it("B7 refuses a tool write of an oversized record", () => {
    assertB7AToolWriteIsRefused();
  });
});
