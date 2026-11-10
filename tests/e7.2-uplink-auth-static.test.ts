import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `E7.2` / ADR 0123 decision 5, plan T3.1 and M17 — the uplink receiver's token
 * compare is constant-time, on the source.
 *
 * No behavioural test can fail on this: `===` over two digests returns the
 * same answers as `timingSafeEqual`, only faster for a wrong guess. So the rule
 * is read from the comment-stripped text of
 * `apps/ingest/src/host/uplink-gateways.ts`:
 *
 * 1. `timingSafeEqual` is imported from `node:crypto` and called inside a
 *    `for … of snapshot.gateways` loop — every row, not a filtered or found one;
 * 2. that loop holds no `break` and no `return`, so it never exits early;
 * 3. no line that names a hash or digest compares it with `==`/`===`/`!=`/`!==`
 *    (other than against `null`/`undefined`), and nothing calls `.equals(` or
 *    `.compare(` in the file;
 * 4. the presented token is hashed with SHA-256 before the compare, so the
 *    stored hash is never itself accepted as a credential;
 * 5. no other runtime file under `apps/ingest/src` reads the token hash, but
 *    `uplink-write.ts`, which names it once, as the commit's SQL predicate.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const AUTH_FILE = "apps/ingest/src/host/uplink-gateways.ts";
const WRITE_FILE = "apps/ingest/src/host/uplink-write.ts";

const BLOCK_COMMENT = new RegExp(["/", "\\*", "[\\s\\S]*?", "\\*", "/"].join(""), "g");
const LINE_COMMENT = /\/\/.*$/gm;

/** Strips comments so the explanation in the file does not count as code. */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
}

const code = stripComments(readFileSync(join(repoRoot, AUTH_FILE), "utf8"));

/** The text of the block that opens at the first `{` at or after `from`. */
function blockAt(source: string, from: number): string {
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces");
}

function runtimeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...runtimeFiles(path));
    } else if (name.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(name)) {
      out.push(relative(repoRoot, path).replaceAll("\\", "/"));
    }
  }
  return out;
}

describe("E7.2 — the uplink token compare is constant-time (ADR 0123 decision 5)", () => {
  it("positive control: the stripped source still holds authenticate", () => {
    expect(code).toMatch(/export function authenticate\(/);
  });

  it("imports timingSafeEqual from node:crypto and calls it inside a loop over every gateway", () => {
    expect(code).toMatch(/import \{[^}]*\btimingSafeEqual\b[^}]*\} from "node:crypto";/);
    const loopAt = code.search(/for \(const \w+ of snapshot\.gateways\)/);
    expect(loopAt, "authenticate must loop over snapshot.gateways itself, not a filtered list").toBeGreaterThan(0);
    const loop = blockAt(code, loopAt);
    expect(loop).toMatch(/\btimingSafeEqual\(/);
    expect(code.match(/\btimingSafeEqual\(/g)?.length, "exactly one compare call").toBe(1);
  });

  it("never exits the compare loop early", () => {
    const loop = blockAt(code, code.search(/for \(const \w+ of snapshot\.gateways\)/));
    expect(loop, "a break leaks which row matched through timing").not.toMatch(/\bbreak\b/);
    expect(loop, "a return leaks which row matched through timing").not.toMatch(/\breturn\b/);
  });

  it("never compares a hash with an equality operator, .equals( or .compare(", () => {
    expect(code).not.toMatch(/\.equals\(/);
    expect(code).not.toMatch(/\.compare\(/);
    const offenders = code
      .split("\n")
      .filter((line) => /hash|digest/i.test(line) && /[!=]==?/.test(line))
      .filter((line) => line.replace(/[!=]==?\s*(null|undefined)\b/g, "").match(/[!=]==?/) !== null);
    expect(offenders, `hash or digest compared with an equality operator:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("hashes the presented token with SHA-256 before the compare", () => {
    expect(code).toMatch(/createHash\("sha256"\)/);
    const body = blockAt(code, code.indexOf("export function authenticate("));
    const hashAt = body.search(/\bhashToken\(/);
    const compareAt = body.search(/\btimingSafeEqual\(/);
    expect(hashAt, "authenticate must hash the presented token").toBeGreaterThan(0);
    expect(hashAt, "the token is hashed before it is compared").toBeLessThan(compareAt);
  });

  it("no other runtime file in apps/ingest/src reads the token hash or calls timingSafeEqual", () => {
    const files = runtimeFiles(join(repoRoot, "apps/ingest/src"));
    expect(files, "positive control: the scan read the auth file").toContain(AUTH_FILE);
    const readers = files.filter((file) =>
      /token_hash|tokenHash|timingSafeEqual/.test(stripComments(readFileSync(join(repoRoot, file), "utf8"))),
    );
    expect(readers).toEqual([AUTH_FILE, WRITE_FILE]);
  });

  /**
   * Security review M1: the write binds its commit to the digest the request
   * authenticated with. That compare runs in Postgres **after**
   * `authenticate` has matched the same digest in constant time, so it can
   * leak nothing a caller does not already know. It is the only other place
   * the hash may be named, and only as that one SQL predicate.
   */
  it("uplink-write.ts names the hash only as the commit's `g.token_hash = $7` predicate", () => {
    const write = stripComments(readFileSync(join(repoRoot, WRITE_FILE), "utf8"));
    expect(write.match(/token_hash|tokenHash/g)).toEqual(["token_hash"]);
    expect(write).toMatch(/AND g\.token_hash = \$7\b/);
    expect(write).not.toMatch(/timingSafeEqual|\.equals\(|\.compare\(/);
  });
});
