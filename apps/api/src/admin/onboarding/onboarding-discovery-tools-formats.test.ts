import { describe, it } from "vitest";

import {
  addRtuCopiesTheDiscoveredFormat,
  theDevicesPageCarriesTheFormat,
  theEmptyResultSaysHowManyArrived,
} from "./onboarding-discovery-tools-formats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 / F4.335 — the discovery tools and payload formats (ADR 0116 decision 8)", () => {
  it("T1 says how many messages arrived when no device decoded (F4.335)", async () => theEmptyResultSaysHowManyArrived());
  it("T2 names each device's payload format on the devices page", async () => theDevicesPageCarriesTheFormat());
  it("T3 copies a discovered device's format onto add_rtu", async () => addRtuCopiesTheDiscoveredFormat());
});
