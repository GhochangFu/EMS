import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F4.164` U5 — a `<button>` whose label swaps on a pending flag ("Save" → "Saving…") must
 * carry `aria-busy={<that flag>}`.
 *
 * **Why this rule exists.** The label swap is the only pending signal most of these buttons
 * give, and a screen reader does not announce a text change inside a focused button. U4 added
 * `aria-busy` to every such site; this gate keeps the next one from shipping without it. A
 * jsdom spec per component cannot see a *new* component that forgot the attribute, so the rule
 * is a source scan.
 *
 * **Why the scanner is not a regex.** The opening tag is split from the children at the first
 * `>` at brace depth 0, outside a string. A bare `>` regex cuts at the `=>` of
 * `onClick={() => …}` and moves every attribute after it — including `aria-busy` — into the
 * children, where the check cannot see it. It also cuts at the `>` of a Tailwind
 * `className="[&>svg]:…"`.
 *
 * **What counts as a pending identifier** (collected from the children only):
 *  - any `X.isPending` or `X.isFetchingNextPage` — whatever the condition shape
 *    (`importM.isPending && importM.variables === entry.code ? …` included), so a new
 *    condition shape fails closed rather than escaping the scan;
 *  - a bare identifier used as `ident ? "…ing…" : …` — a local flag such as `deleting` or a
 *    hoisted `importingThis`. The branch must be a word ending in `ing` followed by an
 *    ellipsis, so `commitResult ? "Committed" : …` does not capture `commitResult`.
 *
 * The opening tag then needs `aria-busy={…}` whose expression names every captured identifier.
 *
 * Lives in `tests/` because `apps/web`'s tsconfig carries no node types; `typecheck:tests` lists
 * it by hand.
 */

const WEB_SRC = join(repoRoot, "apps/web/src");
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.(spec|test)\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Index just past the `>` that closes the opening tag starting at `from` (just after
 * `<button`), or -1. Tracks JSX attribute strings at depth 0, braces, JS strings, template
 * literals with `${}` (as a stack) and comments inside braces. `selfClosing` is true for `/>`.
 */
export function openingTagEnd(src: string, from: number): { end: number; selfClosing: boolean } {
  // Stack of contexts: "brace" (a `{` in JS code) or "tpl" (inside a template literal).
  const stack: ("brace" | "tpl")[] = [];
  let i = from;
  while (i < src.length) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top === "tpl") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        i++;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        stack.push("brace");
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (stack.length === 0) {
      // Depth 0: attribute names, `="…"`/`='…'` values, `{` expressions, and the closing `>`.
      if (c === '"' || c === "'") {
        const close = src.indexOf(c, i + 1);
        if (close === -1) return { end: -1, selfClosing: false };
        i = close + 1;
        continue;
      }
      if (c === "{") {
        stack.push("brace");
        i++;
        continue;
      }
      if (c === ">") return { end: i + 1, selfClosing: src[i - 1] === "/" };
      i++;
      continue;
    }
    // Inside a brace: JS code.
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close === -1 ? src.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (c === "`") {
      stack.push("tpl");
      i++;
      continue;
    }
    if (c === "{") {
      stack.push("brace");
      i++;
      continue;
    }
    if (c === "}") {
      stack.pop();
      i++;
      continue;
    }
    i++;
  }
  return { end: -1, selfClosing: false };
}

/** The balanced `{…}` expression of `aria-busy` in an opening tag, or null. */
function ariaBusyExpression(tag: string): string | null {
  const m = /\baria-busy\s*=\s*\{/.exec(tag);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < tag.length && depth > 0) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}") depth--;
    i++;
  }
  return depth === 0 ? tag.slice(start, i - 1) : null;
}

