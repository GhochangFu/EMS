import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const require_ = createRequire(import.meta.url);

/**
 * ADR 0034 (`E2.1`) — `bms.alarm_skills` is a fourth open vocabulary, in the
 * `bms.rule_categories`/`bms.asset_domains`/`bms.alarm_severities` shape
 * (`tests/rule-vocabulary.test.ts` is the model this follows).
 *
 * What is NOT tested here, and why: the vocabulary's **contents**. They are
 * rows now, so a list asserted here would be a copy of the seed — exactly the
 * duplication this design removes. `alarm_enrichments_skill_code_fkey` and
 * `assertTemplateAlarmVocabularies`'s third branch are the enforcement. What
 * remains checkable from the repo is that no surface reintroduces a hardcoded
 * copy of the set.
 */
describe("ADR 0034 alarm skill vocabulary", () => {
  const migrationDir = join(repoRoot, "packages", "db", "drizzle");
  const migration0034 = readFileSync(join(migrationDir, "0034_alarm_enrichment.sql"), "utf8");

  it("declares bms.alarm_skills as data, not an enum, in the contracts package", () => {
    const operations = readFileSync(
      join(repoRoot, "packages", "shared", "src", "contracts", "operations.ts"),
      "utf8",
    );

    // The regression this guards is a revert: someone finding the fetch
    // inconvenient and pasting the seeded codes back into a `z.enum` — the
    // same shape `tests/rule-vocabulary.test.ts` guards for the other two
    // vocabularies.
    const enumRevert = /\balarmSkillCodeSchema\s*=\s*z\.enum\(/;
    expect(
      enumRevert.test(operations),
      "operations.ts declares alarmSkillCodeSchema as a z.enum again. The set is " +
        "closed by bms.alarm_skills and alarm_enrichments_skill_code_fkey, not by " +
        "this file — see alarmSeverityCodeSchema for the same move under ADR 0032.",
    ).toBe(false);

    // Anti-vacuity.
    expect(enumRevert.test('export const alarmSkillCodeSchema = z.enum(["electrical"]);')).toBe(
      true,
    );

    expect(operations).toMatch(/export const alarmSkillDtoSchema = z\.object/);
    expect(operations).toMatch(/alarmSkills:\s*z\.array\(alarmSkillDtoSchema\)/);
  });

  it("creates and seeds bms.alarm_skills before the enrichment table references it", () => {
    const createAt = migration0034.indexOf("CREATE TABLE IF NOT EXISTS bms.alarm_skills");
    const seedAt = migration0034.indexOf("INSERT INTO bms.alarm_skills");
    const enrichmentAt = migration0034.indexOf("CREATE TABLE IF NOT EXISTS bms.alarm_enrichments");

    expect(createAt).toBeGreaterThan(-1);
    expect(seedAt).toBeGreaterThan(createAt);
    expect(enrichmentAt).toBeGreaterThan(seedAt);

    expect(migration0034).toContain("skill_code varchar(64) REFERENCES bms.alarm_skills(code)");
  });

  it("closes alarm_enrichments.skill_code with a foreign key, not a CHECK", () => {
    expect(migration0034).not.toMatch(/CHECK \(skill_code IN/);
    expect(migration0034).toContain("alarm_id uuid NOT NULL UNIQUE REFERENCES bms.alarms(id)");
  });

  it("renders the skill select from the fetched vocabulary, not a hardcoded option list", () => {
    // F4.44, generalised (the same construct `rule-vocabulary.test.ts` checks
    // for rule categories and plant domains): a <select> whose value matches
    // no <option> renders its FIRST option, so a hand-kept list falling
    // behind does not look broken — it looks like a different value.
    const panel = readFileSync(
      join(repoRoot, "apps", "web", "src", "components", "alarm-details-panel.tsx"),
      "utf8",
    );

    const seedAt = migration0034.indexOf("INSERT INTO bms.alarm_skills");
    const statement = migration0034.slice(seedAt, migration0034.indexOf(";", seedAt));
    const seededCodes = [...statement.matchAll(/\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(seededCodes.length).toBeGreaterThanOrEqual(5);
    expect(seededCodes).toContain("electrical");

    for (const code of seededCodes) {
      expect(
        new RegExp(`<option[^>]*value=["']${code}["']`).test(panel),
        `alarm-details-panel.tsx hardcodes <option value="${code}">. Render the ` +
          "options from skillOptions (the fetched vocabulary) instead.",
      ).toBe(false);
    }

    expect(panel, "alarm-details-panel.tsx no longer maps the fetched skill vocabulary").toMatch(
      /skillOptions\.map\(/,
    );
  });

  it("exports AlarmSkillDto as a derived type, not hand-written", () => {
    const contracts = require_("@bms/shared/contracts") as {
      alarmSkillDtoSchema: { shape: Record<string, unknown> };
    };
    expect(Object.keys(contracts.alarmSkillDtoSchema.shape)).toEqual(
      expect.arrayContaining(["code", "label", "sortOrder", "active"]),
    );
  });
});
