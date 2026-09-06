// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  carriesAJoinedChannelItCannotShowThroughTheSave,
  keepsThePlainCaptionForANotifyRule,
  keepsTheOperatorsBoxesWhenTheSaveIsRefused,
  listsEveryChannelAndChecksTheJoinedOnes,
  mountsTheEditorOnlyWhenTheCardAsksForIt,
  savesTheWholeSetAndInvalidatesTheJoinQuery,
  saysAJoinedChannelGetsNothingWhenTheActionIsNotNotify,
  saysNothingAboutHiddenChannelsWhenThereAreNone,
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

  it("carries a joined channel the list does not show through the save, and names its count", async () => {
    await carriesAJoinedChannelItCannotShowThroughTheSave();
  });

  it("says nothing about hidden channels when every joined one is listed", async () => {
    await saysNothingAboutHiddenChannelsWhenThereAreNone();
  });

  it("says a joined channel receives nothing when the rule's action is not notify", async () => {
    await saysAJoinedChannelGetsNothingWhenTheActionIsNotNotify();
  });

  it("keeps the plain caption for a notify rule", async () => {
    await keepsThePlainCaptionForANotifyRule();
  });
});
