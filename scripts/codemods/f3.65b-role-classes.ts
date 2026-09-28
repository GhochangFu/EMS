import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { CLASS_OVERRIDES, roleFor, SHADE_ROLES } from "../../tests/support/colour-role-map";
import { classStrings, paletteClassMatches, webColourSourceFiles } from "../../tests/support/colour-scan";
import { channelsToHex, deltaE2000, parseTokenBlocks, resolveTailwindShade } from "../../tests/support/colour-tokens";
import { blankComments } from "../../tests/support/pending-button-scan";
import { repoRoot } from "../../tests/support/source-scan";

/*
 * `F3.65b` — the one-shot codemod that moves `apps/web/src` from stock-palette and `bms-*` colour
 * classes to the role classes of `apps/web/src/index.css` (ADR 0078, plan
 * `docs/plans/f3.65b-pages-on-roles.md` §3 D1–D4). **One-shot: committed so the review can re-run
 * it, deleted by `F3.65c`.** Not CI-wired — `tests/f3.65-colour-roles-gate.test.ts` holds the
 * result; `tests/f3.65b-role-codemod.test.ts` holds the rules.
 *
 *   npx tsx scripts/codemods/f3.65b-role-classes.ts --dir <dir>[,<dir>…] [--write]
 *
 * `<dir>` is relative to `apps/web/src` and is **not recursive**: `--dir components` is the files
 * directly in `components/`, so the plan's groups (`components` top level, `components/control-room`
 * without `smoc`) are expressible. Without `--write` it is a dry run that prints the same log.
 *
 * The mapping is `roleFor` / `SHADE_ROLES` / `CLASS_OVERRIDES` (`tests/support/colour-role-map.ts`)
 * and the matches are `paletteClassMatches` (`tests/support/colour-scan.ts`), so the codemod and the
 * gates share one source of truth. On top of the table (D2):
 *  - `text-white` → `on-accent` iff its own class string holds an opaque `bg-bms-green`,
 *    `bg-bms-green-dark`, `bg-accent` or `bg-accent-strong` (any variant, no `/NN`); else `on-dark`,
 *    printed for review;
 *  - a `bms-green` class under a `focus:` / `focus-visible:` variant → `focus`;
 *  - a `SHADE_ROLES` row with `compareOver` → `<utility>-<role>/<alpha × 100>`;
 *  - a `HAND` entry wins over every rule, and fails the run if neither its `from` nor its `to` is on
 *    its line (`to` present means a re-run over an already-rewritten file).
 *
 * After each file it checks (D3): the whitespace/quote token stream keeps its length and changes
 * only at rewritten tokens; every exact rewrite keeps its light value; every emitted role is in
 * `index.css`'s light block; a second pass is a no-op; no palette class is left. A failed check
 * throws naming the file, and the CLI then writes nothing and exits 1.
 */

const WEB_SRC = join(repoRoot, "apps/web/src");

/** A site-level rewrite (D4). `file` is relative to `apps/web/src`; `from`/`to` are whole classes, variant stripped. */
export type HandEntry = { file: string; line: number; from: string; to: string };

/** One rewritten class. `from`/`to` carry the variant prefix. `deltaE` is set on a merged rewrite. */
export type Rewrite = {
  file: string;
  line: number;
  from: string;
  to: string;
  rule: "table" | "on-accent" | "on-dark" | "focus" | "alpha" | "hand";
  kind: "exact" | "merged";
  deltaE?: number;
};

/** D4, with the owner's rulings of 2026-09-28 applied (OQ3, OQ4). */
export const HAND: HandEntry[] = [
  { file: "components/system-status-indicator.tsx", line: 49, from: "bg-white/40", to: "bg-on-dark/40" },
  { file: "components/rules-panel.tsx", line: 407, from: "bg-white", to: "bg-on-dark" },
  { file: "components/admin/asset-templates-page-tab-strip.tsx", line: 65, from: "text-white/80", to: "text-on-accent/80" },
  { file: "pages/crac-page.tsx", line: 96, from: "bg-gray-200", to: "bg-well-deep" },
  { file: "pages/sld-page.tsx", line: 92, from: "bg-gray-200", to: "bg-well-deep" },
  { file: "components/report-schedules.tsx", line: 513, from: "bg-bms-ink", to: "bg-chrome" },
  { file: "components/reports-panel.tsx", line: 395, from: "bg-bms-ink", to: "bg-chrome" },
  { file: "components/control-room/scoped-action-link.tsx", line: 17, from: "text-gray-500", to: "text-neutral-ink" },
  { file: "components/rules-panel.tsx", line: 72, from: "text-gray-500", to: "text-neutral-ink" },
];

