#!/usr/bin/env node
// git pre-commit hook — the commit-time backstop for four AGENTS.md rules.
//
// WHY THIS EXISTS, AND WHAT IT IS NOT
//
// The same four rules are already enforced by Claude Code hooks in
// `.claude/settings.json`, and those hooks are STRICTLY BETTER where they
// apply: two of them are PreToolUse `deny`, so they stop a bad edit before the
// file is written and before an agent builds on it. This hook fires much later,
// once the damage is already on disk.
//
// It exists because those hooks match `Edit|Write|MultiEdit` — Claude's own
// file-writing tools — and therefore see nothing when a file is written any
// other way. Two such ways already exist: a `Bash` heredoc or `sed` (the
// matcher does not list `Bash`), and any external agent invoked as a tool,
// which writes through its own process. Every one of those paths still has to
// reach `main` through a commit.
//
// So this is a BACKSTOP, not a relocation. The Claude hooks stay. Nothing here
// makes the earlier gate redundant, and removing them in favour of this file
// would trade an early block for a late one.
//
// THE OVERRIDE IS THE HUMAN'S
//
// `git commit --no-verify` skips this hook. That is the deliberate escape
// hatch, and it belongs to the person, exactly as the two `deny` hooks say:
// "an agent must not decide that on its own." An agent that finds its commit
// blocked fixes the cause.
//
// FAILURE POLICY
//
// Each check is isolated. A check that throws prints a loud warning and is
// skipped; the other three still run and can still block. A crash therefore
// degrades the gate visibly instead of disabling it silently, which is the
// failure mode this whole file exists to remove.

import { execFileSync } from 'node:child_process';

import { addedSpecLines } from '../scripts/checks/dependency-spec.mjs';
import { journalProblems } from '../scripts/checks/drizzle-journal.mjs';
import { isDrizzleMigration, isPackageJson, isStyleCheckedSource } from '../scripts/checks/paths.mjs';
import { lineCapViolation, styleViolations } from '../scripts/checks/style-hygiene.mjs';

// Deliberately the CURRENT WORKING DIRECTORY, not this file's own location.
// git runs a hook with cwd set to the top of the working tree, so cwd is always
// right in production - and it is what lets the whole driver be exercised
// against a scratch repository in `tests/`, exit codes and all. Resolving the
// repo from `import.meta.url` instead would pin every git call to this
// checkout, and the tests would silently inspect the wrong tree.
function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

/** `git diff --cached --name-only -z` for the given filter, as a path array. */
function stagedPaths(filter) {
  const out = git(['diff', '--cached', '--name-only', '-z', `--diff-filter=${filter}`]);
  return String(out || '')
    .split('\0')
    .filter(Boolean);
}

/** Content of a path in the index (what the commit will contain). */
function stagedContent(path) {
  return git(['show', `:${path}`], { allowFailure: true });
}

/** Content of a path in HEAD, or null when it is new or HEAD does not exist. */
function headContent(path) {
  return git(['show', `HEAD:${path}`], { allowFailure: true });
}

/** The `+` lines of a staged diff, without the `+++` file header. */
function addedLines(path) {
  const diff = git(['diff', '--cached', '-U0', '--', path], { allowFailure: true });
  return String(diff || '')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .join('\n');
}

// ---------------------------------------------------------------------------
// The four checks. Each returns an array of problem strings.
// ---------------------------------------------------------------------------

/**
 * A committed drizzle migration must never be edited.
 *
 * Drizzle records each applied migration by SHA-256 of its content and never
 * re-runs it, so editing one does NOT change any database that already ran it.
 * Dev, CI and the PHE pilot silently diverge from what the file says.
 *
 * "Already shipped" is read as "present in HEAD", so a migration generated and
 * hand-tuned before its first commit stays freely editable.
 */
function checkAppliedMigrationEdit() {
  const touched = stagedPaths('MRD').filter(isDrizzleMigration);
  if (touched.length === 0) return [];
  return [
    'Committed drizzle migrations changed:\n' +
      touched.map((f) => `  - ${f}`).join('\n') +
      '\n\nDrizzle tracks applied migrations by content hash and never re-runs ' +
      'them, so this change will NOT reach any database that already ran the ' +
      'file. Forward-only: add a NEW migration (`pnpm db:generate`) instead.',
  ];
}

