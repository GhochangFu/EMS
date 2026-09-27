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
    const ids = pendingIdentifiers(s.children);
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
