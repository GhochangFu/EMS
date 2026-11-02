import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.299` U4 (ADR 0108 Amendment 1, 7.7; ruling 4.7) — the abnormal list is
 * **advisory only**: a sentence on the Energy page, never an alarm, a rule
 * evaluation, a notification or a write.
 *
 * 1. The advisory api modules import nothing from `apps/api/src/alarms`,
 *    `apps/api/src/rules` or `apps/api/src/notifications`.
 * 2. The reads files carry no `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE`
 *    outside comments.
 *
 * Comments are stripped before matching, so prose naming a forbidden module
 * or keyword cannot fail a check, and a docblock cannot satisfy one. Each
 * claim has a positive control that drives a mutated copy through the same
 * function, so a check that can never fire goes red.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const ADVISORY_MODULES = [
  "apps/api/src/reports/energy-abnormal.ts",
  "apps/api/src/reports/energy-organization-reads.ts",
  "apps/api/src/reports/energy-organization-views.service.ts",
  // F4.302 U2 (ADR 0108 Amendment 4 item 5): the segment view's two-sided list.
  "apps/api/src/trend-points/segment-abnormal.ts",
  "apps/api/src/trend-points/segment-views-read.ts",
  "apps/api/src/trend-points/segment-views.service.ts",
] as const;

/** The files that carry SQL; the claim below fails the day a listed path goes missing. */
const READS_FILES = [
  "apps/api/src/reports/energy-organization-reads.ts",
  "apps/api/src/trend-points/segment-views-read.ts", // F4.302 U2.
] as const;

const FORBIDDEN_DIRECTORIES = ["alarms", "rules", "notifications"] as const;

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
}

/** Every module specifier of an `import … from`, a side-effect `import "…"`, a dynamic `import(…)` or a `require(…)`. */
function specifiers(source: string): string[] {
  const code = withoutComments(source);
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((pattern) => Array.from(code.matchAll(pattern), (match) => match[1] as string));
}

/** The specifiers that reach an alarms, rules or notifications directory. */
function forbiddenImports(source: string): string[] {
  return specifiers(source).filter((specifier) =>
    FORBIDDEN_DIRECTORIES.some((dir) => new RegExp(`(^|/)${dir}(/|$)`).test(specifier)),
  );
}

/** The SQL write keywords outside comments, in any case (SQL keywords are case-insensitive). */
function writeKeywords(source: string): string[] {
  return Array.from(withoutComments(source).matchAll(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/gi), (match) => match[1] as string);
}

describe("F4.299 — the abnormal list is advisory only (ADR 0108 Amendment 1, 7.7)", () => {
  it("the new api modules import nothing from alarms, rules or notifications", () => {
    const offenders = ADVISORY_MODULES.flatMap((path) => forbiddenImports(read(path)).map((s) => `${path}: ${s}`));
    expect(offenders).toEqual([]);
  });

  it("positive control: an alarms import is caught in each advisory module", () => {
    for (const path of ADVISORY_MODULES) {
      expect(forbiddenImports(`${read(path)}
import { AlarmsService } from "../alarms/alarms.service";
`), path).toEqual([
        "../alarms/alarms.service",
      ]);
    }
  });

  it("the scan reads real imports (each module imports something)", () => {
    for (const path of ADVISORY_MODULES) expect(specifiers(read(path)).length).toBeGreaterThan(0);
  });

  it("positive control: an import of an alarms, rules or notifications module is caught", () => {
    const base = read(ADVISORY_MODULES[2]);
    expect(forbiddenImports(`${base}\nimport { AlarmsService } from "../alarms/alarms.service";\n`)).toEqual([
      "../alarms/alarms.service",
    ]);
    expect(forbiddenImports(`${base}\nimport { RulesService } from "../rules/rules.service";\n`)).toEqual([
      "../rules/rules.service",
    ]);
    expect(forbiddenImports(`${base}\nconst n = await import("../notifications/notifications.service");\n`)).toEqual([
      "../notifications/notifications.service",
    ]);
  });

  it("positive control: a comment naming an alarms module is not an import", () => {
    expect(forbiddenImports(`/** see import { A } from "../alarms/alarms.service" */\n// from "../rules/x"\n`)).toEqual([]);
  });

  it("every listed reads file exists and is not empty", () => {
    for (const path of READS_FILES) expect(read(path).length, path).toBeGreaterThan(0);
  });

  it("the reads files carry no INSERT, UPDATE, DELETE or TRUNCATE outside comments", () => {
    const offenders = READS_FILES.flatMap((path) => writeKeywords(read(path)).map((k) => `${path}: ${k}`));
    expect(offenders).toEqual([]);
  });

  it("positive control: a write statement in each reads file is caught, a comment is not", () => {
    for (const path of READS_FILES) {
      const base = read(path);
      expect(writeKeywords(`${base}
const sql = "INSERT INTO bms.alarms (id) VALUES ($1)";
`), path).toEqual(["INSERT"]);
      expect(writeKeywords(`${base}
/** never DELETE here */
// nor TRUNCATE
`), path).toEqual([]);
    }
    const base = read(READS_FILES[0]);
    expect(writeKeywords(`${base}\nconst sql = "INSERT INTO bms.alarms (id) VALUES ($1)";\n`)).toEqual(["INSERT"]);
    expect(writeKeywords(`${base}\nconst sql = \`UPDATE bms.assets SET name = $1\`;\n`)).toEqual(["UPDATE"]);
    expect(writeKeywords(`${base}\n/** never DELETE here */\n// nor TRUNCATE\n`)).toEqual([]);
  });

  it("positive control: a lowercase write statement is caught (SQL keywords are case-insensitive)", () => {
    const base = read(READS_FILES[0]);
    expect(writeKeywords(`${base}\nconst sql = "delete from bms.assets";\n`)).toEqual(["delete"]);
    expect(writeKeywords(`${base}\nconst sql = "insert into bms.alarms (id) values ($1)";\n`)).toEqual(["insert"]);
  });

  it("negative control: a column such as updated_at is not a write keyword", () => {
    expect(writeKeywords(`const sql = "SELECT updated_at, deleted_at, inserted_at FROM bms.assets";\n`)).toEqual([]);
  });
});
