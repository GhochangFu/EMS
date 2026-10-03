// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aReadOnlyRoleSeesNoWriteControls,
  addSendsTheAssetId,
  anEmptyVocabularyRendersNoRolesOfItsOwn,
  createSendsTheSelectedLocation,
  editNeverSendsCode,
  pickerListsOnlyTheGroupsLocation,
  removeInvalidatesTheMembersQuery,
  rendersMembersInServerOrder,
  rolesComeFromTheVocabularyFetch,
  sendsTheCodeAndClearsWithNull,
  showsHowManyMembersCarryEachRole,
  showsTheServerRefusal,
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

  it("offers only free assets of the group's own location in the picker", async () => {
    await pickerListsOnlyTheGroupsLocation();
  });

  it("adds the picked asset to the group", async () => {
    await addSendsTheAssetId();
  });

  it("re-reads the members after a removal", async () => {
    await removeInvalidatesTheMembersQuery();
  });

  it("never sends a code when a group is edited", async () => {
    await editNeverSendsCode();
  });

  it("hides every write control from a role without the write gate", async () => {
    await aReadOnlyRoleSeesNoWriteControls();
  });
});
