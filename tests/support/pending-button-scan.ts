import { join } from "node:path";

import { repoRoot, walk } from "./source-scan";

/*
 * The `<button>` scanner the pending-state gates share: `F4.164`
 * (`tests/f4.164-pending-buttons-aria-busy.test.ts`, a label that swaps on a pending flag
 * carries `aria-busy`) and `F4.168` (`tests/f4.168-pending-disabled-buttons.test.ts`, a button
 * disabled on a pending flag changes its name).
 *
 * It sat inside the F4.164 test until F4.168 needed the same segment parse. It lives here so
 * both rules cut `<button>` segments with one scanner rather than two that can drift apart. The
 * rule prose and the cases stay in each test file.
 *
 * This directory holds no `*.test.ts`: a module here is imported rather than run, and it is
 * typechecked as an import of the files that use it.
 */

export const WEB_SRC = join(repoRoot, "apps/web/src");

/** Every non-spec `.tsx` file under `apps/web/src`. */
export function webSourceFiles(): string[] {
  return walk(WEB_SRC).filter((f) => /\.tsx$/.test(f) && !/\.(spec|test)\.tsx$/.test(f));
}

/**
 * If the `/` at `at` (inside JS code) opens a regex literal, the index just past its closing
 * `/` and flags; else -1. A `/` opens a regex when the previous non-space character is an
 * operator or opener (or `return`/`typeof`/`case` precedes it); a literal cannot span a line.
 */
