import { describe, it } from "vitest";

import {
  acceptsASameOriginWallPath,
  dropsTheFragment,
  failsClosedWhenStorageThrows,
  keepsAStoredPathOffAWallUrl,
  peekValidatesAndKeeps,
  readsNothingWithNoStorage,
  refusesABackslash,
  refusesAProtocolRelativePath,
  refusesAPathThatNormalisesToTwoSlashes,
  refusesARawControlCharacter,
  refusesAnAbsoluteOrScriptUrl,
  refusesAnEmptyValue,
  refusesAnEncodedControlCharacter,
  refusesAnotherOriginAfterParsing,
  remembersAWallUrl,
  remembersNothingOffAWallUrl,
  remembersNothingTheGuardRefuses,
  takeReturnsAndRemoves,
  takeRevalidatesOnRead,
} from "./return-path.spec";

/** `F3.77` plan D10 — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.77 the same-origin return path", () => {
  it("R1 accepts a same-origin wall path", () => {
    acceptsASameOriginWallPath();
  });

  it("R2 drops the fragment", () => {
    dropsTheFragment();
  });

  it("R3 refuses an empty value", () => {
    refusesAnEmptyValue();
  });

  it("R4 refuses an absolute or a script URL", () => {
    refusesAnAbsoluteOrScriptUrl();
  });

  it("R5 refuses //evil", () => {
    refusesAProtocolRelativePath();
  });

  it("R6 refuses /\\evil", () => {
    refusesABackslash();
  });

  it("R7 refuses a raw control character", () => {
    refusesARawControlCharacter();
  });

  it("R8 refuses a percent-encoded control character", () => {
    refusesAnEncodedControlCharacter();
  });

  it("R9 refuses a path that normalises to //host", () => {
    refusesAPathThatNormalisesToTwoSlashes();
  });

  it("R10 refuses a path that resolves to another origin", () => {
    refusesAnotherOriginAfterParsing();
  });

  it("R11 remembers a wall URL", () => {
    remembersAWallUrl();
  });

  it("R12 remembers nothing off a wall URL", () => {
    remembersNothingOffAWallUrl();
  });

  it("R12b keeps a stored path when a later 401 lands off the wall URL", () => {
    keepsAStoredPathOffAWallUrl();
  });

  it("R13 remembers nothing the guard refuses", () => {
    remembersNothingTheGuardRefuses();
  });

  it("R14 take returns the path once and removes the key", () => {
    takeReturnsAndRemoves();
  });

  it("R15 take re-validates on read", () => {
    takeRevalidatesOnRead();
  });

  it("R16 peek validates and keeps the key", () => {
    peekValidatesAndKeeps();
  });

  it("R17 fails closed when storage throws", () => {
    failsClosedWhenStorageThrows();
  });

  it("R18 reads nothing with no storage", () => {
    readsNothingWithNoStorage();
  });
});
