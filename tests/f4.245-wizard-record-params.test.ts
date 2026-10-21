import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const WEB_SRC = "apps/web/src";

/**
 * `F4.245` (ADR 0099 Amendment 4) — the record gate: every `<WizardShell>` names the record it
 * writes in its OWN props (`params={…}`). The shell registers that record for the dock and takes
 * only a fill for it, so an element without `params` is a wizard the copilot cannot fill (or one a
 * fill for another record could reach). `tsc` already refuses a missing required prop; this scan
 * is the second gate, and it also refuses:
 *  - a `params` that arrives only through a spread (`{...shared}`), where a change to the spread
 *    object would drop it with no compiler error at the element;
 *  - a `params` followed by a spread on the same element (review F3): in JSX the later spread
 *    wins, so a `params` key in it would replace the element's own, and `tsc` is silent.
 *
 * The elements are read by the TypeScript parser (review F3), not a text scan: a comment is no
 * element, and an apostrophe in JSX text inside a prop ("Don't") is text, not a quote that could
 * hide the rest of the file.
 */

/** One `<WizardShell>` element's attributes in source order: a named prop, or a spread. */
export type ShellAttribute = { readonly kind: "prop"; readonly name: string } | { readonly kind: "spread" };

/** The attributes of each `<WizardShell …>` element in `source`, in source order. */
export function shellElements(source: string, file = "scan.tsx"): ShellAttribute[][] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const out: ShellAttribute[][] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === "WizardShell") {
      out.push(
        node.attributes.properties.map((attribute): ShellAttribute =>
          ts.isJsxSpreadAttribute(attribute) ? { kind: "spread" } : { kind: "prop", name: attribute.name.getText(sf) },
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** True when the element writes `params` itself and no spread follows it (a later spread wins). */
export function namesItsRecord(attributes: readonly ShellAttribute[]): boolean {
  const at = attributes.findIndex((attribute) => attribute.kind === "prop" && attribute.name === "params");
  return at >= 0 && !attributes.slice(at + 1).some((attribute) => attribute.kind === "spread");
}

const verdicts = (source: string): boolean[] => shellElements(source).map(namesItsRecord);

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
    const files = webSources().filter((f) => shellElements(readFileSync(join(repoRoot, f), "utf8"), f).length > 0);
    expect(files.length).toBeGreaterThan(10);
  });

  it("negative control: an element with no params is refused", () => {
    expect(verdicts('<WizardShell entry={catalogEntry("a.b")!} values={v} />')).toEqual([false]);
  });

  it("negative control: a params that arrives only through a spread is refused", () => {
    expect(verdicts("<WizardShell entry={e} {...shared} />")).toEqual([false]);
  });

  it("negative control: a params inside another prop's value is not the element's", () => {
    expect(verdicts("<WizardShell entry={e} onChange={() => ({ params: 1 })} />")).toEqual([false]);
  });

  it("negative control (review F3): a params followed by a spread is refused — the later spread wins", () => {
    expect(verdicts("<WizardShell entry={e} params={{ id: x.id }} {...shared} />")).toEqual([false]);
  });

  it("positive control: params after a spread is accepted — the element's own wins", () => {
    expect(verdicts("<WizardShell {...shared} entry={e} params={{ id: x.id }} />")).toEqual([true]);
  });

  it("positive control: params in the element's own props is accepted", () => {
    expect(verdicts("<WizardShell params={{}} />")).toEqual([true]);
  });

  it("a commented-out element is not counted", () => {
    expect(shellElements("// <WizardShell entry={e} />\nconst x = <div>{/* <WizardShell entry={e} /> */}</div>;")).toEqual([]);
  });

  it("the scan reads past a nested JSX element in a prop", () => {
    expect(verdicts("<WizardShell renderStep={() => <input />} params={{}} />")).toEqual([true]);
  });

  it("review F3: an apostrophe in JSX text inside a prop does not hide the next element", () => {
    const source = "<>\n<WizardShell renderStep={() => <p>Don't leave</p>} params={{}} />\n<WizardShell entry={e} />\n</>";
    expect(verdicts(source)).toEqual([true, false]);
  });

  it("every WizardShell element in apps/web/src writes params itself, after any spread", () => {
    const bare: string[] = [];
    for (const file of webSources()) {
      shellElements(readFileSync(join(repoRoot, file), "utf8"), file).forEach((attributes, at) => {
        if (!namesItsRecord(attributes)) bare.push(`${file} #${at + 1}`);
      });
    }
    expect(bare).toEqual([]);
  });
});
