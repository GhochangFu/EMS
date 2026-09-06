// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  keepsTheOperatorsBoxesWhenTheSaveIsRefused,
  listsEveryChannelAndChecksTheJoinedOnes,
  mountsTheEditorOnlyWhenTheCardAsksForIt,
  savesTheWholeSetAndInvalidatesTheJoinQuery,
  saysTheChannelListFailedRatherThanClaimingThereAreNone,
  saysThereAreNoChannelsRatherThanShowingAnEmptyList,
  showsWhatTheServerStoredAfterASuccessfulSave,
} from "./rule-channels-editor.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest reads
 * it from the file it collects (ADR 0042 decision 2).
 */
describe("F3.7 per-rule channel picker", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists every channel and checks the ones already joined to the rule", async () => {
    await listsEveryChannelAndChecksTheJoinedOnes();
  });

  it("saves the whole set and invalidates the rule's join query", async () => {
    await savesTheWholeSetAndInvalidatesTheJoinQuery();
  });

  it("shows what the server stored once a save succeeds", async () => {
    await showsWhatTheServerStoredAfterASuccessfulSave();
  });

  it("says there are no channels to manage instead of showing an empty list", async () => {
    await saysThereAreNoChannelsRatherThanShowingAnEmptyList();
  });

  it("says the channel list failed rather than claiming there are none", async () => {
    await saysTheChannelListFailedRatherThanClaimingThereAreNone();
  });

  it("shows the server's refusal and keeps the boxes the operator set", async () => {
    await keepsTheOperatorsBoxesWhenTheSaveIsRefused();
  });

  it("mounts the editor only when the card's Channels button is pressed", async () => {
    await mountsTheEditorOnlyWhenTheCardAsksForIt();
  });
});
