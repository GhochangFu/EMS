import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const DRIVER = join(repoRoot, ".githooks", "pre-commit.mjs");
const HOOKS = join(repoRoot, ".claude", "hooks");

/**
 * The git pre-commit backstop (`.githooks/`) and the shared predicates it
 * splits with the Claude Code hooks (`scripts/checks/`).
 *
 * **Why this spawns processes instead of importing the functions.** The
 * predicates are `.mjs`, and `tests/*.test.ts` is type-checked by the explicit
 * file list in `typecheck:tests` (see `repo-invariants.test.ts`), which would
 * reject an untyped `.mjs` import. That constraint pushed the suite somewhere
 * better: it drives the **real entry points** — a scratch git repository with a
 * real index for the hook, and real stdin JSON for the four Claude hooks. Unit
 * tests over the pure functions would have proved nothing about whether the
 * exit code actually aborts a commit, which is the only behaviour that matters
 * here.
 *
 * The driver reads `process.cwd()` rather than its own location precisely so it
 * can be pointed at the scratch repository.
 */

const scratchDirs: string[] = [];

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A throwaway repository with one commit, so HEAD exists. */
function scratchRepo(seed: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "bms-precommit-"));
  scratchDirs.push(dir);
  sh(dir, ["init", "--quiet"]);
  sh(dir, ["config", "user.email", "test@example.invalid"]);
  sh(dir, ["config", "user.name", "test"]);
  sh(dir, ["config", "commit.gpgsign", "false"]);
  write(dir, { "README.md": "seed\n", ...seed });
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "--quiet", "-m", "seed"]);
  return dir;
}

function write(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

/** Stage `files` and run the hook driver against that index. */
function runGate(dir: string, files: Record<string, string>): { code: number; stderr: string } {
  write(dir, files);
  sh(dir, ["add", "-A"]);
  try {
    execFileSync(process.execPath, [DRIVER], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    return { code: e.status ?? -1, stderr: String(e.stderr ?? "") };
  }
}

/** Run one Claude Code hook with a synthetic tool payload on stdin. */
function runClaudeHook(name: string, payload: unknown): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [join(HOOKS, name)], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

const JOURNAL = (tags: string[]): string =>
  JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries: tags.map((tag, idx) => ({ idx, version: "7", when: 1700000000000 + idx, tag, breakpoints: true })),
  });