/**
 * Adding a dependency requires an ADR (AGENTS.md §9.4 / §4, promotion §10).
 *
 * The pass condition differs from the Claude hook's on purpose, because the two
 * stages know different things. The Claude hook cannot see a future commit, so
 * it blocks outright. At commit time the ADR is either in this commit or it is
 * not — and blocking unconditionally would make the manifest change
 * uncommittable without --no-verify, turning the gate into a nuisance that
 * everyone learns to skip.
 */
function checkDependencyAdr() {
  const manifests = stagedPaths('ACMR').filter(isPackageJson);
  if (manifests.length === 0) return [];

  const added = [];
  for (const path of manifests) {
    const before = headContent(path) ?? '';
    const after = stagedContent(path) ?? '';
    for (const line of addedSpecLines(before, after)) added.push(`${path}: ${line}`);
  }
  if (added.length === 0) return [];

  const adrStaged = stagedPaths('ACMR').some((f) => /^docs\/adr\/.+\.md$/.test(f));
  if (adrStaged) return [];

  return [
    'Dependency specifiers added with no ADR in this commit:\n' +
      added.slice(0, 8).map((l) => `  ${l}`).join('\n') +
      '\n\nAGENTS.md §9.4 / §4: adding or changing a dependency requires an ADR ' +
      'in docs/adr/ (promotion process §10). Stage the ADR in the same commit. ' +
      'If this is a script or version-only change that needs no ADR, the human ' +
      'commits it directly - an agent must not decide that on its own.',
  ];
}

/**
 * Journal integrity, read from the INDEX rather than the working tree.
 *
 * Staging a new .sql without its journal entry is precisely the commit-time
 * mistake this catches, and a working-tree read would miss it whenever the
 * journal is correct on disk but not staged.
 */
function checkDrizzleJournal() {
  const touched = stagedPaths('ACMRD').filter((f) => f.startsWith('packages/db/drizzle/'));
  if (touched.length === 0) return [];

  const journalText = stagedContent('packages/db/drizzle/meta/_journal.json');
  if (journalText === null) return [];

  const listed = git(['ls-files', '--cached', '--', 'packages/db/drizzle/*.sql']);
  const sqlTags = String(listed || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((f) => f.split('/').pop().replace(/\.sql$/i, ''));

  const problems = journalProblems({ journalText, sqlTags });
  if (problems.length === 0) return [];
  return [
    'Drizzle journal integrity failed for the staged tree:\n\n' +
      problems.join('\n\n') +
      '\n\nRegenerate with `pnpm db:generate`, or hand-edit meta/_journal.json ' +
      'keeping `idx`/`tag`/`when` consistent - and stage it.',
  ];
}

/** §4.1 / §4.5 hygiene over the ADDED lines of each staged TS/TSX file. */
function checkStyleHygiene() {
  const files = stagedPaths('ACMR').filter(isStyleCheckedSource);
  const problems = [];

  for (const path of files) {
    const violations = styleViolations(addedLines(path));

    const content = stagedContent(path);
    if (content !== null) {
      const cap = lineCapViolation(String(content).split(/\r?\n/).length);
      if (cap) violations.push(cap);
    }

    if (violations.length > 0) {
      problems.push(`${path}:\n` + violations.map((v) => `  - ${v}`).join('\n'));
    }
  }

  if (problems.length === 0) return [];
  return ['AGENTS.md §4.1 / §4.5 style hygiene:\n\n' + problems.join('\n\n')];
}

// ---------------------------------------------------------------------------

const CHECKS = [
  ['committed migration edit', checkAppliedMigrationEdit],
  ['dependency ADR gate', checkDependencyAdr],
  ['drizzle journal', checkDrizzleJournal],
  ['style hygiene', checkStyleHygiene],
];

function main() {
  if (git(['rev-parse', '--verify', 'HEAD'], { allowFailure: true }) === null) {
    // No commits yet: HEAD comparisons are meaningless and nothing has shipped.
    return 0;
  }

  const problems = [];
  for (const [name, run] of CHECKS) {
    try {
      problems.push(...run());
    } catch (err) {
      process.stderr.write(
        `pre-commit WARNING: the "${name}" check crashed and did NOT run - ` +
          `${err && err.message ? err.message : err}\n`,
      );
    }
  }

  if (problems.length === 0) return 0;

  process.stderr.write(
    `\npre-commit: ${problems.length} rule violation(s) - commit aborted.\n\n` +
      problems.join('\n\n') +
      '\n\nThese are the same rules the Claude Code hooks enforce; this hook is ' +
      'the backstop for writes those hooks never see.\n' +
      'To override, the HUMAN commits with --no-verify. An agent fixes the cause.\n\n',
  );
  return 1;
}

process.exit(main());
