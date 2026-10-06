import { describe, it } from "vitest";

import {
  aRefusedWildcardNeverReachesTheService,
  anOrdinaryTopicReachesTheService,
  createAcceptsAnOrdinaryTopic,
  createRefusesAWildcardTopicWithTheSentence,
  theSentenceNamesBothWildcards,
  updateRefusesAWildcardTopicWithTheSentence,
} from "./rtus.controller.wildcard-topic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6). */
describe("F4.221 — the admin RTU routes refuse an MQTT wildcard topic", () => {
  it("POST answers 400 with the sentence for plant/#", async () => {
    await createRefusesAWildcardTopicWithTheSentence();
  });

  it("PATCH answers 400 with the sentence for plant/+", async () => {
    await updateRefusesAWildcardTopicWithTheSentence();
  });

  it("the sentence names both wildcards", () => {
    theSentenceNamesBothWildcards();
  });

  it("a refused wildcard never reaches the service", async () => {
    await aRefusedWildcardNeverReachesTheService();
  });

  it("PATCH with an ordinary topic reaches the service once", async () => {
    await anOrdinaryTopicReachesTheService();
  });

  it("POST with an ordinary topic reaches the service once", async () => {
    await createAcceptsAnOrdinaryTopic();
  });
});
