#!/usr/bin/env node
// Parse docs/BACKLOG.md §2 into machine-readable status for the live dashboard.
//
// Output: docs/status/backlog-status.json
//
// Three rules this parser exists to hold, all of them learned from the board:
//
//  1. §2 ONLY. §1/§1b are narrative — statuses there are wrapped in
//     strikethrough and bold (`~~**F4.4** ⭐~~ ✅`) and go stale. §3 and §5 are
//     tables with a DIFFERENT column shape; parsing them positionally puts
//     `P0` in the Status field. We bound to §2 and require the exact header.
//  2. Depends is matched on WHOLE TOKENS, never prefixes. BACKLOG.md §1b
//     records that a prefix match reports `E7.2` (which needs `F1.10`) as
//     unblocked by `F1.1`. Reproducing that bug ships a wrong "next" list.
//  3. Eligible != startable. A dependency-clear item can still be gated on an
//     ADR (AGENTS.md §6/§10) or on a client answer. A *numbered* ADR gate is
//     the one kind a column can express, and `Depends` does — `adrStatus()`
//     resolves it against `docs/adr/`, where Accepted means the ruling is made.
//     Every other gate — a bare `ADR` naming a record nobody has written yet,
//     an AGENTS.md §6 deferral, a client answer — is in no column, so it is
//     declared below with a source citation.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKLOG = join(repoRoot, "docs", "BACKLOG.md");
const ADR_DIR = join(repoRoot, "docs", "adr");
const OUT = join(repoRoot, "docs", "status", "backlog-status.json");

const EXPECTED_HEADER = ["ID", "Status", "Feature", "P", "Effort", "Wave", "Depends"];

const STATUS = {
  "⬜": { key: "pending", label: "Pending" },
  "🟡": { key: "planned", label: "ADR / planned" },
  "🔵": { key: "in_progress", label: "In progress" },
  "✅": { key: "done", label: "Done" },
  "⛔": { key: "dropped", label: "Dropped" },
};

// A `Depends` cell usually carries the target's status glyph — `F4.16 ✅`. The
// glyph is the board asserting something *about* the target; it is not part of
// the id, and `byId` is keyed by the bare id from the row's first cell. Left in
// place it makes a satisfied dependency read as unknown, which pins
// `readyToStart` false AND drops the reverse `unlocks` edge — `F4.16` listed
// nothing it unlocks until 2026-08-24 purely because `E7.1` spells it
// `F4.16 ✅`. Built from STATUS so the glyph vocabulary is declared once;
// U+FE0F is the variation selector an editor may append to an emoji, written
// as an escape rather than as itself so it is visible in a diff.
const DEP_GLYPH_RE = new RegExp(`(?:${Object.keys(STATUS).join("|")})\\uFE0F?`, "gu");

/** Strip status glyphs from one `Depends` entry, leaving the bare token. */
const stripDepGlyphs = (dep) => dep.replace(DEP_GLYPH_RE, "").replace(/\s+/g, " ").trim();

