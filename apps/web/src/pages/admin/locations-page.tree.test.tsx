// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import {
  aChangedParentOpensTheDialog,
  aLocationAdminSaveSendsNoParentKey,
  aLocationAdminSeesTheParentAsText,
  aMoveRefreshesTheScope,
  anUntouchedCreatePostsNoParent,
  anUntouchedParentSendsNoParentKey,
  aRefusedDeactivateShowsTheSentence,
  aRefusedMoveShowsTheSentenceInTheForm,
  aRefusedReactivateShowsTheSentence,
  cancelSendsNothing,
  confirmSendsTheNewParent,
  pickingAParentOnCreatePostsIt,
  rowsAreDepthFirst,
  theCreateParentSelectOffersNoInactiveNode,
  theEditParentSelectExcludesTheSubtree,
  theParentColumnNamesTheParent,
} from "./locations-page.tree.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The jsdom docblock is
 * on THIS file because Vitest reads it from the file it collects (ADR 0042 decision 2).
 */
describe("F2.10 locations page — the tree", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAuthStore.setState({ accessToken: null, user: null, scope: null, oidcIdToken: null });
  });

  it("P1 the Parent column names the parent, '—' for a root", async () => {
    await theParentColumnNamesTheParent();
  });

  it("P2 rows are depth-first, siblings in the API's order", async () => {
    await rowsAreDepthFirst();
  });

  it("P3 a refused deactivate shows the server's sentence", async () => {
    await aRefusedDeactivateShowsTheSentence();
  });

  it("P4 a refused reactivate shows the server's sentence", async () => {
    await aRefusedReactivateShowsTheSentence();
  });

  it("P5 an untouched create posts parentId: null", async () => {
    await anUntouchedCreatePostsNoParent();
  });

  it("P6 picking a parent on create posts its id", async () => {
    await pickingAParentOnCreatePostsIt();
  });

  it("P7 the create Parent select offers no inactive node", async () => {
    await theCreateParentSelectOffersNoInactiveNode();
  });

  it("P8 the edit Parent select excludes the node and its descendants", async () => {
    await theEditParentSelectExcludesTheSubtree();
  });

  it("P9 a location_admin sees the parent as text and no Parent control", async () => {
    await aLocationAdminSeesTheParentAsText();
  });

  it("P9b a location_admin's save sends no parentId key", async () => {
    await aLocationAdminSaveSendsNoParentKey();
  });

  it("P10 an admin's save with the parent untouched sends no parentId key", async () => {
    await anUntouchedParentSendsNoParentKey();
  });

  it("P11 a changed parent opens the move dialog and saves nothing", async () => {
    await aChangedParentOpensTheDialog();
  });

  it("P12 Confirm sends the new parent with the rest of the body", async () => {
    await confirmSendsTheNewParent();
  });

  it("P13 Cancel sends nothing", async () => {
    await cancelSendsNothing();
  });

  it("P14 a confirmed move reads /auth/me and replaces the stored scope", async () => {
    await aMoveRefreshesTheScope();
  });

  it("P15 a refused move shows the server's sentence in the open form", async () => {
    await aRefusedMoveShowsTheSentenceInTheForm();
  });
});
