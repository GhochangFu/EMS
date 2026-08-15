import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function schemaFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".schema.ts")) found.push(full);
    }
  };
  walk(join(repoRoot, "apps", "api", "src"));
  return found;
}

/**
 * ADR 0029 decision 10 (`F4.20`) — every refinement explains itself, in source.
 *
 * Here rather than beside the code for a measured reason. Reaching every schema
 * file from a spec inside `apps/api` needs `import.meta.glob`, a Vite feature
 * `tsc` rejects under that package's CommonJS `module` setting: it passes
 * `pnpm test` and fails `pnpm typecheck:tests`. Per §4.6's carve-out, files in
 * `tests/` hold their assertions inline.
 *
 * ## What this guards
 *
 * `zod-to-json-schema` emits **nothing** for `.refine` / `.superRefine` — no
 * marker, no warning, no error. Measured in `F4.20`: 63 schemas across 19 files
 * convert with zero failures while **11 refinement sites vanish**. Demonstrated
 * on `telemetryReadingSchema.time`, where `{"time":"not-a-timestamp"}` is
 * rejected by Zod and accepted by the generated schema.
 *
 * So the document is a lower bound, and Amendment 1's answer is that it must
 * *say so per field*: the `x-zod-refined` marker is automatic, and the prose is
 * authored with `.describe()` — authored because it **cannot** be extracted.
 * `.refine(fn, { message })` captures the message inside the closure;
 * `_def.effect` is only `{ type, refinement }` and `_def.message` is `null`.
 *
 * ## Why order is checked and not just presence
 *
 * `z.string().describe("x").refine(…)` yields **no description**, because
 * `.refine` wraps the described schema in a fresh `ZodEffects` and the
 * description stays on the inner node. Only `.refine(…).describe("x")`
 * survives. Nothing warns. Both mutations — deleting the `.describe()` and
 * moving it before the refinement — survived a first version of this rule that
 * was scoped to route-reachable schemas only, because `telemetryReadingSchema`
 * is bound to no REST handler.
 */