/** A class, variant stripped: its colour utility, its shade or role, and its `/NN` or `/[…]` opacity. */
const CLASS_PARTS =
  /^(bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|divide|outline|fill|stroke|from|via|to|shadow|accent|caret|decoration|placeholder)-(.+?)(\/(?:\d{1,3}|\[[^\]]*\]))?$/;

const OPAQUE_ACCENT_FILL = /^(?:\S*:)?!?bg-(?:bms-green(?:-dark)?|accent(?:-strong)?)$/;

function parts(className: string): { utility: string; shade: string; opacity: string } {
  const m = CLASS_PARTS.exec(className);
  if (!m) throw new Error(`cannot parse "${className}" as a colour utility`);
  return { utility: m[1], shade: m[2], opacity: m[3] ?? "" };
}

let lightTokens: Map<string, [number, number, number]> | null = null;

function light(): Map<string, [number, number, number]> {
  lightTokens ??= parseTokenBlocks(readFileSync(join(WEB_SRC, "index.css"), "utf8")).light;
  return lightTokens;
}

function lightHex(role: string): string | undefined {
  const channels = light().get(role);
  return channels ? channelsToHex(channels).toUpperCase() : undefined;
}

function isSpecOrTest(file: string): boolean {
  return /\.(spec|test)\.[^./]+$/.test(file) || /(^|\/)test-setup\.ts$/.test(file);
}

type Planned = Rewrite & { index: number; length: number; replacement: string; shade: string; role: string };

