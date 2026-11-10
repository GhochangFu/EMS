import { describe, it } from "vitest";

import {
  aGatewayCodeIsEncodedAndNoHashLeaks,
  aGatewayLineRenders,
  aRevokedGatewayWithRtusIsNamed,
  gatewaysNeverChangeTheVerdict,
  noGatewaysRendersNothing,
} from "./health-server-gateways.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — gateway lines on the health body (ADR 0123 decision 12)", () => {
  it("renders one line per gateway", () => {
    aGatewayLineRenders();
  });

  it("never changes the header verdict", () => {
    gatewaysNeverChangeTheVerdict();
  });

  it("names a revoked gateway that still has RTUs", () => {
    aRevokedGatewayWithRtusIsNamed();
  });

  it("renders nothing without gateways", () => {
    noGatewaysRendersNothing();
  });

  it("encodes the code and never shows the hash", () => {
    aGatewayCodeIsEncodedAndNoHashLeaks();
  });
});
