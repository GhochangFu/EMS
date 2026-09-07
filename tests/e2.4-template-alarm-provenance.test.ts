import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `E2.4` U1 / ADR 0058 decision 5 — migration `0067`: four provenance
 * columns and one plain, non-unique index on `bms.automation_rules`. Model:
 * `tests/f3.10-alarm-lifecycle-schema.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/`
 * carve-out (§4.6). Files are read by relative path from the repo root,
 * never through a static `@bms` import (the `F2.7` lesson: a hand-repaired
 * workspace made a real TS2307 pass locally and die only in CI).
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0067_template_alarm_provenance.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/alarms-schema.ts";

/** Comments stripped before every assertion (the `f3.1a` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

describe("E2.4 — migration 0067 exists", () => {
  it("0067_template_alarm_provenance.sql is present in packages/db/drizzle", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), "migration must exist").toBe(true);
  });
});

describe("E2.4 template alarm provenance migration 0067 (ADR 0058 decision 5)", () => {
  const sql = sqlOnly(read(MIGRATION_REL));

  it("journals 0067 with idx 67, version 7, breakpoints true, and a when strictly greater than entry 66's, all read from the file", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: ReadonlyArray<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
    };
    const entry66 = journal.entries.find((e) => e.idx === 66);
    expect(entry66, "journal entry idx 66 (0066_alarm_lifecycle) not found").toBeDefined();

    const stem = MIGRATION_REL.split("/").pop()!.replace(/\.sql$/, "");
    const entry67 = journal.entries.find((e) => e.tag === stem);
    expect(
      entry67,
      `no journal entry with tag "${stem}". Drizzle matches migrations to journal entries ` +
        "by tag; an unjournalled .sql file is silently skipped.",
    ).toBeDefined();
    expect(entry67?.idx, "journal entry for 0067 must have idx 67").toBe(67);
    expect(entry67?.version).toBe("7");
    expect(entry67?.breakpoints).toBe(true);
    expect(
      entry67?.when,
      "migration 0067's journal when must be strictly greater than entry 66's — read both " +
        "from the file, never a literal copy, so a later regeneration mistake is caught.",
    ).toBeGreaterThan(entry66!.when);
  });

  it("adds the four provenance columns, each IF NOT EXISTS, with the named FK constraint", () => {
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS source_template_id uuid\s+CONSTRAINT automation_rules_source_template_id_fk\s+REFERENCES bms\.asset_templates\(id\);/,
    );
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS source_template_version integer;/,
    );
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS source_alarm_code varchar\(64\);/,
    );
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS seeded_baseline jsonb;/,
    );
  });

  it("adds a plain, non-unique index on source_template_id, and carries no unique index, CONCURRENTLY, GRANT, CHECK, UPDATE or INSERT", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS automation_rules_source_template_idx\s+ON bms\.automation_rules\s*\(\s*source_template_id\s*\)\s*;/,
    );

    expect(
      /CREATE UNIQUE INDEX/i.test(sql),
      "ADR 0058 decision 5: an earlier draft's partial unique index could never fire " +
        "(asset_id is always fresh on instantiate) — 0067 must add no unique index at all.",
    ).toBe(false);
    expect(
      /CONCURRENTLY/i.test(sql),
      "drizzle applies the file inside one transaction; CONCURRENTLY cannot run inside one (§4.4).",
    ).toBe(false);
    expect(/\bGRANT\b/.test(sql), "migration 0067 must write no GRANT").toBe(false);
    // WITH CHECK is a policy clause, not a column CHECK; strip it before the
    // scan so it cannot mask (or be mistaken for) a real column CHECK.
    expect(
      /\bCHECK\b/.test(sql.replace(/WITH CHECK/g, "")),
      "migration 0067 must carry no CHECK constraint",
    ).toBe(false);
    expect(/\bUPDATE\b/i.test(sql), "migration 0067 has no backfill — it must write no UPDATE").toBe(false);
    expect(/\bINSERT\b/i.test(sql), "migration 0067 has no backfill — it must write no INSERT").toBe(false);
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket", () => {
    expect(sql).toContain("SET ROLE bms_owner;");
    expect(sql).toContain("RESET ROLE;");
  });

  it("packages/db/src/schema/alarms-schema.ts mirrors the four columns on automationRules", () => {
    const schema = read(SCHEMA_REL);

    const rulesStart = schema.indexOf('bmsSchema.table("automation_rules"');
    expect(rulesStart).toBeGreaterThan(-1);
    const rulesBlock = schema.slice(rulesStart, schema.indexOf("\n});", rulesStart));

    expect(rulesBlock).toMatch(/sourceTemplateId:\s*uuid\(\s*"source_template_id"\s*\)/);
    expect(rulesBlock).toMatch(/sourceTemplateVersion:\s*integer\(\s*"source_template_version"\s*\)/);
    expect(rulesBlock).toMatch(/sourceAlarmCode:\s*varchar\(\s*"source_alarm_code"/);
    expect(rulesBlock).toMatch(/seededBaseline:\s*jsonb\(\s*"seeded_baseline"\s*\)/);
  });
});

// --- Part 5: the seeded rule's `source` is a contract value -----------------

/**
 * Resolved through `createRequire` and never a static `@bms/shared` import.
 * The `tests` project runs from the repo root, where the bundler resolver has
 * no workspace link to `@bms/shared` — a static import typechecks green on a
 * hand-repaired local `node_modules` and dies in CI's clean install with
 * `TS2307`. It did exactly that on PR #324; `tests/adr-0055-*` documents the
 * same rule.
 */
