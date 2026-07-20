#!/usr/bin/env node
// PreToolUse hook — AGENTS.md §9.4 / §4: adding or changing a dependency
// requires an ADR in docs/adr/ (Promotion Process §10).
//
// Fires on Edit/Write/MultiEdit of any package.json. When it detects an added
// dependency specifier, it returns an "ask" decision so a human confirms an ADR
// exists before the change lands. Fails OPEN on any error — a broken hook must
// never block the workflow.

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

function isPackageJson(file) {
  const f = file || '';
  return /(^|[\\/])package\.json$/.test(f) && !/[\\/]node_modules[\\/]/.test(f);
}

// A JSON line that looks like "<name>": "<version-or-source-spec>".
const SPEC =
  /"[^"]+"\s*:\s*"(?:\^|~|>=|<=|>|<|\d|\*|workspace:|npm:|file:|link:|git\+|https?:|github:)/;

function specLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => SPEC.test(l));
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
      const before = new Set(specLines(input.old_string));
      added = specLines(input.new_string).filter((l) => !before.has(l));
    } else if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
      for (const e of input.edits) {
        const before = new Set(specLines(e && e.old_string));
        added.push(...specLines(e && e.new_string).filter((l) => !before.has(l)));
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
      '\nConfirm an ADR exists (or this is a script/version-only change) before proceeding.';

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
