import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const composePath = join(repoRoot, "docker-compose.yml");

/**
 * `F1.10` — the ingest disk buffer's named volume is a repo invariant.
 *
 * ADR 0016 Amendment 4 ruling 4 puts the buffer at `INGEST_BUFFER_DIR` on a
 * **named** Compose volume so that an hour of spilled telemetry survives a
 * container replace, not only a database outage. Nothing at run time can tell
 * a named volume from the container's writable layer: the directory exists,
 * the probe write succeeds, the health line says `buffered=`, and every suite
 * is green. The difference shows up once, on the next `docker compose up -d`
 * after an outage, as a buffer that is simply gone. So the mount is held here,
 * statically, the way `tests/adr-0041-notification-invariants.test.ts` holds
 * what the committed stack must not say.
 *
 * Only the running stack proves the mount is actually there (step 6 of the
 * build loop); this file proves the committed file still asks for it.
 */

/** One constant, so the mount path and the variable's value cannot drift apart. */
const BUFFER_DIR = "/var/lib/bms-ingest";
const VOLUME = "bms-ingest-buffer";

/** Strip `#` comments so a commented-out line cannot satisfy an assertion. */
function withoutComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

/** The `ingest:` service block: from its heading to the next two-space service key. */
function ingestBlock(compose: string): string {
  const start = /^ {2}ingest:\s*$/m.exec(compose);
  expect(start, "docker-compose.yml must declare an `ingest` service").not.toBeNull();
  const after = compose.slice(start?.index ?? 0);
  const next = /\n {2}[A-Za-z_][\w-]*:\s*$/m.exec(after.slice(1));
  return next === null ? after : after.slice(0, next.index + 1);
}

describe("F1.10 — the ingest disk buffer sits on a named volume (ADR 0016 Amendment 4 ruling 4)", () => {
  const compose = withoutComments(readFileSync(composePath, "utf8"));

  it("mounts the named volume at INGEST_BUFFER_DIR on the ingest service", () => {
    const block = ingestBlock(compose);
    // The mount and the variable must name the same directory. A mount at one
    // path and a variable pointing at another is a buffer on the writable
    // layer with a volume nobody writes to — and every suite stays green.
    expect(block).toMatch(new RegExp(`^\\s*-\\s*${VOLUME}:${BUFFER_DIR}\\s*$`, "m"));
    expect(block).toMatch(new RegExp(`^\\s*INGEST_BUFFER_DIR:\\s*${BUFFER_DIR}\\s*$`, "m"));
  });

  it("declares the volume at the top level, so compose creates and keeps it", () => {
    // A mount that names an undeclared volume is a compose error at `up`, not
    // at commit — this is the half that fails earlier.
    const topLevel = /^volumes:\s*$/m.exec(compose);
    expect(topLevel, "docker-compose.yml must have a top-level `volumes:` block").not.toBeNull();
    const declared = compose.slice(topLevel?.index ?? 0);
    expect(declared).toMatch(new RegExp(`^ {2}${VOLUME}:\\s*$`, "m"));
  });
});
