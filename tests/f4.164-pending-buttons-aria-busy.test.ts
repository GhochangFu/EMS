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
 * **What counts as a pending flag** (collected from the children only):
 *  - any `X.isPending` or `X.isFetchingNextPage` anywhere in the children, where `X` is an
 *    identifier or a dotted chain (`props.saveM.isPending`), and `?.` counts as `.`
 *    (`saveM?.isPending`). The surrounding condition does not matter:
 *    `importM.isPending && importM.variables === entry.code ? …` is caught;
 *  - a bare identifier used as `ident ? "…ing…" : …` — a local flag such as `deleting` or a
 *    hoisted `importingThis`. The branch must be a word ending in `ing` followed by an
 *    ellipsis, so `commitResult ? "Committed" : …` does not capture `commitResult`.
 *
 * The opening tag then needs `aria-busy={…}` whose expression contains every captured flag as
 * the full token (`saveM.isPending`, not merely `saveM`), not negated by a leading `!`.
 *
 * **NOT covered — these shapes escape the scan today:** `saveM.status === "pending"`; a label
 * without an ellipsis (`saving ? "Saving" : "Save"`); an inverted ternary
 * (`!deleting ? "Delete" : "Deleting…"`); `deleting && "Deleting…"`; a label computed into a
 * variable before the `<button>`; a flag read through a call (`m().isPending` is captured only
 * from `isPending`'s own object onward); a pending label on a component that is not a literal
 * `<button>` (for example a design-system `<Button>`).
 *
 * **Fails closed on the parse.** A `<button` whose opening tag the scanner cannot delimit, or
 * whose `</button>` it cannot find before the next `<button`, is a finding of its own. Comment
 * blanking never blanks a span that contains `<button`.
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
 * If the `/` at `at` (inside JS code) opens a regex literal, the index just past its closing
 * `/` and flags; else -1. A `/` opens a regex when the previous non-space character is an
 * operator or opener (or `return`/`typeof`/`case` precedes it); a literal cannot span a line.
 */
function regexLiteralEnd(src: string, at: number): number {
  let p = at - 1;
  while (p >= 0 && /\s/.test(src[p])) p--;
  const prev = p >= 0 ? src[p] : "";
  const keyword = /\b(?:return|typeof|case)$/.test(src.slice(Math.max(0, p - 5), p + 1));
  if (!(prev === "" || "(,=:[!&|?{};+-*%>~^".includes(prev) || keyword)) return -1;
  let j = at + 1;
  let inClass = false;
  while (j < src.length && src[j] !== "\n") {
    const ch = src[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      j++;
      while (j < src.length && /[a-z]/.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
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
    if (c === "/") {
      const regexEnd = regexLiteralEnd(src, i);
      if (regexEnd !== -1) {
        i = regexEnd;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      // A quote string cannot span a line: an unterminated one means the scan lost its place.
      if (src[j] !== c) return { end: -1, selfClosing: false };
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

/** `X.isPending` / `X.isFetchingNextPage`, `X` a dotted chain; `?.` is folded to `.` afterwards. */
const MEMBER_FLAG = /(?<![\w$])((?:[A-Za-z_$][\w$]*\??\.)+)(isPending|isFetchingNextPage)\b/g;
const LOCAL_FLAG =
  /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\?(?![.?])\s*(["'`])[^"'`\n]*\b\w+ing(?:…|\.\.\.)[^"'`\n]*\2/g;

const foldOptional = (s: string): string => s.replace(/\?\./g, ".");

/**
 * The pending flags a button's children swap its label on, as full tokens: `saveM.isPending`,
 * `props.saveM.isPending`, `listQ.isFetchingNextPage`, or a bare local such as `deleting`.
 */
export function pendingIdentifiers(children: string): string[] {
  const ids = new Set<string>();
  for (const m of children.matchAll(MEMBER_FLAG)) ids.add(foldOptional(m[1] + m[2]));
  for (const m of children.matchAll(LOCAL_FLAG)) ids.add(m[1]);
  return [...ids];
}

/** True when `busy` contains `token` as a whole token that is not negated by a leading `!`. */
function namesFlag(busy: string, token: string): boolean {
  const text = foldOptional(busy);
  const escaped = token.replace(/[.$]/g, (ch) => "\\" + ch);
  const pattern = new RegExp("(?<![\\w$.])" + escaped + "(?![\\w$])", "g");
  for (const m of text.matchAll(pattern)) {
    if (!text.slice(0, m.index).trimEnd().endsWith("!")) return true;
  }
  return false;
}

/**
 * Blanks `//` line comments and `/* … *\/` block comments so a `<button` inside one is not cut.
 * A comment opener counts only at a code position (after whitespace, a bracket or a separator),
 * so a `/*` inside a regex (`/[/*]/`) or a glob string (`"src/**\/*.tsx"`) is not one. A match
 * that contains `<button` is left alone: blanking may never hide a button, only fail to hide one.
 */
function blankComments(src: string): string {
  // Replace comment characters with spaces, keeping newlines so line numbers hold.
  return src.replace(/(?<![^\s{}();,=:])\/\*[\s\S]*?\*\/|(?<![^\s{}();,])\/\/[^\n]*/g, (s) =>
    s.includes("<button") ? s : s.replace(/[^\n]/g, " "),
  );
}

export type PendingButton = { line: number; ids: string[]; ariaBusy: string | null };

/**
 * Every `<button>` segment in `src`: the pending ones, and the line of every `<button` the
 * scanner could not delimit. An unparseable tag is reported, never skipped — a silent stop
 * would pass every later button in the file.
 */
export function scanButtons(src: string): { pending: PendingButton[]; unparsed: number[] } {
  const text = blankComments(src);
  const pending: PendingButton[] = [];
  const unparsed: number[] = [];
  const open = /<button(?=[\s>/])/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text)) !== null) {
    const line = text.slice(0, m.index).split("\n").length;
    const resume = m.index + m[0].length;
    const { end, selfClosing } = openingTagEnd(text, resume);
    const tag = end === -1 ? "" : text.slice(m.index, end);
    // A tag that runs into another button has lost its place, whatever `>` it stopped at.
    if (end === -1 || /<\/?button(?=[\s>/])/.test(tag.slice(1))) {
      unparsed.push(line);
      open.lastIndex = resume;
      continue;
    }
    open.lastIndex = end;
    if (selfClosing) continue;
    const close = text.indexOf("</button>", end);
    const nextOpen = text.slice(end).search(/<button(?=[\s>/])/);
    if (close === -1 || (nextOpen !== -1 && end + nextOpen < close)) {
      unparsed.push(line);
      continue;
    }
    open.lastIndex = close;
    const ids = pendingIdentifiers(text.slice(end, close));
    if (ids.length === 0) continue;
    pending.push({ line, ids, ariaBusy: ariaBusyExpression(tag) });
  }
  return { pending, unparsed };
}

/** Every `<button>` segment in `src` whose children swap on a pending flag. */
export function pendingButtons(src: string): PendingButton[] {
  return scanButtons(src).pending;
}

/**
 * One finding per pending button whose `aria-busy` is missing or does not name every flag
 * (un-negated), and one per `<button` the scanner could not parse.
 */
export function pendingButtonsMissingAriaBusy(src: string, file = "<source>"): string[] {
  const { pending, unparsed } = scanButtons(src);
  const findings = unparsed.map((line) => ({ line, text: `${file}:${line} scanner could not parse the <button> tag` }));
  for (const b of pending) {
    const busy = b.ariaBusy;
    const missing = busy === null ? b.ids : b.ids.filter((id) => !namesFlag(busy, id));
    if (missing.length === 0) continue;
    findings.push({
      line: b.line,
      text:
        busy === null
          ? `${file}:${b.line} label pends on ${missing.join(", ")} but the <button> has no aria-busy`
          : `${file}:${b.line} label pends on ${missing.join(", ")} but aria-busy={${busy.trim()}} does not name it`,
    });
  }
  return findings.sort((a, b) => a.line - b.line).map((f) => f.text);
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
      "<source>:3 label pends on save.isPending but the <button> has no aria-busy",
    ]);
  });

  it("G2 passes the same button with aria-busy={save.isPending} after the arrow", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={save.isPending}"))).toEqual([]);
  });

  it("G3 flags an aria-busy that names a different flag than the label", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={other.isPending}"))).toHaveLength(1);
  });

  it("G3b flags an aria-busy on the same object but another flag (save.isSuccess)", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={save.isSuccess}"))).toHaveLength(1);
  });

  it("G3c flags a negated aria-busy (!save.isPending)", () => {
    expect(pendingButtonsMissingAriaBusy(fixture("aria-busy={!save.isPending}"))).toHaveLength(1);
  });

  it("G3d passes a hoisted local flag named in aria-busy (importingThis)", () => {
    expect(
      pendingButtonsMissingAriaBusy(
        fixture("aria-busy={importingThis}", `{importingThis ? "Importing…" : "Import"}`),
      ),
    ).toEqual([]);
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
    expect(findings[0]).toContain("commitMutation.isPending");
    expect(findings[0]).not.toContain("commitResult");
  });

  it("G4d passes the nested committed/committing ternary with aria-busy={commitMutation.isPending}", () => {
    expect(
      pendingButtonsMissingAriaBusy(
        fixture(
          "aria-busy={commitMutation.isPending}",
          `{commitResult ? "Committed" : commitMutation.isPending ? "Committing…" : "Commit"}`,
        ),
      ),
    ).toEqual([]);
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

  it("G7 a regex literal with a quote in an earlier button's onClick does not hide a later pending button", () => {
    const src = [
      `const a = <button onClick={() => setQ(q.replace(/'/g, ""))}>Clear</button>;`,
      fixture(),
    ].join("\n");
    expect(pendingButtonsMissingAriaBusy(src).length).toBeGreaterThanOrEqual(1);
  });

  it("G8 a `/*` inside a regex literal does not blank a later pending button", () => {
    const src = ["const re = /[/*]/;", fixture(), "/** doc */", "const n = 1;"].join("\n");
    expect(pendingButtonsMissingAriaBusy(src)).toEqual([
      "<source>:4 label pends on save.isPending but the <button> has no aria-busy",
    ]);
  });

  it("G8b a `/*` inside a glob string does not blank a later pending button", () => {
    const src = ['const glob = "src/**/*.tsx";', fixture(), "/** doc */"].join("\n");
    expect(pendingButtonsMissingAriaBusy(src)).toHaveLength(1);
  });

  it("G8d a `/*` after a space inside a string does not blank a later pending button", () => {
    // The code-position rule admits this opener; only the "never blank a <button" bound holds it.
    const src = ['const s = "a /* b";', fixture(), "/** doc */"].join("\n");
    expect(pendingButtonsMissingAriaBusy(src)).toHaveLength(1);
  });

  it("G8c an unterminated <button> tag is a finding, not a silent stop", () => {
    const findings = pendingButtonsMissingAriaBusy("const b = <button onClick={() => go(}");
    expect(findings).toEqual(["<source>:1 scanner could not parse the <button> tag"]);
  });

  it("G9 flags a label on a nested chain (props.save.isPending) with no aria-busy", () => {
    const findings = pendingButtonsMissingAriaBusy(
      fixture("", `{props.save.isPending ? "Saving…" : "Save"}`),
    );
    expect(findings).toEqual([
      "<source>:3 label pends on props.save.isPending but the <button> has no aria-busy",
    ]);
  });

  it("G9b passes the nested chain with aria-busy={props.save.isPending}", () => {
    expect(
      pendingButtonsMissingAriaBusy(
        fixture("aria-busy={props.save.isPending}", `{props.save.isPending ? "Saving…" : "Save"}`),
      ),
    ).toEqual([]);
  });

  it("G10 flags an optional-chained label (save?.isPending) with no aria-busy", () => {
    const findings = pendingButtonsMissingAriaBusy(fixture("", `{save?.isPending ? "Saving…" : "Save"}`));
    expect(findings).toEqual(["<source>:3 label pends on save.isPending but the <button> has no aria-busy"]);
  });

  it("G5 every pending button under apps/web/src names its flag in aria-busy", () => {
    const { findings } = scanTree();
    expect(findings, `pending buttons without a matching aria-busy:\n${findings.join("\n")}`).toEqual([]);
  });

  it("G6 the scan found at least 47 pending-button segments (a broken walk would pass G5 vacuously)", () => {
    expect(scanTree().segments).toBeGreaterThanOrEqual(47);
  });
});
