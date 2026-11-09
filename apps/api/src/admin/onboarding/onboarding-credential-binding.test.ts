import { describe, it } from "vitest";

import * as S from "./onboarding-credential-binding.spec";

describe("F4.339 review H1 — a copied credential is bound to its broker", () => {
  it("is served only on its broker", S.aBoundBlobIsServedOnlyOnItsBroker);
  it("is dropped by a merge once its RTU names another broker", S.aMergeDropsABlobWhoseBrokerChanged);
  it("leaves an unbound (typed) blob unchanged", S.anUnboundBlobIsUnchanged);
  it("reads a malformed binding as absent", S.aMalformedBindingIsAbsent);
});
