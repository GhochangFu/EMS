import { describe, it } from "vitest";

import {
  assertAMovedDeviceMovesTheConfigFingerprint,
  assertCanonicalJsonSortsKeysAtEveryDepth,
  assertKeyOrderDoesNotMoveTheConfigFingerprint,
  assertMqttHasNoConfigFingerprint,
  assertOneChangedRegisterMovesTheConfigFingerprint,
  assertTheConnectionSliceMovesTheConfigFingerprint,
  assertTheMovedFingerprintsKeepTheirShape,
} from "./plan-fingerprints.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — plan fingerprints (ADR 0016 Amendment 10 (a))", () => {
  it("F1 key order does not move the config fingerprint", () => assertKeyOrderDoesNotMoveTheConfigFingerprint());
  it("F2 one changed register moves it", () => assertOneChangedRegisterMovesTheConfigFingerprint());
  it("F3 a changed connection slice moves it", () => assertTheConnectionSliceMovesTheConfigFingerprint());
  it("F4 a slice moved to another device moves it", () => assertAMovedDeviceMovesTheConfigFingerprint());
  it("F5 MQTT has none", () => assertMqttHasNoConfigFingerprint());
  it("F6 canonical JSON sorts keys at every depth", () => assertCanonicalJsonSortsKeysAtEveryDepth());
  it("F7 the moved fingerprints keep their shape", () => assertTheMovedFingerprintsKeepTheirShape());
});
