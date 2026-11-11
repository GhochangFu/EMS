import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.17` / ADR 0125, plan §11 — every Socket.IO connection the SPA opens goes
 * through `apps/web/src/lib/live-socket.ts`'s `openLiveSocket`, which
 * reconnects after a rate-limited handshake (`rate_limited`, then the server's
 * disconnect). A new `io()` call site would silently miss that and leave its
 * live feed dead until a remount under `RATE_LIMIT_MODE=enforce`; this scan is
 * what fails. It reads the `import` of `io`, so a comment that mentions `io(`
 * does not count. It lives here, not beside the helper, because the web build
 * type-checks its spec files without Node's types.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const webSrc = join(repoRoot, "apps", "web", "src");
const HELPER = "lib/live-socket.ts";
/**
 * Every `import … from "socket.io-client"` except `import type`: a default
 * import, `{ io }`, `{ connect }`, `{ Manager }` and `* as` all open a socket
 * (code review 3), so the scan refuses any value import, not only `io`.
 */
const SOCKET_IMPORT = /import\s+([^;]*?)\s+from\s*["']socket\.io-client["']/g;

function hasValueImport(source: string): boolean {
  for (const match of source.matchAll(SOCKET_IMPORT)) {
    const clause = match[1].trim();
    if (clause.startsWith("type ")) continue;
    const named = /^\{([^}]*)\}$/.exec(clause);
    if (named && named[1].split(",").every((part) => part.trim() === "" || part.trim().startsWith("type "))) continue;
    return true;
  }
  return false;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("F4.17 — the SPA opens sockets only through openLiveSocket", () => {
  it("recognises every value-import form and lets a type-only import through", () => {
    expect(hasValueImport('import { io } from "socket.io-client";')).toBe(true);
    expect(hasValueImport('import io from "socket.io-client";')).toBe(true);
    expect(hasValueImport("import { connect } from 'socket.io-client';")).toBe(true);
    expect(hasValueImport('import { Manager, type Socket } from "socket.io-client";')).toBe(true);
    expect(hasValueImport('import * as sio from "socket.io-client";')).toBe(true);
    expect(hasValueImport('import type { Socket } from "socket.io-client";')).toBe(false);
    expect(hasValueImport('import { type Socket } from "socket.io-client";')).toBe(false);
  });

  it("imports a value from socket.io-client in the helper and nowhere else", () => {
    const files = sourceFiles(webSrc);
    const importers = files
      .filter((file) => hasValueImport(readFileSync(file, "utf8")))
      .map((file) => relative(webSrc, file).replace(/\\/g, "/"));
    expect(files.length, "the walk found no web source files").toBeGreaterThan(100);
    // The positive twin: the helper itself is found, so an empty list cannot mean a broken pattern.
    expect(importers, "the helper must be the one importer").toEqual([HELPER]);
  });
});
