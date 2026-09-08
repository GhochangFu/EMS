// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  distinguishesNoMatchesFromAnEmptyKnowledgeBase,
  explainsAnEmptyKnowledgeBase,
  filtersByClassAlarmCodeAndPhilosophyText,
  groupsClassesByDomainAndNamesTheVersion,
  omitsTheSkillLineWhenNoneIsAuthored,
  rendersForAViewer,
} from "./alarm-kb-page.spec";

/**
 * `E2.2` PR 2 (ADR 0059) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); the jsdom docblock is here because this is the file
 * Vitest collects (ADR 0042 decision 2).
 */
describe("E2.2 — the browsable alarm philosophy KB page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("groups classes by domain and names the version the text comes from", async () => {
    await groupsClassesByDomainAndNamesTheVersion();
  });

  it("filters by class name, alarm code and philosophy text", async () => {
    await filtersByClassAlarmCodeAndPhilosophyText();
  });

  it("explains an empty knowledge base instead of looking broken", async () => {
    await explainsAnEmptyKnowledgeBase();
  });

  it("distinguishes no search matches from an empty knowledge base", async () => {
    await distinguishesNoMatchesFromAnEmptyKnowledgeBase();
  });

  it("renders in full for a viewer (ruling Q0b)", async () => {
    await rendersForAViewer();
  });

  it("omits the skill line when no skill is authored", async () => {
    await omitsTheSkillLineWhenNoneIsAuthored();
  });
});
