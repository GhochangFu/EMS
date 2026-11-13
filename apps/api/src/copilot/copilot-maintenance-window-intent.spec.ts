import { expect } from "vitest";

import {
  CREATE_WINDOW_WORDS,
  EXTEND_WINDOW_WORDS,
  MAINTENANCE_WINDOW_INTENT_IDS,
  maintenanceWindowIntentOf,
  ownMessageIntentOf,
} from "./copilot-maintenance-window-intent";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decision 4, ruling Q2) — the own-message
 * words that allow a maintenance-window create or extend, in the
 * `copilot-operations-intent.ts` shape. Vitest entry point: the sibling `.test.ts`.
 */

/** Each create word, in a sentence and in any case, asks for the create alone. */
export function eachCreateWordAsksForTheCreate(): void {
  for (const word of CREATE_WINDOW_WORDS) {
    expect(maintenanceWindowIntentOf(`please ${word} chiller 2 until six`), word).toEqual(["maintenanceWindow.create"]);
    expect(maintenanceWindowIntentOf(word.toUpperCase()), word.toUpperCase()).toEqual(["maintenanceWindow.create"]);
  }
}

/** Each extend word, in a sentence and in any case, asks for the extend alone. */
export function eachExtendWordAsksForTheExtend(): void {
  for (const word of EXTEND_WINDOW_WORDS) {
    expect(maintenanceWindowIntentOf(`please ${word} it by two hours`), word).toEqual(["maintenanceWindow.extend"]);
    expect(maintenanceWindowIntentOf(word.toUpperCase()), word.toUpperCase()).toEqual(["maintenanceWindow.extend"]);
  }
}

/** The fixed lists, exactly (plan §6: fixed at PR 6, one list per entry). */
export function theWordsAreTheFixedLists(): void {
  expect([...CREATE_WINDOW_WORDS]).toEqual([
    "maintenance window",
    "maintenance windows",
    "suppress",
    "suppressed",
    "suppressing",
    "suppression",
    "silence",
    "silenced",
    "silencing",
    "mute",
    "muted",
    "muting",
  ]);
  expect([...EXTEND_WINDOW_WORDS]).toEqual(["extend", "extended", "extending", "extension", "prolong", "prolonged", "prolonging"]);
  expect([...MAINTENANCE_WINDOW_INTENT_IDS].sort()).toEqual(["maintenanceWindow.create", "maintenanceWindow.extend"]);
}

/** Whole words only, and a hyphen joins a token: none of these asks. */
export function aWordInsideAnotherDoesNotAsk(): void {
  for (const message of ["the unsuppressed alarms", "commuted load", "the extendable rack", "pre-extend check", "a window cleaner"]) {
    expect(maintenanceWindowIntentOf(message), message).toEqual([]);
  }
}

/** End and cancel are not gated (Q2): a message with "end" or "cancel" asks for nothing here. */
export function endAndCancelAreNotGated(): void {
  expect(maintenanceWindowIntentOf("end the window now and cancel tomorrow's")).toEqual([]);
}

/** The turn's one list: the operational ids and the window ids, each by its own words. */
export function theOwnMessageListJoinsBoth(): void {
  expect(ownMessageIntentOf("ack the alarm, then extend the maintenance window")).toEqual([
    "alarm.acknowledge",
    "maintenanceWindow.create",
    "maintenanceWindow.extend",
  ]);
  expect(ownMessageIntentOf("what is the kW on MCC-1 now?")).toEqual([]);
}
