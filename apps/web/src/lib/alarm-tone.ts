/**
 * `F4.357` U8 (ADR 0130 decisions 10, 11) — the critical-alarm tone, generated with the Web Audio
 * API: two short beeps through a gain envelope. No audio file, no dependency.
 *
 * A browser keeps an `AudioContext` suspended until the page gets a gesture (a click), so a wall
 * nobody touches cannot play. `play` therefore asks `resume()` without awaiting it (Chrome leaves
 * that promise pending until a gesture) and answers `"blocked"` while the context is not running;
 * the bar then shows "Sound blocked — click to enable", whose click calls `unlock`.
 */
export type AlarmTonePort = {
  /** Plays the tone now, or answers `"blocked"` when the browser will not play yet. */
  play(): "played" | "blocked";
  /** Resumes the context inside a user gesture. */
  unlock(): Promise<void>;
};

const BEEP_HZ = 880;
const BEEP_SECONDS = 0.18;
const GAP_SECONDS = 0.12;
const PEAK_GAIN = 0.25;

/** The tone over `Ctor` (`window.AudioContext`), or a port that is always blocked when there is none. */
export function createAlarmTone(Ctor: typeof AudioContext | undefined): AlarmTonePort {
  let context: AudioContext | null = null;
  const contextOf = (): AudioContext | null => {
    if (Ctor === undefined) return null;
    context ??= new Ctor();
    return context;
  };
  return {
    play() {
      const audio = contextOf();
      if (audio === null) return "blocked";
      if (audio.state !== "running") {
        void audio.resume().catch(() => undefined);
        return "blocked";
      }
      for (let beep = 0; beep < 2; beep += 1) {
        const start = audio.currentTime + beep * (BEEP_SECONDS + GAP_SECONDS);
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(BEEP_HZ, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + 0.02);
        gain.gain.linearRampToValueAtTime(0, start + BEEP_SECONDS);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + BEEP_SECONDS);
      }
      return "played";
    },
    async unlock() {
      await contextOf()?.resume();
    },
  };
}
