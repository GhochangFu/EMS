#!/usr/bin/env node
// PreToolUse hook — protect already-shipped drizzle migrations from edits.
//
// Drizzle records each applied migration by SHA-256 of its file content in
// drizzle.__drizzle_migrations, and never re-runs it. Editing a migration that
// has already shipped therefore does NOT change any existing database: dev,
// CI, and the PHE pilot silently diverge, and the file no longer describes the
// schema those databases actually have.
//
// Forward-only is the rule: to change the schema, add a NEW migration.
//
// Fires on Edit/MultiEdit/Write of packages/db/drizzle/*.sql. A file is treated as
// "already shipped" when it is tracked by git (committed). Newly generated,
// untracked migrations are still freely editable, so `pnpm db:generate`
// followed by hand-tuning keeps working.
//
// Returns an "ask" decision so a human can override deliberately (e.g. fixing
// a typo in a migration that has genuinely never left this machine).
// Fails OPEN on any error — a broken hook must never block the workflow.

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (raw += c));
    process.stdin.on('end', () => resolve(raw));
    const t = setTimeout(() => resolve(raw), 2000);
    if (typeof t.unref === 'function') t.unref();
  });
}

function isDrizzleMigration(file) {
  const norm = String(file || '').replace(/\\/g, '/');
  return /\/packages\/db\/drizzle\/[^/]+\.sql$/i.test(norm);
}

// True when git already tracks the file (i.e. it has been committed/shipped).
function isTrackedByGit(file) {
  try {
    const out = execFileSync('git', ['ls-files', '--error-unmatch', file], {
      cwd: dirname(file),
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 5000,
    });
    return String(out).trim().length > 0;
  } catch {
    return false; // untracked, or git unavailable → do not block
  }
}

(async () => {
  try {
    const data = JSON.parse((await readStdin()) || '{}');
    const tool = data.tool_name || '';
    if (tool !== 'Edit' && tool !== 'MultiEdit' && tool !== 'Write') process.exit(0);

    const file = (data.tool_input && data.tool_input.file_path) || '';
    if (!isDrizzleMigration(file)) process.exit(0);
    if (!isTrackedByGit(file)) process.exit(0);

    const name = file.replace(/\\/g, '/').split('/').pop();
    const reason =
      `${name} is a committed drizzle migration. Drizzle tracks applied ` +
      'migrations by content hash and never re-runs them, so editing this file ' +
      'will NOT update any database that already ran it — dev, CI, and the PHE ' +
      'pilot would silently diverge from what this file says.\n\n' +
      'Prefer forward-only: add a NEW migration (`pnpm db:generate`) that makes ' +
      'the change.\n\n' +
      'Override only if this migration has genuinely never been applied anywhere.';

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: reason,
        },
      })
    );
    process.exit(0);
  } catch {
    process.exit(0); // fail open
  }
})();
