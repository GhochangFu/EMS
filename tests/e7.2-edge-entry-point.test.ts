import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `E7.2` / ADR 0123 decision 2, ADR 0016 Amendment 9 (c), plan T5.7 — the edge
 * entry point cannot reach Postgres.
 *
 * `tests/repo-invariants.test.ts` says `apps/ingest/src` holds exactly
 * `main.ts` and `edge-main.ts`. This file says what tells them apart: walking
 * the **runtime** import graph from `edge-main.ts` reaches no `pg`, no
 * `@bms/db`, and none of the cloud-only modules (the normaliser, the binding
 * query, the reload registry, credential decryption, the uplink receiver and
 * the aggregate repair). `import type` and all-`type` specifier lists are
 * skipped, because they are erased at compile time — `edge-plan.ts` imports
 * `EndpointPlan` from `bindings.ts` exactly that way (plan M6). The same walk
 * from `main.ts` must reach `pg`, so a walker that read nothing cannot pass.
 *
 * And the edge's compose file runs that entry point with a named buffer
 * volume, no database URL and no published port (plan C14).
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ingestSrc = join(repoRoot, "apps", "ingest", "src");

/**
 * One pass over the source that knows strings, template literals and regex
 * literals, so a string holding `/*` or `//` cannot swallow the code after it.
 * Both outputs keep every offset: `code` has comments blanked and strings
 * intact; `bare` has string and regex contents blanked too, for searching
 * code only.
 */
function scan(src: string): { code: string; bare: string } {
  const code = src.split("");
  const bare = src.split("");
  const blank = (from: number, to: number, both: boolean): void => {
    for (let k = from; k < to; k += 1) {
      if (src[k] === "\n") continue;
      bare[k] = " ";
      if (both) code[k] = " ";
    }
  };
  let i = 0;
  let prev = "";
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i);
      blank(i, end, true);
      i = end;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2) === -1 ? src.length : src.indexOf("*/", i + 2) + 2;
      blank(i, end, true);
      i = end;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, j, false);
      i = j + 1;
      prev = c;
    } else if (c === "/" && (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n" && (inClass || src[j] !== "/")) {
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j += src[j] === "\\" ? 2 : 1;
      }
      blank(i + 1, j, false);
      i = j + 1;
      prev = "/";
    } else {
      if (!/\s/.test(c)) prev = c;
      i += 1;
    }
  }
  return { code: code.join(""), bare: bare.join("") };
}

/** `true` for `type X`, `{ type A, type B }` — a clause the compiler erases. */
function typeOnly(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\s/.test(trimmed)) {
    return true;
  }
  const braces = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (braces === null) {
    return false;
  }
  const specifiers = braces[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return specifiers.length > 0 && specifiers.every((s) => /^type\s/.test(s));
}

/**
 * Every specifier the source loads at run time, and every load the walker
 * cannot follow: an `import(` or `require(` whose argument is not one string
 * literal, or any `createRequire`. A load the walker cannot follow fails the
 * test rather than being trusted.
 */
