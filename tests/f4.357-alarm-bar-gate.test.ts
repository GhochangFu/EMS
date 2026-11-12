import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, withoutComments } from "./support/source-scan";

/**
 * `F4.357` (ADR 0130 decisions 1, 13, 19; plan D4, D10, D12) — the alarm bar's static gate. Inline
 * assertions (a top-level `tests/` file, AGENTS.md §4.6).
 *
 *  - **G1** `--alarm-bar-h` is declared exactly once in `index.css`, as `3rem`, and
 *    `ALARM_BAR_HEIGHT_PX` is its pixel twin (48 at the 16 px root): the page clearance, the
 *    Copilot offsets and the wall's fit (PR 4) read one height.
 *  - **G2** (decision 9, WCAG 2.3.1) the blink: `@keyframes alarm-bar-blink` sets only `opacity`; the
 *    animation is `alarm-bar-blink 1s step-end infinite` and sits only inside
 *    `@media (prefers-reduced-motion: no-preference)`; under `reduce` the class gets a static
 *    `double` outline instead. jsdom computes no media query and `javascript_tool` cannot switch
 *    one, so this static gate is where the reduced-motion claim is held.
 *  - **G3** (decision 9: "no design system may change, remove or add to this blink") no selector
 *    that names `data-design`, `data-profile`, `data-surface` or `data-theme` names `alarm-bar`.
 *  - **G4** the bar is mounted where the ADR puts it: `main.tsx` installs the one feed, `AppShell`
 *    and the control room wall (`WallFrame`, decision 12) render `<AlarmBar`, and no shell under
 *    `layouts/shells/` renders a second one.
 *
 * Every scan strips comments first, so a docblock that spells the call cannot pass the gate, and
 * each rule is also run on a mutated source to prove it can fail.
 */

const WEB_SRC = join(repoRoot, "apps/web/src");
const read = (path: string): string => readFileSync(join(WEB_SRC, path), "utf8");

/** Every `--alarm-bar-h:` declaration's value. */
function barHeightDeclarations(css: string): string[] {
  return [...withoutComments(css).matchAll(/--alarm-bar-h\s*:\s*([^;]+);/g)].map((match) => match[1]!.trim());
}

/**
 * `ALARM_BAR_HEIGHT_PX` as `lib/alarm-bar.ts` spells it. Read as text: importing the module would
 * pull `api/alarms.ts` (and `import.meta.env`) into the root `tsc -p tsconfig.typecheck-tests.json`.
 */
function barHeightPx(source: string): number | undefined {
  const match = /export const ALARM_BAR_HEIGHT_PX = (\d+);/.exec(withoutComments(source));
  return match ? Number(match[1]) : undefined;
}

const installsTheFeed = (source: string): boolean => /\binstallAlarmBarFeed\(/.test(withoutComments(source));
const rendersTheBar = (source: string): boolean => /<AlarmBar\b/.test(withoutComments(source));

/** Each top-level rule of `css` (comments stripped): `[prelude, body]`, at-rules with their nested body. */
function topLevelRules(css: string): [string, string][] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: [string, string][] = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "{") {
      if (depth === 0) open = i;
      depth += 1;
    } else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        out.push([source.slice(start, open).trim(), source.slice(open + 1, i)]);
        start = i + 1;
      }
    }
  }
  return out;
}

