// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aReadOnlyRoleSeesNoWriteControls,
  aRefusedAddShowsTheSentence,
  aRefusedRemoveShowsTheSentence,
  aRefusedRoleWriteShowsTheSentence,
  aRefusedSaveShowsTheSentence,
  addSendsTheAssetId,
  anEmptyVocabularyRendersNoRolesOfItsOwn,
  cancellingMemberRemoveSendsNothing,
  changingTheFilterClosesTheMemberRemoveDialog,
  pickingAnotherGroupClosesTheMemberRemoveDialog,
  confirmingMemberRemoveSendsOneRequest,
  choosingAnOrganizationStaysOnTheScreen,
  createAtAnotherLocationMovesTheFilterThere,
  createSendsTheSelectedLocation,
  editNeverSendsCode,
  pickerListsOnlyTheGroupsLocation,
  removeInvalidatesTheMembersQuery,
  rendersMembersInServerOrder,
  rolesComeFromTheVocabularyFetch,
  sendsTheCodeAndClearsWithNull,
  showsHowManyMembersCarryEachRole,
  showsTheServerRefusal,
  theOtherRowsKeepTheirName,
  theRowBeingRemovedAnnouncesIt,
  aFillFillsTheNamedStepOnly,
  aLocationPickedFirstStays,
  aNameOnlyEditLeavesTheStoredDomain,
  aRolePickWaitsForTheReview,
  anUnpickedAssetHoldsTheMemberStep,
  anUnpickedLocationHoldsTheBasicsStep,
  createStepsAreBasicsDetailsReview,
  theAddReviewNamesThePickedRole,
  theEditReviewShowsNowBesideAfter,
  theEditReviewShowsTheStoredDomain,
  theRemoveReviewIsTheRedCard,
  theWizardsSendNoCopilotHeader,
} from "./asset-groups-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2). The project
 * default stays `node`.
 */
describe("F3.37 asset groups page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("builds the role options from the vocabulary fetch, never a hardcoded list", async () => {
    await rolesComeFromTheVocabularyFetch();
  });

  it("renders no role of its own when the vocabulary comes back empty", async () => {
    await anEmptyVocabularyRendersNoRolesOfItsOwn();
  });

  it("renders members in the order the server sent them", async () => {
    await rendersMembersInServerOrder();
  });

  it("shows how many members carry each role", async () => {
    await showsHowManyMembersCarryEachRole();
  });

  it("sends the role code, and an explicit null to clear it", async () => {
    await sendsTheCodeAndClearsWithNull();
  });

  it("shows the server's reason when a role write is refused", async () => {
    await showsTheServerRefusal();
  });

  it("creates a group at the location chosen in the modal", async () => {
    await createSendsTheSelectedLocation();
  });

  it("moves the filter to the new group's location when it differs from the filter's", async () => {
    await createAtAnotherLocationMovesTheFilterThere();
  });

  it("stays on the asset-groups screen when an organization is chosen in the filter bar", async () => {
    await choosingAnOrganizationStaysOnTheScreen();
  });

  it("offers only free assets of the group's own location in the picker", async () => {
    await pickerListsOnlyTheGroupsLocation();
  });

  it("adds the picked asset to the group", async () => {
    await addSendsTheAssetId();
  });

  it("the add Review's sentence names the picked role", async () => {
    await theAddReviewNamesThePickedRole();
  });

  it("re-reads the members after a removal", async () => {
    await removeInvalidatesTheMembersQuery();
  });

  it("names the row being removed as removing, with aria-busy", async () => {
    await theRowBeingRemovedAnnouncesIt();
  });

  it("keeps the other rows' names while one row is removed", async () => {
    await theOtherRowsKeepTheirName();
  });

  it("never sends a code when a group is edited", async () => {
    await editNeverSendsCode();
  });

  it("hides every write control from a role without the write gate", async () => {
    await aReadOnlyRoleSeesNoWriteControls();
  });

  it("F4.197: a refused save shows the server's sentence, not the JSON envelope", async () => {
    await aRefusedSaveShowsTheSentence();
  });

  it("F4.197: a refused add shows the server's sentence, not the JSON envelope", async () => {
    await aRefusedAddShowsTheSentence();
  });

  it("F4.197: a refused remove shows the server's sentence, not the JSON envelope", async () => {
    await aRefusedRemoveShowsTheSentence();
  });

  it("F4.197: a refused role write shows the server's sentence, not the JSON envelope", async () => {
    await aRefusedRoleWriteShowsTheSentence();
  });

  it("F4.202: cancelling a member's Remove sends nothing", async () => {
    await cancellingMemberRemoveSendsNothing();
  });

  it("F4.202: confirming a member's Remove sends one request", async () => {
    await confirmingMemberRemoveSendsOneRequest();
  });

  it("F4.202: picking another group closes an open member-remove dialog", async () => {
    await pickingAnotherGroupClosesTheMemberRemoveDialog();
  });

  it("F4.202: changing the filter closes an open member-remove dialog", async () => {
    await changingTheFilterClosesTheMemberRemoveDialog();
  });
});

describe("F3.86 PR 3c asset groups page — the catalog wizards (ADR 0099 decisions 3, 6, ruling Q9)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the create wizard's steps are Basics, Details, Review", async () => {
    await createStepsAreBasicsDetailsReview();
  });

  it("a location picked first in a fresh wizard stays picked", async () => {
    await aLocationPickedFirstStays();
  });

  it("an unpicked location holds the Basics step and sends nothing", async () => {
    await anUnpickedLocationHoldsTheBasicsStep();
  });

  it("the create and the DELETE send no X-Copilot-Change header", async () => {
    await theWizardsSendNoCopilotHeader();
  });

  it("a copilot fill fills the named step's fields only", async () => {
    await aFillFillsTheNamedStepOnly();
  });

  it("an edit's Review shows Now beside After", async () => {
    await theEditReviewShowsNowBesideAfter();
  });

  it("the edit Review shows the stored domain as Now, and re-picking it is no change", async () => {
    await theEditReviewShowsTheStoredDomain();
  });

  it("a name-only edit of a classified group neither shows nor sends a domain change", async () => {
    await aNameOnlyEditLeavesTheStoredDomain();
  });

  it("a role pick sends nothing until the role wizard's Submit", async () => {
    await aRolePickWaitsForTheReview();
  });

  it("an unpicked asset holds the Member step", async () => {
    await anUnpickedAssetHoldsTheMemberStep();
  });

  it("the member remove Review is the red card", async () => {
    await theRemoveReviewIsTheRedCard();
  });
});
