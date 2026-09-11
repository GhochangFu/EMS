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
 * every one of the eighteen files but `main.ts` itself — an entry is in its
 * own closure by construction, so its presence there proves nothing about
 * the walker. Rule 1's own controls are the same shape — the worker's
 * closure must reach the modules it is built from.
 *
 * **`F3.11` (ADR 0064 decision 3, Amendment 1 A1/A2) made the split this
 * file was waiting for.** The worker now imports `RuleSweepModule`, a
 * loop-free carve whose closure reaches `AlarmRaiser` and
 * `NotificationsService` but none of the eighteen; `RulesModule` and
 * `AlarmsModule` stay forbidden, and a worker that reaches either is a
 * defect the ADR names, not a shortcut. Three lists grew with that row: the
 * `NOTIFY bms_alarms` listener (`alarms/alarm-notify.service.ts`) is a
 * seventh loop site, the generic `LISTEN` loop it and the telemetry listener
 * share (`database/notify-listener.ts`) and its alarm adapter
 * (`alarms/alarm-notify.ts`) are the third and fourth loop hosts, and
 * `WORKER_LEAVES` names the nine files the worker's graph now reaches.
 * Two rules were added: **rule 6**, the worker mounts exactly two
 * controllers (`health`, `metrics`) — the gate on Amendment 1 A1, where
 * importing `AuthModule` or `NotificationsModule` would have served `/auth`
 * and `/notifications` on `WORKER_PORT`; and **rule 7**, the API's closure
 * reaches no queue consumer (ADR 0064 decision 7: one consumer, on the
 * worker), with the worker's closure as the positive control.
 */

// ---------------------------------------------------------------------------
// The eighteen files (7 + 4 + 5 + 2), in the ADR's four groups. The first
// version of this file and plan §8 said "thirteen"; the review re-counted to
// fifteen; F3.11 added a loop site and two loop hosts.
// ---------------------------------------------------------------------------

/** The seven `onModuleInit` loop sites (ADR 0063 Context 2; the seventh is ADR 0064 decision 4's listener). */
const LOOP_SITES = [
  "alarms/alarm-engine.service.ts",
  "alarms/alarm-lifecycle.service.ts",
  "alarms/alarm-notify.service.ts",
  "asset-health/health-rollup.service.ts",
  "calc/calc-scheduler.service.ts",
  "calc/calc-streaming.service.ts",
  "telemetry/telemetry-notify.service.ts",
] as const;

/**
 * The four loop hosts: the sweep primitive, the telemetry `LISTEN` adapter,
 * the generic `LISTEN` loop both adapters run on (ADR 0064 Amendment 1 A2),
 * and the alarm `LISTEN` adapter.
 */
const LOOP_HOSTS = [
  "scheduling/sweep-loop.ts",
  "telemetry/telemetry-listener.ts",
  "database/notify-listener.ts",
  "alarms/alarm-notify.ts",
] as const;

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

const ALL_EIGHTEEN = [...LOOP_SITES, ...LOOP_HOSTS, ...LOOP_MODULES, ...API_ROOTS];

/**
 * Rule 3 walks from `main.ts`, and an entry is always in its own closure —
 * so `main.ts` is dropped from the positive control: seventeen files the
 * walker must actually *follow* an edge to reach.
 */
const POSITIVE_CONTROL = ALL_EIGHTEEN.filter((p) => p !== "main.ts");

/**
 * What the worker's closure must reach — the modules `WorkerModule` is built
 * from. Since `F3.11` that includes the two provider-only carves
 * (`AccessControlModule`, `NotificationsCoreModule`), the loop-free
 * `AlarmRaiseModule`, `RuleSweepModule` with its service and body, and the
 * `rules-sweep` declaration. This list is the enumeration of what the worker
 * may import; a module not named here is not a leaf until its row adds it.
 */
const WORKER_LEAVES = [
  "worker.module.ts",
  "queue/queue.module.ts",
  "queue/worker-host.service.ts",
  "queue/worker-host.ts",
  "queue/rules-sweep.ts",
  "health/health.controller.ts",
  "database/database.module.ts",
  "observability/observability.module.ts",
  "auth/access-control.module.ts",
  "notifications/notifications-core.module.ts",
  "notifications/notifications.service.ts",
  "alarms/alarm-raise.module.ts",
  "alarms/alarm-raise.service.ts",
  "rules/rule-sweep.module.ts",
  "rules/rule-sweep.service.ts",
  "rules/rule-sweep.ts",
] as const;

