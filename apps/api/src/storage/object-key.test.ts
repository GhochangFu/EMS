import { describe, it } from "vitest";

import {
  assertBuildsTheExactKeyForThreeUuids,
  assertBuildsTheReportKeyForTwoUuids,
  assertNonUuidPartIsRefusedWithoutEchoingIt,
  assertNonUuidReportPartIsRefusedWithoutEchoingIt,
  assertObjectKeyErrorNameIsStable,
  INVALID_PART_ROWS,
  INVALID_REPORT_PART_ROWS,
} from "./object-key.spec";

/**
 * F3.3 (ADR 0066 decision 4) — Vitest entry point for the object key
 * builder. Assertions live in the sibling `.spec` (§4.6/ADR 0014); this
 * file only runs them.
 */
describe("F3.3 — buildObjectKey", () => {
  it("builds org/<org>/assets/<asset>/<image> for three uuids", () => {
    assertBuildsTheExactKeyForThreeUuids();
  });

  it.each(INVALID_PART_ROWS)(
    "refuses a non-uuid $part ($value) without echoing it",
    (row) => {
      assertNonUuidPartIsRefusedWithoutEchoingIt(row);
    },
  );

  it("gives ObjectKeyError a stable name", () => {
    assertObjectKeyErrorNameIsStable();
  });
});

describe("ADR 0071 decision 5 — buildReportObjectKey", () => {
  it("builds org/<org>/reports/<fileId> for two uuids", () => {
    assertBuildsTheReportKeyForTwoUuids();
  });

  it.each(INVALID_REPORT_PART_ROWS)(
    "refuses a non-uuid $part ($value) without echoing it",
    (row) => {
      assertNonUuidReportPartIsRefusedWithoutEchoingIt(row);
    },
  );
});
