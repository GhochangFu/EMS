import { describe, it } from "vitest";

import { theRefusalIsTheOneSentence } from "./assignee.spec";

/** `F4.285` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.285 — the assignee refusal sentence", () => {
  it("is the one sentence for every refusal case", () => theRefusalIsTheOneSentence());
});
