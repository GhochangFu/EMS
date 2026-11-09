import { expect } from "vitest";

import { copyOnboardingCredentialsBodySchema, type OnboardingDraft } from "@bms/shared";

import { brokerOf, copyBlobToTargets, sameBroker } from "./onboarding-credential-copy";

/**
 * `F4.339` (ADR 0117 decision 7, plan T7.1) — the credential copy's pure core.
 * Assertions live here; the sibling `.test.ts` is the Vitest entry point (ADR 0014).
 */

const BLOB = { c: "Y2lwaGVy", iv: "aXZpdml2aXZp", v: 2 };
const MQTT = { host: "broker.test", port: 8883 };

function draft(secrets: Record<string, unknown> = { A: BLOB }): OnboardingDraft {
  return {
    rtus: [
      { code: "A", displayName: "A", protocol: "mqtt", config: MQTT, credentialsSet: true },
      { code: "B", displayName: "B", protocol: "mqtt", config: MQTT },
      { code: "C", displayName: "C", protocol: "mqtt", config: MQTT },
    ],
    _secrets: secrets,
  } as never;
}

const secretsOf = (d: OnboardingDraft) => (d as unknown as { _secrets: Record<string, unknown> })._secrets;

/** Two targets get the blob byte-equal (`c`, `iv`, `v`) and `credentialsSet: true`; the source keeps its own. */
export function twoTargetsGetTheBlobAsStored(): void {
  const out = copyBlobToTargets(draft(), BLOB, "A", [1, 2], false);
  if (!("draft" in out)) throw new Error("refused");
  expect(secretsOf(out.draft)).toEqual({ A: BLOB, B: BLOB, C: BLOB });
  expect(out.draft.rtus?.map((r) => r.credentialsSet)).toEqual([true, true, true]);
}

/** A target that already holds a credential refuses the copy, naming its code; the draft is unchanged. */
export function aHeldTargetRefusesWithoutReplace(): void {
  const before = draft({ A: BLOB, C: { c: "b2xk", iv: "b2xkb2xkb2xk" } });
  const snapshot = JSON.stringify(before);
  expect(copyBlobToTargets(before, BLOB, "A", [1, 2], false)).toEqual({ refused: "has-credential", codes: ["C"] });
  expect(JSON.stringify(before)).toBe(snapshot);
}

/** `replace: true` overwrites a held target. */
export function replaceOverwritesAHeldTarget(): void {
  const out = copyBlobToTargets(draft({ A: BLOB, C: { c: "b2xk", iv: "b2xkb2xkb2xk" } }), BLOB, "A", [2], true);
  if (!("draft" in out)) throw new Error("refused");
  expect(secretsOf(out.draft).C).toEqual(BLOB);
}

/** The source as its own target is refused. */
export function theSourceIsNotATarget(): void {
  expect(copyBlobToTargets(draft(), BLOB, "A", [0, 1], false)).toEqual({ refused: "self", codes: ["A"] });
}

/** A target with no distinct code is refused by index. */
export function aTargetWithNoDistinctCodeIsRefused(): void {
  const d = draft();
  d.rtus![2] = { ...d.rtus![2]!, code: "B" };
  expect(copyBlobToTargets(d, BLOB, "A", [1, 2], false)).toEqual({ refused: "no-code", indexes: [1, 2] });
}

/** A committed source (no draft code) copies to any draft target. */
export function aCommittedSourceHasNoSelf(): void {
  const out = copyBlobToTargets(draft({}), BLOB, null, [0], false);
  expect("draft" in out).toBe(true);
}

/** Same broker needs host, port and TLS; `tls` absent reads as true; the host compares case-insensitively. */
export function sameBrokerComparesHostPortAndTls(): void {
  const a = brokerOf({ host: "Broker.Test", port: 8883 });
  expect(a).toEqual({ host: "broker.test", port: 8883, tls: true });
  expect(sameBroker(a, brokerOf({ host: "broker.test", port: 8883, tls: true }))).toBe(true);
  expect(sameBroker(a, brokerOf({ host: "broker.test", port: 1883 }))).toBe(false);
  expect(sameBroker(a, brokerOf({ host: "broker.test", port: 8883, tls: false }))).toBe(false);
  expect(sameBroker(a, brokerOf({ host: "other.test", port: 8883 }))).toBe(false);
}

/** The body: one source shape or the other, never both; 1–100 distinct targets; nothing else. */
export function theBodyTakesOneSourceAndDistinctTargets(): void {
  const ok = (body: unknown) => copyOnboardingCredentialsBodySchema.safeParse(body).success;
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [1, 2] })).toBe(true);
  expect(ok({ from: { rtuId: "44444444-4444-4444-8444-444444444444" }, toRtuIndexes: [0], replace: true })).toBe(true);
  expect(ok({ from: { rtuIndex: 0, rtuId: "44444444-4444-4444-8444-444444444444" }, toRtuIndexes: [1] })).toBe(false);
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [1, 1] })).toBe(false);
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [] })).toBe(false);
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [1], credentials: {} })).toBe(false);
}

/** `F4.339` PR 9 (ADR 0099 Amendment 18 Q3): an optional `draftHash`, 64 lowercase hex, binds a copilot card's copy. */
export function theBodyTakesAnOptionalDraftHash(): void {
  const ok = (body: unknown) => copyOnboardingCredentialsBodySchema.safeParse(body).success;
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [1], draftHash: "a".repeat(64) })).toBe(true);
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [1] })).toBe(true);
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [1], draftHash: "A".repeat(64) })).toBe(false);
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [1], draftHash: "a".repeat(63) })).toBe(false);
  expect(ok({ from: { rtuIndex: 0 }, toRtuIndexes: [1], draftHash: null })).toBe(false);
}
