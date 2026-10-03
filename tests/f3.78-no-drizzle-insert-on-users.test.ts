import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F3.78` / ADR 0089 decision 7, plan §3 conventions — nothing under
 * `apps/api/src` inserts into `bms.users` through drizzle's query builder.
 *
 * drizzle-orm 0.38.4's `buildInsertQuery` lists **every** column of the table
 * and sends `default` for an omitted one, so `tx.insert(users)` names
 * `password_hash`. Postgres checks the column `INSERT` privilege on every
 * listed column, and `0098` grants the pool roles seven columns without it:
 * on `bms_tenant` or `bms_fleet` the statement is `permission denied for table
 * users`. A bare `.returning()` would select `password_hash` as well. The user
 * insert is raw `sql` with an explicit column list and an explicit `RETURNING`
 * list (`insertUserRow` in `apps/api/src/admin/users/users.service.ts`).
 *
 * Comments are stripped before the scan, so a docblock that quotes the
 * forbidden call (the service's own does) cannot fail it, and cannot satisfy
 * the positive control either.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** `insert(users)`, `.insert( users )`, `insert(schema.users)` — the builder entry on the users table. */
const DRIZZLE_USERS_INSERT = /\binsert\s*\(\s*(?:[A-Za-z_$][\w$]*\.)?users\s*\)/;

function tsFiles(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(relative(repoRoot, full).split("\\").join("/"));
    }
  };
  walk(join(repoRoot, rel));
  return out;
}

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

describe("F3.78 — no drizzle insert on bms.users under apps/api/src (ADR 0089 decision 7)", () => {
  it("the walk finds the api source tree (a broken walk would pass vacuously)", () => {
    expect(tsFiles("apps/api/src").length).toBeGreaterThan(100);
  });

  it("the pattern matches the forbidden call shapes (positive control)", () => {
    expect(
      ["await tx.insert(users).values(row)", "db.insert( users )", "tx.insert(schema.users)"].map((sample) =>
        DRIZZLE_USERS_INSERT.test(sample),
      ),
    ).toEqual([true, true, true]);
  });

  it("no file under apps/api/src calls insert(users)", () => {
    const offenders = tsFiles("apps/api/src").filter((rel) => DRIZZLE_USERS_INSERT.test(codeOnly(read(rel))));
    expect(offenders).toEqual([]);
  });

  it("the users service inserts with raw sql naming exactly the seven granted columns", () => {
    const service = codeOnly(read("apps/api/src/admin/users/users.service.ts"));
    expect(service).toContain(
      "INSERT INTO bms.users (id, organization_id, email, display_name, role, oidc_subject, created_at)",
    );
  });
});