describe("ADR 0029 decision 10 — refinements explain themselves", () => {
  it("follows every .refine/.superRefine with a .describe()", () => {
    const files = schemaFiles();

    // A broken walk must fail loudly rather than pass having scanned nothing.
    expect(
      files.length,
      "no *.schema.ts files were found — the walk is broken and this is vacuous",
    ).toBeGreaterThan(10);

    const offenders: string[] = [];
    let refinements = 0;

    for (const file of files) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);

      lines.forEach((line, index) => {
        if (!/\.(superRefine|refine)\s*\(/.test(line)) return;
        // Comments and prose about the rule are not the rule being broken.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        refinements += 1;

        // A refinement's argument list spans many lines. Its `.describe()` is
        // the next chained call at or below the refinement's own indentation,
        // so scan forward for the first line that starts a chained call.
        const indent = (line.match(/^\s*/) ?? [""])[0].length;
        let described = false;
        for (let i = index + 1; i < lines.length; i += 1) {
          const next = lines[i] as string;
          const trimmed = next.trim();
          if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          const nextIndent = (next.match(/^\s*/) ?? [""])[0].length;
          // Still inside the refinement's own argument list.
          if (nextIndent > indent) continue;
          // The line that CLOSES that argument list — `})`, `},`, `)`, `);` —
          // sits at the refinement's indentation and is not the next chained
          // call. Skipping it is the whole difference between this scan working
          // and reporting every multi-line refinement as an offender, which is
          // what the first version did.
          if (/^[)}\],;]+$/.test(trimmed)) continue;
          if (trimmed.startsWith(".describe(")) described = true;
          // The first real chained call at this level decides it.
          if (trimmed.startsWith(".")) break;
          // Anything else at this indentation ends the chain.
          break;
        }
        if (!described) {
          offenders.push(`${rel}:${index + 1} — ${line.trim().slice(0, 80)}`);
        }
      });
    }

    // 11 were measured; the floor catches a regex that silently stops matching.
    expect(
      refinements,
      "no refinements were found at all. 11 were measured across 5 files, so " +
        "either every one was removed or this scan has stopped seeing them — in " +
        "which case an empty offender list means nothing.",
    ).toBeGreaterThanOrEqual(1);

    expect(
      offenders,
      `refinements with no .describe() immediately after them:\n${offenders.join("\n")}\n\n` +
        "zod-to-json-schema emits NOTHING for a refinement, so the generated document " +
        "is more permissive than the API at these sites and a caller who trusts it gets " +
        "a 400 the document says is impossible (ADR 0029 Amendment 1). Add " +
        "`.describe(...)` AFTER the refinement — placed before it, the description " +
        "lands on the inner schema and is silently discarded, which is why this checks " +
        "order and not merely presence.",
    ).toEqual([]);
  });

  /**
   * ADR 0029 decision 6, by the only mechanism this repo has.
   *
   * **Decision 6 asks for a runtime count** — build the document, compare the
   * number of documented operations against the routes Nest actually
   * registered. That was written, and it cannot run here. Vitest transforms TS
   * with esbuild, which does not emit `design:paramtypes`, so Nest's
   * constructor injection resolves to `undefined` and `AppModule` cannot be
   * instantiated at all: booting it failed in `TelemetryGateway.afterInit` with
   * `this.hub` undefined. No test in this repo has ever built a Nest module —
   * every integration suite constructs services directly (`new
   * DashboardService(pool)`) — and that is why. Fixing it means adding an swc
   * transform, which is a dependency change ADR 0029 does not cover.
   *
   * **The runtime count was verified manually instead**, against the running
   * container with a token: **94 documented operations** for the 93 REST routes
   * plus `/docs-json` itself, and **35 request bodies**, which is exactly the 43
   * registry entries minus the 8 GET query schemas. Recorded because a manual
   * check is not a gate and should not be mistaken for one.
   *
   * What this static check holds is the defect decision 6 *names*: a controller
   * that is silently absent. A controller class listed in no module's
   * `controllers` array is invisible to Nest, and therefore to the document,
   * while its file still exists and still compiles.
   */
  it("registers every controller with a module", () => {
    const controllers: string[] = [];
    const modules: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".controller.ts")) controllers.push(full);
        else if (entry.name.endsWith(".module.ts")) modules.push(full);
      }
    };
    walk(join(repoRoot, "apps", "api", "src"));

    expect(controllers.length, "no controllers found — the walk is broken").toBeGreaterThan(10);
    expect(modules.length, "no modules found — the walk is broken").toBeGreaterThan(5);

    // **Only the `controllers: [...]` arrays**, never the whole module file.
    // Searching the file is satisfied by the `import { XController }` line at
    // the top, so deleting the class from the array — the actual defect —
    // passes. Verified by mutation: the file-wide version SURVIVED removing
    // `OpenApiController` from its module. This is AGENTS.md §4.4's seventh
    // instance exactly: a static check defeated by a legitimate occurrence of
    // the same token elsewhere in the same file.
    const registered = modules
      .map((file) => readFileSync(file, "utf8"))
      .flatMap((text) => [...text.matchAll(/controllers\s*:\s*\[([\s\S]*?)\]/g)].map((m) => m[1]))
      .join("\n");

    const orphans = controllers
      .flatMap((file) => {
        const match = readFileSync(file, "utf8").match(/export class (\w+Controller)\b/);
        return match ? [{ file, name: match[1] as string }] : [];
      })
      .filter(({ name }) => !new RegExp(`\\b${name}\\b`).test(registered))
      .map(({ file }) => relative(repoRoot, file).replace(/\\/g, "/"));

    expect(
      orphans,
      `these controllers are declared by no module:\n${orphans.join("\n")}\n\n` +
        "Nest never registers them, so their routes do not exist and the OpenAPI " +
        "document cannot describe what it cannot see. The file still compiles and still " +
        "looks like a working controller, which is what makes this silent (ADR 0029 " +
        "decision 6).",
    ).toEqual([]);
  });

  it("keeps body and query schemas out of the controllers", () => {
    // ADR 0029 decisions 1 and 3: the registry binds routes to the schemas that
    // validate them, and it can only see schemas that live in a `*.schema.ts`.
    // F4.20 found `statusQuerySchema` declared inside
    // asset-templates.controller.ts — invisible to the registry, and it would
    // have left that route's only parameter undocumented for a reason no reader
    // could have guessed. Moved to the schema file; pinned here.
    //
    // **Scoped to `*BodySchema` / `*QuerySchema`, and the exclusion is
    // deliberate rather than convenient.** Three controllers also declare
    // `const idParamSchema = z.string().uuid()` locally, and a first version of
    // this rule flagged them — correcting a claim made while writing it, that
    // the template one was the only inline schema in the tree. They stay: a
    // path parameter is described by Nest's own reflection, never by the
    // registry, so moving them would satisfy this check while documenting
    // nothing. What they are is a *duplication* of `admin.schema.ts`'s
    // `idParamSchema` — real, but a different item's problem, and not one this
    // rule should quietly conscript.
    const controllers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".controller.ts")) controllers.push(full);
      }
    };
    walk(join(repoRoot, "apps", "api", "src"));

    expect(controllers.length, "no controllers found — the walk is broken").toBeGreaterThan(10);

    const offenders = controllers
      .filter((file) =>
        /^\s*(?:export\s+)?const\s+\w*(?:Body|Query)Schema\s*=\s*z\./m.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(repoRoot, file).replace(/\\/g, "/"));

    expect(
      offenders,
      `these controllers declare a Zod schema inline:\n${offenders.join("\n")}\n\n` +
        "A schema that validates request input must live in a `*.schema.ts`, or ADR " +
        "0029's registry cannot see it and the route's payload goes undocumented — " +
        "silently, and reading as `no body` rather than as an omission.",
    ).toEqual([]);
  });
});
