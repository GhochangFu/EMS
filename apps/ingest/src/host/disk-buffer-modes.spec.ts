import * as fsPromises from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterLogger } from "../adapter/types.js";
import { openDiskBufferStore, type BufferFileSystem } from "./disk-buffer.js";

/**
 * The store's file modes — ADR 0016 Amendment 4, the `Modes` note.
 *
 * Apart from `disk-buffer.spec.ts` only because §4.5 caps a file at 1000 lines,
 * and this block shares almost nothing with it: it needs a recording
 * filesystem rather than the failure fakes, and none of that file's segment
 * fixtures.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOW = new Date("2026-09-06T10:00:00.000Z");

const silent: AdapterLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export async function runDiskBufferModeTests(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "bms-ingest-modes-"));
  try {
    // Deleting all four `mode` options leaves every block of
    // `disk-buffer.spec.ts` green — nothing else reads them, and a `stat` on
    // the mode bits would assert nothing on the Windows workstations this host
    // is built on. The options object the store hands the filesystem is the
    // portable evidence: the buffer holds plant telemetry, so on a POSIX host
    // only the account running the host may read it.
    const dir = join(root, "deep", "deeper");
    const mkdirOptions: unknown[] = [];
    const appendOptions: unknown[] = [];
    const fs: BufferFileSystem = {
      mkdir: async (path, options) => {
        mkdirOptions.push(options);
        await fsPromises.mkdir(path, options);
        return undefined;
      },
      writeFile: fsPromises.writeFile,
      appendFile: async (path, data, options) => {
        appendOptions.push(options);
        return fsPromises.appendFile(path, data, options);
      },
      readFile: fsPromises.readFile,
      readdir: fsPromises.readdir,
      unlink: fsPromises.unlink,
      stat: fsPromises.stat,
    };
    const store = await openDiskBufferStore({
      dir,
      maxAgeMs: 3_600_000,
      maxBytes: 268_435_456,
      now: () => NOW,
      logger: silent,
      fs,
    });
    const handle = store.handle("mqtt", "phe.thinkiot.co.in:8883");
    assert(await handle.append([{ sourceKey: "flow", value: 1 }]), "the append lands");

    // `ensureDir` walks up on `ENOENT` and creates the missing ancestors
    // top-down, so `deep`, `deeper`, `mqtt` and the encoded endpoint directory
    // are all created here — the walk's own calls carry the mode, or the tree
    // is 0o755 wherever an ancestor was missing.
    assert(mkdirOptions.length >= 4, `the walk creates each missing directory, got ${mkdirOptions.length}`);
    const created = mkdirOptions.map((options) => JSON.stringify(options));
    assert(
      created.every((options) => options === JSON.stringify({ mode: 0o700 })),
      `every directory is created 0o700, got ${created.join(" ")}`,
    );
    assert(appendOptions.length === 1, `one append is one appendFile, got ${appendOptions.length}`);
    assert(
      JSON.stringify(appendOptions[0]) === JSON.stringify({ encoding: "utf8", mode: 0o600 }),
      `a segment is written 0o600 as utf8, got ${JSON.stringify(appendOptions[0])}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