afterAll(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe("pre-commit backstop - what it blocks", () => {
  it("aborts when a committed drizzle migration is edited", () => {
    const dir = scratchRepo({
      "packages/db/drizzle/0001_init.sql": "CREATE TABLE a();\n",
      "packages/db/drizzle/meta/_journal.json": JOURNAL(["0001_init"]),
    });
    const r = runGate(dir, { "packages/db/drizzle/0001_init.sql": "CREATE TABLE a(); -- edited\n" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Committed drizzle migrations changed");
    expect(r.stderr).toContain("0001_init.sql");
  });

  it("aborts on an added dependency with no ADR staged", () => {
    const dir = scratchRepo({ "package.json": '{\n  "name": "x"\n}\n' });
    const r = runGate(dir, { "package.json": '{\n  "name": "x",\n  "dependencies": {\n    "left-pad": "^1.3.0"\n  }\n}\n' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Dependency specifiers added with no ADR");
    expect(r.stderr).toContain("left-pad");
  });

  it("aborts on a migration file with no journal entry", () => {
    const dir = scratchRepo({
      "packages/db/drizzle/0001_init.sql": "CREATE TABLE a();\n",
      "packages/db/drizzle/meta/_journal.json": JOURNAL(["0001_init"]),
    });
    const r = runGate(dir, { "packages/db/drizzle/0002_next.sql": "CREATE TABLE b();\n" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("NO journal entry");
    expect(r.stderr).toContain("0002_next.sql");
  });

  it("aborts on a journal entry whose .sql file is missing", () => {
    const dir = scratchRepo({
      "packages/db/drizzle/0001_init.sql": "CREATE TABLE a();\n",
      "packages/db/drizzle/meta/_journal.json": JOURNAL(["0001_init"]),
    });
    const r = runGate(dir, { "packages/db/drizzle/meta/_journal.json": JOURNAL(["0001_init", "0002_ghost"]) });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("NO .sql file");
  });

  it("aborts on a banned construct in an ADDED line of a TS file", () => {
    const dir = scratchRepo();
    const r = runGate(dir, { "src/a.ts": "export const f = (x: any) => x;\n" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("type - use `unknown`");
  });
});

describe("pre-commit backstop - what it must NOT block", () => {
  it("passes an added dependency when an ADR is staged in the same commit", () => {
    const dir = scratchRepo({ "package.json": '{\n  "name": "x"\n}\n' });
    const r = runGate(dir, {
      "package.json": '{\n  "name": "x",\n  "dependencies": {\n    "left-pad": "^1.3.0"\n  }\n}\n',
      "docs/adr/0099-left-pad.md": "# ADR 0099\n\nAccepted.\n",
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  /**
   * The gate must not fire on its own installer. `"hooks:install": "git config
   * ..."` is a script, not a dependency: the SPEC alternation requires `git+`
   * with the plus for a git source, so a value beginning `git config` is not a
   * specifier. Verified rather than assumed, because this exact line is added to
   * the root manifest by the change that introduced this hook.
   */
  it("passes a script-only manifest change, including its own installer line", () => {
    const dir = scratchRepo({ "package.json": '{\n  "name": "x",\n  "scripts": {}\n}\n' });
    const r = runGate(dir, {
      "package.json": '{\n  "name": "x",\n  "scripts": {\n    "hooks:install": "git config core.hooksPath .githooks"\n  }\n}\n',
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  /**
   * Added lines only. Whole-file scanning would make every pre-existing
   * violation in a legacy module block every commit that touches it, and a gate
   * that everyone learns to bypass is worse than no gate.
   */
  it("passes when the banned construct is pre-existing and untouched", () => {
    const dir = scratchRepo({ "src/legacy.ts": "export const f = (x: any) => x;\n" });
    const r = runGate(dir, { "src/legacy.ts": "export const f = (x: any) => x;\nexport const g = 1;\n" });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("passes a new migration that is journaled alongside its .sql", () => {
    const dir = scratchRepo({
      "packages/db/drizzle/0001_init.sql": "CREATE TABLE a();\n",
      "packages/db/drizzle/meta/_journal.json": JOURNAL(["0001_init"]),
    });
    const r = runGate(dir, {
      "packages/db/drizzle/0002_next.sql": "CREATE TABLE b();\n",
      "packages/db/drizzle/meta/_journal.json": JOURNAL(["0001_init", "0002_next"]),
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("passes an ordinary clean change", () => {
    const dir = scratchRepo();
    const r = runGate(dir, { "src/ok.ts": "export const answer: number = 42;\n" });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });
});

describe("the Claude Code hooks still work after the shared extraction", () => {
  it("check-dependency-adr denies an Edit that adds a specifier", () => {
    const r = runClaudeHook("check-dependency-adr.mjs", {
      tool_name: "Edit",
      tool_input: {
        file_path: "/repo/package.json",
        old_string: '  "scripts": {}',
        new_string: '  "dependencies": { "left-pad": "^1.3.0" }',
      },
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("check-dependency-adr stays silent on a script-only Edit", () => {
    const r = runClaudeHook("check-dependency-adr.mjs", {
      tool_name: "Edit",
      tool_input: {
        file_path: "/repo/package.json",
        old_string: '  "scripts": {}',
        new_string: '  "scripts": { "hooks:install": "git config core.hooksPath .githooks" }',
      },
    });
    expect(r.stdout).toBe("");
  });

  it("check-applied-migration-edit recognises a migration path", () => {
    const r = runClaudeHook("check-applied-migration-edit.mjs", {
      tool_name: "Edit",
      tool_input: { file_path: join(repoRoot, "packages/db/drizzle/0041_bms_owner_and_force_rls.sql") },
    });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("check-style-hygiene flags a banned construct in written text", () => {
    const r = runClaudeHook("check-style-hygiene.mjs", {
      tool_name: "Write",
      tool_input: { file_path: "/repo/src/a.ts", content: "const f = (x: any) => x;" },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("§4.1");
  });

  /**
   * The regression that made this worth keeping: the English word in a prose
   * comment is not a type. `stripNonCode` is what separates them, and it is now
   * shared, so this case guards both entry points at once.
   */
  it("check-style-hygiene does not flag the same word inside a comment", () => {
    const r = runClaudeHook("check-style-hygiene.mjs", {
      tool_name: "Write",
      tool_input: { file_path: "/repo/src/a.ts", content: "// this does not apply to any of the roles\nconst f = 1;" },
    });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });
});
