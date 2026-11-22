import { describe, it } from "vitest";

import {
  assertABitTableTakesBoolOnly,
  assertADeviceProfileCodeAndVersionAreBounded,
  assertADeviceProfileNamesItsSource,
  assertADeviceProfileParses,
  assertADuplicateSourceKeyIsRefusedAtTheSecondIndex,
  assertAMultiWordRegisterEndsByAddress65535,
  assertAddressIsZeroTo65535,
  assertConnectionBounds,
  assertConnectionDefaults,
  assertRegisterOtherDefaults,
  assertRegisterWordOrderDefaultsToBig,
  assertScaleAndOffsetAreFinite,
  assertTheDeviceCarriesProfileProvenance,
  assertTheDraftAllowsAnIntervalAndNoRegisters,
  assertTheDraftAppliesTheIngestRules,
  assertTheHostIsOneLowerCasedName,
  assertTheListHoldsOneTo256Registers,
  assertUnitIdIsZeroTo247Or255,
  assertNoMessageEchoesTheRefusedValue,
  assertTheHostHasOneCanonicalSpelling,
  assertUnknownKeysAreRefused,
  assertTheDraftMayNameAProfileById,
  assertAProfileNeedsAUnitId,
  assertAProfileExcludesRegistersAndProvenance,
  assertTheProfileIssuesEchoNoValue,
} from "./ingest-modbus.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — Modbus schemas (ADR 0141 decisions 5, 6, 7, 12)", () => {
  it("M1 defaults wordOrder to big", () => assertRegisterWordOrderDefaultsToBig());
  it("M2 defaults byteSwap, scale and offset", () => assertRegisterOtherDefaults());
  it("M3 defaults port, timeoutMs and interRequestDelayMs", () => assertConnectionDefaults());
  it("M4 bounds the address to 0-65535", () => assertAddressIsZeroTo65535());
  it("M5 allows only bool on a coil or discrete table", () => assertABitTableTakesBoolOnly());
  it("M6 requires a finite scale and offset", () => assertScaleAndOffsetAreFinite());
  it("M7 refuses a duplicate sourceKey at the second index", () =>
    assertADuplicateSourceKeyIsRefusedAtTheSecondIndex());
  it("M8 holds 1 to 256 registers", () => assertTheListHoldsOneTo256Registers());
  it("M9 refuses unknown keys", () => assertUnknownKeysAreRefused());
  it("M10 lower-cases the host and refuses a slash or whitespace", () => assertTheHostIsOneLowerCasedName());
  it("M11 bounds port, timeoutMs and interRequestDelayMs", () => assertConnectionBounds());
  it("M12 accepts unit id 0-247 or 255 (Amendment 1 (a))", () => assertUnitIdIsZeroTo247Or255());
  it("M13 carries profile provenance on the device", () => assertTheDeviceCarriesProfileProvenance());
  it("M14 lets a draft carry an interval and no registers", () => assertTheDraftAllowsAnIntervalAndNoRegisters());
  it("M19 refuses a register whose words run past address 65535", () => assertAMultiWordRegisterEndsByAddress65535());
  it("M18 applies the ingest rules to a draft", () => assertTheDraftAppliesTheIngestRules());
  it("M15 parses a device profile", () => assertADeviceProfileParses());
  it("M16 requires the profile's source document, revision and pages", () => assertADeviceProfileNamesItsSource());
  it("M17 bounds a profile's code and version", () => assertADeviceProfileCodeAndVersionAreBounded());
  it("M20 echoes no refused value in an issue message", () => assertNoMessageEchoesTheRefusedValue());
  it("M21 stores one canonical spelling of a host (PR 7 review M1)", () => assertTheHostHasOneCanonicalSpelling());
  // Plan PR 11 (ADR 0141 Amendment 1 (f), decision 23): onboarding binds a profile.
  it("M22 lets a draft name a device profile by id", () => assertTheDraftMayNameAProfileById());
  it("M23 requires a unit id beside a profile", () => assertAProfileNeedsAUnitId());
  it("M24 refuses a profile beside registers or a provenance", () => assertAProfileExcludesRegistersAndProvenance());
  it("M25 echoes no value in a profile issue", () => assertTheProfileIssuesEchoNoValue());
});