// Constraints on STARTING an item that no `Depends` cell can express.
// Every entry cites where in the repo the constraint is written down; if the
// citation stops being true, delete the entry rather than leaving it to rot.
// E5.1 carried a `kind: "client"` entry here from 2026-08-09 until 2026-09-02,
// when the owner lifted the client block (PR #277; ADR 0040 Accepted): v1 is
// authored from docs/e5.1-derived-taglist-v1.md and the client's answers land
// as template v2. Its citation stopped being true, so the entry is gone.
const GATES = [
  {
    ids: ["F1.2", "F1.3", "F1.4", "F1.5", "F1.6", "E5.4", "E6.1"],
    kind: "adr",
    reason:
      "F1.1 unblocked these on the board, but AGENTS.md §6 gates every further " +
      "protocol implementation behind its own scope ADR under §10. Needs a " +
      "scope decision before any code.",
    clientReason:
      "Held for a scope decision on which industrial protocols to implement, and on the libraries each one needs.",
    source: "BACKLOG.md §1b 'F1.1 landed and opened the adapter fan-out'",
  },
  // F3.8's §9.4 dependency gate was here until 2026-08-23. ADR 0041 answered
  // it — `nodemailer` into `apps/api` and a Mailpit Compose service, Accepted
  // by the owner the same day — so the citation above ("needs a §9.4
  // dependency ADR") stopped being true and the entry is deleted rather than
  // left to rot, per this list's own rule.
  {
    ids: ["E1.1"],
    kind: "adr",
    reason:
      "The only new infrastructure the SOW adds. ADR on the ML stack (runtime, " +
      "registry, serving path) comes first.",
    clientReason:
      "Held for a decision on the machine-learning stack — runtime, model registry and serving path.",
    source: "BACKLOG.md §1b slot 9 · §5 ADR queue",
  },
  // The E7.1 / F4.16 multi-tenancy gate was here until 2026-08-24. ADR 0043
  // answered it — Accepted the same day, F4.16 landed the RLS substrate and
  // shipped, and E7.1 split into E7.1a–E7.1d at the §10 gate with E7.1a's own
  // ADR 0045 already Accepted. So the citation above ("Requires an ADR before
  // it counts as pending at all") stopped being true, and the entry is deleted
  // rather than left to rot, per this list's own rule. It was not harmless
  // while it sat here: the dashboard's held section did not test
  // `dependencyClear` (`F4.86` fixed that, and deleted the `gatedItems` this
  // sentence used to name), so the
  // client-facing page carried "Held for a decision on the multi-tenancy model"
  // against E7.1 while E7.1a was in flight. E7.1's own row says "Do not
  // implement against this row" — that is a routing instruction to the four
  // child rows, not a decision the board is waiting on, so it is not a gate.
  //
  // Named individually in AGENTS.md §6's deferred list. Dependency-clear on the
  // board, and "do not implement them yet" in the rulebook — §10 promotion first.
  {
    ids: ["F3.3"],
    kind: "adr",
    reason:
      "AGENTS.md §6 defers MinIO / object storage and names F3.3 as ADR-required. " +
      "Deferred, not cancelled — but it needs a promotion ADR before any code.",
    clientReason:
      "Held for a decision on the object-storage service and its encryption boundary.",
    source: "AGENTS.md §6",
  },
  {
    ids: ["F4.24"],
    kind: "adr",
    reason:
      "Bundles three separately deferred things — the EMQX broker, a BullMQ job " +
      "queue and MinIO. AGENTS.md §6 defers all three; Redis must not become a " +
      "job queue until a later promotion.",
    clientReason:
      "Held for decisions on the message broker, job queue and object storage this bundles together.",
    source: "AGENTS.md §6",
  },
  {
    ids: ["F4.15"],
    kind: "adr",
    reason:
      "AGENTS.md §6 defers append-only audit storage and hash-chaining by name. " +
      "ADR 0021 also leaves open whether audit reads are themselves audited — " +
      "that must not be settled as a side effect of other work.",
    clientReason:
      "Held for a decision on tamper-evident audit storage, including whether audit reads are themselves audited.",
    source: "AGENTS.md §6 · ADR 0021",
  },
  {
    ids: ["F4.13"],
    kind: "adr",
    reason:
      "AGENTS.md §6 defers MFA / SSO / AD federation; Keycloak is limited to " +
      "local and pilot OIDC authentication.",
    clientReason:
      "Held for a decision on multi-factor authentication and identity federation.",
    source: "AGENTS.md §6",
  },
  {
    ids: ["F4.27"],
    kind: "adr",
    reason: "AGENTS.md §6 defers Kubernetes production manifests.",
    clientReason:
      "Held for a decision on the production Kubernetes deployment topology.",
    source: "AGENTS.md §6",
  },
  {
    ids: ["F3.19"],
    kind: "adr",
    reason: "AGENTS.md §6 defers the Three.js 3D control room (Phase 6).",
    clientReason:
      "Held for a decision on the 3D control-room phase.",
    source: "AGENTS.md §6",
  },
  {
    ids: ["F4.19"],
    kind: "adr",
    reason: "AGENTS.md §6 defers NERSA / ISO compliance reporting.",
    clientReason:
      "Held for a decision on the compliance-reporting track.",
    source: "AGENTS.md §6",
  },
  {
    ids: ["F3.29"],
    kind: "adr",
    // Not a Depends edge: F3.29 does not wait on another backlog item to ship,
    // it waits on the §5 IA decision. Its own row says so ("wave unset, gated
    // by the §5 Domain-first navigation IA decision it shares a surface with"),
    // and the §5 row names F3.29 back — but the board reads neither, so
    // without this entry F3.29 renders as ready to start.
    reason:
      "The §5 Domain-first navigation IA decision owns the same surface " +
      "(app-shell.tsx). Reordering the sidebar around utility domains departs " +
      "from AGENTS.md §5 'match the original screen's information architecture " +
      "first', so it is a §10 scope call, not an implementation pass.",
    clientReason:
      "Held for a decision on the navigation structure of the application shell.",
    source: "BACKLOG.md §5 — Domain-first navigation IA",
  },
];

// The chains BACKLOG.md §1 names as the critical path, converging on the
// Foundry demo. Declared here because §1 states them in prose, and §1's own
// status glyphs are narrative — the states below are read from §2 at runtime.
const CRITICAL_PATHS = [
  { label: "Water-treatment domain pack", chain: ["F2.1", "E1.7", "E5.1"] },
  { label: "Template instantiation → agent onboarding", chain: ["F2.1", "F2.2", "F3.22"] },
  { label: "ML foundation → anomaly & enrichment", chain: ["F4.1", "E1.1", "E1.3"] },
];

const warnings = [];
const warn = (m) => warnings.push(m);

