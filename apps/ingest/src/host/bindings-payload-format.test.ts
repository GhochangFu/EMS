import { describe, it } from "vitest";

import {
  aPheRtuPlansAsBefore,
  oneTopicMeansOneFormat,
  theDeviceSliceCarriesTheJoinedFormatOnly,
  theFingerprintFollowsTheDecoder,
  theTopicOwnerWinsAConflict,
  theQueryJoinsTheCatalog,
  unknownAndInvalidFormatsAreSkipped,
} from "./bindings-payload-format.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host binding plan — payload formats (ADR 0116 decision 4)", () => {
  it("P1 joins the catalog on the config's code", () => theQueryJoinsTheCatalog());
  it("P2 carries the joined format, never a stored one", () => theDeviceSliceCarriesTheJoinedFormatOnly());
  it("P3 skips unknown and invalid formats by name", () => unknownAndInvalidFormatsAreSkipped());
  it("P4 allows one format per topic", () => oneTopicMeansOneFormat());
  it("P5 plans a PHE RTU exactly as before", () => aPheRtuPlansAsBefore());
  it("P6 fingerprints the decoder, not names or credentials", () => theFingerprintFollowsTheDecoder());
  it("P7 lets the topic's owner win a conflict, with no borrowed credentials", () => theTopicOwnerWinsAConflict());
});
