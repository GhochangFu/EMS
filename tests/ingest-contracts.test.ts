import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F1.1` / ADR 0016 — the ingest contract surface, asserted where it can
 * actually break.
 *
 * These live in the repo project rather than in `apps/ingest` because two of
 * the three are *packaging* invariants: they are about how `@bms/shared`
 * publishes its subpath, which no application-level test would notice breaking.
 * Inline assertions are the `tests/` carve-out in AGENTS.md §4.6.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sharedPkgPath = join(repoRoot, "packages", "shared", "package.json");
const require_ = createRequire(import.meta.url);

/** The six ADR 0016 froze. `modbus_rtu` and `dcs` are deliberately absent. */
const FROZEN_PROTOCOLS = ["mqtt", "modbus_tcp", "bacnet", "opc_ua", "snmp", "rest_poller"];

describe("ADR 0016 ingest contracts", () => {
  // Resolved through `createRequire` rather than a bare `import`: this project
  // runs from the repo root, where Vite's resolver has no workspace link to
  // `@bms/shared`. Node's own resolution does — and it is the resolution that
  // matters, because `apps/sim` loads the package exactly this way.
  const loadIngest = () =>
    require_("@bms/shared/ingest") as { INGEST_PROTOCOLS: readonly string[] };

  it("freezes the protocol union, so adding one is a deliberate change", () => {
    // Order matters as little as membership, but asserting the exact array
    // means an adapter PR that adds a protocol has to say so in this diff —
    // which is the point. ADR 0016 §7 makes it a one-line change on purpose.
    expect([...loadIngest().INGEST_PROTOCOLS]).toEqual(FROZEN_PROTOCOLS);
  });

  it("keeps every ingest protocol expressible in onboarding", () => {
    const { INGEST_PROTOCOLS } = loadIngest();

    // `OnboardingProtocol` is a type, so the compile-time guard in `ingest.ts`
    // is erased at runtime and cannot fail a test run. Read the union from
    // source instead: if the two drift, F3.24 could offer a protocol that
    // nothing is able to ingest.
    const indexSource = readFileSync(join(repoRoot, "packages/shared/src/index.ts"), "utf8");
    const union = indexSource.match(/export type OnboardingProtocol =([\s\S]*?);/)?.[1];
    expect(union, "OnboardingProtocol union not found in packages/shared/src/index.ts").toBeTruthy();

    const onboarding = [...(union ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(onboarding.length).toBeGreaterThan(0);

    const missing = INGEST_PROTOCOLS.filter((p) => !onboarding.includes(p));
    expect(missing, `ingest protocols absent from OnboardingProtocol: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("publishes ./ingest under both import and require conditions", () => {
    // ADR 0016 §8 calls this out specifically: `apps/sim` consumes @bms/shared
    // through `createRequire(import.meta.url)`, so an import-only condition
    // would break it — at runtime, in the simulator, with nothing else failing.
    const pkg = JSON.parse(readFileSync(sharedPkgPath, "utf8")) as {
      exports: Record<string, Record<string, string>>;
    };
    const entry = pkg.exports["./ingest"];
    expect(entry, "packages/shared must export the ./ingest subpath").toBeTruthy();
    for (const condition of ["types", "import", "require"]) {
      expect(entry[condition], `./ingest is missing its "${condition}" condition`).toBeTruthy();
    }

    // And the declared targets must exist once built, or the map is a promise
    // the package does not keep.
    const sharedDir = join(repoRoot, "packages", "shared");
    for (const condition of ["types", "import", "require"]) {
      const target = join(sharedDir, entry[condition]);
      expect(
        existsSync(target),
        `${entry[condition]} is declared for "${condition}" but missing — run \`pnpm --filter @bms/shared build\``,
      ).toBe(true);
    }
  });

  it("loads the declared import target as ESM", async () => {
    // The require condition is covered by every other case here. This one
    // proves the *import* condition's target is genuinely loadable rather than
    // merely present on disk — the two can diverge, and a broken import
    // condition would surface only in whichever consumer used ESM.
    const pkg = JSON.parse(readFileSync(sharedPkgPath, "utf8")) as {
      exports: Record<string, Record<string, string>>;
    };
    const target = join(repoRoot, "packages", "shared", pkg.exports["./ingest"].import);
    const loaded = (await import(pathToFileURL(target).href)) as {
      INGEST_PROTOCOLS?: readonly string[];
    };
    expect([...(loaded.INGEST_PROTOCOLS ?? [])]).toEqual(FROZEN_PROTOCOLS);
  });
});