/** G2's rule over one stylesheet: the problems found, `[]` when the blink is as ruled. */
function blinkProblems(css: string): string[] {
  const rules = topLevelRules(css);
  const problems: string[] = [];
  const keyframes = rules.filter(([prelude]) => prelude === "@keyframes alarm-bar-blink");
  if (keyframes.length !== 1) problems.push(`${keyframes.length} @keyframes alarm-bar-blink`);
  for (const [, body] of keyframes) {
    const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    if (properties.some((p) => p !== "opacity")) problems.push(`the keyframe sets ${properties.join(", ")}`);
  }
  // Every rule that animates the blink, by name or on its class: a longhand counts too.
  const animated = rules.filter(
    ([prelude, body]) =>
      !prelude.startsWith("@keyframes") &&
      (/animation(-name)?\s*:[^;]*alarm-bar-blink/.test(body) || /\.alarm-bar-blink[^{]*\{[^}]*animation[a-z-]*\s*:/.test(`${prelude} {${body}}`)),
  );
  for (const [prelude, body] of animated) {
    if (prelude !== "@media (prefers-reduced-motion: no-preference)") problems.push(`the animation sits in "${prelude}"`);
    if (/animation-[a-z-]+\s*:/.test(body)) problems.push(`a longhand animation property in "${prelude}"`);
    const value = /animation\s*:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (value !== "alarm-bar-blink 1s step-end infinite") problems.push(`the animation is "${value}"`);
  }
  if (animated.length !== 1) problems.push(`${animated.length} rules animate alarm-bar-blink`);
  const reduce = rules.filter(([prelude]) => prelude === "@media (prefers-reduced-motion: reduce)");
  if (!reduce.some(([, body]) => /\.alarm-bar-blink\s*\{[^}]*outline\s*:[^;]*double/.test(body))) {
    problems.push("no double outline for .alarm-bar-blink under reduce");
  }
  return problems;
}

/** Every style rule's selector in `css`, at-rules entered at any depth (keyframe steps left out). */
function selectorsOf(css: string): string[] {
  return topLevelRules(css).flatMap(([prelude, body]) =>
    prelude.startsWith("@keyframes") ? [] : prelude.startsWith("@") ? selectorsOf(body) : [prelude],
  );
}

/** G3's rule: every selector that names a design attribute and the alarm bar or its blink marker. */
function designScopedBarSelectors(css: string): string[] {
  return selectorsOf(css).filter((selector) => /data-(design|profile|surface|theme)/.test(selector) && /alarm-bar|data-blink/.test(selector));
}

describe("F4.357 alarm bar gate (ADR 0130)", () => {
  it("G1 --alarm-bar-h is declared once, as 3rem, and ALARM_BAR_HEIGHT_PX is 48", () => {
    expect(barHeightDeclarations(read("index.css"))).toEqual(["3rem"]);
    expect(barHeightPx(read("lib/alarm-bar.ts"))).toBe(48);
    expect(barHeightPx("export const ALARM_BAR_HEIGHT_PX = 40;"), "the scan reads the value").toBe(40);
    expect(barHeightDeclarations("html { --alarm-bar-h: 3rem; } .x { --alarm-bar-h: 4rem; }"), "the scan sees a second one").toHaveLength(2);
    expect(barHeightDeclarations("/* --alarm-bar-h: 3rem; */"), "a comment is not a declaration").toEqual([]);
  });

  it("G2 the blink is an opacity step at 1 Hz, only without reduced motion; a double outline with it", () => {
    expect(blinkProblems(read("index.css"))).toEqual([]);
    const good = [
      "@keyframes alarm-bar-blink { 50% { opacity: 0.35; } }",
      "@media (prefers-reduced-motion: no-preference) { .alarm-bar-blink { animation: alarm-bar-blink 1s step-end infinite; } }",
      "@media (prefers-reduced-motion: reduce) { .alarm-bar-blink { outline: 3px double red; } }",
    ];
    expect(blinkProblems(good.join("\n")), "the scan passes the ruled form").toEqual([]);
    expect(blinkProblems(good.join("\n").replace("1s step-end", "0.25s step-end")), "four flashes a second").not.toEqual([]);
    expect(
      blinkProblems([good[0], ".alarm-bar-blink { animation: alarm-bar-blink 1s step-end infinite; }", good[2]].join("\n")),
      "the animation outside the media query",
    ).not.toEqual([]);
    expect(blinkProblems(good.join("\n").replace("opacity: 0.35", "background: red")), "a colour step").not.toEqual([]);
    expect(blinkProblems(`${good.join("\n")}\n.alarm-bar-blink { animation-duration: 0.25s; }`), "a longhand outside the query").not.toEqual([]);
    expect(blinkProblems(`${good.join("\n")}\n.x { animation-name: alarm-bar-blink; }`), "the name on another rule").not.toEqual([]);
  });

  it("G3 no design-system selector names the alarm bar", () => {
    expect(designScopedBarSelectors(read("index.css"))).toEqual([]);
    expect(designScopedBarSelectors('html[data-design="bento-ops"] .alarm-bar-blink { animation: none; }'), "the scan sees one").toHaveLength(1);
    expect(designScopedBarSelectors('html[data-design="bento-ops"] [data-blink="true"] { animation: none; }'), "by data-blink").toHaveLength(1);
    expect(
      designScopedBarSelectors('@supports (zoom: 1) { @media screen { html[data-theme="dark"] .alarm-bar-blink { opacity: 1; } } }'),
      "nested at-rules",
    ).toHaveLength(1);
  });

  it("G4 main.tsx installs the feed, AppShell renders the bar, no shell renders another", () => {
    expect(installsTheFeed(read("main.tsx")), "main.tsx calls installAlarmBarFeed(").toBe(true);
    expect(rendersTheBar(read("layouts/app-shell.tsx")), "app-shell.tsx renders <AlarmBar").toBe(true);
    // U9 (decision 12): the wall renders without AppShell, so it mounts its own.
    expect(rendersTheBar(read("components/control-room/wall-frame.tsx")), "wall-frame.tsx renders <AlarmBar").toBe(true);
    const shells = readdirSync(join(WEB_SRC, "layouts/shells")).filter((name) => name.endsWith(".tsx") && !name.includes(".spec") && !name.includes(".test"));
    expect(shells.length, "the shells directory holds the shells").toBeGreaterThan(1);
    for (const name of shells) {
      expect(rendersTheBar(read(`layouts/shells/${name}`)), `${name} renders no second bar`).toBe(false);
    }
    expect(installsTheFeed("/** installAlarmBarFeed(useAuthStore, ports) */"), "a docblock does not install").toBe(false);
    expect(rendersTheBar("// <AlarmBar />"), "a comment does not render").toBe(false);
  });
});
