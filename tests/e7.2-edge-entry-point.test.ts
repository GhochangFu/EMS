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

/** Block comments and `//` tails, so a commented-out import cannot count either way. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
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

/** Every specifier `file` loads at run time. */
function runtimeImports(source: string): string[] {
  const src = withoutComments(source);
  const found: string[] = [];
  for (const match of src.matchAll(/(?:^|[\n;])\s*(?:import|export)\s+([^;'"]*?)\s*from\s*["']([^"']+)["']/g)) {
    if (!typeOnly(match[1])) {
      found.push(match[2]);
    }
  }
  for (const match of src.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g)) {
    found.push(match[1]);
  }
  for (const match of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push(match[1]);
  }
  return found;
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
function walkFrom(entry: string): { files: Set<string>; packages: Set<string>; unresolved: string[] } {
  const files = new Set<string>();
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
    for (const specifier of runtimeImports(readFileSync(file, "utf8"))) {
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
  return { files, packages, unresolved };
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
    expect(runtimeImports('import type { A } from "./a.js";\nimport { type B, type C } from "./b.js";')).toEqual([]);
    expect(runtimeImports('import { type B, c } from "./b.js";\nexport { d } from "./d.js";')).toEqual([
      "./b.js",
      "./d.js",
    ]);
    expect(runtimeImports('// import pg from "pg";\nimport "./side.js";')).toEqual(["./side.js"]);
  });

  it("edge-main.ts reaches no pg, no @bms/db and no cloud-only module", () => {
    const edge = walkFrom("edge-main.ts");
    expect(edge.unresolved, "every relative import resolves").toEqual([]);
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
