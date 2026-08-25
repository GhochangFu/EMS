#!/usr/bin/env node
// PostToolUse hook — AGENTS.md §4.5 / §4.1 style hygiene for edited TS/TSX source.
//
// Checks only the text just written (not the whole file) for: console.log/debug/info,
// `any` types, and emoji. Also checks the whole-file line cap. On a violation it exits
// with code 2 so the message is fed back to Claude as advisory feedback to self-correct.
// The edit has already happened — this never undoes anything. Fails OPEN on any error.

import { readFileSync, existsSync } from 'node:fs';

// Shared with `.githooks/pre-commit.mjs`. Both callers check ADDED text only;
// only the way that text is obtained differs (the new_string of an edit here,
// the `+` lines of a staged diff there).
import { isStyleCheckedSource } from '../../scripts/checks/paths.mjs';
import { lineCapViolation, styleViolations } from '../../scripts/checks/style-hygiene.mjs';

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

function newText(tool, input) {
  if (!input) return '';
  if (tool === 'Write') return String(input.content || '');
  if (tool === 'Edit') return String(input.new_string || '');
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.map((e) => String((e && e.new_string) || '')).join('\n');
  }
  return '';
}

(async () => {
  try {
    const data = JSON.parse((await readStdin()) || '{}');
    const tool = data.tool_name || '';
    const input = data.tool_input || {};
    const file = input.file_path || '';

    if (!isStyleCheckedSource(file)) process.exit(0);

    const violations = styleViolations(newText(tool, input));

    try {
      if (file && existsSync(file)) {
        const cap = lineCapViolation(readFileSync(file, 'utf8').split(/\r?\n/).length);
        if (cap) violations.push(cap);
      }
    } catch {
      /* ignore line-count failure */
    }

    if (violations.length) {
      const rel = String(file).replace(/\\/g, '/');
      process.stderr.write(
        `AGENTS.md §4.5 style hygiene — please fix in ${rel}:\n` +
          violations.map((v) => '  - ' + v).join('\n') +
          '\n'
      );
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail open
  }
})();
