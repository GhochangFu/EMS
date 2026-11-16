import { describe, it } from "vitest";

import {
  aBareAssetIdParamIsCheckedAsAUuid,
  aGoodRefDecodesToItsPair,
  aMalformedRefIsA400FromBoth,
  aNonUuidAssetIdIsA400FromBoth,
  theBoundCountsCodePointsAsPostgresDoes,
  theBoundedOneAloneRefusesAnEmptyOrOverlongKey,
} from "./guarded-point-ref.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4a — the shared guarded point-ref decoder (ADR 0135 Amendment 3 S2)", () => {
  it("a malformed ref is a 400 from both decoders", () => aMalformedRefIsA400FromBoth());
  it("a non-UUID asset id is a 400 from both decoders", () => aNonUuidAssetIdIsA400FromBoth());
  it("a good ref decodes to its pair", () => aGoodRefDecodesToItsPair());
  it("only the bounded decoder refuses an empty or 129-character point key", () =>
    theBoundedOneAloneRefusesAnEmptyOrOverlongKey());
  it("the bound counts code points, as varchar(128) does", () => theBoundCountsCodePointsAsPostgresDoes());
  it("E1.2b: a bare asset-id param is a UUID or a 400", () => aBareAssetIdParamIsCheckedAsAUuid());
});