export function regexLiteralEnd(src: string, at: number): number {
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

/**
 * The balanced `{…}` expression of attribute `name` in an opening tag, or null. The name must
 * stand alone: `disabled` does not match `data-disabled`.
 */
export function attributeExpression(tag: string, name: string): string | null {
  const escaped = name.replace(/[-]/g, "\\-");
  const m = new RegExp("(?<![\\w-])" + escaped + "\\s*=\\s*\\{").exec(tag);
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
export const MEMBER_FLAG = /(?<![\w$])((?:[A-Za-z_$][\w$]*\??\.)+)(isPending|isFetchingNextPage)\b/g;
export const LOCAL_FLAG =
  /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\?(?![.?])\s*(["'`])[^"'`\n]*\b\w+ing(?:…|\.\.\.)[^"'`\n]*\2/g;

export const foldOptional = (s: string): string => s.replace(/\?\./g, ".");

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
export function namesFlag(busy: string, token: string): boolean {
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
export function blankComments(src: string): string {
  // Replace comment characters with spaces, keeping newlines so line numbers hold.
  return src.replace(/(?<![^\s{}();,=:])\/\*[\s\S]*?\*\/|(?<![^\s{}();,])\/\/[^\n]*/g, (s) =>
    s.includes("<button") ? s : s.replace(/[^\n]/g, " "),
  );
}

/** One `<button>` element: its line, its opening tag (from `<button` to `>`) and its children. */
export type ButtonSegment = { line: number; tag: string; children: string };

/**
 * Every `<button>` element in `src` (comments blanked), and the line of every `<button` the
 * scanner could not delimit. A self-closing `<button />` has empty children. An unparseable tag
 * is reported, never skipped — a silent stop would pass every later button in the file.
 */
export function buttonSegments(src: string): { segments: ButtonSegment[]; unparsed: number[] } {
  const text = blankComments(src);
  const segments: ButtonSegment[] = [];
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
    if (selfClosing) {
      segments.push({ line, tag, children: "" });
      continue;
    }
    const close = text.indexOf("</button>", end);
    const nextOpen = text.slice(end).search(/<button(?=[\s>/])/);
    if (close === -1 || (nextOpen !== -1 && end + nextOpen < close)) {
      unparsed.push(line);
      continue;
    }
    open.lastIndex = close;
    segments.push({ line, tag, children: text.slice(end, close) });
  }
  return { segments, unparsed };
}

export type PendingButton = { line: number; ids: string[]; ariaBusy: string | null };

/**
 * Every `<button>` segment in `src` whose children swap on a pending flag, and the line of every
 * `<button` the scanner could not delimit.
 */
export function scanButtons(src: string): { pending: PendingButton[]; unparsed: number[] } {
  const { segments, unparsed } = buttonSegments(src);
  const pending: PendingButton[] = [];
  for (const s of segments) {
    // `F4.168`: an `aria-label` that swaps (`importM.isPending ? "Importing …" : …`) is a label too.
    const ids = pendingIdentifiers(s.children + "\n" + (attributeExpression(s.tag, "aria-label") ?? ""));
    if (ids.length === 0) continue;
    pending.push({ line: s.line, ids, ariaBusy: attributeExpression(s.tag, "aria-busy") });
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

/* ------------------------------------------------------------------------------------------
 * `F4.168` — a `<button>` disabled on a pending flag changes its name and carries `aria-busy`.
 * ---------------------------------------------------------------------------------------- */

/**
 * `X.isPending` / `X.isFetching…` in a `disabled` (or name, or `aria-busy`) expression. Not
 * `isLoading` or `isError` (`F4.168` D1): a query that loads is not an action the user started.
 */
export const DISABLED_MEMBER = /(?<![\w$])((?:[A-Za-z_$][\w$]*\??\.)+)(isPending|isFetching\w*)\b/g;

/**
 * A bare identifier with no same-file `const` definition that still counts as a pending flag: a
 * prop or a `useState` flag. `busy` / `pending`, a `…Pending` / `…Busy` name, and the `-ing`
 * props and state this tree passes (`deleting`) or `F4.168` U4 introduces (`saving`, `clearing`,
 * `toggling`, `duplicating`, `archiving`). A name outside it escapes the gate.
 */
export const PENDING_VOCAB =
  /^(?:busy|pending|deleting|saving|clearing|toggling|duplicating|archiving|[a-z][\w$]*(?:Pending|Busy))$/;

/**
 * Index of the first character in `stop` at bracket depth 0 from `from`, or of a closer that
 * would take the depth below 0, or `src.length`. Skips strings, template literals (with
 * `${…}`), comments and regex literals, so a `;` inside a `useMemo(() => { …; })` arrow body
 * or a `"a;b"` string does not end the expression.
 */
export function expressionEnd(src: string, from: number, stop: string): number {
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (depth === 0 && stop.includes(c)) return i;
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
      i = j + 1;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "$" && src[j + 1] === "{") j = expressionEnd(src, j + 2, "}") + 1;
        else j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    }
    i++;
  }
  return src.length;
}

/**
 * Blanks the text of string literals and template-literal quasis (keeping `${…}` code), so a
 * word in a label (`"Deleting…"`) is never read as an identifier.
 */
export function blankStrings(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      out += c + " ".repeat(Math.max(0, Math.min(j, code.length) - i - 1)) + (j < code.length ? code[j] : "");
      i = j + 1;
      continue;
    }
    if (c === "`") {
      out += c;
      let j = i + 1;
      while (j < code.length && code[j] !== "`") {
        if (code[j] === "\\") {
          out += "  ";
          j += 2;
        } else if (code[j] === "$" && code[j + 1] === "{") {
          const end = expressionEnd(code, j + 2, "}");
          out += "${" + blankStrings(code.slice(j + 2, end)) + "}";
          j = end + 1;
        } else {
          out += code[j] === "\n" ? "\n" : " ";
          j++;
        }
      }
      if (j < code.length) out += "`";
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The code inside each top-level `{…}` of JSX children; the JSX text between them is dropped. */
export function jsxExpressions(children: string): string[] {
  const out: string[] = [];
  let i = children.indexOf("{");
  while (i !== -1) {
    const end = expressionEnd(children, i + 1, "}");
    out.push(children.slice(i + 1, end));
    i = children.indexOf("{", end + 1);
  }
  return out;
}

/**
 * Every same-file `const|let|var NAME = …` initialiser in `src` (comments blanked), cut by
 * {@link expressionEnd} at the `;` at bracket depth 0. Destructuring (`const [pending, …]`) is
 * not a definition; such a name is a leaf, counted only through {@link PENDING_VOCAB}.
 */
export function definitionOf(name: string, src: string): string[] {
  const escaped = name.replace(/\$/g, "\\$");
  const def = new RegExp("(?<![\\w$.])(?:const|let|var)\\s+" + escaped + "(?![\\w$])\\s*(?::[^=;]*)?=(?![=>])", "g");
  const out: string[] = [];
  for (const m of src.matchAll(def)) {
    const from = m.index + m[0].length;
    out.push(src.slice(from, expressionEnd(src, from, ";")));
  }
  return out;
}

const MAX_DEFINITION_DEPTH = 5;
const BARE_IDENTIFIER = /(?<![\w$.])[A-Za-z_$][\w$]*(?![\w$])(?!\s*\??\.)(?!\s*\()/g;

function negatedAt(text: string, index: number): boolean {
  return text.slice(0, index).trimEnd().endsWith("!");
}

/**
 * The pending leaf tokens `code` reads, resolved through `src`: `X.isPending` members, bare
 * identifiers expanded recursively through {@link definitionOf} (so `!canSubmit` reaches
 * `createM.isPending` through `canSubmit` → `busy`), and bare identifiers with no definition
 * that {@link PENDING_VOCAB} names. `unnegated` drops a top-level token under a leading `!`
 * (for `aria-busy`); inside a definition negation does not matter.
 */
export function expandTokens(
  code: string,
  src: string,
  unnegated = false,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): Set<string> {
  const text = blankStrings(foldOptional(code));
  const tokens = new Set<string>();
  for (const m of text.matchAll(DISABLED_MEMBER)) {
    if (unnegated && negatedAt(text, m.index)) continue;
    tokens.add(m[1] + m[2]);
  }
  for (const m of text.matchAll(BARE_IDENTIFIER)) {
    const name = m[0];
    if (seen.has(name) || (unnegated && negatedAt(text, m.index))) continue;
    const defs = definitionOf(name, src);
    if (defs.length === 0) {
      if (PENDING_VOCAB.test(name)) tokens.add(name);
      continue;
    }
    if (depth >= MAX_DEFINITION_DEPTH) continue;
    const inner = new Set(seen).add(name);
    const resolved = new Set<string>();
    for (const d of defs) for (const t of expandTokens(d, src, false, depth + 1, inner)) resolved.add(t);
    // `const deleting = deletingIds.includes(row.id)` resolves to no token, but its name is a flag.
    if (resolved.size === 0 && PENDING_VOCAB.test(name)) resolved.add(name);
    for (const t of resolved) tokens.add(t);
  }
  return tokens;
}

/** {@link expandTokens} of `code` against the comment-blanked `src`, sorted. */
export function pendingTokensOf(code: string, src: string, unnegated = false): string[] {
  return [...expandTokens(code, blankComments(src), unnegated)].sort();
}

/** True when the opening tag has attribute `name` in any form. */
function hasAttribute(tag: string, name: string): boolean {
  return new RegExp("(?<![\\w-])" + name.replace(/-/g, "\\-") + "(?![\\w-])").test(tag);
}

/** The string value of `name="…"` / `name='…'` / `name={"…"}`, or null. */
function attributeString(tag: string, name: string): string | null {
  const m = new RegExp(
    "(?<![\\w-])" + name.replace(/-/g, "\\-") + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|\\{\\s*[\"'`]([^\"'`]*)[\"'`]\\s*\\})",
  ).exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/**
 * The pending tokens a button's accessible name reads (`F4.168` D2): the `aria-label` when the
 * tag has one (a string `aria-label="…"` is static), else the children.
 */
function nameTokens(tag: string, children: string, src: string): { source: string; tokens: Set<string> } {
  if (hasAttribute(tag, "aria-label")) {
    const expr = attributeExpression(tag, "aria-label") ?? "";
    return { source: "aria-label", tokens: labelTokens([expr], expr, src) };
  }
  return { source: "children", tokens: labelTokens(jsxExpressions(children), children, src) };
}

function labelTokens(code: string[], raw: string, src: string): Set<string> {
  const text = blankComments(src);
  const tokens = new Set<string>();
  for (const c of code) for (const t of expandTokens(c, text)) tokens.add(t);
  for (const id of pendingIdentifiers(raw)) for (const t of expandTokens(id, text)) tokens.add(t);
  return tokens;
}

export type DisabledPendingButton = { line: number; disabled: string[] };

/** Every `<button>` in `src` whose `disabled={…}` expression reads a pending token. */
export function disabledPendingButtons(src: string): DisabledPendingButton[] {
  const out: DisabledPendingButton[] = [];
  for (const s of buttonSegments(src).segments) {
    const expr = attributeExpression(s.tag, "disabled");
    const disabled = expr === null ? [] : pendingTokensOf(expr, src);
    if (disabled.length > 0) out.push({ line: s.line, disabled });
  }
  return out;
}

/**
 * One finding per `<button>` that breaks the `F4.168` rule, and one per `<button` the scanner
 * could not parse. For a button whose `disabled` reads pending tokens `D`:
 *  - with `data-pending-bystander="<flag>"`: the flag must resolve into `D`, and the tag must
 *    carry no `aria-busy` (`F4.168` D3);
 *  - else the name (`aria-label` if present, else the children) must pend on a token in `D`,
 *    and `aria-busy` must name that token, not negated.
 * A bystander marker on a button whose `disabled` does not pend is a finding too.
 */
export function disabledPendingButtonFindings(src: string, file = "<source>"): string[] {
  const text = blankComments(src);
  const { segments, unparsed } = buttonSegments(src);
  const findings = unparsed.map((line) => ({ line, text: `${file}:${line} scanner could not parse the <button> tag` }));
  const add = (line: number, msg: string) => findings.push({ line, text: `${file}:${line} ${msg}` });
  for (const s of segments) {
    const expr = attributeExpression(s.tag, "disabled");
    const d = expr === null ? [] : pendingTokensOf(expr, src);
    const marker = attributeString(s.tag, "data-pending-bystander");
    if (marker !== null || hasAttribute(s.tag, "data-pending-bystander")) {
      if (d.length === 0) {
        add(s.line, `data-pending-bystander on a <button> whose disabled does not pend`);
      } else if (!pendingTokensOf(marker ?? "", src).some((t) => d.includes(t))) {
        add(s.line, `data-pending-bystander="${marker ?? ""}" names no pending flag of disabled (${d.join(", ")})`);
      } else if (hasAttribute(s.tag, "aria-busy")) {
        add(s.line, `bystander of ${d.join(", ")} carries aria-busy; a bystander is not busy`);
      }
      continue;
    }
    if (d.length === 0) continue;
    const name = nameTokens(s.tag, s.children, text);
    const hit = d.filter((t) => name.tokens.has(t));
    if (hit.length === 0) {
      add(s.line, `disabled pends on ${d.join(", ")} but the name (${name.source}) does not change on it`);
      continue;
    }
    const busy = attributeExpression(s.tag, "aria-busy");
    if (busy === null) {
      add(s.line, `name pends on ${hit.join(", ")} but the <button> has no aria-busy`);
      continue;
    }
    const b = pendingTokensOf(busy, src, true);
    if (!hit.some((t) => b.includes(t))) {
      add(s.line, `name pends on ${hit.join(", ")} but aria-busy={${busy.trim()}} does not name it un-negated`);
    }
  }
  return findings.sort((a, b) => a.line - b.line).map((f) => f.text);
}
