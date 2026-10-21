import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const WEB_SRC = "apps/web/src";

/**
 * `F4.245` (ADR 0099 Amendment 4) — the record gate: every `<WizardShell>` names the record it
 * writes in its OWN props (`params={…}`). The shell registers that record for the dock and takes
 * only a fill for it, so an element without `params` is a wizard the copilot cannot fill (or one a
 * fill for another record could reach). `tsc` already refuses a missing required prop; this scan
 * is the second gate, and it also refuses a `params` that arrives only through a spread
 * (`{...shared}`), where a change to the spread object would drop it with no compiler error at the
 * element. Comments are blanked first, so a commented-out element counts for nothing.
 */

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

function code(source: string): string {
  return source
    .replace(BLOCK_COMMENT, (c) => c.replace(/[^\n]/g, ""))
    .replace(LINE_COMMENT, "");
}

/** The props text of each `<WizardShell …>` element: from the tag to its closing `>` / `/>` outside braces and strings. */
export function shellElements(source: string): string[] {
  const text = code(source);
  const out: string[] = [];
  const open = /<WizardShell\b/g;
  let hit: RegExpExecArray | null;
  while ((hit = open.exec(text)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    let i = hit.index + hit[0].length;
    const start = i;
    for (; i < text.length; i += 1) {
      const c = text[i]!;
      if (quote !== null) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    out.push(text.slice(start, i));
  }
  return out;
}

/** The element's own top-level props text: brace-nested text (a prop value or a spread) blanked. */
function ownProps(props: string): string {
  let depth = 0;
  let out = "";
  for (const c of props) {
    if (c === "{") depth += 1;
    if (depth === 0) out += c;
    else out += c === "{" || c === "}" ? c : " ";
    if (c === "}") depth -= 1;
  }
  return out;
}

/** True when the element writes `params={…}` itself (not through a spread). */
export function namesItsRecord(props: string): boolean {
  return /(^|\s)params=\{/.test(ownProps(props));
}

function webSources(dir = WEB_SRC): string[] {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((dirent) => {
    const rel = `${dir}/${dirent.name}`;
    if (dirent.isDirectory()) return webSources(rel);
    const n = dirent.name;
    return n.endsWith(".tsx") && !n.endsWith(".spec.tsx") && !n.endsWith(".test.tsx") ? [rel] : [];
  });
}

describe("F4.245 wizard record gate — every WizardShell element names its record", () => {
  it("positive control: the scan finds the elements, in more than ten files", () => {
    const files = webSources().filter((f) => shellElements(readFileSync(join(repoRoot, f), "utf8")).length > 0);
    expect(files.length).toBeGreaterThan(10);
  });

  it("negative control: an element with no params is refused", () => {
    expect(namesItsRecord('\n entry={catalogEntry("a.b")!}\n values={v}\n/')).toBe(false);
  });

  it("negative control: a params that arrives only through a spread is refused", () => {
    expect(namesItsRecord('\n entry={e}\n {...shared}\n/')).toBe(false);
    expect(namesItsRecord("\n entry={e}\n onChange={() => ({ params: 1 })}\n/")).toBe(false);
  });

  it("positive control: params in the element's own props is accepted, even beside a spread", () => {
    expect(namesItsRecord("\n entry={e}\n params={{ id: x.id }}\n {...shared}\n/")).toBe(true);
    expect(namesItsRecord("\n params={{}}\n/")).toBe(true);
  });

  it("a commented-out element is not counted", () => {
    expect(shellElements("// <WizardShell entry={e} />\n{/* <WizardShell entry={e} /> */}")).toEqual([]);
  });

  it("the scan reads past a nested JSX element in a prop", () => {
    const els = shellElements("<WizardShell renderStep={() => <input />} params={{}} />");
    expect(els).toHaveLength(1);
    expect(namesItsRecord(els[0]!)).toBe(true);
  });

  it("every WizardShell element in apps/web/src writes params itself", () => {
    const bare: string[] = [];
    for (const file of webSources()) {
      const found = shellElements(readFileSync(join(repoRoot, file), "utf8"));
      found.forEach((props, at) => {
        if (!namesItsRecord(props)) bare.push(`${file} #${at + 1}`);
      });
    }
    expect(bare).toEqual([]);
  });
});
