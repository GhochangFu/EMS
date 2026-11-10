import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `E7.2` / ADR 0123 decision 4 — a wire sample is the disk buffer's segment
 * line plus `protocol`.
 *
 * The edge spills a failed batch with the `F1.10` store and later posts the
 * replayed samples; the cloud writes them. If the segment line gains a field
 * the wire does not carry, a replayed sample loses it on the way up with every
 * suite green; if the wire gains one the line does not hold, a sample that
 * went through the buffer arrives without it. Nothing at run time compares the
 * two, so the key sets are held equal here.
 *
 * `lineSchema` is private to `disk-buffer.ts` (and that file is at 981 of the
 * 1000-line cap), so its keys are read from the source, as the other `tests/`
 * scans do; the wire's keys come from the built `./ingest` subpath both ends
 * load. Inline assertions are the `tests/` carve-out in AGENTS.md §4.6.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const diskBufferPath = join(repoRoot, "apps", "ingest", "src", "host", "disk-buffer.ts");
const require_ = createRequire(import.meta.url);

/** The six fields of a segment line, as `F1.10` and ADR 0016 Amendment 5 wrote them. */
const SEGMENT_LINE_KEYS = ["at", "deviceKey", "good", "rx", "sourceKey", "value"];

/** Top-level keys of `const lineSchema = z.object({ … });`, comments stripped. */
function lineSchemaKeys(): string[] {
  const source = readFileSync(diskBufferPath, "utf8");
  const block = /const lineSchema = z\.object\(\{\n([\s\S]*?)\n\}\);/.exec(source);
  expect(block, "`const lineSchema = z.object({ … });` was not found in disk-buffer.ts").not.toBeNull();
  const body = (block?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return [...body.matchAll(/^ {2}(\w+)\s*:/gm)].map((m) => m[1]).sort();
}

function wireSampleKeys(): string[] {
  const { uplinkSampleSchema } = require_("@bms/shared/ingest") as {
    uplinkSampleSchema: { shape: Record<string, unknown> };
  };
  return Object.keys(uplinkSampleSchema.shape).sort();
}

describe("E7.2 — uplink sample and segment line carry the same fields", () => {
  it("reads six keys from lineSchema, so the comparison is not vacuous", () => {
    expect(lineSchemaKeys()).toEqual(SEGMENT_LINE_KEYS);
  });

  it("carries protocol on the wire and is otherwise the segment line", () => {
    const wire = wireSampleKeys();
    expect(wire, "the wire sample must name its protocol").toContain("protocol");
    expect(
      wire.filter((k) => k !== "protocol"),
      "uplinkSampleSchema minus `protocol` must equal disk-buffer.ts lineSchema. A field on one " +
        "side only is lost, or invented, for every sample that crossed the edge's buffer — add it " +
        "to both, or say in ADR 0123 why the two shapes part.",
    ).toEqual(lineSchemaKeys());
  });
});
