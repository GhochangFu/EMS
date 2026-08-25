#!/usr/bin/env node
// Points git at `.githooks/`, so the pre-commit backstop actually runs.
//
// Run by `pnpm hooks:install` and by `postinstall`, so a fresh clone is gated
// after `pnpm install` with nothing to remember. `core.hooksPath` is per-clone
// configuration and cannot be committed, which is why this step has to exist at
// all.
//
// Written in node rather than inline in the manifest on purpose: pnpm runs
// lifecycle scripts through `cmd` on Windows, where `>/dev/null 2>&1` and `||`
// do not mean what they mean in sh. A shell one-liner would have worked on the
// author's machine and silently failed on somebody else's.
//
// Never fails the install. A missing .git (Docker build context, a tarball) is
// an ordinary state, not an error.

import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function git(args) {
  return execFileSync('git', args, {
    cwd: here,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

try {
  git(['rev-parse', '--is-inside-work-tree']);
} catch {
  process.exit(0); // not a git checkout - nothing to install
}

try {
  git(['config', 'core.hooksPath', '.githooks']);

  // git requires the executable bit on POSIX. A no-op on Windows, where the
  // filesystem carries no such bit and Git for Windows runs the shim anyway.
  if (process.platform !== 'win32') {
    chmodSync(join(here, 'pre-commit'), 0o755);
  }

  process.stdout.write('git hooks installed: core.hooksPath -> .githooks\n');
} catch (err) {
  process.stdout.write(
    `git hooks NOT installed (${err && err.message ? err.message : err}). ` +
      'Run `pnpm hooks:install` once the checkout is a normal git repository.\n',
  );
}