/** The rewrites for `src`, unapplied and unchecked. */
function plan(src: string, file: string, hand: HandEntry[]): Planned[] {
  const text = blankComments(src);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (index: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const lineText = (line: number): string => text.slice(lineStarts[line - 1], lineStarts[line] ?? text.length);
  const strings = classStrings(text);
  const matches = paletteClassMatches(src).map((m) => ({ ...m, line: lineOf(m.index) }));

  const handFor = new Map<string, HandEntry>();
  for (const h of hand.filter((e) => e.file === file)) {
    const here = matches.filter((m) => m.line === h.line && m.className === h.from);
    if (here.length > 1) throw new Error(`${file}:${h.line} HAND entry "${h.from}" is ambiguous: ${here.length} uses on the line`);
    if (here.length === 1) handFor.set(`${here[0].index}`, h);
    else if (!lineText(h.line).split(/[\s"'`{}]+/).some((t) => t.endsWith(h.to) && (t === h.to || t.endsWith(`:${h.to}`)))) {
      throw new Error(`${file}:${h.line} HAND entry expects "${h.from}" on this line and it is not there`);
    }
  }

  return matches.map(({ index, className, line }) => {
    let v = index;
    while (v > 0 && /[^\s"'`{}]/.test(text[v - 1])) v--;
    const variant = text.slice(v, index);
    const { utility, shade, opacity } = parts(className);
    const base = { file, line, index, length: className.length, shade, from: `${variant}${className}` };
    const done = (replacement: string, rule: Rewrite["rule"], kind: Rewrite["kind"], deltaE?: number): Planned => ({
      ...base,
      replacement,
      role: parts(replacement).shade,
      to: `${variant}${replacement}`,
      rule,
      kind,
      ...(deltaE === undefined ? {} : { deltaE }),
    });

    const h = handFor.get(`${index}`);
    if (h) return done(h.to, "hand", "exact");

    let resolved: { role: string; kind: "exact" | "merged" };
    try {
      resolved = roleFor(className);
    } catch (err) {
      throw new Error(`${file}:${line} ${(err as Error).message}`);
    }
    const stripped = `${utility}-${shade}`;
    const override = CLASS_OVERRIDES[stripped];
    const row = override ? undefined : SHADE_ROLES.find((r) => r.shade === shade);

    if (stripped === "text-white") {
      const own = strings
        .filter((s) => s.start <= index && index + className.length <= s.start + s.body.length)
        .filter((s) => s.body.slice(index - s.start, index - s.start + className.length) === className)
        .sort((a, b) => a.body.length - b.body.length)[0];
      const onAccent = own ? own.body.split(/\s+/).some((t) => OPAQUE_ACCENT_FILL.test(t)) : false;
      return onAccent
        ? done(`${utility}-on-accent${opacity}`, "on-accent", "exact")
        : done(`${utility}-on-dark${opacity}`, "on-dark", "exact");
    }
    if (shade === "bms-green" && variant.split(":").some((p) => p === "focus" || p === "focus-visible")) {
      return done(`${utility}-focus${opacity}`, "focus", "exact");
    }
    if (row?.compareOver) {
      if (opacity) throw new Error(`${file}:${line} "${className}" already carries an opacity; its row targets /${row.compareOver.alpha * 100}`);
      return done(`${utility}-${row.role}/${Math.round(row.compareOver.alpha * 100)}`, "alpha", "merged", row.deltaE);
    }
    const deltaE = resolved.kind === "merged" ? (override?.deltaE ?? row?.deltaE) : undefined;
    return done(`${utility}-${resolved.role}${opacity}`, "table", resolved.kind, deltaE);
  });
}

function apply(src: string, planned: Planned[]): string {
  let out = src;
  for (const p of [...planned].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, p.index) + p.replacement + out.slice(p.index + p.length);
  }
  return out;
}

/**
 * D3's token-stream invariant: split `before` and `after` on whitespace and quotes; the two streams
 * must have the same length and differ only at tokens of `before` that hold one of `offsets` (the
 * start of each logged rewrite). Returns one line per violation.
 */
export function tokenStreamViolations(before: string, after: string, offsets: number[]): string[] {
  const a = [...before.matchAll(/[^\s"'`]+/g)];
  const b = [...after.matchAll(/[^\s"'`]+/g)].map((m) => m[0]);
  if (a.length !== b.length) return [`token count changed: ${a.length} -> ${b.length}`];
  const out: string[] = [];
  a.forEach((m, i) => {
    const logged = offsets.some((o) => m.index <= o && o < m.index + m[0].length);
    if (!logged && m[0] !== b[i]) out.push(`token ${i} "${m[0]}" -> "${b[i]}" is not a logged rewrite`);
  });
  return out;
}

/**
 * Rewrite every palette class in `src` (`file` relative to `apps/web/src`), then run D3's checks.
 * Throws on a spec or test path, an unmapped class, a HAND entry that does not fit its line, or a
 * failed check — each naming the file.
 */
export function rewriteSource(
  src: string,
  opts: { file: string; hand: HandEntry[] },
): { out: string; rewrites: Rewrite[]; review: Rewrite[]; merged: Rewrite[] } {
  const file = opts.file.split("\\").join("/");
  if (isSpecOrTest(file)) throw new Error(`${file}: the codemod refuses a spec or test file`);
  const planned = plan(src, file, opts.hand);
  const out = apply(src, planned);

  const failures: string[] = [];
  failures.push(...tokenStreamViolations(src, out, planned.map((p) => p.index)));
  for (const p of planned) {
    const roleHex = lightHex(p.role);
    if (!roleHex) {
      failures.push(`line ${p.line}: emits role "${p.role}" (${p.to}), which index.css's light block does not declare`);
      continue;
    }
    if (p.rule !== "hand" && p.kind === "exact") {
      const shadeHex = resolveTailwindShade(p.shade).toUpperCase();
      if (shadeHex !== roleHex) failures.push(`line ${p.line}: exact rewrite ${p.from} -> ${p.to} moves light ${shadeHex} to ${roleHex}`);
    }
  }
  const second = plan(out, file, opts.hand);
  if (second.length > 0 || apply(out, second) !== out) failures.push(`a second pass is not a no-op (${second.length} rewrites)`);
  const left = paletteClassMatches(out);
  if (left.length > 0) failures.push(`palette classes left: ${left.map((m) => m.className).join(", ")}`);
  if (failures.length > 0) throw new Error(`${file}: D3 self-check failed:\n  ${failures.join("\n  ")}`);

  const rewrites: Rewrite[] = planned.map((p) => {
    let { kind, deltaE } = p;
    if (p.rule === "hand") {
      const shadeHex = resolveTailwindShade(p.shade);
      const roleHex = lightHex(p.role) ?? "";
      if (shadeHex.toUpperCase() !== roleHex) {
        kind = "merged";
        deltaE = Math.round(deltaE2000(shadeHex, roleHex) * 100) / 100;
      }
    }
    const r: Rewrite = { file: p.file, line: p.line, from: p.from, to: p.to, rule: p.rule, kind };
    if (deltaE !== undefined) r.deltaE = deltaE;
    return r;
  });
  return {
    out,
    rewrites,
    review: rewrites.filter((r) => r.rule === "on-dark"),
    merged: rewrites.filter((r) => r.kind === "merged"),
  };
}

function main(argv: string[]): number {
  const write = argv.includes("--write");
  const at = argv.indexOf("--dir");
  const dirs = at === -1 ? [] : (argv[at + 1] ?? "").split(",").map((d) => d.trim().replace(/\/+$/, "")).filter(Boolean);
  if (dirs.length === 0) {
    process.stderr.write("usage: npx tsx scripts/codemods/f3.65b-role-classes.ts --dir <dir>[,<dir>…] [--write]\n");
    return 2;
  }
  const rel = (full: string): string => relative(WEB_SRC, full).split("\\").join("/");
  const byDir = new Map(dirs.map((d) => [d, [] as string[]]));
  for (const full of webColourSourceFiles()) {
    const d = dirname(rel(full));
    byDir.get(d === "." ? "" : d)?.push(full);
  }
  const empty = dirs.filter((d) => (byDir.get(d) ?? []).length === 0);
  if (empty.length > 0) {
    process.stderr.write(`no scanned file directly in: ${empty.join(", ")}\n`);
    return 1;
  }

  const results: { full: string; file: string; out: string; rewrites: Rewrite[]; review: Rewrite[]; merged: Rewrite[] }[] = [];
  const failures: string[] = [];
  for (const full of dirs.flatMap((d) => byDir.get(d) ?? [])) {
    const file = rel(full);
    const src = readFileSync(full, "utf8");
    try {
      const r = rewriteSource(src, { file, hand: HAND });
      if (r.rewrites.length > 0) results.push({ full, file, ...r });
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  if (failures.length > 0) {
    process.stderr.write(`FAILED — nothing written:\n${failures.join("\n")}\n`);
    return 1;
  }

  const all = results.flatMap((r) => r.rewrites);
  const count = (rule: Rewrite["rule"]): number => all.filter((r) => r.rule === rule).length;
  const lines: string[] = [
    `F3.65b role-class codemod — ${write ? "WRITE" : "dry run"} — dirs: ${dirs.map((d) => d || ".").join(", ")}`,
    `files changed ${results.length} · rewrites ${all.length} · exact ${all.filter((r) => r.kind === "exact").length} · merged ${all.filter((r) => r.kind === "merged").length}`,
    `rules: table ${count("table")} · on-accent ${count("on-accent")} · on-dark ${count("on-dark")} · focus ${count("focus")} · alpha ${count("alpha")} · hand ${count("hand")}`,
    "D3 self-checks: passed for every file",
    "",
    "Per file:",
    ...results.map((r) => `  ${r.file}  ${r.rewrites.length}`),
    "",
    "Merged sites (file:line · old · new · ΔE):",
    "| Site | Old | New | ΔE |",
    "|---|---|---|---|",
    ...results.flatMap((r) => r.merged).map((m) => `| \`${m.file}:${m.line}\` | \`${m.from}\` | \`${m.to}\` | ${m.deltaE ?? "?"} |`),
    "",
    "text-white -> on-dark (review: the element's fill is not an opaque accent):",
    ...results.flatMap((r) => r.review).map((m) => `  ${m.file}:${m.line}  ${m.from} -> ${m.to}`),
    "",
    "HAND rewrites:",
    ...all.filter((r) => r.rule === "hand").map((m) => `  ${m.file}:${m.line}  ${m.from} -> ${m.to}`),
    "",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  if (write) for (const r of results) writeFileSync(r.full, r.out);
  return 0;
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