const require_ = createRequire(import.meta.url);
const shared = require_("@bms/shared") as {
  ruleListItemSchema: { shape: { source: { options: readonly string[] } } };
};

describe("E2.4 — template_alarm is a contract value (ADR 0058 decision 6)", () => {
  it("the rule list contract offers template_alarm as a source", () => {
    const options = [...shared.ruleListItemSchema.shape.source.options];
    expect(
      options,
      "`GET /rules` validates its own response against this schema (ADR 0030). Without " +
        "`template_alarm` in the enum, every seeded rule makes the API throw a " +
        "ResponseContractError in dev and strips the field in production — the rules page " +
        "would go blank the first time a template was instantiated.",
    ).toContain("template_alarm");
    // Anti-vacuity: the enum really is the closed set it looks like.
    expect(options).toContain("operator_rule");
    expect(options).not.toContain("not_a_rule_source");
  });

  it("rule-mapping.ts carries the literal, so the row mapper's cast admits it", () => {
    const mapping = read("apps/api/src/rules/rule-mapping.ts");
    expect(
      mapping,
      "`mapRuleRow` casts `automation_rules.source` to a literal union. A stored " +
        "`template_alarm` that the cast does not name is a lie the type system cannot see.",
    ).toContain('"template_alarm"');
  });
});

// --- Part 6: where the seed is written, and what it does not write ----------

/**
 * Block and line comments removed, so a match is code rather than prose.
 *
 * This repository's files explain themselves at length, and several of them
 * quote the very literal a test like this looks for. Without this, an assertion
 * that a *builder* writes `type: "review"` is satisfied by a *docblock* saying
 * that it does — which is precisely what happened while this test was written.
 */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const INSTANTIATE_REL = "apps/api/src/admin/asset-templates/asset-templates-instantiate.service.ts";
const HELPERS_REL = "apps/api/src/admin/asset-templates/template-alarm-rules.ts";
const TEMPLATES_DIR = "apps/api/src/admin/asset-templates";

