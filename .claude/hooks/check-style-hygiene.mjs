#!/usr/bin/env node
// PostToolUse hook — AGENTS.md §4.5 / §4.1 style hygiene for edited TS/TSX source.
//
// Checks only the text just written (not the whole file) for: console.log/debug/info,
// `any` types, and emoji. Also checks the whole-file line cap. On a violation it exits
// with code 2 so the message is fed back to Claude as advisory feedback to self-correct.
// The edit has already happened — this never undoes anything. Fails OPEN on any error.

import { readFileSync, existsSync } from 'node:fs';

const MAX_LINES = 1000;

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

// Best-effort removal of comments and string/template literals so matches are code, not prose.
function stripNonCode(s) {
  return String(s || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ');
}

(async () => {
  try {
    const data = JSON.parse((await readStdin()) || '{}');
    const tool = data.tool_name || '';
    const input = data.tool_input || {};
    const file = input.file_path || '';

    if (!/\.tsx?$/.test(file)) process.exit(0);
    if (/[\\/](node_modules|dist|build)[\\/]/.test(file)) process.exit(0);

    const added = newText(tool, input);
    const code = stripNonCode(added);
    const violations = [];

    if (/\bconsole\.(log|debug|info)\s*\(/.test(code)) {
      violations.push('console.log/debug/info — use the shared Pino logger (§4.5).');
    }
    if (/(:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|Array<any>|Record<[^>]*\bany\b[^>]*>)/.test(code)) {
      violations.push('`any` type — use `unknown` and narrow (§4.1).');
    }
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(added)) {
      violations.push('emoji in code — not allowed unless explicitly requested (§4.5).');
    }

    try {
      if (file && existsSync(file)) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/).length;
        if (lines > MAX_LINES) {
          violations.push(
            `file is ${lines} lines — max ${MAX_LINES} lines per file this phase (§4.5).`
          );
        }
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
