import * as fsPromises from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BufferFileSystem } from "./disk-buffer.js";
import {
  assert,
  ENCODED,
  errno,
  errorLines,
  exists,
  line,
  makeHarness,
  MINUTE,
  openWithHandle,
  realFs,
  received,
  sample,
  segment,
  START,
  withTempDir,
} from "./disk-buffer.spec.js";

/**
 * The one way out of a refused unlink that is not an operator (`F1.10`
 * post-merge review).
 *
 * `unlinkRefused` takes a flagged record out of `lowestSegment`, out of
 * `oldestAcrossStore` and out of the age loop, and only a successful unlink
 * cleared the flag — so a record nothing offers is a record nothing can ever
 * unlink. Blocks 15, 15b and 15c all append at a *later* minute, so none of
 * them reaches the case that matters: an append into the refused minute
 * itself, which is what the drain loop does when the replay loop has drained
 * to the current minute and its `commit()` was refused.
 *
 * It lives apart from `disk-buffer.spec.ts` only because §4.5 caps a file at
 * 1000 lines; the harness is imported from there so both files drive the same
 * clock, the same capturing logger and the same poisonable filesystem.
 */
export async function runDiskBufferRefusedTests(): Promise<void> {
  // ---- an append into the refused minute makes the record reachable again ---

  await withTempDir(async (dir) => {
    // The whole scenario inside one minute M. Replay drains M, `commit()` is
    // refused and flags it, and the drain loop spills again — still M, so the
    // batch lands in the file that is flagged. Without a reset the record is
    // never offered again: `buffered` counts those lines for the rest of the
    // hour and not one of them ever reaches the database.
    const harness = makeHarness();
    const endpointDir = join(dir, "mqtt", ENCODED);
    await mkdir(endpointDir, { recursive: true });
    const path = join(endpointDir, `${MINUTE}.jsonl`);
    await writeFile(path, line(1, START));
    // Refusal is a state of the volume, not of the file: an EPERM that a
    // remount clears is exactly the case, so the last step below turns it off.
    const volume = { refusing: true };
    const fs: BufferFileSystem = {
      ...realFs(),
      unlink: async (target) => {
        if (volume.refusing && String(target) === path) {
          throw errno("EPERM", "operation not permitted, unlink");
        }
        return fsPromises.unlink(target);
      },
    };
    const { handle } = await openWithHandle(harness, dir, { fs });
    assert(handle.buffered === 1, `the scan found the segment, got ${handle.buffered}`);

    const replayed = segment(await handle.oldest(), "the segment reads before anything refuses it");
    assert(
      replayed.samples.map((one) => one.sample.value).join(",") === "1",
      `the line replays, got ${replayed.samples.map((one) => one.sample.value).join(",")}`,
    );
    await replayed.commit();
    assert(errorLines(harness, "unlink failed").length === 1, "the refusal is logged once");
    assert(await exists(path), "the file the volume refused is still there");
    assert(handle.buffered === 1, `and its line is still counted, got ${handle.buffered}`);
    assert(
      (await handle.oldest()) === null,
      "the flagged record is skipped — this is the state the append below has to escape",
    );

    // Still inside minute M, so this appends to the flagged file itself.
    assert(await handle.append(received(harness, [sample(2)])), "the append into the refused minute succeeds");
    assert(handle.buffered === 2, `both lines are counted, got ${handle.buffered}`);

    const again = segment(
      await handle.oldest(),
      "an append that reached the file is fresh evidence it is reachable — the record " +
        "must be offered again, or the batch just written can never replay",
    );
    assert(
      again.samples.map((one) => one.sample.value).join(",") === "1,2",
      `the old line and the new one both replay, got ${again.samples.map((one) => one.sample.value).join(",")}`,
    );

    // The remount. A successful unlink still ends it, and the record goes.
    volume.refusing = false;
    await again.commit();
    assert(!(await exists(path)), "a successful unlink erases the file");
    assert(handle.buffered === 0, `and the record with it, got ${handle.buffered}`);
    assert((await handle.oldest()) === null, "nothing is left to replay");
    assert(
      errorLines(harness, "unlink failed").length === 1,
      `the volume was named once, not once per pass:\n${harness.lines.join("\n")}`,
    );
  });
}
