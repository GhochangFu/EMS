import { describe, it } from "vitest";

import * as S from "./onboarding-credential-copy.spec";

describe("F4.339 — the credential copy's pure core (ADR 0117 decision 7)", () => {
  it("copies the blob as stored to two targets, each credentialsSet", S.twoTargetsGetTheBlobAsStored);
  it("refuses a held target without replace, naming its code, and changes nothing", S.aHeldTargetRefusesWithoutReplace);
  it("overwrites a held target with replace", S.replaceOverwritesAHeldTarget);
  it("refuses the source as its own target", S.theSourceIsNotATarget);
  it("refuses a target with no distinct code", S.aTargetWithNoDistinctCodeIsRefused);
  it("lets a committed source copy to any draft target", S.aCommittedSourceHasNoSelf);
  it("compares host, port and TLS; tls absent reads as true", S.sameBrokerComparesHostPortAndTls);
  it("takes one source shape, distinct targets and nothing else", S.theBodyTakesOneSourceAndDistinctTargets);
  it("takes an optional draftHash of 64 lowercase hex (Amendment 18 Q3)", S.theBodyTakesAnOptionalDraftHash);
});