function runtimeImports(source: string): { specifiers: string[]; unfollowable: string[] } {
  const { code, bare } = scan(source);
  const specifiers: string[] = [];
  const unfollowable: string[] = [];
  for (const match of code.matchAll(/(?:^|[\n;])\s*(?:import|export)\s+([^;'"]*?)\s*from\s*["']([^"']+)["']/g)) {
    if (!typeOnly(match[1])) {
      specifiers.push(match[2]);
    }
  }
  for (const match of code.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g)) {
    specifiers.push(match[1]);
  }
  for (const match of bare.matchAll(/\b(import|require)\s*\(/g)) {
    const at = (match.index ?? 0) + match[0].length;
    const literal = /^\s*(["'])[^"'\n]*\1\s*\)/.exec(bare.slice(at));
    const spec = literal === null ? null : /^\s*["']([^"']*)["']/.exec(code.slice(at));
    if (spec === null) {
      unfollowable.push(`${match[1]}(${code.slice(at, at + 30).split("\n")[0]}`);
    } else {
      specifiers.push(spec[1]);
    }
  }
  if (/\bcreateRequire\b/.test(bare)) {
    unfollowable.push("createRequire");
  }
  return { specifiers, unfollowable };
}

/** A relative `./x.js` to the file on disk (`x.ts`, or the `.js` itself). */
function resolveRelative(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base.replace(/\.js$/, ".ts"), base, `${base}.ts`]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** The runtime closure from `entry`: source files (relative to `src/`) and bare packages. */
function walkFrom(entry: string): {
  files: Set<string>;
  packages: Set<string>;
  unresolved: string[];
  unfollowable: string[];
} {
  const files = new Set<string>();
  const unfollowable: string[] = [];
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const pending = [join(ingestSrc, entry)];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    const rel = relative(ingestSrc, file).split("\\").join("/");
    if (files.has(rel)) {
      continue;
    }
    files.add(rel);
    const found = runtimeImports(readFileSync(file, "utf8"));
    unfollowable.push(...found.unfollowable.map((u) => `${rel}: ${u}`));
    for (const specifier of found.specifiers) {
      if (specifier.startsWith(".")) {
        const next = resolveRelative(file, specifier);
        if (next === undefined) {
          unresolved.push(`${rel} -> ${specifier}`);
        } else {
          pending.push(next);
        }
      } else {
        packages.add(specifier);
      }
    }
  }
  return { files, packages, unresolved, unfollowable };
}

/** Modules only the cloud host may load: each one reads, writes or plans against Postgres. */
const CLOUD_ONLY_FILES = [
  "host/normaliser.ts",
  "host/bindings.ts",
  "host/reconcile.ts",
  "rtu-config.js",
  "host/uplink-server.ts",
  "host/uplink-write.ts",
  "host/uplink-receiver.ts",
  "host/uplink-gateways.ts",
  "host/aggregate-repair.ts",
];

const reachesDatabasePackage = (packages: Set<string>): string[] =>
  [...packages].filter((p) => p === "pg" || p === "@bms/db" || p.startsWith("@bms/db/") || p.startsWith("pg/"));

describe("E7.2 — the edge entry point cannot reach Postgres (ADR 0123 decision 2)", () => {
  it("the walker skips type-only imports and follows the rest", () => {
    const specs = (src: string) => runtimeImports(src).specifiers;
    expect(specs('import type { A } from "./a.js";\nimport { type B, type C } from "./b.js";')).toEqual([]);
    expect(specs('import { type B, c } from "./b.js";\nexport { d } from "./d.js";')).toEqual(["./b.js", "./d.js"]);
    expect(specs('// import pg from "pg";\nimport "./side.js";')).toEqual(["./side.js"]);
    expect(specs('const x = await import("pg");\nconst y = require("@bms/db");')).toEqual(["pg", "@bms/db"]);
  });

  it("a string holding a comment opener cannot hide an import", () => {
    expect(runtimeImports('const s = "/*";\nimport pg from "pg";\nconst t = "*/";').specifiers).toEqual(["pg"]);
    expect(runtimeImports("const r = /[\"'/*]/;\nimport pg from \"pg\";\n").specifiers).toEqual(["pg"]);
  });

  it("a load the walker cannot follow is reported, never trusted", () => {
    expect(runtimeImports('const m = "p" + "g";\nawait import(m);').unfollowable).toHaveLength(1);
    expect(runtimeImports("const db = require(name);").unfollowable).toHaveLength(1);
    expect(runtimeImports('import { createRequire } from "node:module";\ncreateRequire(import.meta.url)("pg");').unfollowable).toContain(
      "createRequire",
    );
    expect(runtimeImports('log("import(x) in a string");').unfollowable).toEqual([]);
  });

  it("edge-main.ts reaches no pg, no @bms/db and no cloud-only module", () => {
    const edge = walkFrom("edge-main.ts");
    expect(edge.unresolved, "every relative import resolves").toEqual([]);
    expect(edge.unfollowable, "every load from edge-main.ts is a string literal the walk follows").toEqual([]);
    // Positive controls: the walk reached the edge's own modules, including
    // one that type-imports `bindings.ts`.
    for (const file of ["host/uplink-client.ts", "host/supervisor.ts", "host/disk-buffer.ts", "host/edge-plan.ts", "adapters/mqtt.ts"]) {
      expect(edge.files.has(file), `the edge walk must reach ${file}`).toBe(true);
    }
    expect(reachesDatabasePackage(edge.packages), "edge-main.ts must not reach a database package").toEqual([]);
    expect(CLOUD_ONLY_FILES.filter((f) => edge.files.has(f)), "edge-main.ts reaches a cloud-only module").toEqual([]);
  });

  it("main.ts reaches pg (positive control: only main.ts reaches Postgres)", () => {
    const cloud = walkFrom("main.ts");
    expect(cloud.unresolved).toEqual([]);
    expect(reachesDatabasePackage(cloud.packages)).toContain("pg");
    expect(cloud.files.has("host/normaliser.ts") && cloud.files.has("host/uplink-server.ts")).toBe(true);
  });
});

/** Top-level `#` comments and trailing ones, so a commented line cannot satisfy a claim. */
function withoutYamlComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

describe("E7.2 — deploy/edge/docker-compose.yml (plan C14)", () => {
  const compose = withoutYamlComments(readFileSync(join(repoRoot, "deploy", "edge", "docker-compose.yml"), "utf8"));

  it("runs node dist/edge-main.js", () => {
    expect(compose).toMatch(/^\s+command:\s*\["node",\s*"dist\/edge-main\.js"\]\s*$/m);
  });

  it("mounts a named volume at EDGE_BUFFER_DIR", () => {
    const dir = /^\s+EDGE_BUFFER_DIR:\s*(\S+)\s*$/m.exec(compose)?.[1];
    expect(dir, "EDGE_BUFFER_DIR is set").toBeDefined();
    const mount = new RegExp(`^\\s+-\\s*([A-Za-z][\\w-]*):${(dir as string).replace(/[/.]/g, "\\$&")}\\s*$`, "m").exec(compose);
    expect(mount, `a volume is mounted at ${dir}`).not.toBeNull();
    const volume = (mount as RegExpExecArray)[1];
    expect(compose, `${volume} is a named volume, declared at the top level`).toMatch(
      new RegExp(`^volumes:\\s*\\n\\s+${volume}:`, "m"),
    );
  });

  it("sets no DATABASE_URL and publishes no port", () => {
    expect(compose).toContain("edge:");
    expect(compose).not.toMatch(/DATABASE_URL/);
    expect(compose).not.toMatch(/^\s+ports:/m);
  });
});
