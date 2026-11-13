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
    expect(maintenanceWindowIntentOf(`${word} this window until 8 pm`.toUpperCase()), word.toUpperCase()).toEqual(EXTEND);
  }
  expect(maintenanceWindowIntentOf("extend the maintenance window to 20:00")).toEqual(EXTEND);
  expect(maintenanceWindowIntentOf("extend it by two hours")).toEqual(EXTEND);
  expect(maintenanceWindowIntentOf("prolong this window until 8 pm")).toEqual(EXTEND);
}

/** Security re-check: the user's own message must ask for the act in imperative position. */
export function aCreateRequestInAClauseAsks(): void {
  for (const message of [
    "please create a maintenance window for the WC site",
    "can you set up a maintenance window on AHU-3 until 6 pm",
    "schedule a maintenance window on chiller 2 tomorrow 9-11",
    "put chiller 2 into a maintenance window",
    "Chiller 2 is under service. Suppress its alarms until 18:00.",
    "suppress all alarms at the WC site",
  ]) {
    expect(maintenanceWindowIntentOf(message), message).toEqual(CREATE);
  }
}

/** Security re-check: a topic, a question, a negation or the tone never asks for the create. */
export function aTopicQuestionOrNegationDoesNotAskForTheCreate(): void {
  for (const message of [
    "show the start time of the maintenance window",
    "list the start and end of all maintenance windows",
    "start date of maintenance windows",
    "what is the schedule for the maintenance window?",
    "add up the maintenance windows this month",
    "add notes to the maintenance window",
    "who put chiller 2 in a maintenance window?",
    "did someone create a maintenance window yesterday?",
    "why does the window suppress alarms?",
    "does a maintenance window suppress alarms?",
    "Which windows suppress Chiller 2 right now?",
    "list windows that suppress chiller 2",
    "cancel the start of the maintenance window",
    "end the silence on chiller 2",
    "stop the suppress on chiller 2",
    "silence is not normal here",
    "why the silence from chiller 2?",
    "sensor silence since 4 pm on AHU-3",
    "silence the tone",
    "silence the buzzer",
    "silence the alarm bar",
    "don't create a maintenance window",
    "do not suppress chiller 2",
    "don't suppress anything",
    "please don't create a maintenance window",
    "can you create a maintenance window on chiller 2?",
  ]) {
    expect(maintenanceWindowIntentOf(message), message).toEqual([]);
  }
}

/** Security re-check: an extend of something else, a question or a negation never asks for the extend. */
export function anExtendOfSomethingElseDoesNotAsk(): void {
  for (const message of [
    "extend the report range to 30 days",
    "how far does the window extend?",
    "does it extend past six?",
    "don't extend the window",
    "extend",
    "EXTEND",
  ]) {
    expect(maintenanceWindowIntentOf(message), message).toEqual([]);
  }
}

/** The matcher is linear: a 500k-character message, adversarial or not, finishes fast. */
export function aLongMessageFinishesFast(): void {
  const inputs = [
    "a ".repeat(250_000),
    " ".repeat(500_000),
    "suppress " + "!".repeat(500_000) + "a",
    "create " + "x ".repeat(250_000) + "maintenance window",
    ", and".repeat(100_000),
    "extend" + "\t".repeat(500_000),
  ];
  const started = Date.now();
  for (const message of inputs) maintenanceWindowIntentOf(message);
  expect(Date.now() - started).toBeLessThan(1_000);
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
