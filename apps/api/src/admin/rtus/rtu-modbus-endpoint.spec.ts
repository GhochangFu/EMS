import { expect } from "vitest";

import type { BmsTx } from "../../database/tenant-context";
import { lockModbusEndpoints } from "./rtu-modbus-endpoint";

/**
 * `F1.2` plan PR 11 — the endpoint lock shared by the RTUs page bind and the onboarding commit.
 * A draft may name several endpoints, so the keys are taken once each and in one sorted order:
 * two commits naming the same endpoints in opposite orders then queue rather than deadlock.
 */

/** A fake transaction that records the parameter of every `execute`. */
function recordingTx(): { tx: BmsTx; keys: unknown[] } {
  const keys: unknown[] = [];
  const tx = {
    execute: async (query: { queryChunks?: unknown[] }) => {
      // drizzle's `sql` template keeps each interpolated value as a chunk that is not a StringChunk.
      for (const chunk of query.queryChunks ?? []) {
        if (typeof chunk === "string") {
          keys.push(chunk);
        }
      }
      return { rows: [] };
    },
  } as unknown as BmsTx;
  return { tx, keys };
}

/** EL1 — duplicates are locked once, the keys in sorted order, each `modbus_tcp:<host>:<port>`. */
export async function assertTheLocksAreDistinctAndSorted(): Promise<void> {
  const { tx, keys } = recordingTx();
  await lockModbusEndpoints(tx, [
    { host: "meter-b", port: 502 },
    { host: "meter-a", port: 5020 },
    { host: "meter-b", port: 502 },
    { host: "meter-a", port: 502 },
  ]);
  expect(keys).toEqual(["modbus_tcp:meter-a:502", "modbus_tcp:meter-a:5020", "modbus_tcp:meter-b:502"]);
}

/** EL2 — no endpoint, no lock. */
export async function assertNoEndpointTakesNoLock(): Promise<void> {
  const { tx, keys } = recordingTx();
  await lockModbusEndpoints(tx, []);
  expect(keys).toEqual([]);
}