/**
 * Rule 6: the two controllers the worker serves on `WORKER_PORT` — liveness
 * and the Prometheus scrape (ADR 0063 decisions 10, 11). Nothing else, by
 * Amendment 1 A1 of ADR 0064.
 */
const WORKER_CONTROLLERS = [
  "health/health.controller.ts",
  "observability/metrics.controller.ts",
] as const;

/**
 * Rule 7: the files that start or compose a queue consumer. The API's
 * closure reaches none — one consumer per queue, on the worker (ADR 0064
 * decision 7; ADR 0063 decision 12) — and the worker's reaches all four.
 */
const CONSUMER_FILES = [
  "queue/worker-host.ts",
  "queue/worker-host.service.ts",
  "rules/rule-sweep.module.ts",
  "rules/rule-sweep.service.ts",
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
// Rule 5's compose reader (the tests/f1.10-ingest-buffer-volume.test.ts
// precedent: hold the committed text statically, never the running stack).
// ---------------------------------------------------------------------------

/** Strip `#` comments so a commented-out line cannot satisfy an assertion. */
function withoutComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

/** One top-level `<name>:` service block: from its heading to the next two-space service key. */
function serviceBlock(compose: string, name: string): string {
  const start = new RegExp(`^ {2}${name}:\\s*$`, "m").exec(compose);
  expect(start, `docker-compose.yml must declare a \`${name}\` service`).not.toBeNull();
  const after = compose.slice(start?.index ?? 0);
  const next = /\n {2}[A-Za-z_][\w-]*:\s*$/m.exec(after.slice(1));
  return next === null ? after : after.slice(0, next.index + 1);
}

/**
 * The text from a heading line to the end of `block`, or `""` when the
 * heading is absent — so each `it()` below holds exactly one `expect`, and a
 * missing heading fails the `it()` that names it rather than a shared setup.
 */
function sectionAfter(block: string, heading: RegExp): string {
  const found = heading.exec(block);
  return found === null ? "" : block.slice(found.index);
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

  describe("rule 2 — the closure of apps/api/src/worker.ts contains none of the eighteen", () => {
    it("reaches none of the seven onModuleInit loop sites", () => {
      const offending = present(closure("worker.ts"), LOOP_SITES);
      expect(
        offending,
        "the worker's import closure reaches these loop sites — it would start a loop the API " +
          "starts (ADR 0063 decision 3):\n" +
          offending.join("\n"),
      ).toEqual([]);
    });

    it("reaches none of the four loop hosts (sweep-loop, telemetry-listener, notify-listener, alarm-notify)", () => {
      const offending = present(closure("worker.ts"), LOOP_HOSTS);
      expect(
        offending,
        "the worker's import closure reaches the sweep primitive or a LISTEN loop:\n" +
          offending.join("\n"),
      ).toEqual([]);
    });

    it("reaches none of the five loop-bearing modules (alarms, calc, asset-health, telemetry, rules)", () => {
      const offending = present(closure("worker.ts"), LOOP_MODULES);
      expect(
        offending,
        "the worker's import closure reaches these modules — the split happened under F3.11 " +
          "(RuleSweepModule, AlarmRaiseModule, NotificationsCoreModule, AccessControlModule); " +
          "a worker that reaches RulesModule or AlarmsModule is the defect ADR 0064 decision 3 names:\n" +
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

  describe("rule 3 — positive control: the closure of apps/api/src/main.ts contains every one of the eighteen but itself", () => {
    it("reaches the other seventeen files from main.ts", () => {
      const missing = absent(closure("main.ts"), POSITIVE_CONTROL);
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
    const composePath = join(repoRoot, "docker-compose.yml");
    const compose = withoutComments(readFileSync(composePath, "utf8"));
    const redis = serviceBlock(compose, "redis");
    const worker = serviceBlock(compose, "worker");

    it('the redis service\'s command contains "--appendonly" followed by "yes" (decision 8: a restart replays the queue)', () => {
      expect(redis).toMatch(/"--appendonly",\s*"yes"/);
    });

    it('the redis service\'s command contains "--maxmemory-policy" followed by "noeviction" (decision 8: BullMQ requires it)', () => {
      expect(redis).toMatch(/"--maxmemory-policy",\s*"noeviction"/);
    });

    it("the redis service mounts the named volume redis-data at /data (decision 8)", () => {
      expect(redis).toMatch(/^\s*-\s*redis-data:\/data\s*$/m);
    });

    it("docker-compose.yml has a top-level volumes: block", () => {
      expect(compose).toMatch(/^volumes:\s*$/m);
    });

    // ADR 0063 Amendment 2 (the 2026-09-11 security review, M3): Redis is
    // now a write path into the tenant database — the worker runs whatever
    // it finds under `bms:*` — so the host port binds to loopback. `api`,
    // `api-replica` and `worker` reach `redis:6379` on the compose network
    // and never use the published port; only host-side tooling does.
    it("the redis service publishes 6379 on 127.0.0.1 only (Amendment 2: loopback bind)", () => {
      expect(redis).toMatch(/^\s*-\s*"127\.0\.0\.1:6379:6379"\s*$/m);
    });

    it("the redis service does not publish 6379 on every interface (the negative of the row above)", () => {
      expect(redis).not.toMatch(/^\s*-\s*"6379:6379"\s*$/m);
    });

    it("redis-data is declared under the top-level volumes: block", () => {
      expect(sectionAfter(compose, /^volumes:\s*$/m)).toMatch(/^ {2}redis-data:\s*$/m);
    });

    it('a worker service exists with command: ["node", "dist/worker.js"] (decision 12)', () => {
      expect(worker).toMatch(/command:\s*\["node",\s*"dist\/worker\.js"\]/);
    });

    it("the worker service carries the profiles core, pilot and phe (decision 12)", () => {
      const profilesLine = /^\s*profiles:\s*\[([^\]]*)\]\s*$/m.exec(worker);
      expect(profilesLine, "worker service must declare a profiles: [...] line").not.toBeNull();
      const profiles = (profilesLine?.[1] ?? "").split(",").map((p) => p.trim().replace(/"/g, ""));
      expect(profiles).toEqual(["core", "pilot", "phe"]);
    });

    it("the worker service sets REDIS_URL (the worker refuses to boot without it, decision 9)", () => {
      expect(worker).toMatch(/^\s*REDIS_URL:\s*\S+/m);
    });

    it("the worker service sets WORKER_PORT: 4100", () => {
      expect(worker).toMatch(/^\s*WORKER_PORT:\s*4100\s*$/m);
    });

    it("the worker service publishes 4100:4100", () => {
      expect(worker).toMatch(/^\s*-\s*["']?4100:4100["']?\s*$/m);
    });

    it("the worker service declares depends_on: (decision 12)", () => {
      expect(worker).toMatch(/^\s*depends_on:\s*$/m);
    });

    it("the worker service's depends_on names redis", () => {
      expect(sectionAfter(worker, /^\s*depends_on:\s*$/m)).toMatch(/^\s*redis:\s*$/m);
    });

    it("the worker service's depends_on names migrate", () => {
      expect(sectionAfter(worker, /^\s*depends_on:\s*$/m)).toMatch(/^\s*migrate:\s*$/m);
    });
  });

  describe("rule 6 — the worker mounts no API route (ADR 0064 Amendment 1 A1) — F3.11", () => {
    it("the worker's closure holds exactly two controllers: health/health.controller.ts and observability/metrics.controller.ts", () => {
      const controllers = [...closure("worker.ts").files]
        .filter((p) => p.endsWith(".controller.ts"))
        .sort();
      expect(
        controllers,
        "the controllers the worker's import closure reaches — every one beyond health and metrics " +
          "is a route served on WORKER_PORT without main.ts's global filter and api/v1 prefix " +
          "(importing AuthModule brings auth/auth.controller.ts; NotificationsModule brings " +
          "notifications/notifications.controller.ts and escalation-profiles.controller.ts):\n" +
          controllers.join("\n"),
      ).toEqual([...WORKER_CONTROLLERS]);
    });
  });

  describe("rule 7 — the API starts no queue consumer (ADR 0064 decision 7: one consumer, on the worker) — F3.11", () => {
    it("main.ts's closure reaches none of the four consumer files", () => {
      const offending = present(closure("main.ts"), CONSUMER_FILES);
      expect(
        offending,
        "the API's import closure reaches a queue consumer — a second consumer on the same queue " +
          "double-runs every job that is not idempotent (ADR 0063 decision 12):\n" +
          offending.join("\n"),
      ).toEqual([]);
    });

    it("positive control: worker.ts's closure reaches all four consumer files", () => {
      const missing = absent(closure("worker.ts"), CONSUMER_FILES);
      expect(
        missing,
        "consumer files the worker's closure does not reach — either the registration moved " +
          "(update CONSUMER_FILES with its ADR) or the walker follows nothing and the row above " +
          "passed vacuously:\n" +
          missing.join("\n"),
      ).toEqual([]);
    });
  });
});
