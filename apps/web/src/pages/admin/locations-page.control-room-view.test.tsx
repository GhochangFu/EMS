// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addModalHasNoControlRoomViewField,
  editModalHasNoControlRoomViewField,
  editSaveSendsNoViewPut,
  theRowActionOpensTheWizardAndPutsOnce,
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

describe("F3.67 / F3.86 PR 3d locations page — the Control Room view is its own wizard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("W2a the Add modal has no Control Room view field", async () => {
    await addModalHasNoControlRoomViewField();
  }, WAIT_BUDGET_MS);

  it("the Edit modal has no Control Room view field", async () => {
    await editModalHasNoControlRoomViewField();
  }, WAIT_BUDGET_MS);

  it("the Edit Save sends no view PUT", async () => {
    await editSaveSendsNoViewPut();
  }, WAIT_BUDGET_MS);

  it("the row action opens the wizard, whose Submit puts the exact body once", async () => {
    await theRowActionOpensTheWizardAndPutsOnce();
  }, WAIT_BUDGET_MS);
});
