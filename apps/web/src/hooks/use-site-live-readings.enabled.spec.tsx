import { renderHook } from "@testing-library/react";
import { expect, vi } from "vitest";

import { useSiteLiveReadings } from "./use-site-live-readings";

/**
 * `F4.308` review M1 — `useSiteLiveReadings`' optional `enabled`: `false` opens no
 * `/ws/telemetry` socket, so the layout editor can call the hook in every mode and connect only
 * while a preview group is chosen. Omitted, it is `true`: every existing caller connects as
 * before. `use-site-live-readings.enabled.test.tsx` is the Vitest entry.
 */

const mocks = vi.hoisted(() => ({ io: vi.fn(), disconnect: vi.fn() }));

vi.mock("socket.io-client", () => ({ io: mocks.io }));

function arm(): void {
  mocks.io.mockReset();
  mocks.disconnect.mockReset();
  mocks.io.mockImplementation(() => ({ on: () => undefined, disconnect: mocks.disconnect }));
}

/** H1 — omitted, `enabled` is true: one socket. */
export function anOmittedEnabledConnects(): void {
  arm();
  renderHook(() => useSiteLiveReadings("site-a", undefined, 0));
  expect(mocks.io).toHaveBeenCalledTimes(1);
}

/** H2 — `enabled: false` opens no socket. */
export function aDisabledHookOpensNoSocket(): void {
  arm();
  renderHook(() => useSiteLiveReadings("site-a", undefined, 0, false));
  expect(mocks.io).not.toHaveBeenCalled();
}

/** H3 — turning it on connects; turning it off disconnects. */
export function turningItOnConnectsAndOffDisconnects(): void {
  arm();
  const { rerender } = renderHook(({ on }: { on: boolean }) => useSiteLiveReadings("site-a", undefined, 0, on), {
    initialProps: { on: false },
  });
  expect(mocks.io).not.toHaveBeenCalled();
  rerender({ on: true });
  expect(mocks.io).toHaveBeenCalledTimes(1);
  rerender({ on: false });
  expect(mocks.disconnect).toHaveBeenCalledTimes(1);
}