/** GFM splits table rows on unescaped `|`, regardless of code spans. */
function splitRow(line) {
  const cells = [];
  let cur = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  // Leading and trailing pipes produce empty edge cells.
  if (cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

function stripMd(s) {
  return s
    .replace(/~~/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*/g, "")
    // Italic markers, opening and closing. Leaving the closing `*` behind turns
    // "*(critical path)*" into "(critical path)*".
    .replace(/(^|[\s(])\*(\S[^*]*?)\*(?=$|[\s.,;:)])/g, "$1$2")
    // Marker glyphs are rendered as their own affordance, not as title text.
    .replace(/[⭐🔒]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a Feature cell into a short headline and the rest of the record. */
function splitTitle(feature) {
  const flat = stripMd(feature);
  const cut = flat.search(/\s—\s|\.\s+[A-Z(]|:\s+[A-Z]/);
  let title = cut > 12 ? flat.slice(0, cut) : flat;
  if (title.length > 110) {
    const sp = title.lastIndexOf(" ", 110);
    title = `${title.slice(0, sp > 40 ? sp : 110)}…`;
  }
  return { title: title.replace(/[.,;:]$/, ""), detail: flat };
}

function parseBacklog(md) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+2\.\s/.test(l));
  const rest = lines.slice(start + 1).findIndex((l) => /^##\s+\d/.test(l));
  if (start < 0) throw new Error("§2 heading not found in BACKLOG.md");
  const end = rest < 0 ? lines.length : start + 1 + rest;

  const items = [];
  let track = null;
  let inTable = false;
  let rowCandidates = 0;

  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i];

    const heading = line.match(/^###\s+Track\s+([A-Z]+)\s+—\s+(.+)$/);
    if (heading) {
      track = { id: heading[1], name: stripMd(heading[2]) };
      inTable = false;
      continue;
    }
    if (/^###\s/.test(line)) {
      track = null;
      inTable = false;
      continue;
    }
    if (!line.trim().startsWith("|")) {
      inTable = false;
      continue;
    }

    const cells = splitRow(line);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

    // Header row: only tables with the exact §2 shape are parsed.
    if (cells.length === EXPECTED_HEADER.length && cells[0] === "ID" && cells[1] === "Status") {
      inTable = EXPECTED_HEADER.every((h, idx) => cells[idx] === h);
      if (!inTable) warn(`skipped table at line ${i + 1}: unexpected header ${cells.join(" | ")}`);
      continue;
    }

    if (!/^\s*[*~ ]*[FE]\d+\.\d+/.test(cells[0] ?? "")) continue;
    rowCandidates += 1;

    if (!inTable) {
      warn(`row at line ${i + 1} is outside a recognised §2 table — skipped`);
      continue;
    }
    if (cells.length > EXPECTED_HEADER.length) {
      // A Feature cell may contain an unescaped `|` inside a code span — e.g.
      // F4.35 quotes the assertion `|naive - raw| > 0.01`. GFM splits on it, so
      // the cell arrives shredded. The four trailing columns (P/Effort/Wave/
      // Depends) are short and never contain pipes, so the surplus belongs to
      // Feature: rejoin it and keep the row rather than dropping the item.
      warn(
        `row at line ${i + 1} had ${cells.length} cells — recovered by rejoining ` +
          `the Feature cell (unescaped '|' in its text)`,
      );
      cells.splice(2, cells.length - 6, cells.slice(2, -4).join("|"));
    }
    if (cells.length !== EXPECTED_HEADER.length) {
      warn(`row at line ${i + 1} has ${cells.length} cells, expected ${EXPECTED_HEADER.length} — skipped`);
      continue;
    }

    const id = stripMd(cells[0]);
    const glyph = Object.keys(STATUS).find((g) => cells[1].includes(g));
    if (!glyph) {
      warn(`row ${id} (line ${i + 1}) has no recognised status glyph in "${cells[1]}" — skipped`);
      continue;
    }

    const feature = cells[2];
    const { title, detail } = splitTitle(feature);
    const dependsRaw = stripMd(cells[6]);
    const depends =
      dependsRaw === "—" || dependsRaw === "" || dependsRaw === "-"
        ? []
        : dependsRaw
            .split(/[,·]/)
            // Strip here, not in `resolveEligibility`: the reverse `unlocks`
            // edges are built from `item.depends` in a second loop, and a strip
            // done only at the point of resolution would silently miss them.
            // `dependsRaw` keeps the cell verbatim for display.
            .map((d) => stripDepGlyphs(d))
            .filter(Boolean);

    items.push({
      id,
      track: track?.id ?? "?",
      trackName: track?.name ?? "Unknown",
      status: STATUS[glyph].key,
      statusLabel: STATUS[glyph].label,
      glyph,
      title,
      detail,
      enabler: feature.includes("⭐"),
      priority: stripMd(cells[3]),
      effort: stripMd(cells[4]),
      wave: stripMd(cells[5]),
      effortWeeks: parseEffort(stripMd(cells[4])),
      depends,
      dependsRaw,
      adrs: [...new Set((feature.match(/ADR\s+0?\d{3,4}/g) ?? []).map((a) => a.replace(/\s+/, " ")))],
      prs: [...new Set((feature.match(/(?:PR\s*)?#(\d+)/g) ?? []).map((p) => p.replace(/\D/g, "")))],
      line: i + 1,
    });
  }

  if (rowCandidates !== items.length) {
    warn(`${rowCandidates - items.length} of ${rowCandidates} candidate rows in §2 were not parsed`);
  }
  return items;
}

/**
 * `docs/adr/NNNN-*.md`, indexed by ADR number with the leading zeros dropped so
 * `ADR 43` and `ADR 0043` reach the same record. Built once, lazily.
 */
let adrIndex = null;
function adrFileFor(number) {
  if (adrIndex === null) {
    adrIndex = new Map();
    try {
      for (const name of readdirSync(ADR_DIR)) {
        const m = name.match(/^(\d{3,4})-.*\.md$/);
        if (m) adrIndex.set(String(Number(m[1])), join(ADR_DIR, name));
      }
    } catch (err) {
      warn(`could not read docs/adr/ — every ADR dependency stays unknown (${err.message})`);
    }
  }
  return adrIndex.get(String(Number(number))) ?? null;
}

/** First alphabetic word of a Status value, lower-cased. */
const statusWord = (s) => stripMd(s).match(/[A-Za-z]+/)?.[0].toLowerCase() ?? null;

/**
 * The declared status of one ADR, or `null` when it cannot be read.
 *
 * Two forms exist in `docs/adr/`: an inline `Status: accepted` (0001, 0002) and
 * a `## Status` heading whose first non-empty line carries the word, usually
 * bolded and followed by a date and prose ("**Accepted** — 2026-08-24, by the
 * repository owner"). Both patterns are anchored to the start of a line —
 * unanchored, they match "status line" in ADR 0043's prose and "statuses" in
 * ADR 0021's, and would read a decision out of a sentence.
 *
 * A number with no file, or a file with no readable Status, returns `null` and
 * warns. The caller keeps those unknown: unresolvable is never ready.
 */
const adrStatusCache = new Map();
function adrStatus(number) {
  const key = String(Number(number));
  if (adrStatusCache.has(key)) return adrStatusCache.get(key);

  let status = null;
  const file = adrFileFor(number);
  if (!file) {
    warn(`a Depends cell names ADR ${number}, which docs/adr/ does not have — kept unknown`);
  } else {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const inline = lines[i].match(/^\s*(?:\*\*)?Status(?:\*\*)?\s*:\s*(\S.*)$/i);
      if (inline) {
        status = statusWord(inline[1]);
        break;
      }
      if (/^#{1,6}\s*(?:\*\*)?Status(?:\*\*)?\s*$/i.test(lines[i].trim())) {
        const next = lines.slice(i + 1).find((l) => l.trim() !== "");
        status = next ? statusWord(next) : null;
        break;
      }
    }
    if (!status) warn(`ADR ${number} has no readable Status line — kept unknown`);
  }

  adrStatusCache.set(key, status);
  return status;
}

/** Whole-token dependency resolution. Never a prefix match — see rule 2. */
function resolveEligibility(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const gateFor = (id) => {
    const g = GATES.find((entry) => entry.ids.includes(id));
    return g
      ? { kind: g.kind, reason: g.reason, clientReason: g.clientReason ?? g.reason, source: g.source }
      : null;
  };

  for (const item of items) {
    const unmet = [];
    const unknown = [];
    for (const dep of item.depends) {
      // `F1.x` style wildcards are deliberate prose in the board, not an id.
      if (/^[FE]\d+\.x$/i.test(dep)) {
        unknown.push(dep);
        continue;
      }
      // A numbered ADR gate is a real, checkable dependency: the record states
      // its own status, and Accepted means the ruling has been made. A bare
      // `ADR` with no number is not checkable — it names a decision nobody has
      // written down yet — so it falls through to `byId` and stays unknown.
      const adr = dep.match(/^ADR\s+0*(\d{1,4})$/i);
      if (adr) {
        const status = adrStatus(adr[1]);
        if (status === "accepted") continue;
        (status === null ? unknown : unmet).push(dep);
        continue;
      }
      const target = byId.get(dep);
      if (!target) {
        unknown.push(dep);
        continue;
      }
      if (target.status !== "done") unmet.push(dep);
    }
    item.unmetDepends = unmet;
    item.unknownDepends = unknown;
    item.gate = gateFor(item.id);
    item.dependencyClear = unmet.length === 0 && unknown.length === 0;
    // `planned` (🟡) is deliberately excluded: it means an ADR is in flight or
    // the item shipped only in part, which is not the same as "pick this up".
    item.readyToStart = item.dependencyClear && !item.gate && item.status === "pending";
    // THE one definition of "held" (`F4.86`). Every consumer reads this flag —
    // the `gated` set below, the dashboard's `stateOf`, its "Eligible, but
    // held" section, and the republish hook — because four separate
    // re-derivations of this same idea is what put E1.1 in two sections at
    // once and made the page's own numbers disagree with each other.
    //
    // `dependencyClear` is part of the definition, not an extra filter on top
    // of it. The board's footer says held means held on a DECISION, not on
    // engineering capacity, and the held section's own prose promises "the
    // engineering they depend on is finished". An item waiting on both is
    // waiting on engineering too, so it belongs in `blocked` — the ruling
    // `34c6636` already made for the console line and left unapplied here.
    item.held =
      item.dependencyClear &&
      Boolean(item.gate) &&
      item.status !== "done" &&
      item.status !== "dropped";
    item.unlocks = [];
  }

  for (const item of items) {
    for (const dep of item.depends) {
      byId.get(dep)?.unlocks.push(item.id);
    }
  }
  return items;
}

/**
 * Effort cells are planning-grade prose: "3–4", "10+", "incl.", "infra", "—".
 * Only the numeric ones are sized; everything else stays null so the charts can
 * say how much of the board is unsized rather than quietly scoring it zero.
 */
function parseEffort(raw) {
  const m = String(raw).match(/^(\d+)(?:\s*[–-]\s*(\d+))?\s*(\+)?$/);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] ? Number(m[2]) : min;
  return { min, max, mid: (min + max) / 2 };
}

// Every timestamp this repo's dashboard shows is India Standard Time — the
// delivery team and the client are both there, so UTC would be a translation
// step for every reader. `TZ` makes git's `--date=*-local` formats agree.
const TZ = "Asia/Kolkata";

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TZ },
    }).trim();
  } catch {
    return "";
  }
};

const istFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// The trailing `[a-z]?` is load-bearing, added 2026-08-24 when `E7.1` split into
// `E7.1a`–`E7.1d` at the ADR 0045 gate. Without it this pattern matched neither
// the child ids in a `Depends` cell nor a `feat/E7.1a-...` branch name — and it
// failed by matching *nothing* rather than by matching the parent, because the
// `\b` after `\d+` cannot fall between `1` and `a`. That is the silent shape
// §2's `E7.2` note already warns about: a whole-token miss reads as "no branch
// in flight", not as an error. Keep the suffix optional and keep it inside the
// capture group.
const ID_RE = /\b([FE]\d+\.\d+[a-z]?)\b/g;
// `byId` is keyed by the literal id in the row's first cell, and `note()`
// returns early on a miss — so a case mismatch here disappears silently rather
// than warning. Uppercase the track letter as before, then put a split-suffix
// back to lower case so `feat/E7.1a-...` resolves to the `E7.1a` row instead of
// looking up a non-existent `E7.1A`. Ids without a suffix are unaffected.
const normalizeId = (raw) => raw.toUpperCase().replace(/([A-Z])$/, (c) => c.toLowerCase());
const idsIn = (s) => [...new Set([...(s ?? "").matchAll(ID_RE)].map((m) => normalizeId(m[1])))];

