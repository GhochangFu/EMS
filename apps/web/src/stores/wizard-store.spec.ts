import { expect } from "vitest";

import type { CopilotFillStepDto } from "@bms/shared";

import { useWizardStore } from "./wizard-store";

/**
 * `F4.245` / ADR 0099 Amendment 4 — the hand-off from the dock to the open
 * wizards: each open wizard registers its record, the dock reads them at send
 * time, and a fill is taken only by the wizard whose key it names. A fill with
 * no matching wizard waits only while the page `open_page` sent the user to is
 * shown. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY_A = `dashboard.update /api/v1/dashboards/${A}`;
const KEY_B = `dashboard.update /api/v1/dashboards/${B}`;
const WIZARD_A = { catalogId: "dashboard.update", params: { id: A } };
const fillFor = (id: string): CopilotFillStepDto => ({ catalogId: "dashboard.update", params: { id }, stepId: "basics", values: { name: "N" } });

const store = () => useWizardStore.getState();

export function aRegisteredWizardIsOpenUntilItUnregisters(): void {
  const mount = store().register(KEY_A, WIZARD_A);
  expect(store().openWizards()).toEqual([WIZARD_A]);
  store().unregister(mount);
  expect(store().openWizards()).toEqual([]);
}

/** Critique C7: the dock names one record once, so a duplicate never makes the turn a 400. Mutation: drop the dedupe. */
export function twoCopiesOfOneRecordAreNamedOnce(): void {
  store().register(KEY_A, WIZARD_A);
  store().register(KEY_A, WIZARD_A);
  expect(store().openWizards()).toEqual([WIZARD_A]);
}

export function theFillForTheOpenRecordIsTakenByIt(): void {
  store().register(KEY_A, WIZARD_A);
  store().receiveFill(fillFor(A), null);
  expect(store().take(KEY_A)).toEqual(fillFor(A));
  expect(store().take(KEY_A)).toBeNull();
}

/** Mutation: compare `catalogId` only (the pre-F4.245 rule) — B's wizard takes A's fill. */
export function anotherRecordsWizardDoesNotTakeTheFill(): void {
  store().register(KEY_A, WIZARD_A);
  store().register(KEY_B, { catalogId: "dashboard.update", params: { id: B } });
  store().receiveFill(fillFor(A), null);
  expect(store().take(KEY_B)).toBeNull();
  expect(store().take(KEY_A)).toEqual(fillFor(A));
}

/** Critique C6: a fill with no open match and no page to wait for is dropped at once. Mutation: keep it → B's later mount... A's takes it. */
export function aFillWithNoOpenMatchAndNoPageIsDropped(): void {
  store().receiveFill(fillFor(A), null);
  store().register(KEY_A, WIZARD_A);
  expect(store().take(KEY_A)).toBeNull();
}

/** Owner ruling (nav): a fill after `open_page` waits for its wizard on that page. */
export function aFillForTheOpenedPageWaitsForItsWizard(): void {
  store().receiveFill(fillFor(A), "/admin/dashboards/a");
  store().leavePage("/admin/dashboards/a");
  store().register(KEY_A, WIZARD_A);
  expect(store().take(KEY_A)).toEqual(fillFor(A));
}

/** Mutation: `leavePage` keeps the fill — a later visit to the record lands a stale fill. */
export function aWaitingFillIsDroppedWhenTheUserLeavesThePage(): void {
  store().receiveFill(fillFor(A), "/admin/dashboards/a");
  store().leavePage("/admin/dashboards");
  store().register(KEY_A, WIZARD_A);
  expect(store().take(KEY_A)).toBeNull();
}

/** Mutation: `unregister` keeps the fill — it lands when that record's wizard opens again. */
export function aWaitingFillIsDroppedWhenItsWizardUnregisters(): void {
  const mount = store().register(KEY_B, { catalogId: "dashboard.update", params: { id: B } });
  store().receiveFill(fillFor(B), "/admin/dashboards/b");
  store().unregister(mount);
  store().register(KEY_B, { catalogId: "dashboard.update", params: { id: B } });
  expect(store().take(KEY_B)).toBeNull();
}

/** A fill whose params the entry refuses names no wizard and is dropped, never thrown. */
export function aFillWithBadParamsIsDropped(): void {
  store().register(KEY_A, WIZARD_A);
  store().receiveFill({ ...fillFor(A), params: { id: "nope" } }, null);
  expect(store().take(KEY_A)).toBeNull();
}