const MEMBER_FLAG = /(?<![\w$.])([A-Za-z_$][\w$]*)\.(?:isPending|isFetchingNextPage)\b/g;
const LOCAL_FLAG =
  /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\?(?![.?])\s*(["'`])[^"'`\n]*\b\w+ing(?:…|\.\.\.)[^"'`\n]*\2/g;

/** The pending identifiers a button's children swap its label on. */
export function pendingIdentifiers(children: string): string[] {
  const ids = new Set<string>();
  for (const m of children.matchAll(MEMBER_FLAG)) ids.add(m[1]);
  for (const m of children.matchAll(LOCAL_FLAG)) ids.add(m[1]);
  return [...ids];
}

/** Removes `//` line comments and `/* … *\/` block comments so a `<button` inside one is not cut. */
function blankComments(src: string): string {
  // Replace comment characters with spaces, keeping newlines so line numbers hold.
  return src.replace(/(?<![\w"'`])\/\*[\s\S]*?\*\/|(?<![:"'`\w])\/\/[^\n]*/g, (s) =>
    s.replace(/[^\n]/g, " "),
  );
}

export type PendingButton = { line: number; ids: string[]; ariaBusy: string | null };

/** Every `<button>` segment in `src` whose children swap on a pending identifier. */
export function pendingButtons(src: string): PendingButton[] {
  const text = blankComments(src);
  const out: PendingButton[] = [];
  const open = /<button(?=[\s>/])/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text)) !== null) {
    const { end, selfClosing } = openingTagEnd(text, m.index + m[0].length);
    if (end === -1) break;
    open.lastIndex = end;
    if (selfClosing) continue;
    const close = text.indexOf("</button>", end);
    if (close === -1) break;
    const tag = text.slice(m.index, end);
    const children = text.slice(end, close);
    open.lastIndex = close;
    const ids = pendingIdentifiers(children);
    if (ids.length === 0) continue;
    const line = text.slice(0, m.index).split("\n").length;
    out.push({ line, ids, ariaBusy: ariaBusyExpression(tag) });
  }
  return out;
}

/** One finding per pending button whose `aria-busy` is missing or does not name every identifier. */
export function pendingButtonsMissingAriaBusy(src: string, file = "<source>"): string[] {
  const findings: string[] = [];
  for (const b of pendingButtons(src)) {
    const busy = b.ariaBusy;
    const missing =
      busy === null ? b.ids : b.ids.filter((id) => !new RegExp(`(?<![\\w$])${id.replace(/\$/g, "\\$")}(?![\\w$])`).test(busy));
    if (missing.length === 0) continue;
    findings.push(
      busy === null
        ? `${file}:${b.line} label pends on ${missing.join(", ")} but the <button> has no aria-busy`
        : `${file}:${b.line} label pends on ${missing.join(", ")} but aria-busy={${busy.trim()}} does not name it`,
    );
  }
  return findings;
}

function scanTree(): { findings: string[]; segments: number } {
  const findings: string[] = [];
  let segments = 0;
  for (const full of walk(WEB_SRC)) {
    const src = readFileSync(full, "utf8");
    const rel = relative(repoRoot, full).split("\\").join("/");
    segments += pendingButtons(src).length;
    findings.push(...pendingButtonsMissingAriaBusy(src, rel));
  }
  return { findings, segments };
}

/** A pending button with an arrow in `onClick` and a multi-line label. `busy` goes AFTER the arrow. */
function fixture(busy = "", label = `{save.isPending\n        ? "Saving…"\n        : "Save"}`): string {
  return [
    "export function Form() {",
    "  return (",
    "    <button",
    '      type="button"',
    "      onClick={() => go()}",
    `      ${busy}`,
    '      className="rounded [&>svg]:h-4"',
    "    >",
    `      ${label}`,
    "    </button>",
    "  );",
    "}",
  ].join("\n");
}

describe("F4.164: a pending label-swap <button> carries aria-busy", () => {
  it("G1 flags a pending button with an arrow in onClick and no aria-busy, exactly once", () => {
    expect(pendingButtonsMissingAriaBusy(fixture())).toEqual([
      "<source>:3 label pends on save but the <button> has no aria-busy",
    ]);
  });

  it("G2 passes the same button with aria-busy={save.isPending} after the arrow", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={save.isPending}"))).toEqual([]);
  });

  it("G3 flags an aria-busy that names a different flag than the label", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={other.isPending}"))).toHaveLength(1);
  });

  it('G4 flags a local `deleting ? "Deleting…"` label with no aria-busy', () => {
    const findings = pendingButtonsMissingAriaBusy(
      fixture("", `{deleting ? "Deleting…" : "Delete"}`),
    );
    expect(findings).toEqual(["<source>:3 label pends on deleting but the <button> has no aria-busy"]);
  });

  it("G4b captures commitMutation, not commitResult, from the nested committed/committing ternary", () => {
    const findings = pendingButtonsMissingAriaBusy(
      fixture("", `{commitResult ? "Committed" : commitMutation.isPending ? "Committing…" : "Commit"}`),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("commitMutation");
    expect(findings[0]).not.toContain("commitResult");
  });

  it("G4c a `{` before a later `{/* … */}` JSX comment does not blank the button between them", () => {
    // Regression: a comment blanker that matched `\{\s*\/\*…\*\/\s*\}` lazily ran from a type
    // literal's `{ /** doc */` to a JSX comment's `*/}` far below and hid three real sites.
    const src = [
      "type P = {",
      "  /** doc */",
      "  id: string;",
      "};",
      fixture(),
      "const x = <div>{/* note */}</div>;",
    ].join("\n");
    expect(pendingButtonsMissingAriaBusy(src)).toHaveLength(1);
  });

  it("G5 every pending button under apps/web/src names its flag in aria-busy", () => {
    const { findings } = scanTree();
    expect(findings, `pending buttons without a matching aria-busy:\n${findings.join("\n")}`).toEqual([]);
  });

  it("G6 the scan found at least 47 pending-button segments (a broken walk would pass G5 vacuously)", () => {
    expect(scanTree().segments).toBeGreaterThanOrEqual(47);
  });
});
