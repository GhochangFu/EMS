import { describe, it } from "vitest";

import {
  assetsKeyIsRefused,
  capitalisedAssetsKeyIsRefused,
  keyLengthBoundIs64,
  ordinaryKeyIsAccepted,
  reservedKeysAndCapArePinned,
} from "./dashboard-tabs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 — the dashboard tab key", () => {
  it("refuses the reserved key assets", () => {
    assetsKeyIsRefused();
  });

  it("refuses Assets, so a capital does not dodge the reservation", () => {
    capitalisedAssetsKeyIsRefused();
  });

  it("accepts an ordinary slug", () => {
    ordinaryKeyIsAccepted();
  });

  it("bounds the key at 64 characters and refuses the empty key", () => {
    keyLengthBoundIs64();
  });

  it("reserves only assets and caps a dashboard at 8 tabs", () => {
    reservedKeysAndCapArePinned();
  });
});
