#!/usr/bin/env node
// PostToolUse hook — drizzle migration journal integrity (packages/db/drizzle).
//
// Drizzle only applies migrations listed in meta/_journal.json. A .sql file that
// is never journaled is silently skipped, so the schema it defines never lands.
// That is not hypothetical: 0018/0021/0022 shipped to main unjournaled, which
// left bms.point_keys missing and broke `pnpm db:seed` on every fresh database.
// CI did not catch it because .github/workflows/ci.yml runs db:migrate but never
// db:seed (tracked as F4.4 in docs/BACKLOG.md).
//
// Fires after any edit under packages/db/drizzle/ and asserts four invariants:
//   1. every *.sql file has a journal entry
//   2. every journal entry has a *.sql file
//   3. `when` timestamps strictly increase (drizzle applies only migrations
//      newer than the newest already-applied one, so an out-of-order entry can
//      never apply to an existing database)
//   4. no `when` is more than one hour ahead of the wall clock (F4.94 — a
//      future stamp sorts above a later, honestly-stamped migration, so
//      drizzle silently skips the later one on every database that already
//      ran the future entry)
//
// Exits 2 on violation so the message is fed back to Claude as advisory
// feedback. The edit has already happened — this never undoes anything.
// Fails OPEN on any error: a broken hook must never block the workflow.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Shared with `.githooks/pre-commit.mjs`. This invariant is byte-identical at
// both entry points - only the VIEW differs. This hook passes the working tree,
// because that is what the agent just edited; the pre-commit hook passes the
// staged tree, because that is what the commit will contain.
import { journalProblems } from '../../scripts/checks/drizzle-journal.mjs';
import { drizzleDirFor } from '../../scripts/checks/paths.mjs';

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

(async () => {
  try {
    const data = JSON.parse((await readStdin()) || '{}');
    const file = (data.tool_input && data.tool_input.file_path) || '';
    const dir = drizzleDirFor(file);
    if (!dir) process.exit(0);

    const journalPath = join(dir, 'meta', '_journal.json');
    if (!existsSync(journalPath)) process.exit(0);

    const sqlTags = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .map((f) => f.slice(0, -4));

    const problems = journalProblems({
      journalText: readFileSync(journalPath, 'utf8'),
      sqlTags,
    });

    if (problems.length === 0) process.exit(0);

    process.stderr.write(
      'Drizzle journal integrity check failed for packages/db/drizzle:\n\n' +
        problems.join('\n\n') +
        '\n\nFix meta/_journal.json (or the migration filename) before committing. ' +
        'Regenerate with `pnpm db:generate`, or hand-edit the journal keeping ' +
        '`idx`/`tag` consistent and `when` = `Date.now()` at authoring time.\n'
    );
    process.exit(2);
  } catch {
    process.exit(0); // fail open
  }
})();