/**
 * The body of `instantiate`'s `withTenant(...)` callback, by brace matching.
 *
 * Sliced rather than grepped because the claim is *positional*: ADR 0058
 * decision 9 says the rule insert happens inside the same transaction as
 * `assets` and `asset_points`. An insert moved one line below the closing brace
 * still compiles, still passes every unit test, and still writes rules — it
 * just writes them outside the transaction, so a rolled-back batch leaves rules
 * pointing at assets that never existed, and `bms.automation_rules`' own
 * `WITH CHECK` no longer has a GUC to compare against.
 */
function withTenantBody(source: string): string {
  const at = source.indexOf("withTenant(this.tenantDb, template.organizationId");
  if (at < 0) {
    throw new Error(
      "instantiate() no longer opens `withTenant(this.tenantDb, template.organizationId, ...)`. " +
        "If the write path moved, this test must move with it — do not delete it.",
    );
  }
  const open = source.indexOf("{", source.indexOf("=>", at));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") {
      depth += 1;
    } else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open, i + 1);
      }
    }
  }
  throw new Error("unbalanced braces in instantiate()'s withTenant callback");
}

describe("E2.4 — the seed is written inside the batch transaction (ADR 0058 decisions 2, 9)", () => {
  const instantiate = read(INSTANTIATE_REL);
  const body = withTenantBody(instantiate);

  it("slices a proper sub-range of the service, not the whole file", () => {
    // Anti-vacuity for the two assertions below: a slicer that returned the
    // whole file would make "the insert is inside the transaction" unfalsifiable.
    expect(body.length).toBeGreaterThan(200);
    expect(body.length).toBeLessThan(instantiate.length);
    expect(body).toContain("insert(assets)");
    expect(
      body,
      "the slice must stop at the callback's closing brace — `fetchTemplate` is defined well " +
        "after it, so finding it here means the brace matching ran off the end",
    ).not.toContain("private async fetchTemplate");
  });

  it("inserts automationRules inside the withTenant callback", () => {
    expect(
      instantiate,
      "instantiate() must seed the template's alarms at all (ADR 0058 decision 1)",
    ).toContain("insert(automationRules)");
    expect(
      body,
      "the rule insert must sit INSIDE the withTenant callback (decision 9). Outside it the " +
        "rows are written on a handle with no `app.current_organization` GUC, and a rolled-back " +
        "batch leaves rules whose assets do not exist.",
    ).toContain("insert(automationRules)");
  });

  it("the row builder writes a review action and the template_alarm source", () => {
    // Comments stripped first, and this is not a formality: `template-alarm-rules.ts`
    // *explains* decision 2 in its docblock, in the words `{type: "review", target:
    // <category>}`. Asserted against the raw file, this test passed with the
    // builder mutated to `notify` — the prose held it up. The same `f3.1a` lesson
    // the migration half of this file applies with `sqlOnly`.
    const helpers = codeOnly(read(HELPERS_REL));
    expect(
      helpers,
      "ADR 0041 decision 9 and the F3.7 Q3 ruling make `review` inert: it raises the alarm and " +
        "dispatches nothing. `notify` here would page every on-call rota the moment forty " +
        "chillers were instantiated.",
    ).toContain('type: "review"');
    expect(helpers).toContain('source: "template_alarm"');
  });

  it("no file under admin/asset-templates writes a rule_notifications row", () => {
    const forbidden = /insert\(\s*ruleNotifications\s*\)/;
    // Anti-vacuity: the pattern matches the thing it is looking for.
    expect(forbidden.test("await tx.insert(ruleNotifications).values(x)")).toBe(true);

    const offenders = readdirSync(join(repoRoot, TEMPLATES_DIR))
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => forbidden.test(read(`${TEMPLATES_DIR}/${name}`)));
    expect(
      offenders,
      "ADR 0058 decision 2: a seeded rule joins NO notification channel. Promoting one to " +
        "`notify` and giving it a channel is a commissioning act done in F3.7's per-rule " +
        "picker, never a side effect of pressing Instantiate.",
    ).toEqual([]);
  });
});
