import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterLogger } from "../adapter/types.js";
import { openDiskBufferStore } from "./disk-buffer.js";
import { receivedTogether } from "./received-sample.js";

/**
 * `DiskBufferStore.backlog()` — what the start-up scan found (ADR 0115
 * Amendment 1, owner ruling A).
 *
 * The registry seeds its `stopped` list from this at boot, so after a host
 * restart an endpoint the boot plan does not start — an organization still
 * switched off — still has its backlog named on the health body. Apart from
 * `disk-buffer.spec.ts` only because §4.5 caps a file at 1000 lines.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOW = new Date("2026-11-07T10:00:00.000Z");

const silent: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function options(dir: string) {
  return { dir, maxAgeMs: 3_600_000, maxBytes: 268_435_456, now: () => NOW, logger: silent };
}

export async function runDiskBufferBacklogTests(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "bms-ingest-backlog-"));
  try {
    const first = await openDiskBufferStore(options(root));
    assert(first.backlog().length === 0, "an empty directory has no backlog");

    // Written by one process, read by the next — the restart case.
    const plain = first.handle("mqtt", "mqtt://shapoorji.thinkiot.co.in:1883");
    const tls = first.handle("mqtt", "phe.thinkiot.co.in:8883");
    assert(
      await plain.append(
        receivedTogether(
          [
            { sourceKey: "flow", value: 1 },
            { sourceKey: "flow", value: 2 },
          ],
          NOW,
        ),
      ),
      "the first append lands",
    );
    assert(await tls.append(receivedTogether([{ sourceKey: "flow", value: 3 }], NOW)), "the second append lands");
    // A handle that was asked for but never written holds nothing and is not listed.
    first.handle("mqtt", "never-written:1");

    const listed = first.backlog();
    assert(
      listed.map((e) => e.endpointKey).join(",") === "mqtt://shapoorji.thinkiot.co.in:1883,phe.thinkiot.co.in:8883",
      `only endpoints holding samples, sorted by key: ${JSON.stringify(listed)}`,
    );

    const second = await openDiskBufferStore(options(root));
    const scanned = second.backlog();
    assert(
      scanned.length === 2 &&
        scanned[0].protocol === "mqtt" &&
        scanned[0].endpointKey === "mqtt://shapoorji.thinkiot.co.in:1883" &&
        scanned[0].buffered === 2 &&
        scanned[1].endpointKey === "phe.thinkiot.co.in:8883" &&
        scanned[1].buffered === 1,
      `the scan names each endpoint by its decoded key with its sample count: ${JSON.stringify(scanned)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
