import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.42` / ADR 0051 Amendment 3 — `bms.template_points.point_key` is held to
 * the fleet-wide catalog, the way `0057` held `bms.asset_points.point_key`.
 *
 * **Assertions inline, no `.spec` sibling**, on the §4.6 carve-out for the
 * top-level `tests/` directory. `tests/f3.39-global-point-key-vocabulary.test.ts`
 * is the direct model: this row is the sibling half of the constraint that one
 * added, on the only other table that names a point key by code.
 *
 * **What is NOT tested here.** Row counts and the constraint's live behaviour
 * belong to the §4.6 database check — 15 rows over 14 codes with zero orphans
 * was measured before the migration was written. What a source scan can hold is
 * the *shape*, and above all **the statement order inside `0058`**, which is the
 * thing most likely to go wrong and the one thing no other gate can see.
 *
 * **The order is load-bearing for a reason that is easy to undo by tidying.**
 * The guard reads `bms.template_points`, which carries `tenant_isolation` with
 * FORCE since `0047`. `bms_owner` is not `BYPASSRLS`, so the same read inside
 * the `SET ROLE bms_owner` bracket returns zero rows and the guard passes
 * vacuously — on a database full of orphans, at the exact moment it matters.
 * Moving `SET ROLE` up one statement would look like a cleanup and would delete
 * the check without failing anything.
 *
 * **And `0058` must not admit an orphan.** ADR 0051 decision 3 admitted
 * `asset_points`' sixteen, because those are measurements a device carries. A
 * `template_points` orphan is authored text, and `F3.38`'s whole failure was
 * eight camelCase names typed into the stock catalog. An `INSERT` added here
 * later "to match `0057`" would turn a typo into permanent fleet-wide
 * vocabulary — so its absence is asserted, not assumed.
 */
const MIGRATION_REL = "packages/db/drizzle/0058_template_points_point_key_fk.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
const TEMPLATES_SERVICE_REL = "apps/api/src/admin/asset-templates/asset-templates.service.ts";

/**
 * Comments stripped, for `f3.1a`'s reason: a `RESET ROLE;` in a header comment
 * once kept a `toContain` green after the statement itself was deleted. This
 * migration's header quotes the constraint name, `ADD CONSTRAINT` and the role
 * bracket, so every ordering assertion below would be satisfied by prose.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/**
 * The same rule as `sqlOnly`, for TypeScript — and this file needed it for the
 * migration and not for the service, which is exactly the gap the `F3.42`
 * post-merge sweep found. The scan below looked for the bare name
 * `assertPointKeysActive` in the RAW service source, and
 * `asset-templates.service.ts:677` names the method in a doc comment. The gate
 * could have been deleted from all three of its call sites with this test
 * still green, on the strength of a sentence describing it.
 */
const tsOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * The body of one member of `AssetTemplatesAdminService`, from its signature to
 * the next member declared at the same indent.
 *
 * Crude, and sufficient for the one question counting cannot answer: is the
 * call inside THIS method. Three calls exist; a count stays green if the
 * `publish` gate is deleted and a second one appears in `create`.
 */
const methodBody = (service: string, signature: string): string => {
  const start = service.indexOf(signature);
  if (start === -1) {
    return "";
  }
  const rest = service.slice(start + signature.length);
  const end = rest.search(/\n {2}(?:private|protected|public|async)\b/);
  return end === -1 ? rest : rest.slice(0, end);
};

/** The index of the first match, or `-1`. Ordering assertions read these. */
const at = (haystack: string, needle: RegExp): number => haystack.search(needle);

const GUARD_RAISE = /RAISE\s+EXCEPTION/i;
const SET_OWNER = /SET\s+ROLE\s+bms_owner/i;
const ADD_CONSTRAINT = /ADD\s+CONSTRAINT\s+template_points_point_key_point_keys_code_fk/i;
const ORPHAN_INSERT = /INSERT\s+INTO\s+bms\.point_keys/i;

describe("F3.42 template_points is held to the point-key catalog (ADR 0051 Amendment 3)", () => {
  const migration = read(MIGRATION_REL);
  const sql = sqlOnly(migration);

  describe("migration 0058 — shape and statement order", () => {
    /**
     * Anti-vacuity. Every assertion below reads `sql`, so a stripper that
     * blanked the file would turn each `toBe(-1)` green and each ordering
     * comparison meaningless. `f3.39` shipped this control for the same reason
     * and its own review found the version that read the unstripped source.
     */
    it("has SQL left after the comments are stripped", () => {
      expect(sql.trim().length, "sqlOnly() removed everything — the scans below prove nothing").
        toBeGreaterThan(200);
      expect(at(sql, /ALTER\s+TABLE\s+bms\.template_points/i), "no ALTER survives stripping").
        toBeGreaterThan(-1);
    });

    it("runs the orphan guard BEFORE the SET ROLE bms_owner bracket", () => {
      const guard = at(sql, GUARD_RAISE);
      const setRole = at(sql, SET_OWNER);

      expect(guard, "0058 has no RAISE EXCEPTION guard on uncatalogued template point keys").
        toBeGreaterThan(-1);
      expect(setRole, "0058 does not enter the bms_owner bracket at all").toBeGreaterThan(-1);
      expect(
        guard,
        "the guard reads bms.template_points, which is FORCE-policied since 0047. bms_owner is " +
          "not BYPASSRLS, so inside the role bracket the read returns zero rows and the guard " +
          "passes vacuously. It must run as bms_app — outside, and first.",
      ).toBeLessThan(setRole);
    });

    it("adds the constraint INSIDE the bms_owner bracket", () => {
      const setRole = at(sql, SET_OWNER);
      const alter = at(sql, ADD_CONSTRAINT);
      const reset = at(sql, /RESET\s+ROLE/i);

      expect(alter, "0058 does not add template_points_point_key_point_keys_code_fk").
        toBeGreaterThan(-1);
      expect(setRole, "the ALTER must follow SET ROLE — only the owner may alter the table").
        toBeLessThan(alter);
      expect(reset, "0058 never leaves the bms_owner bracket").toBeGreaterThan(alter);
    });

    it("references bms.point_keys(code) with no ON DELETE or ON UPDATE clause", () => {
      expect(sql).toMatch(/FOREIGN\s+KEY\s*\(\s*point_key\s*\)\s*REFERENCES\s+bms\.point_keys\s*\(\s*code\s*\)/i);
      expect(
        at(sql, /ON\s+DELETE/i),
        "no ON DELETE: a delete of a code a template still names must fail loudly. Retire a " +
          "code with active = false instead.",
      ).toBe(-1);
      expect(
        at(sql, /ON\s+UPDATE/i),
        "no ON UPDATE: a code is an identifier, not a label, and has never been editable.",
      ).toBe(-1);
    });

    /**
     * The asymmetry with `0057`, asserted rather than trusted to a comment.
     * `0057` step 4 admits its orphans; this migration must refuse them.
     */
    it("admits no orphan to the catalog", () => {
      expect(
        at(sql, ORPHAN_INSERT),
        "0058 inserts into bms.point_keys. ADR 0051 Amendment 3 decision 3: a template_points " +
          "orphan is authored text, not a measurement a device carries, so admitting it " +
          "automatically would turn a typo into permanent fleet-wide vocabulary — which is " +
          "F3.38's failure arriving through the other door.",
      ).toBe(-1);
    });

    it("names every offending code in the refusal", () => {
      expect(
        sql,
        "the guard must aggregate the offending codes into the message. A bare ADD CONSTRAINT " +
          "failure reports only the constraint name, leaving an operator to bisect their " +
          "templates by hand.",
      ).toMatch(/string_agg\s*\(\s*DISTINCT\s+tp\.point_key/i);
    });
  });

  describe("the journal", () => {
    it("registers 0058 after 0057, with a strictly greater timestamp", () => {
      const journal = JSON.parse(read(JOURNAL_REL)) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const entry = journal.entries.find((e) => e.tag === "0058_template_points_point_key_fk");
      const previous = journal.entries.find((e) => e.tag === "0057_global_point_key_vocabulary");

      expect(entry, "0058 is not journaled — drizzle would never apply the .sql file").
        toBeDefined();
      expect(previous, "0057 left the journal").toBeDefined();
      expect(entry!.idx, "0058 must follow 0057's index").toBe(previous!.idx + 1);
      expect(
        entry!.when,
        "drizzle applies migrations in `when` order, so a non-increasing timestamp silently " +
          "skips this one",
      ).toBeGreaterThan(previous!.when);
    });
  });

  describe("what the constraint does NOT replace", () => {
    /**
     * ADR 0051 Amendment 3 decision 2. The two controls check different things
     * and the tempting cleanup — "the database enforces it now" — deletes the
     * half a constraint cannot express.
     */
    it("keeps assertPointKeysActive at all three call sites, still filtering on active", () => {
      const service = tsOnly(read(TEMPLATES_SERVICE_REL));
      expect(service, "assertPointKeysActive was removed").toContain(
        "private async assertPointKeysActive",
      );

      /**
       * **Each call site named, because deleting one is silent.** The method
       * stays referenced by the other two, so `noUnusedLocals` does not fire,
       * and the only behavioural test of the gate
       * (`asset-templates.lifecycle.integration.spec.ts`,
       * `assertPointKeyCatalogIsEnforced`) exercises `create` with an ABSENT
       * code — a case `0058` now refuses at the database anyway.
       *
       * `publish` is the site that matters most and the one no constraint can
       * replace. Author a draft while a code is active, deactivate the code,
       * publish: the catalog row still exists, so the foreign key is satisfied,
       * and `active = true` is the only thing that refuses it.
       */
      for (const signature of [
        "async create(",
        "async update(",
        "async publish(jwt: JwtPayload, id: string)",
      ]) {
        expect(
          methodBody(service, signature),
          `${signature} no longer calls assertPointKeysActive. Nothing else goes red when ` +
            "one of the three is deleted — not the compiler, not the integration suite — " +
            "so this assertion is the whole gate.",
        ).toContain("await this.assertPointKeysActive(");
      }

      expect(
        service,
        "the gate no longer filters on active = true. A foreign key holds existence against " +
          "every writer; only this holds activity, because a retired code keeps its row.",
      ).toMatch(/eq\(\s*pointKeys\.active\s*,\s*true\s*\)/);
    });

    it("stops calling the fleet-wide catalog an organization's", () => {
      // Stripped on both sides. The negative must not be satisfied by deleting a
      // comment that quotes the old wording, and the positive must not be
      // satisfied by a comment that quotes the new one.
      const service = tsOnly(read(TEMPLATES_SERVICE_REL));
      expect(
        service,
        "the thrown message still says \"this organization's\". There has been no organization " +
          "catalog since 0057; resolveCatalogPointKey's equivalent moved in F3.39.",
      ).not.toMatch(/Not in this organization's active point-key catalog: \$\{missing/);
      expect(service).toMatch(/Not in the active point-key catalog: \$\{missing/);
    });
  });

  describe("the schema records the constraint", () => {
    it("no longer calls template_points.point_key deliberately not a FK", () => {
      expect(
        read(SCHEMA_REL),
        "bms-schema.ts still documents templatePoints.pointKey as deliberately unconstrained. " +
          "ADR 0015 §3 reason 2 is void since 0057 — code is unique alone, so the FK needs no " +
          "denormalized organization_id.",
      ).not.toContain("deliberately not a FK");
    });
  });
});