/**
 * "In progress" is DERIVED, not a board status — no row is 🔵. The signal is
 * the checked-out branch plus branches not yet merged into origin/main, minus
 * the ones origin/main has already superseded by a squash merge (see below).
 */
function gitContext(items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const dirty = git("status", "--porcelain")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim());

  const branchIds = (name) => idsIn(name.replace(/[-_/]/g, " ").replace(/\bf(\d)\s(\d+)/gi, "F$1.$2"));

  // `--no-merged` is the cheap first filter, and on its own it is WRONG for a
  // squash merge: the merge replaces the branch's commits with one new commit,
  // so the branch never becomes an ancestor of origin/main and stays "unmerged"
  // forever. That is how the board reported F2.3 and F2.4 as in flight on
  // 2026-08-21, hours after both had shipped in PR #113 and PR #116.
  //
  // Comparing content cannot repair it. `git merge-tree`, `git cherry` and
  // patch-id all report a conflict or a miss as soon as main edits the same
  // files again — which it had, so every one of them failed on that live case.
  //
  // The signal that does survive is the delivery commit on origin/main. It
  // names the id in its SUBJECT — never search the body, because
  // `git log --grep` reads the whole message and returns commits for unrelated
  // items — it is not a docs/chore commit, and it is NEWER than the branch tip,
  // because the merge created it after the last commit the branch received.
  // Work that is still genuinely in flight fails that last test, which is what
  // keeps a real branch on the board.
  const NON_DELIVERY = /^(docs|chore|test|ci|build|style)\b/i;

  // The same classification, applied to BRANCHES — and it has to be, or the two
  // halves of this function disagree with each other.
  //
  // `NON_DELIVERY` declares a `docs(...)` or `chore(...)` subject not to be a
  // delivery. Nothing said the same about a `docs/...` branch, so on 2026-08-30
  // the board reported `F3.35` as in flight hours after its ADR merged, and it
  // could never have cleared: `docs/F3.35-adr-0048` squash-merged, so
  // `--no-merged` keeps it forever, and the supersede test below looks for a
  // delivery commit naming the id — which `NON_DELIVERY` had already excluded,
  // because that delivery was `docs(adr): … (#218)`. No delivery, no supersede,
  // permanent false positive.
  //
  // It is structural rather than a one-off: an ADR-gated row is *created* by a
  // `docs(...)` PR, so every row born the way `F3.35` and `F3.36` were would
  // have joined the count and stayed there.
  //
  // **Prefix, not content, and that is forced.** The branch's own commit
  // subjects appear as `* ` bullets inside a squash body only for a
  // MULTI-commit PR; GitHub writes the body directly for a single commit —
  // measured on `5a41704` (one commit, no bullet) against `2a79a42` (twenty,
  // bulleted). So "are this branch's commits in that squash?" is not a question
  // git can answer here, and the branch's own name is the signal that is left.
  //
  // **The loss is real and small.** While an ADR is genuinely being drafted on
  // a `docs/` branch, this reports nothing in flight for that row. The board
  // already says it the other way: 🟡 `planned` means an ADR is in flight,
  // which is what the status filter above documents.
  //
  // The CHECKED-OUT branch stays exempt — see the note below it. Having a
  // branch checked out is a deliberate statement about what is being worked on,
  // and that reasoning does not change with its prefix.
  const RECORD_BRANCH = /^(?:origin\/)?(?:docs|chore|test|ci|build|style)\//i;
  const deliveries = new Map();
  for (const line of git("log", "origin/main", "--pretty=%ct%x1f%s").split("\n").filter(Boolean)) {
    const [ct, subject] = line.split("\x1f");
    if (NON_DELIVERY.test(subject)) continue;
    // A bare subject carrying a PR number counts too — the repo's older
    // deliveries predate the `feat:` convention (`F2.2 — instantiate … (#7)`).
    if (!/^feat\b/i.test(subject) && !/\(#\d+\)\s*$/.test(subject)) continue;
    for (const id of idsIn(subject)) {
      if (!byId.has(id)) continue;
      if (!deliveries.has(id)) deliveries.set(id, Number(ct)); // log is newest-first
    }
  }

  // `git branch -a` lists a local branch and its origin/ copy as two entries.
  // Both carry the same id, so without this the same work is counted twice.
  const seenBranch = new Set();
  const unmerged = git("branch", "-a", "--no-merged", "origin/main", "--format=%(refname:short)")
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean)
    .filter((b) => !/^origin\/HEAD/.test(b))
    .filter((b) => {
      const key = b.replace(/^origin\//, "");
      if (seenBranch.has(key)) return false;
      seenBranch.add(key);
      return true;
    });

  const active = new Map();
  const note = (id, source, current) => {
    if (!byId.has(id)) return;
    const entry = active.get(id) ?? { id, sources: [], current: false };
    entry.sources.push(source);
    entry.current = entry.current || current;
    active.set(id, entry);
  };

  // The checked-out branch is exempt from the supersede test on purpose: having
  // it checked out is a deliberate statement about what is being worked on, and
  // the existing filter below already keeps a `current` entry when the row is
  // done.
  for (const id of branchIds(branch)) note(id, `branch ${branch}`, true);

  const superseded = new Map();
  for (const b of unmerged) {
    // A record branch is not implementation work. Skipped before the supersede
    // test rather than inside it, because a squash-merged record branch has no
    // delivery commit to be superseded BY — see `RECORD_BRANCH` above.
    if (RECORD_BRANCH.test(b)) continue;
    const tip = Number(git("log", "-1", "--pretty=%ct", b) || 0);
    for (const id of branchIds(b)) {
      const delivered = deliveries.get(id);
      if (delivered && tip && delivered > tip) {
        superseded.set(id, b);
        continue;
      }
      note(id, `branch ${b}`, false);
    }
  }

  // A superseded branch whose row is still open is neither in flight nor
  // nothing: it is merged work the board has not recorded. Say so, rather than
  // drop it silently — that gap is what made the stale board look plausible.
  for (const [id, b] of superseded) {
    const it = byId.get(id);
    if (it.status === "done" || it.status === "dropped") continue;
    warn(
      `${id}: origin/main already carries a delivery commit for it, but the board row reads ` +
        `"${it.statusLabel}". Branch ${b} is stale, not in flight — flip the row or delete the branch.`,
    );
  }

  const log = git("log", "-40", "--date=format-local:%Y-%m-%d %H:%M", "--pretty=%h%x1f%ad%x1f%s")
    .split("\n")
    .filter(Boolean);
  const activity = log.map((l) => {
    const [sha, date, subject] = l.split("\x1f");
    return { sha, date, subject, ids: idsIn(subject).filter((id) => byId.has(id)) };
  });

  // Delivery dates are not on the board — derive them from the commit that
  // closed each item. Prefer an explicit close/land commit; fall back to the
  // most recent commit naming the id at all.
  const full = git("log", "--all", "--date=short", "--pretty=%ad%x1f%s").split("\n").filter(Boolean);
  const closes = new Map();
  for (const line of full) {
    const [date, subject] = line.split("\x1f");
    const explicit = /\b(close|closed|closes|done|landed|lands)\b/i.test(subject);
    for (const id of idsIn(subject)) {
      if (!byId.has(id)) continue;
      const prev = closes.get(id);
      // `full` is newest-first, so the first hit of each kind is the latest one.
      if (!prev || (explicit && !prev.explicit)) closes.set(id, { date, explicit });
    }
  }
  for (const it of items) {
    it.deliveredOn = it.status === "done" ? (closes.get(it.id)?.date ?? null) : null;
  }

  const inProgress = [...active.values()]
    .map((e) => {
      const item = byId.get(e.id);
      return {
        ...e,
        sources: [...new Set(e.sources)],
        title: item.title,
        track: item.track,
        priority: item.priority,
        boardStatus: item.statusLabel,
        lastCommit: activity.find((c) => c.ids.includes(e.id)) ?? null,
      };
    })
    .filter((e) => byId.get(e.id).status !== "done" || e.current)
    .sort((a, b) => Number(b.current) - Number(a.current));

  return {
    branch,
    head: git("rev-parse", "--short", "HEAD"),
    headSubject: git("log", "-1", "--pretty=%s"),
    headDate: git("log", "-1", "--date=format-local:%d %b %Y, %H:%M", "--pretty=%ad"),
    dirty,
    backlogLastCommit: {
      sha: git("log", "-1", "--pretty=%h", "--", "docs/BACKLOG.md"),
      date: git("log", "-1", "--date=format-local:%d %b %Y, %H:%M", "--pretty=%ad", "--", "docs/BACKLOG.md"),
      subject: git("log", "-1", "--pretty=%s", "--", "docs/BACKLOG.md"),
    },
    inProgress,
    activity: activity.slice(0, 25),
  };
}

const md = readFileSync(BACKLOG, "utf8");
const items = resolveEligibility(parseBacklog(md));
const repo = gitContext(items);

const countBy = (key) =>
  items.reduce((acc, it) => ((acc[it[key]] = (acc[it[key]] ?? 0) + 1), acc), {});

const ready = items.filter((it) => it.readyToStart);
const gated = items.filter((it) => it.held);
const blocked = items.filter(
  (it) => !it.dependencyClear && it.status !== "done" && it.status !== "dropped",
);

// `F4.86`. These three sets are rendered as three separate answers to "why can
// this not start", so an item in two of them is reported twice and the totals
// stop adding up. The overlap that motivated this was `gated` x `blocked`, but
// the check is written over all three pairs rather than that one: the defect
// class is a predicate drifting until two sets intersect, and naming only the
// pair that already bit us would not catch the next one.
//
// A hard exit, not a warning. `warnings` is rendered ON the board, which is the
// wrong place for "the board is wrong" — and the leak-check CI job runs this
// script, so a non-zero exit here is a gate under AGENTS.md §4.6.
//
// Like its sibling in `backlog-dashboard.mjs`, this is data-dependent: it can
// only fire while some item sits in two sets at once. Restore the old inclusive
// predicate on a board where nothing is gated AND dependency-blocked and it
// passes. That is the state in which the defect is also invisible.
for (const [aName, a, bName, b] of [
  ["ready", ready, "gated", gated],
  ["ready", ready, "blocked", blocked],
  ["gated", gated, "blocked", blocked],
]) {
  const bIds = new Set(b.map((it) => it.id));
  const both = a.filter((it) => bIds.has(it.id)).map((it) => it.id);
  if (both.length > 0) {
    console.error(
      `backlog-status: ${both.length} item(s) counted as both ${aName} and ${bName}: ${both.join(", ")}.\n` +
        `  These sets must not intersect — see the \`item.held\` docblock.`,
    );
    process.exit(1);
  }
}

// Disjointness is only half the invariant, and the weaker half. It is satisfied
// VACUOUSLY by an under-populated `gated`: narrow `item.held` in any way — the
// plausible refactor is `item.readyToStart && ...`, misreading that flag as
// "eligible" — and `gated` empties board-wide. Every consumer then agrees on
// zero, the three sets trivially do not intersect, both gates pass, and 15
// items silently become "Waiting" with the held section rendering nothing.
//
// So also check COVERAGE. An item with an open gate has exactly two honest
// homes: `gated` if its dependencies are finished, `blocked` if they are not.
// `stray` is the set that reaches neither, which is empty on a correct board
// and non-empty for every narrowing of `held`.
const stray = items.filter(
  (it) =>
    it.gate &&
    it.status !== "done" &&
    it.status !== "dropped" &&
    it.dependencyClear &&
    !it.held,
);
if (stray.length > 0) {
  console.error(
    `backlog-status: ${stray.length} gated item(s) counted in neither gated nor blocked: ` +
      `${stray.map((it) => it.id).join(", ")}.\n` +
      `  \`item.held\` has been narrowed and the board now hides them.`,
  );
  process.exit(1);
}

const P_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const byPriority = (a, b) =>
  (P_ORDER[a.priority] ?? 9) - (P_ORDER[b.priority] ?? 9) ||
  (Number(a.wave) || 9) - (Number(b.wave) || 9) ||
  a.id.localeCompare(b.id);

const tracks = [...new Map(items.map((it) => [it.track, it.trackName])).entries()]
  .map(([id, name]) => {
    const rows = items.filter((it) => it.track === id);
    return {
      id,
      name,
      total: rows.length,
      done: rows.filter((r) => r.status === "done").length,
      ready: rows.filter((r) => r.readyToStart).length,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const now = new Date();
const payload = {
  generatedAt: now.toISOString(),
  generatedAtIST: `${istFormat.format(now).replace(",", ",")} IST`,
  timezone: TZ,
  source: { file: "docs/BACKLOG.md", ...repo.backlogLastCommit },
  repo: {
    branch: repo.branch,
    head: repo.head,
    headSubject: repo.headSubject,
    headDate: repo.headDate,
    dirty: repo.dirty,
  },
  counts: {
    total: items.length,
    ...countBy("status"),
    ready: ready.length,
    gated: gated.length,
    blocked: blocked.length,
  },
  tracks,
  criticalPaths: CRITICAL_PATHS.map((p) => ({
    label: p.label,
    chain: p.chain.map((id) => {
      const it = items.find((x) => x.id === id);
      return {
        id,
        title: it?.title ?? id,
        status: it?.status ?? "unknown",
        gate: it?.gate ?? null,
        readyToStart: it?.readyToStart ?? false,
        // `F4.86`. The chain node is a PROJECTION, so the dashboard's
        // critical-path panel cannot reach `items` and has to be handed the
        // flag. Without it that panel was the fifth re-derivation of heldness —
        // it read `n.gate` and painted E1.1 "hold" while every other panel on
        // the same page said "Waiting". Neither new gate could see it, because
        // both walk `data.items`, not this array.
        held: it?.held ?? false,
      };
    }),
  })),
  inProgress: repo.inProgress,
  ready: ready.sort(byPriority).map((it) => it.id),
  gated: gated.sort(byPriority).map((it) => it.id),
  items,
  activity: repo.activity,
  warnings,
};

// Fingerprint of the BOARD, and nothing else.
//
// It was briefly a hash of the whole payload minus the timestamps, which meant
// the recent-commit log and the checked-out branch were inside it: every commit
// anywhere triggered a republish, even when not one item had moved. On an
// hourly loop that is noise dressed as news.
//
// So it covers exactly what a reader is here for — which items exist, what
// state each is in, what each is waiting on, and the totals — projected field
// by field rather than by subtraction, so adding a field to the payload cannot
// silently widen it again.
payload.fingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      counts: payload.counts,
      inFlight: payload.inProgress.map((p) => p.id).sort(),
      tracks: payload.tracks,
      items: items
        .map((it) => [
          it.id,
          it.status,
          it.priority,
          it.wave,
          it.title,
          it.dependsRaw,
          it.readyToStart,
          // `F4.86`. `held` earns a slot because it moves a card between two
          // rendered sections on its own, and nothing else in this TUPLE moves
          // with it: a gated item that becomes dependency-clear leaves
          // "Waiting" and joins "Eligible, but held" while `readyToStart` stays
          // false throughout, because a gated item is never ready.
          //
          // That is narrower than "the board could move unnoticed", and the
          // difference is worth keeping straight. `counts` is hashed alongside
          // these tuples and carries `gated` and `blocked`, so the ordinary
          // single flip already moves the fingerprint through the totals — and
          // the usual CAUSE of the flip is an upstream item reaching `done`,
          // whose `status` is projected here too. What this slot adds is the
          // compensating case: one item enters held as another leaves, the
          // totals do not move, and without this field nothing else would.
          //
          // Adding the slot costs exactly one spurious `CHANGED` prompt, the
          // first run after it lands. Worth naming, because "no news, no churn"
          // is this hash's whole purpose.
          it.held,
          it.gate?.kind ?? null,
          it.deliveredOn,
        ])
        .sort((a, b) => a[0].localeCompare(b[0])),
    }),
  )
  .digest("hex")
  .slice(0, 16);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

const c = payload.counts;
console.log(
  `backlog-status: ${c.total} items — ${c.done ?? 0} done, ${c.pending ?? 0} pending, ` +
    `${c.planned ?? 0} planned · ${c.ready} ready, ${c.gated} gated, ${c.blocked} blocked`,
);
console.log(`in progress (derived from git): ${repo.inProgress.map((i) => i.id).join(", ") || "none"}`);
if (warnings.length) console.warn(`warnings:\n  ${warnings.join("\n  ")}`);
console.log(`wrote ${OUT}`);
