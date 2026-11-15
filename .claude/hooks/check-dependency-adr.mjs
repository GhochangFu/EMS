#!/usr/bin/env node
// PreToolUse hook — AGENTS.md §9.4 / §4: adding or changing a dependency
// requires an ADR in docs/adr/ (Promotion Process §10).
//
// Fires on Edit/Write/MultiEdit of any package.json, and since ADR 0135 of a
// Python pyproject.toml or uv.lock (apps/ml). When it detects an added
// dependency, it returns a "deny" decision, which blocks the tool call
// outright. "ask" was not enough: under permissions.defaultMode "auto" an "ask"
// is resolved without reaching a human, so an unattended session sailed straight
// past the gate. "deny" holds in every permission mode.
//
// uv.lock is denied outright: it is produced by `uv lock`, never hand-edited.
//
// Fails OPEN on any error — a broken hook must never block the workflow.

import { readFileSync } from 'node:fs';

// Shared with `.githooks/pre-commit.mjs`. The SPEC regex and the TOML scanner
// ARE the check, so a second copy could be weakened on one path while the
// other still passed.
import {
  addedPyDependencyEntries,
  addedSpecLines,
  pyDependencyEntries,
  specLines,
} from '../../scripts/checks/dependency-spec.mjs';
import { isPackageJson, isPyprojectToml, isUvLock } from '../../scripts/checks/paths.mjs';

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

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

/** Apply one Edit to `text` the way the Edit tool does (literal, first or all). */
function applyEdit(text, oldString, newString, replaceAll) {
  const o = String(oldString ?? '');
  const n = String(newString ?? '');
  if (!o) return text;
  if (replaceAll) return text.split(o).join(n);
  const i = text.indexOf(o);
  return i === -1 ? text : text.slice(0, i) + n + text.slice(i + o.length);
}

/**
 * Added Python entries for an Edit/MultiEdit. A TOML entry's meaning depends
 * on the table it sits in, which an edit fragment usually does not show — so
 * the edit is applied to the file on disk and the whole file compared. When the
 * file cannot be read, the fragments are compared on their own.
 */
function addedPyForEdits(file, edits) {
  let before = null;
  try {
    before = readFileSync(file, 'utf8');
  } catch {
    before = null;
  }
  if (before !== null) {
    let after = before;
    for (const e of edits) after = applyEdit(after, e.old_string, e.new_string, e.replace_all);
    return addedPyDependencyEntries(before, after);
  }
  const out = [];
  for (const e of edits) out.push(...addedPyDependencyEntries(e.old_string, e.new_string));
  return out;
}

(async () => {
  try {
    const data = JSON.parse((await readStdin()) || '{}');
    const tool = data.tool_name || '';
    const input = data.tool_input || {};
    const file = input.file_path || '';

    if (isUvLock(file)) {
      deny(
        'ADR 0135 / AGENTS.md §9.4: uv.lock is produced by `uv lock` (or `uv add`), ' +
          'never edited by hand. Run uv from Bash; a newly locked package needs an ADR ' +
          'staged in the same commit, which the pre-commit check enforces.'
      );
    }

    const python = isPyprojectToml(file);
    if (!python && !isPackageJson(file)) process.exit(0);

    const edits =
      tool === 'Edit'
        ? [input]
        : tool === 'MultiEdit' && Array.isArray(input.edits)
          ? input.edits.filter(Boolean)
          : [];

    let added = [];
    if (python) {
      if (tool === 'Write') added = pyDependencyEntries(input.content);
      else if (edits.length) added = addedPyForEdits(file, edits);
    } else if (tool === 'Write') {
      // Whole-file write: no reliable diff, so flag present specifiers.
      added = specLines(input.content);
    } else {
      for (const e of edits) added.push(...addedSpecLines(e.old_string, e.new_string));
    }

    if (added.length === 0) process.exit(0);

    deny(
      'AGENTS.md §9.4 / §4: adding or changing a dependency requires an ADR in ' +
        'docs/adr/ (Promotion Process §10). Detected manifest change:\n' +
        added.slice(0, 8).map((l) => '  ' + l).join('\n') +
        '\nThis edit is blocked. Land the ADR first, then apply the manifest change ' +
        'in the same PR' +
        (python ? ' (for apps/ml, with `uv add` from Bash)' : '') +
        '. If this is a script or version-only change that needs no ADR, ' +
        'the human applies it directly — an agent must not decide that on its own.'
    );
  } catch {
    process.exit(0); // fail open
  }
})();
