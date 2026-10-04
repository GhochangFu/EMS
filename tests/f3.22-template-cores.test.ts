import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.22` PR 1 (ADR 0091 decision 1) — the transaction-aware cores, pinned.
 *
 * The cores hold every guard; the public wrappers only open the transaction
 * and translate errors. A guard added to a wrapper and not to the core is the
 * drift ADR 0091's Consequences names: the Control Room agent calls the core,
 * so it would silently skip that guard. A source scan is the only gate that
 * sees where a guard lives, hence this file.
 *
 * Assertions inline, no `.spec` sibling — §4.6 carves out the top-level
 * `tests/` directory.
 */
const DIR = "apps/api/src/admin/asset-templates";
const SERVICE_REL = `${DIR}/asset-templates.service.ts`;
const INSTANTIATE_SERVICE_REL = `${DIR}/asset-templates-instantiate.service.ts`;
const WRITE_CORE_REL = `${DIR}/asset-templates-write-core.ts`;
const INSTANTIATE_CORE_REL = `${DIR}/asset-templates-instantiate-core.ts`;
const INSTANTIATE_GUARDS_REL = `${DIR}/asset-templates-instantiate-guards.ts`;
const WRITE_GUARDS_REL = `${DIR}/asset-templates-write-guards.ts`;

/** Comments stripped: these files explain the rules they follow, so a
 * `toContain` against the raw text would pass on a docblock alone. */
const tsOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** The body of a two-space-indented class method: from its signature to the
 * first closing brace at that indent. `-1` if the signature is gone. */
const methodBody = (code: string, signature: string): string => {
  const start = code.indexOf(signature);
  expect(
    start,
    `${signature} not found; the slice has drifted`,
  ).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("\n  }\n", start);
  expect(end, `no closing brace after ${signature}`).toBeGreaterThan(start);
  return code.slice(start, end);
};

const DRIFT =
  "a guard added to a wrapper and not to the core is the drift ADR 0091 Consequences names";

describe("F3.22 template cores (ADR 0091 decision 1)", () => {
  it("anti-vacuity: each new file keeps more than 2,000 characters of code", () => {
    for (const rel of [
      WRITE_GUARDS_REL,
      WRITE_CORE_REL,
      INSTANTIATE_GUARDS_REL,
      INSTANTIATE_CORE_REL,
    ]) {
      expect(existsSync(join(repoRoot, rel)), `${rel} is missing`).toBe(true);
      expect(
        tsOnly(read(rel)).length,
        `${rel} is nearly empty after comment stripping; the scans below would pass on nothing`,
      ).toBeGreaterThan(2000);
    }
  });

  describe("the wrappers hold no guard", () => {
    const service = tsOnly(read(SERVICE_REL));
    const instantiateService = tsOnly(read(INSTANTIATE_SERVICE_REL));
    const cases: readonly [string, string, string, readonly string[]][] = [
      ["create", SERVICE_REL, methodBody(service, "  async create("), []],
      [
        "publish",
        SERVICE_REL,
        methodBody(service, "  async publish("),
        ["this.fetchRow("],
      ],
      [
        "instantiate",
        INSTANTIATE_SERVICE_REL,
        methodBody(instantiateService, "  async instantiate("),
        ["this.templateOrganization(", "requireMasterDataUser("],
      ],
    ];

    for (const [name, rel, body, allowed] of cases) {
      it(`${name}( in ${rel} only opens the transaction and calls the core`, () => {
        expect(
          body,
          `${name}( must open withTenant on the tenant pool. ${DRIFT}`,
        ).toContain("withTenant(this.tenantDb,");
        expect(
          body,
          `${name}( must hand the transaction on. ${DRIFT}`,
        ).toContain("InTransaction(tx");
        // Strip the allowed calls first, then forbid the guard shapes.
        let rest = body;
        for (const a of allowed) rest = rest.split(a).join("");
        for (const forbidden of [
          "this.accessControl.can",
          "this.vocabularies.",
          "this.fleetDb.select",
          // The service's own private delegators (assertCanAuthor,
          // assertPointKeysActive, assertTransition, ...) are guards too.
          "this.assert",
        ]) {
          expect(
            rest,
            `${name}( in ${rel} contains ${forbidden}. ${DRIFT}`,
          ).not.toContain(forbidden);
        }
      });
    }
  });

  describe("deps.fleetDb is counted by name (owner ruling 2026-10-04, plan Q1)", () => {
    const aliasAndDestructure = (code: string, rel: string): void => {
      expect(
        /(?:const|let)\s*\{[^}]*\bfleetDb\b[^}]*\}\s*=\s*deps\b/.test(code),
        `${rel}: destructuring fleetDb off deps hides further uses from the count`,
      ).toBe(false);
      expect(
        /(?:const|let)\s+\w+\s*=\s*deps\.fleetDb\b/.test(code),
        `${rel}: aliasing deps.fleetDb to a local hides further uses from the count`,
      ).toBe(false);
    };

    it("write core: exactly one, resolveActorId(deps.fleetDb — an identity read, not a guard", () => {
      const code = tsOnly(read(WRITE_CORE_REL));
      aliasAndDestructure(code, WRITE_CORE_REL);
      const uses = code.match(/deps\.fleetDb\b/g) ?? [];
      expect(
        uses.length,
        `deps.fleetDb is used ${uses.length} times in ${WRITE_CORE_REL}; the only legal use is ` +
          "resolveActorId(deps.fleetDb, jwt). Any guard read must go through tx.",
      ).toBe(1);
      expect(code).toContain("resolveActorId(deps.fleetDb");
    });

    it("instantiate core and guards: exactly two — the resolveTarget probe and the asset-code estate read", () => {
      const core = tsOnly(read(INSTANTIATE_CORE_REL));
      const guards = tsOnly(read(INSTANTIATE_GUARDS_REL));
      aliasAndDestructure(core, INSTANTIATE_CORE_REL);
      aliasAndDestructure(guards, INSTANTIATE_GUARDS_REL);
      const uses = [
        ...(core.match(/deps\.fleetDb\b/g) ?? []),
        ...(guards.match(/deps\.fleetDb\b/g) ?? []),
      ];
      expect(
        uses.length,
        `deps.fleetDb is used ${uses.length} times across the instantiate core and guards; ` +
          "exactly two are legal: (1) resolveTarget(tx, deps.fleetDb, ...) for the tx-miss probe, " +
          "(2) assertAssetCodesFree(tx, deps.fleetDb, ...) for the estate-wide asset-code read.",
      ).toBe(2);
      expect(core, "the resolveTarget probe read is gone").toContain(
        "resolveTarget(tx, deps.fleetDb",
      );
      expect(core, "the assertAssetCodesFree estate read is gone").toContain(
        "assertAssetCodesFree(tx, deps.fleetDb",
      );
    });
  });

  describe("vocabulary reads inside a core run on tx (review finding: one tenant connection)", () => {
    // `VocabulariesService`'s own executor is the tenant pool, so a vocabulary
    // read inside `withTenant` that omits `tx` holds one tenant connection while
    // it waits for a second. The executor is optional on the service, so the
    // compiler cannot see an omission; this scan and C11–C14 can.
    const WHY =
      "a vocabulary read inside withTenant without tx holds one tenant connection and waits " +
      "for a second — N concurrent cores on a pool of N never finish";

    for (const rel of [WRITE_CORE_REL, INSTANTIATE_CORE_REL]) {
      it(`${rel}: every deps.vocabularies use hands tx on`, () => {
        const code = tsOnly(read(rel));
        const uses = code.match(/deps\.vocabularies\b/g) ?? [];
        const onTx = [
          ...(code.match(/deps\.vocabularies\.\w+\([^()]*,\s*tx\)/g) ?? []),
          ...(code.match(/\(deps\.vocabularies,\s*tx,/g) ?? []),
        ];
        expect(
          uses.length,
          `${rel}: no deps.vocabularies use found; the scan has drifted`,
        ).toBeGreaterThan(0);
        expect(
          onTx.length,
          `${rel}: ${uses.length - onTx.length} deps.vocabularies use(s) without tx. ${WHY}`,
        ).toBe(uses.length);
      });
    }

    for (const [rel, fn] of [
      [WRITE_GUARDS_REL, "assertTemplateAlarmVocabularies"],
      [INSTANTIATE_GUARDS_REL, "assertAlarmVocabulariesStillLive"],
    ] as const) {
      it(`${rel}: ${fn} reads vocabularies.list(db)`, () => {
        const code = tsOnly(read(rel));
        const start = code.indexOf(`export async function ${fn}(`);
        expect(start, `${fn} not found in ${rel}`).toBeGreaterThanOrEqual(0);
        const body = code.slice(start, code.indexOf("\n}\n", start));
        expect(body, `${fn} must take a required db executor. ${WHY}`).toMatch(
          /\bdb: VocabularyExecutor,/,
        );
        expect(
          body.match(/vocabularies\.list\(/g) ?? [],
          `${fn}: one list read`,
        ).toHaveLength(1);
        expect(
          body,
          `${fn} must read list on the caller's executor. ${WHY}`,
        ).toContain("vocabularies.list(db)");
      });
    }
  });

  it("the two new integration specs have .test siblings", () => {
    for (const base of [
      "asset-templates-write-cores",
      "asset-templates-instantiate-core",
    ]) {
      for (const ext of ["spec", "test"]) {
        const rel = `${DIR}/${base}.integration.${ext}.ts`;
        expect(existsSync(join(repoRoot, rel)), `${rel} is missing`).toBe(true);
      }
    }
  });
});
