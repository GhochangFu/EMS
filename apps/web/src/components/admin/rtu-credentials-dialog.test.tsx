// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedSiblingReadBlocksTheSave,
  aRefetchKeepsTheUsersUnticks,
  aRefusalIsShownAndTheFieldsClear,
  cancelSendsNothing,
  submitSendsOnceAndKeepsNothing,
  theActionIsHiddenForALocationAdmin,
  theActionShowsForTheTwoRoles,
  theDialogStartsEmptyWithSiblingsTicked,
  tooManySiblingsBlockTheSave,
} from "./rtu-credentials-dialog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.333 — Replace credentials on /admin/rtus (ADR 0129 decisions 2, 3, 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("D1 starts empty, masks the password and pre-ticks every sibling", theDialogStartsEmptyWithSiblingsTicked);
  it("D2 sends the body once with the ticked siblings, closes, and caches no value", submitSendsOnceAndKeepsNothing);
  it("D3 shows the API's refusal and clears the typed values", aRefusalIsShownAndTheFieldsClear);
  it("D4 Cancel closes without a request", cancelSendsNothing);
  it("D5 a refetch never re-ticks an untick, and ticks a newly offered sibling (review L2)", aRefetchKeepsTheUsersUnticks);
  it("D6 a failed sibling read is shown and blocks the save (code review 1)", aFailedSiblingReadBlocksTheSave);
  it("D7 more than 100 ticked siblings block the save (code review 2)", tooManySiblingsBlockTheSave);
  it("P1 shows the action and the pill on an MQTT row for admin and organization_admin", theActionShowsForTheTwoRoles);
  it("P2 hides the action from a location_admin (Q4)", theActionIsHiddenForALocationAdmin);
});
