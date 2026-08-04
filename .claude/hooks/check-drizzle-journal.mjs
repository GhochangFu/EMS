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
// Fires after any edit under packages/db/drizzle/ and asserts three invariants:
//   1. every *.sql file has a journal entry
//   2. every journal entry has a *.sql file
//   3. `when` timestamps strictly increase (drizzle applies only migrations
//      newer than the newest already-applied one, so an out-of-order entry can
//      never apply to an existing database)
//
// Exits 2 on violation so the message is fed back to Claude as advisory
// feedback. The edit has already happened — this never undoes anything.
// Fails OPEN on any error: a broken hook must never block the workflow.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

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

// Returns the drizzle migrations dir for an edited path, or '' when unrelated.
function drizzleDirFor(file) {
  const norm = String(file || '').replace(/\\/g, '/');
  if (!/\/packages\/db\/drizzle\//.test(norm)) return '';
  const idx = norm.indexOf('/packages/db/drizzle/');
  return norm.slice(0, idx + '/packages/db/drizzle'.length).split('/').join(sep);
}

(async () => {
  try {
    const data = JSON.parse((await readStdin()) || '{}');
    const file = (data.tool_input && data.tool_input.file_path) || '';
    const dir = drizzleDirFor(file);
    if (!dir) process.exit(0);

    const journalPath = join(dir, 'meta', '_journal.json');
    if (!existsSync(journalPath)) process.exit(0);

    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    const entries = Array.isArray(journal.entries) ? journal.entries : [];

    const tags = entries.map((e) => String((e && e.tag) || ''));
    const files = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .map((f) => f.slice(0, -4));

    const problems = [];

    const tagSet = new Set(tags);
    const unjournaled = files.filter((f) => !tagSet.has(f));
    if (unjournaled.length > 0) {
      problems.push(
        'Migration files with NO journal entry (drizzle will silently skip these):\n' +
          unjournaled.map((f) => `  - ${f}.sql`).join('\n')
      );
    }

    const fileSet = new Set(files);
    const orphanTags = tags.filter((t) => !fileSet.has(t));
    if (orphanTags.length > 0) {
      problems.push(
        'Journal entries with NO .sql file (migrate will fail to read them):\n' +
          orphanTags.map((t) => `  - ${t}`).join('\n')
      );
    }

    const whens = entries.map((e) => Number((e && e.when) || 0));
    for (let i = 1; i < whens.length; i += 1) {
      if (whens[i] <= whens[i - 1]) {
        problems.push(
          `Journal 'when' is not strictly increasing at entry ${i} ` +
            `(${tags[i - 1] || '?'} = ${whens[i - 1]} -> ${tags[i] || '?'} = ${whens[i]}). ` +
            'Drizzle applies only migrations newer than the newest applied one, ' +
            'so an out-of-order entry can never apply to an existing database.'
        );
        break;
      }
    }

    if (problems.length === 0) process.exit(0);

    process.stderr.write(
      'Drizzle journal integrity check failed for packages/db/drizzle:\n\n' +
        problems.join('\n\n') +
        '\n\nFix meta/_journal.json (or the migration filename) before committing. ' +
        'Regenerate with `pnpm db:generate`, or hand-edit the journal keeping ' +
        '`idx`/`tag`/`when` consistent.\n'
    );
    process.exit(2);
  } catch {
    process.exit(0); // fail open
  }
})();
