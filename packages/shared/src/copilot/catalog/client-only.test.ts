import { describe, it } from "vitest";

import {
  aBlankValueSetsNothing,
  aDottedPathStripsTheNestedKey,
  anAbsentPathIsANoOp,
  aTopLevelPathStripsTheKey,
  aTypedValueIsSetAtItsPath,
  theObjectOnTheWayIsCreated,
  theStripDoesNotMutateTheBody,
} from "./client-only.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — clientOnly paths, stripped and set by one helper", () => {
  it("a dotted path strips the nested key", () => {
    aDottedPathStripsTheNestedKey();
  });

  it("a top-level path strips the key", () => {
    aTopLevelPathStripsTheKey();
  });

  it("an absent path leaves the body as it was", () => {
    anAbsentPathIsANoOp();
  });

  it("the strip does not mutate the body", () => {
    theStripDoesNotMutateTheBody();
  });

  it("a typed value is set at its nested path", () => {
    aTypedValueIsSetAtItsPath();
  });

  it("the object on the way is created", () => {
    theObjectOnTheWayIsCreated();
  });

  it("a blank value sets nothing", () => {
    aBlankValueSetsNothing();
  });
});
