// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addModalHasNoControlRoomViewField,
  adminBuiltinFieldIsEnabled,
  builtinOptionIsAbsentForAnOrganizationAdmin,
  builtinOptionIsPresentForTheGlobalAdmin,
  changedViewIsPutOnceAfterTheUpdate,
  dashboardPickerListsOnlyEligibleDashboards,
  editModalHasTheControlRoomViewField,
  editShowsTheStoredBuiltinView,
  nameOnlyEditOfARemovedDashboardSiteSaves,
  nonAdminBuiltinFieldIsDisabled,
  nonAdminSeesTheStoredBuiltinView,
  rejectedPutShowsItsMessage,
  removedStoredDashboardShowsNoLongerAvailable,
  rescopedStoredDashboardShowsNoLongerAvailable,
  touchedDashboardPickerIsRequired,
  unchangedViewIsNotPut,
  untouchedRemovedDashboardPickerIsNotRequired,
  viewChangedBackIsNotPut,
} from "./locations-page.control-room-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2). The project
 * default stays `node`.
 *
 * `WAIT_BUDGET_MS`: each wait in the spec may take up to `asyncUtilTimeout` (5000 ms,
 * `test-setup.ts`), which equals Vitest's default `testTimeout` — at 5 s a failing wait would
 * redden as "Test timed out" instead of naming its assertion. The budget only lets the red
 * say which claim broke; it cannot turn a wrong assertion green.
 */
const WAIT_BUDGET_MS = 20_000;

describe("F3.67 locations page — the Control Room view field", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("W1 editing a site whose stored view is builtin shows builtin", async () => {
    await editShowsTheStoredBuiltinView();
  }, WAIT_BUDGET_MS);

  it("W2a the Add modal has no Control Room view field", async () => {
    await addModalHasNoControlRoomViewField();
  }, WAIT_BUDGET_MS);

  it("W2b the Edit modal has the Control Room view field", async () => {
    await editModalHasTheControlRoomViewField();
  }, WAIT_BUDGET_MS);

  it("W3 the dashboard picker lists the site- and group-scoped dashboards only", async () => {
    await dashboardPickerListsOnlyEligibleDashboards();
  }, WAIT_BUDGET_MS);

  it("W4 a changed view is put once, after the location update", async () => {
    await changedViewIsPutOnceAfterTheUpdate();
  }, WAIT_BUDGET_MS);

  it("W5 an unchanged view is not put", async () => {
    await unchangedViewIsNotPut();
  }, WAIT_BUDGET_MS);

  it("W5b a view changed and changed back is not put", async () => {
    await viewChangedBackIsNotPut();
  }, WAIT_BUDGET_MS);

  it("W6 a rejected put shows its message in the error line", async () => {
    await rejectedPutShowsItsMessage();
  }, WAIT_BUDGET_MS);

  it("W7a an organization_admin is not offered builtin", async () => {
    await builtinOptionIsAbsentForAnOrganizationAdmin();
  }, WAIT_BUDGET_MS);

  it("W7b the global admin is offered builtin", async () => {
    await builtinOptionIsPresentForTheGlobalAdmin();
  }, WAIT_BUDGET_MS);

  it("W8a a non-admin editing a builtin site sees builtin (OQ3)", async () => {
    await nonAdminSeesTheStoredBuiltinView();
  }, WAIT_BUDGET_MS);

  it("W8b a non-admin editing a builtin site gets a disabled field (OQ3)", async () => {
    await nonAdminBuiltinFieldIsDisabled();
  }, WAIT_BUDGET_MS);

  it("W8c the global admin editing a builtin site gets an enabled field", async () => {
    await adminBuiltinFieldIsEnabled();
  }, WAIT_BUDGET_MS);

  it("W9a an untouched picker over a removed dashboard is not required (C1)", async () => {
    await untouchedRemovedDashboardPickerIsNotRequired();
  }, WAIT_BUDGET_MS);

  it("W9b a name-only edit of a site whose dashboard was removed saves, with no put (C1)", async () => {
    await nameOnlyEditOfARemovedDashboardSiteSaves();
  }, WAIT_BUDGET_MS);

  it("W9c a touched dashboard picker is required", async () => {
    await touchedDashboardPickerIsRequired();
  }, WAIT_BUDGET_MS);

  it("W10a a removed stored dashboard shows as no longer available (C1)", async () => {
    await removedStoredDashboardShowsNoLongerAvailable();
  }, WAIT_BUDGET_MS);

  it("W10b a re-scoped stored dashboard stays selected as no longer available (C1)", async () => {
    await rescopedStoredDashboardShowsNoLongerAvailable();
  }, WAIT_BUDGET_MS);
});
