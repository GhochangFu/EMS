#!/usr/bin/env node
// PreToolUse hook — AGENTS.md §9.4 / §4: adding or changing a dependency
// requires an ADR in docs/adr/ (Promotion Process §10).
//
// Fires on Edit/Write/MultiEdit of any package.json. When it detects an added
// dependency specifier, it returns a "deny" decision, which blocks the tool call
// outright. "ask" was not enough: under permissions.defaultMode "auto" an "ask"
// is resolved without reaching a human, so an unattended session sailed straight
// past the gate. "deny" holds in every permission mode.
//
// Fails OPEN on any error — a broken hook must never block the workflow.

// Shared with `.githooks/pre-commit.mjs`. The SPEC regex IS the check, so a
// second copy could be weakened on one path while the other still passed.
import { addedSpecLines, specLines } from '../../scripts/checks/dependency-spec.mjs';
import { isPackageJson } from '../../scripts/checks/paths.mjs';

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
    const tool = data.tool_name || '';
    const input = data.tool_input || {};
    const file = input.file_path || '';
    if (!isPackageJson(file)) process.exit(0);

    let added = [];
    if (tool === 'Edit') {
      added = addedSpecLines(input.old_string, input.new_string);
    } else if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
      for (const e of input.edits) {
        added.push(...addedSpecLines(e && e.old_string, e && e.new_string));
      }
    } else if (tool === 'Write') {
      // Whole-file write: no reliable diff, so flag present specifiers.
      added = specLines(input.content);
    }

    if (added.length === 0) process.exit(0);

    const reason =
      'AGENTS.md §9.4 / §4: adding or changing a dependency requires an ADR in ' +
      'docs/adr/ (Promotion Process §10). Detected manifest change:\n' +
      added.slice(0, 8).map((l) => '  ' + l).join('\n') +
      '\nThis edit is blocked. Land the ADR first, then apply the manifest change ' +
      'in the same PR. If this is a script or version-only change that needs no ADR, ' +
      'the human applies it directly — an agent must not decide that on its own.';

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
  } catch {
    process.exit(0); // fail open
  }
})();
