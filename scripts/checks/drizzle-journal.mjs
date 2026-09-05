// Drizzle migration journal integrity, shared by the Claude Code PostToolUse
// hook and the git pre-commit hook.
//
// Drizzle only applies migrations listed in meta/_journal.json. A .sql file
// that is never journaled is silently skipped, so the schema it defines never
// lands. That is not hypothetical: 0018/0021/0022 shipped to main unjournaled,
// which left bms.point_keys missing and broke `pnpm db:seed` on every fresh
// database.
//
// This function is pure so that the two callers can feed it different views of
// the same directory. The Claude hook passes the working tree, because that is
// what the agent just edited. The pre-commit hook passes the *staged* content,
// because that is what the commit will actually contain — staging one half of
// a migration pair is exactly the mistake a commit-time gate should catch.
//
// F4.94 added a fourth invariant: `when` must never sit ahead of the wall
// clock. A hand-pinned future stamp (measured drift: about 6.5 days on
// entries 0057–0062) sorts above a later, honestly-stamped migration, so
// drizzle's `Number(lastDbMigration.created_at) < migration.folderMillis`
// check skips the later file on every database that already ran the future
// one — silently. `JOURNAL_CLOCK_SKEW_MS` tolerates only the gap between
// `drizzle-kit`'s `when: +new Date()` stamp and the moment this check runs.

/** Clock-skew allowance for a freshly generated entry: drizzle-kit stamps `when: +new Date()` on the author's machine. */
export const JOURNAL_CLOCK_SKEW_MS = 60 * 60 * 1000;

/**
 * @param {{ journalText: string, sqlTags: string[], now?: number }} view
 *   `journalText` is the raw meta/_journal.json; `sqlTags` are the migration
 *   file names without the `.sql` suffix; `now` is injectable for tests and
 *   defaults to `Date.now()`.
 * @returns {string[]} human-readable problems; empty means the view is sound.
 */
export function journalProblems({ journalText, sqlTags, now = Date.now() }) {
  let journal;
  try {
    journal = JSON.parse(journalText);
  } catch {
    return ['meta/_journal.json is not valid JSON, so drizzle cannot read it.'];
  }

  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  const tags = entries.map((e) => String((e && e.tag) || ''));
  const files = Array.from(new Set(sqlTags));
  const problems = [];

  const tagSet = new Set(tags);
  const unjournaled = files.filter((f) => !tagSet.has(f));
  if (unjournaled.length > 0) {
    problems.push(
      'Migration files with NO journal entry (drizzle will silently skip these):\n' +
        unjournaled.map((f) => `  - ${f}.sql`).join('\n'),
    );
  }

  const fileSet = new Set(files);
  const orphanTags = tags.filter((t) => !fileSet.has(t));
  if (orphanTags.length > 0) {
    problems.push(
      'Journal entries with NO .sql file (migrate will fail to read them):\n' +
        orphanTags.map((t) => `  - ${t}`).join('\n'),
    );
  }

  // Drizzle applies only migrations newer than the newest already-applied one,
  // so an out-of-order entry can never apply to an existing database.
  const whens = entries.map((e) => Number((e && e.when) || 0));
  for (let i = 1; i < whens.length; i += 1) {
    if (whens[i] <= whens[i - 1]) {
      problems.push(
        `Journal 'when' is not strictly increasing at entry ${i} ` +
          `(${tags[i - 1] || '?'} = ${whens[i - 1]} -> ${tags[i] || '?'} = ${whens[i]}). ` +
          'Drizzle applies only migrations newer than the newest applied one, ' +
          'so an out-of-order entry can never apply to an existing database.',
      );
      break;
    }
  }

  const ahead = entries.filter((e) => Number((e && e.when) || 0) > now + JOURNAL_CLOCK_SKEW_MS);
  if (ahead.length > 0) {
    problems.push(
      `Journal 'when' is ahead of the wall clock (now = ${now}, tolerance ${JOURNAL_CLOCK_SKEW_MS} ms):\n` +
        ahead.map((e) => `  - ${e.tag} = ${e.when} (${new Date(e.when).toISOString()})`).join('\n') +
        '\n\nThe next generated migration takes Date.now(), which is SMALLER, so drizzle skips it on ' +
        'every database that already ran this entry - silently. Stamp `when` with Date.now() at ' +
        'authoring time; never hand-pin it ahead of the clock (F4.94).',
    );
  }

  return problems;
}
