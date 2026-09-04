#!/usr/bin/env node
// Stop hook — keep the published build board in step with the backlog.
//
// A backlog status moves in more ways than an edit to docs/BACKLOG.md: a merge,
// a fetch or a rebase changes what the board reports without any tool touching
// the file. On 2026-08-21 the board was published stale for exactly that reason
// — the checkout was six commits behind origin/main. So this runs at Stop, not
// on an Edit matcher.
//
// It cannot publish. The Artifact tool belongs to the model, not to a shell, so
// this hook does the deterministic half — regenerate, compare, decide — and
// exits 2 to hand the republish back to Claude as advisory feedback. That makes
// the guarantee "regenerated always, republished when a session is running".
//
// It asks ONCE per distinct board state. Exit 2 on Stop keeps the turn going,
// and stop_hook_active only breaks the loop WITHIN a turn — across turns a
// declined republish would nag forever. So the fingerprint it asked about is
// recorded, and the same state stays silent afterwards. A further change to the
// board is a new state, so it asks again.
//
// Cost control: the status pass alone is enough to decide. The renderer only
// runs when the fingerprint actually moved, so a quiet turn writes one JSON file
// and says nothing. Fails OPEN on any error — a broken hook must never block a
// turn from ending.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATUS = join(repoRoot, 'docs', 'scripts', 'backlog-status.mjs');
const DASHBOARD = join(repoRoot, 'docs', 'scripts', 'backlog-dashboard.mjs');
const JSON_OUT = join(repoRoot, 'docs', 'status', 'backlog-status.json');
const MARKER = join(repoRoot, 'docs', 'status', '.published-fingerprint');
// Advanced whenever this hook asks, published or not — see the header note.
const ASKED = join(repoRoot, 'docs', 'status', '.republish-asked');

// Recorded in docs/status/README.md. The same path redeploys to the same URL,
// which is what keeps the link people already hold current.
const ARTIFACT_URL = 'https://claude.ai/code/artifact/6ea26834-e606-44d5-96e6-8d8ea3e509ed';
const ARTIFACT_FILE = 'docs/status/backlog-dashboard.html';
const FAVICON = '⚡';

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

const run = (script) =>
  execFileSync('node', [script], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

(async () => {
  try {
    const raw = await readStdin();
    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      payload = {};
    }

    // Claude is already responding to this hook. Running again would ask for a
    // republish that is in progress, and the pair would not settle.
    if (payload.stop_hook_active === true) process.exit(0);

    if (!existsSync(STATUS) || !existsSync(DASHBOARD)) process.exit(0);

    run(STATUS);

    const data = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
    const current = String(data.fingerprint || '');
    const published = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : '';
    if (!current || current === published) process.exit(0);

    // Already asked about this exact state and it was not published. The
    // operator declined, or the publish failed. Either way, do not ask again
    // until the board actually moves.
    const asked = existsSync(ASKED) ? readFileSync(ASKED, 'utf8').trim() : '';
    if (current === asked) process.exit(0);

    run(DASHBOARD);
    writeFileSync(ASKED, `${current}\n`);

    const counts = data.counts || {};
    const inFlight = (data.inProgress || []).map((i) => i.id);
    // `counts.gated` — the number the board's stat tile prints (`F4.86`).
    //
    // This was a fourth re-derivation of "held", added to match the renderer
    // when `34c6636` corrected the dashboard's console line. It matched the
    // renderer while the renderer was wrong, so this line reported 16 held
    // against a board that showed 15. Its stated reason was false as well:
    // `counts.gated` does exclude done and dropped rows, so that was never
    // what set the two numbers apart — `dependencyClear` was.
    const held = counts.gated ?? 0;
    const warnings = data.warnings || [];

    const lines = [
      'The backlog board moved and the published artifact is now behind it.',
      `  fingerprint ${published || '(never published)'} -> ${current}`,
      `  ${counts.done ?? 0} done · ${inFlight.length} in flight${inFlight.length ? ` (${inFlight.join(', ')})` : ''}` +
        ` · ${counts.ready ?? 0} ready · ${held} held`,
      '',
      'Both files are regenerated already. Two steps remain, in this order:',
      `  1. Publish ${ARTIFACT_FILE} with the Artifact tool, passing`,
      `     url: ${ARTIFACT_URL}`,
      `     favicon: ${FAVICON}`,
      `     Publishing without that url creates a second, competing artifact.`,
      `  2. Run: node docs/scripts/backlog-dashboard.mjs --mark-published`,
      '     Without step 2 the board stays marked unpublished.',
      '',
      'This is asked once for this board state. If you decline, it stays quiet',
      'until the backlog moves again.',
    ];
    if (warnings.length) {
      lines.push('', 'The status pass also raised:', ...warnings.map((w) => `  - ${w}`));
    }

    process.stderr.write(`${lines.join('\n')}\n`);
    process.exit(2);
  } catch {
    process.exit(0);
  }
})();
