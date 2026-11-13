import { afterEach, describe, it, vi } from "vitest";

import {
  aKolkataOperatorReadsAndTypesLocalTime,
  aLocalInputIsTheInstantOfItsComponents,
  aStJohnsOperatorReadsAndTypesLocalTime,
  aUtcOperatorSeesUtc,
} from "./maintenance-window-time.spec";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Vitest entry point (ADR 0014). Each case pins its own `TZ`; the first holds under any zone. */
describe("F4.359 U15 — maintenance-window times in the browser's zone", () => {
  it("a local input is the instant of its own components, in the runner's zone", aLocalInputIsTheInstantOfItsComponents);
  it("a local input is the instant of its own components, under Asia/Kolkata", () => {
    vi.stubEnv("TZ", "Asia/Kolkata");
    aLocalInputIsTheInstantOfItsComponents();
  });
  it("an Asia/Kolkata operator reads and types local time", () => {
    vi.stubEnv("TZ", "Asia/Kolkata");
    aKolkataOperatorReadsAndTypesLocalTime();
  });
  it("an America/St_Johns operator reads and types local time", () => {
    vi.stubEnv("TZ", "America/St_Johns");
    aStJohnsOperatorReadsAndTypesLocalTime();
  });
  it("a UTC operator sees UTC", () => {
    vi.stubEnv("TZ", "UTC");
    aUtcOperatorSeesUtc();
  });
});
