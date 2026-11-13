import { expect, vi } from "vitest";

import { createAlarmTone } from "./alarm-tone";

/**
 * `F4.357` U8 (ADR 0130 decision 10) — the Web Audio tone, on a fake `AudioContext`. Vitest entry
 * point: `alarm-tone.test.ts` (ADR 0014).
 */

/** A fake `AudioContext` in `state`, recording the oscillators it makes and its `resume` calls. */
export function fakeAudioContext(state: "running" | "suspended") {
  const made = { contexts: 0, oscillators: [] as { started: number; stopped: number }[], resumes: 0 };
  class FakeContext {
    state = state;
    currentTime = 0;
    destination = {};
    constructor() {
      made.contexts += 1;
    }
    resume() {
      made.resumes += 1;
      return Promise.resolve();
    }
    createOscillator() {
      const record = { started: 0, stopped: 0 };
      made.oscillators.push(record);
      return {
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: () => void (record.started += 1),
        stop: () => void (record.stopped += 1),
      };
    }
    createGain() {
      return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    }
  }
  return { Ctor: FakeContext as unknown as typeof AudioContext, made };
}

/** A running context plays: it starts and stops oscillators and answers "played". */
export function aRunningContextPlays(): void {
  const { Ctor, made } = fakeAudioContext("running");
  const tone = createAlarmTone(Ctor);
  expect(tone.play()).toBe("played");
  expect(made.oscillators.length).toBeGreaterThan(0);
  expect(made.oscillators.every((o) => o.started === 1 && o.stopped === 1)).toBe(true);
  tone.play();
  expect(made.contexts, "one context, made lazily and kept").toBe(1);
}

/** A suspended context (no gesture yet) answers "blocked", makes no oscillator, and asks to resume. */
export function aSuspendedContextIsBlocked(): void {
  const { Ctor, made } = fakeAudioContext("suspended");
  const tone = createAlarmTone(Ctor);
  expect(tone.play()).toBe("blocked");
  expect(made.oscillators).toEqual([]);
  expect(made.resumes, "resume is asked, not awaited").toBe(1);
}

/** `unlock` resumes the context. */
export async function unlockResumes(): Promise<void> {
  const { Ctor, made } = fakeAudioContext("suspended");
  await createAlarmTone(Ctor).unlock();
  expect(made.resumes).toBe(1);
}

/** No Web Audio at all: blocked, and unlock does nothing. */
export async function noWebAudioIsBlocked(): Promise<void> {
  const tone = createAlarmTone(undefined);
  expect(tone.play()).toBe("blocked");
  await expect(tone.unlock()).resolves.toBeUndefined();
}
