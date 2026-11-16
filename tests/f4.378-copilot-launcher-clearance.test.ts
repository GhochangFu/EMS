import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, withoutComments } from "./support/source-scan";

/**
 * `F4.378` (the owner's AWS check, 2026-11-16) — the floating "Open the copilot" button covered the
 * dashboard builder's "Next" at 666 px and at 1400 px, so a click opened the copilot. The page
 * content now ends with a clearance as tall as the button's reach above the content's bottom edge,
 * plus a margin, so the last action on any page scrolls clear of it. jsdom computes no layout, so
 * this static gate holds the rule; inline assertions (a top-level `tests/` file, AGENTS.md §4.6).
 *
 *  - **C1** `index.css` declares `--copilot-launcher-offset` and `--copilot-launcher-size` once each,
 *    and `.copilot-launcher-clearance` pads the bottom by offset + size + a margin, as plain CSS
 *    after `@tailwind utilities` (so it wins over the content's `p-4`), not inside an `@layer`.
 *  - **C2** the launcher is placed and sized by those two variables, and by no literal.
 *  - **C3** `ShellMain`'s scroll container carries the clearance, and every shell that mounts the
 *    copilot dock renders its pages through `ShellMain`.
 */

const WEB_SRC = join(repoRoot, "apps/web/src");
const read = (path: string): string => readFileSync(join(WEB_SRC, path), "utf8");

/** Every declaration of a custom property, its value. */
function declarations(css: string, name: string): string[] {
  return [...withoutComments(css).matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, "g"))].map((m) => m[1]!.trim());
}

/** Why the clearance rule is wrong, or `[]`. */
function clearanceProblems(css: string): string[] {
  const text = withoutComments(css);
  const problems: string[] = [];
  if (declarations(text, "--copilot-launcher-offset").length !== 1) problems.push("--copilot-launcher-offset is not declared once");
  if (declarations(text, "--copilot-launcher-size").length !== 1) problems.push("--copilot-launcher-size is not declared once");
  const rule = /\.copilot-launcher-clearance\s*\{([^}]*)\}/.exec(text);
  if (!rule) return [...problems, "no .copilot-launcher-clearance rule"];
  const padding = /padding-bottom\s*:\s*calc\(([^;]*)\)\s*;/.exec(rule[1]!)?.[1] ?? "";
  if (!/var\(--copilot-launcher-offset\)/.test(padding) || !/var\(--copilot-launcher-size\)/.test(padding) || !/\+\s*\d+(\.\d+)?rem/.test(padding)) {
    problems.push(`padding-bottom is not offset + size + a margin: "${padding}"`);
  }
  const at = rule.index;
  if (at < text.indexOf("@tailwind utilities")) problems.push("the rule is before @tailwind utilities");
  const lastLayer = text.lastIndexOf("@layer", at);
  if (lastLayer >= 0) {
    // Inside an @layer block when that block's braces have not closed before the rule.
    let depth = 0;
    for (let i = text.indexOf("{", lastLayer); i < at && i >= 0; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
      if (depth === 0) break;
    }
    if (depth > 0) problems.push("the rule sits inside an @layer");
  }
  return problems;
}

/** The launcher's class string, from the button that names itself "Open the copilot". */
function launcherClasses(source: string): string {
  const text = withoutComments(source);
  const at = text.indexOf('"Open the copilot"');
  const button = text.slice(text.lastIndexOf("<button", at), text.indexOf(">", text.indexOf("className=", at)));
  return /className=\{?`([^`]*)`|className="([^"]*)"/.exec(button)?.slice(1).find(Boolean) ?? "";
}

function launcherProblems(classes: string): string[] {
  const problems: string[] = [];
  if (!classes.includes("bottom-[calc(var(--copilot-launcher-offset)+var(--alarm-bar-h))]")) problems.push("bottom is not the offset over the alarm bar");
  if (!classes.includes("h-[var(--copilot-launcher-size)]") || !classes.includes("w-[var(--copilot-launcher-size)]")) problems.push("size is not the variable");
  if (/(^|\s)(h|w)-\d/.test(classes)) problems.push("a literal height or width");
  if (/bottom-\[calc\(\d/.test(classes)) problems.push("a literal bottom offset");
  return problems;
}

describe("F4.378 the page content clears the copilot launcher", () => {
  it("C1 index.css declares the two variables and the clearance after the utilities", () => {
    const css = read("index.css");
    expect(clearanceProblems(css)).toEqual([]);
    expect(declarations(css, "--copilot-launcher-offset")).toEqual(["2.5rem"]);
    expect(declarations(css, "--copilot-launcher-size")).toEqual(["3.5rem"]);
  });

  it("C1 the scan is live", () => {
    const good = "@tailwind utilities;\nbody { --copilot-launcher-offset: 2.5rem; --copilot-launcher-size: 3.5rem; }\n.copilot-launcher-clearance { padding-bottom: calc(var(--copilot-launcher-offset) + var(--copilot-launcher-size) + 1rem); }";
    expect(clearanceProblems(good)).toEqual([]);
    expect(clearanceProblems(good.replace(" + 1rem", "")), "no margin").not.toEqual([]);
    expect(clearanceProblems(good.replace("var(--copilot-launcher-size) + ", "")), "no size").not.toEqual([]);
    expect(clearanceProblems(good.replace(".copilot-launcher-clearance {", "@layer components { .copilot-launcher-clearance {") + "}"), "in a layer").not.toEqual([]);
    expect(clearanceProblems(`${good.replace("@tailwind utilities;", "")}\n@tailwind utilities;`), "before the utilities").not.toEqual([]);
  });

  it("C2 the launcher is placed and sized by the variables", () => {
    const classes = launcherClasses(read("components/copilot/copilot-dock.tsx"));
    expect(classes).toContain("fixed");
    expect(launcherProblems(classes)).toEqual([]);
    expect(launcherProblems("fixed bottom-[calc(2.5rem+var(--alarm-bar-h))] h-14 w-14"), "the old literals").not.toEqual([]);
  });

  it("C3 ShellMain's scroll container carries the clearance, and every copilot shell uses ShellMain", () => {
    const main = withoutComments(read("layouts/shells/shell-footer.tsx"));
    expect(main).toMatch(/className="[^"]*\boverflow-auto\b[^"]*\bcopilot-launcher-clearance\b[^"]*"|className="[^"]*\bcopilot-launcher-clearance\b[^"]*\boverflow-auto\b[^"]*"/);
    const shells = readdirSync(join(WEB_SRC, "layouts/shells")).filter((name) => /\.tsx$/.test(name) && !/\.(spec|test)\.tsx$/.test(name));
    const withDock = shells.filter((name) => withoutComments(read(`layouts/shells/${name}`)).includes("<CopilotDock"));
    expect(withDock.length, "the shells that mount the dock").toBeGreaterThan(0);
    for (const name of withDock) {
      expect(withoutComments(read(`layouts/shells/${name}`)), `${name} renders its pages in ShellMain`).toContain("<ShellMain");
    }
  });
});
