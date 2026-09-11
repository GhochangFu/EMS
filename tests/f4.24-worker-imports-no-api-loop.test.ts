import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiSrc = join(repoRoot, "apps", "api", "src");

/**
 * `F4.24` / ADR 0063 decision 3, as **Amendment 1** re-states its gate: the
 * worker process starts no loop the API process starts — no sweep, no
 * streaming engine, no `LISTEN` — by construction of the module graph, never
 * by a flag.
 *
 * The ADR first asked for a spec that boots `WorkerModule` and watches
 * `runSweepLoop` never enter. No spec in `apps/api` boots a Nest module
 * (vitest runs specs through esbuild, which emits no `design:paramtypes`, so
 * constructor injection cannot resolve — AGENTS.md §4.6, `F4.20`). The gate
 * moved here: a **static import-closure invariant**. Every loop is started
 * from an `onModuleInit` in a file the API's graph reaches; if the worker's
 * relative import closure never reaches that file, the worker cannot start
 * the loop. The other half of the gate — `pg_stat_activity` empty for the
 * worker's address while the API's `LISTEN bms_telemetry` backend is present
 * — is a stack measurement in the closure row, not a test.
 *
 * **The walker over-approximates on purpose.** It follows `import type`
 * lines, which the compiler erases, and dynamic `import(...)` calls; for an
 * absence claim the safe error is to see too much. It strips comments first,
 * so a docblock that quotes a path (as this one does) is not an edge.
 *
 * **Rule 3 is the positive control**, without which a walker that follows
 * nothing passes rule 2 vacuously: the same walk over `main.ts` must reach
 * every one of the thirteen files. Rule 1's own controls are the same shape —
 * the worker's closure must reach the modules it is built from.
 *
 * This is what fences `F3.11`: the day `WorkerModule` gains
 * `imports: [RulesModule]`, rule 2 reddens naming `rules/rules.module.ts`,
 * `alarms/alarms.module.ts`, `telemetry/telemetry.module.ts` and every loop
 * site behind them, and the split happens then, under that row.
 */

// ---------------------------------------------------------------------------
// The thirteen files, in the ADR's four groups
// ---------------------------------------------------------------------------

/** The six `onModuleInit` loop sites (ADR 0063 Context 2). */
const LOOP_SITES = [
  "alarms/alarm-engine.service.ts",
  "alarms/alarm-lifecycle.service.ts",
  "asset-health/health-rollup.service.ts",
  "calc/calc-scheduler.service.ts",
  "calc/calc-streaming.service.ts",
  "telemetry/telemetry-notify.service.ts",
] as const;

/** The two loop hosts: the sweep primitive and the `LISTEN` client. */
const LOOP_HOSTS = ["scheduling/sweep-loop.ts", "telemetry/telemetry-listener.ts"] as const;

/** The five modules whose providers start a loop, or import one that does. */
const LOOP_MODULES = [
  "alarms/alarms.module.ts",
  "calc/calc.module.ts",
  "asset-health/asset-health.module.ts",
  "telemetry/telemetry.module.ts",
  "rules/rules.module.ts",
] as const;

/** The API root and its entrypoint — a worker that reaches either is the API. */
const API_ROOTS = ["app.module.ts", "main.ts"] as const;

const ALL_THIRTEEN = [...LOOP_SITES, ...LOOP_HOSTS, ...LOOP_MODULES, ...API_ROOTS];

/** What the worker's closure must reach — the modules `WorkerModule` is built from. */
const WORKER_LEAVES = [
  "worker.module.ts",
  "queue/queue.module.ts",
  "queue/worker-host.service.ts",
  "queue/worker-host.ts",
  "health/health.controller.ts",
  "database/database.module.ts",
  "observability/observability.module.ts",
] as const;

// ---------------------------------------------------------------------------
// The walker
// ---------------------------------------------------------------------------

/** Block comments and `//` tails go first, so a quoted path in a docblock is not an edge. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * Every module specifier in one file's text: `import … from "x"`,
 * `export … from "x"`, side-effect `import "x"`, and dynamic `import("x")`.
 * `import type … from "x"` matches the first form and is followed too.
 */
function specifiers(src: string): string[] {
  const code = stripComments(src);
  const found: string[] = [];
  for (const re of [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const match of code.matchAll(re)) {
      found.push(match[1] as string);
    }
  }
  return found;
}

/** A relative specifier resolved to a file: `x.ts`, then `x/index.ts`; `x.js` reads as `x.ts`. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ""));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (candidate.endsWith(".ts") || candidate.endsWith(".tsx")) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function posixRelative(file: string): string {
  return relative(apiSrc, file).replace(/\\/g, "/");
}

type Closure = { files: Set<string>; unresolved: string[] };

/**
 * BFS over the relative-import closure of `entryRel` (a path under
 * `apps/api/src`). Non-relative specifiers (`@nestjs/*`, `bullmq`,
 * `@bms/shared`) are not followed — the claim is about this app's own files.
 * Returns posix paths relative to `apps/api/src`, and every relative
 * specifier the walker could not resolve, which rule 1 asserts is empty.
 */
