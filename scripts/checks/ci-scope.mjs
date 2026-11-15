// CI scope: does a change set touch only documentation?
//
// `.github/workflows/ci.yml` runs the full `Build and validate migrations` job
// (build, image builds, migrations, seed, every test suite against Postgres —
// about 12 billed minutes) on every pull request and every push to main. The
// private repository's Actions minutes reached GitHub's 90% warning on
// 2026-09-26, and about half of the pull requests (closures, `chore(agents):`
// sweeps, ADR records) change only Markdown. For those, the `changes` job
// calls this script, and CI runs the repo-invariant tests (`tests/`, no
// database) instead of the full job. Those tests read AGENTS.md, BACKLOG.md
// and the ADRs, so a docs-only change is still gated.
//
// The rule is deliberately narrow, and every doubt answers "full run":
// - a path is documentation only when it ends in `.md`, or sits under `docs/`
//   and is not under `docs/scripts/` (those scripts are code the leak check
//   and the tests run);
// - an empty list, a git failure or an unknown base answers "code";
// - the diff runs with --no-renames: with rename detection, --name-only prints
//   only the destination, so moving a code file into docs/ would read as a
//   docs-only change (code review, 2026-09-26). -z keeps non-ASCII paths
//   unquoted.

/** True when `path` is documentation that the full job cannot be needed for. */
export function isDocumentationPath(path) {
  const p = String(path || '').replace(/\\/g, '/');
  if (p.length === 0) return false;
  if (p.startsWith('docs/scripts/')) return false;
  return p.endsWith('.md') || p.startsWith('docs/');
}

/** True when the change set is non-empty and every path is documentation. */
export function isDocsOnly(paths) {
  const list = (paths || []).map((p) => String(p).trim()).filter((p) => p.length > 0);
  return list.length > 0 && list.every(isDocumentationPath);
}

// ADR 0135 (E1.1, plan R16): the `ml` job — apps/ml's ruff and pytest against a
// TimescaleDB service — is path-scoped. It runs when the scorer changes, when
// anything in packages/db changes (the migrations, the roles and the seed build
// its database, and its fixture reads seeded organizations and locations; step
// 0's thresholds live there too), when the dependencies that run those CLIs
// change, or when this gate itself changes. Every doubt answers "ml", as above.
// The code review of PR 3 widened R16's list from the drizzle folder alone: a
// seed change that broke the fixture would otherwise pass and stay unseen.
const ML_PREFIXES = ['apps/ml/', 'packages/db/'];
const ML_FILES = new Set([
  // The ml image builds from the repo root, so the root .dockerignore decides
  // what apps/ml/Dockerfile can COPY (code review of plan PR 4).
  '.dockerignore',
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/ci.yml',
  'scripts/checks/ci-scope.mjs',
]);

/** True when the change set is empty or any path can affect apps/ml. */
export function touchesMl(paths) {
  const list = (paths || []).map((p) => String(p).trim().replace(/\\/g, '/')).filter((p) => p.length > 0);
  if (list.length === 0) return true;
  return list.some((p) => ML_FILES.has(p) || ML_PREFIXES.some((prefix) => p.startsWith(prefix)));
}

// CLI: node scripts/checks/ci-scope.mjs <base> <head> <two-dot|three-dot>
// Prints `code=true|false` then `ml=true|false`; the workflow appends both to
// $GITHUB_OUTPUT.
if (process.argv[1]?.endsWith('ci-scope.mjs')) {
  const [base, head, mode] = process.argv.slice(2);
  let code = true;
  let ml = true;
  const zero = /^0+$/;
  if (base && head && !zero.test(base)) {
    try {
      const { execFileSync } = await import('node:child_process');
      const range = mode === 'three-dot' ? `${base}...${head}` : `${base}..${head}`;
      const out = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', range], { encoding: 'utf8' });
      const paths = out.split('\0');
      code = !isDocsOnly(paths);
      ml = touchesMl(paths);
      console.error(`ci-scope: ${paths.filter(Boolean).length} changed path(s) in ${range}; docs only: ${!code}; ml: ${ml}`);
    } catch (err) {
      console.error(`ci-scope: git diff failed, running the full job (${err instanceof Error ? err.message : String(err)})`);
      code = true;
      ml = true;
    }
  } else {
    console.error('ci-scope: no usable base commit, running the full job');
  }
  console.log(`code=${code}`);
  console.log(`ml=${ml}`);
}
