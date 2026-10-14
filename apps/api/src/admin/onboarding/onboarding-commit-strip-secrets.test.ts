import { describe, it } from "vitest";

import {
  assertAKeyedCommitWithABlobProceeds,
  assertAnUnkeyedCommitWithABlobIsRefused,
  assertAnUnkeyedCommitWithoutABlobProceeds,
  assertTheCommittedUpdateStripsTheDraftSecrets,
} from "./onboarding-commit-strip-secrets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.258 — the onboarding commit strips the draft's encrypted credentials", () => {
  it("S1 — the update that marks the session committed sets draft to draft - '_secrets'", async () => {
    await assertTheCommittedUpdateStripsTheDraftSecrets();
  });

  it("S2 — with no key loaded, a draft with an RTU credential is refused 503 before the transaction", async () => {
    await assertAnUnkeyedCommitWithABlobIsRefused();
  });

  it("S3 — with no key loaded, a draft with no RTU credential reaches the transaction", async () => {
    await assertAnUnkeyedCommitWithoutABlobProceeds();
  });

  it("S4 — with a key loaded, a draft with an RTU credential reaches the transaction", async () => {
    await assertAKeyedCommitWithABlobProceeds();
  });
});
