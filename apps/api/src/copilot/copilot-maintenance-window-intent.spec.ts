import { expect } from "vitest";

import {
  CREATE_WINDOW_VERBS,
  EXTEND_WINDOW_WORDS,
  MAINTENANCE_WINDOW_INTENT_IDS,
  SUPPRESS_WORDS,
  WINDOW_NOUNS,
  maintenanceWindowIntentOf,
  ownMessageIntentOf,
} from "./copilot-maintenance-window-intent";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decision 4, ruling Q2) — the own-message
 * words that allow a maintenance-window create or extend, in the
 * `copilot-operations-intent.ts` shape. A create needs a create verb before the
 * window noun, or an imperative "suppress" / "silence" aimed at something; an
 * extend needs "extend" or "prolong". Vitest entry point: the sibling `.test.ts`.
 */

const CREATE = ["maintenanceWindow.create"];
const EXTEND = ["maintenanceWindow.extend"];

/** The review's create requests each ask for the create alone. */
export function aCreateRequestAsksForTheCreate(): void {
  for (const message of [
    "create a maintenance window on chiller 2 until 18:00",
    "suppress chiller 2 alarms until six",
    "silence the alarms on site X for two hours",
    "Schedule a new maintenance window for UPS-1 tomorrow",
    "please put chiller 2 into a maintenance window",
    "SET UP A MAINTENANCE WINDOW ON MCC-1",
  ]) {
    expect(maintenanceWindowIntentOf(message), message).toEqual(CREATE);
  }
}

/** Each create verb, before the window noun and in any case, asks for the create alone. */
export function eachCreateVerbBeforeTheNounAsks(): void {
  for (const verb of CREATE_WINDOW_VERBS) {
    for (const noun of WINDOW_NOUNS) {
      expect(maintenanceWindowIntentOf(`please ${verb} a ${noun} on chiller 2`), verb).toEqual(CREATE);
      expect(maintenanceWindowIntentOf(`${verb} ${noun}`.toUpperCase()), verb).toEqual(CREATE);
    }
  }
  for (const word of SUPPRESS_WORDS) {
    expect(maintenanceWindowIntentOf(`please ${word} chiller 2 until six`), word).toEqual(CREATE);
    expect(maintenanceWindowIntentOf(`${word} the alarms`.toUpperCase()), word).toEqual(CREATE);
  }
}

/**
 * Review of PR 6: a question about a window or a suppression, an end, a cancel, and the
 * tone's Mute button do not ask for a create. Nor does an extend of a window.
 */
export function aQuestionOrAnEndDoesNotAskForTheCreate(): void {
  for (const message of [
    "end the maintenance window",
    "cancel tomorrow's maintenance window",
    "which maintenance windows are active?",
    "show the open maintenance windows",
    "is the chiller alarm suppressed?",
    "why is this alarm muted?",
    "how do I mute the tone?",
    "the alarms were silenced at noon",
    "how do I silence?",
    "explain this alarm",
    "show the alarms on the extension block",
  ]) {
    expect(maintenanceWindowIntentOf(message), message).toEqual([]);
  }
  expect(maintenanceWindowIntentOf("extend the maintenance window")).toEqual(EXTEND);
}

/** Each extend word, in a sentence and in any case, asks for the extend alone. */
export function eachExtendWordAsksForTheExtend(): void {
  for (const word of EXTEND_WINDOW_WORDS) {
    expect(maintenanceWindowIntentOf(`please ${word} it by two hours`), word).toEqual(EXTEND);
    expect(maintenanceWindowIntentOf(word.toUpperCase()), word.toUpperCase()).toEqual(EXTEND);
  }
  expect(maintenanceWindowIntentOf("extend the maintenance window to 20:00")).toEqual(EXTEND);
}

/** The fixed lists, exactly (plan §6: fixed at PR 6, one list per entry). */
export function theWordsAreTheFixedLists(): void {
  expect([...CREATE_WINDOW_VERBS]).toEqual(["create", "add", "schedule", "start", "set up", "put"]);
  expect([...WINDOW_NOUNS]).toEqual(["maintenance window", "maintenance windows"]);
  expect([...SUPPRESS_WORDS]).toEqual(["suppress", "silence"]);
  expect([...EXTEND_WINDOW_WORDS]).toEqual(["extend", "prolong"]);
  expect([...MAINTENANCE_WINDOW_INTENT_IDS].sort()).toEqual(["maintenanceWindow.create", "maintenanceWindow.extend"]);
}

/** Whole words only, and a hyphen joins a token: none of these asks. */
export function aWordInsideAnotherDoesNotAsk(): void {
  for (const message of [
    "the unsuppressed alarms",
    "pre-suppress chiller 2",
    "the extendable rack",
    "pre-extend check",
    "a window cleaner",
    "readd a maintenance window",
    "the add-on maintenance window",
  ]) {
    expect(maintenanceWindowIntentOf(message), message).toEqual([]);
  }
}

/** The turn's one list: the operational ids and the window ids, each by its own words. */
export function theOwnMessageListJoinsBoth(): void {
  expect(ownMessageIntentOf("ack the alarm, then extend the maintenance window")).toEqual(["alarm.acknowledge", "maintenanceWindow.extend"]);
  expect(ownMessageIntentOf("what is the kW on MCC-1 now?")).toEqual([]);
}