function closure(entryRel: string): Closure {
  const entry = join(apiSrc, entryRel);
  const files = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (files.has(file)) continue;
    files.add(file);
    const src = readFileSync(file, "utf8");
    for (const spec of specifiers(src)) {
      if (!spec.startsWith(".")) continue;
      const target = resolveRelative(file, spec);
      if (target === null) {
        unresolved.push(`${posixRelative(file)} -> ${spec}`);
        continue;
      }
      if (!files.has(target)) queue.push(target);
    }
  }
  return { files: new Set([...files].map(posixRelative)), unresolved };
}

function present(c: Closure, paths: readonly string[]): string[] {
  return paths.filter((p) => c.files.has(p));
}

function absent(c: Closure, paths: readonly string[]): string[] {
  return paths.filter((p) => !c.files.has(p));
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

describe("F4.24 — the worker imports no API loop (ADR 0063 decision 3, Amendment 1)", () => {
  describe("rule 1 — the walker resolves every relative import it meets", () => {
    it("resolves every relative specifier in the worker's closure", () => {
      const c = closure("worker.ts");
      expect(
        c.unresolved,
        "relative imports the walker could not resolve — an unresolved edge is a hole in an absence claim:\n" +
          c.unresolved.join("\n"),
      ).toEqual([]);
    });

    it("resolves every relative specifier in the API's closure", () => {
      const c = closure("main.ts");
      expect(
        c.unresolved,
        "relative imports the walker could not resolve — an unresolved edge is a hole in the positive control:\n" +
          c.unresolved.join("\n"),
      ).toEqual([]);
    });

    it("reaches the modules WorkerModule is built from (the walker follows something)", () => {
      const c = closure("worker.ts");
      const missing = absent(c, WORKER_LEAVES);
      expect(
        missing,
        "files the worker's closure must contain and does not — either WorkerModule lost an import " +
          "or the walker follows nothing:\n" +
          missing.join("\n"),
      ).toEqual([]);
    });
  });

  describe("rule 2 — the closure of apps/api/src/worker.ts contains none of the thirteen", () => {
    it("reaches none of the six onModuleInit loop sites", () => {
      const offending = present(closure("worker.ts"), LOOP_SITES);
      expect(
        offending,
        "the worker's import closure reaches these loop sites — it would start a loop the API " +
          "starts (ADR 0063 decision 3):\n" +
          offending.join("\n"),
      ).toEqual([]);
    });

    it("reaches neither scheduling/sweep-loop.ts nor telemetry/telemetry-listener.ts", () => {
      const offending = present(closure("worker.ts"), LOOP_HOSTS);
      expect(
        offending,
        "the worker's import closure reaches the sweep primitive or the LISTEN client:\n" +
          offending.join("\n"),
      ).toEqual([]);
    });

    it("reaches none of the five loop-bearing modules (alarms, calc, asset-health, telemetry, rules)", () => {
      const offending = present(closure("worker.ts"), LOOP_MODULES);
      expect(
        offending,
        "the worker's import closure reaches these modules — F3.11's `imports: [RulesModule]` " +
          "is the day this reddens, and the split is that row's:\n" +
          offending.join("\n"),
      ).toEqual([]);
    });

    it("reaches neither app.module.ts nor main.ts", () => {
      const offending = present(closure("worker.ts"), API_ROOTS);
      expect(
        offending,
        "the worker's import closure reaches the API root — WorkerModule is a second root, " +
          "not a subset of AppModule:\n" +
          offending.join("\n"),
      ).toEqual([]);
    });
  });

  describe("rule 3 — positive control: the closure of apps/api/src/main.ts contains every one of the thirteen", () => {
    it("reaches all thirteen files from main.ts", () => {
      const missing = absent(closure("main.ts"), ALL_THIRTEEN);
      expect(
        missing,
        "files the API's closure does not reach — either a loop moved (update the list with its " +
          "ADR) or the walker follows nothing and rule 2 passed vacuously:\n" +
          missing.join("\n"),
      ).toEqual([]);
    });
  });

  describe("rule 4 — the entrypoint exists and the script runs it (decision 2)", () => {
    it("apps/api/src/worker.ts exists", () => {
      expect(existsSync(join(apiSrc, "worker.ts"))).toBe(true);
    });

    it('apps/api/package.json scripts.worker is "node dist/worker.js"', () => {
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, "apps", "api", "package.json"), "utf8"),
      ) as { scripts?: Record<string, string> };
      expect(manifest.scripts?.worker).toBe("node dist/worker.js");
    });
  });

  describe("rule 5 — compose (decisions 8 and 12; the adr-0041 / f1.10 precedent) — Unit 6", () => {
    // Written as `it.todo` so every commit before Unit 6 stays green; Unit 6
    // turns each into an `it()` with the assertion its name states.
    it.todo(
      'the redis service\'s command contains "--appendonly" followed by "yes" (decision 8: a restart replays the queue)',
    );
    it.todo(
      'the redis service\'s command contains "--maxmemory-policy" followed by "noeviction" (decision 8: BullMQ requires it)',
    );
    it.todo("the redis service mounts the named volume redis-data at /data, and redis-data is declared under volumes:");
    it.todo('a worker service exists with command: ["node", "dist/worker.js"] (decision 12)');
    it.todo("the worker service carries the profiles core, pilot and phe (decision 12)");
    it.todo("the worker service sets REDIS_URL (the worker refuses to boot without it, decision 9)");
    it.todo("the worker service sets WORKER_PORT: 4100 and publishes 4100:4100");
    it.todo("the worker service's depends_on names redis and migrate (decision 12)");
  });
});
