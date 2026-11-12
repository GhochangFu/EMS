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
 *  - **G4** the bar is mounted where the ADR puts it: `main.tsx` installs the one feed, `AppShell`
 *    renders `<AlarmBar`, and no shell under `layouts/shells/` renders a second one.
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

describe("F4.357 alarm bar gate (ADR 0130)", () => {
  it("G1 --alarm-bar-h is declared once, as 3rem, and ALARM_BAR_HEIGHT_PX is 48", () => {
    expect(barHeightDeclarations(read("index.css"))).toEqual(["3rem"]);
    expect(barHeightPx(read("lib/alarm-bar.ts"))).toBe(48);
    expect(barHeightPx("export const ALARM_BAR_HEIGHT_PX = 40;"), "the scan reads the value").toBe(40);
    expect(barHeightDeclarations("html { --alarm-bar-h: 3rem; } .x { --alarm-bar-h: 4rem; }"), "the scan sees a second one").toHaveLength(2);
    expect(barHeightDeclarations("/* --alarm-bar-h: 3rem; */"), "a comment is not a declaration").toEqual([]);
  });

  it("G4 main.tsx installs the feed, AppShell renders the bar, no shell renders another", () => {
    expect(installsTheFeed(read("main.tsx")), "main.tsx calls installAlarmBarFeed(").toBe(true);
    expect(rendersTheBar(read("layouts/app-shell.tsx")), "app-shell.tsx renders <AlarmBar").toBe(true);
    const shells = readdirSync(join(WEB_SRC, "layouts/shells")).filter((name) => name.endsWith(".tsx") && !name.includes(".spec") && !name.includes(".test"));
    expect(shells.length, "the shells directory holds the shells").toBeGreaterThan(1);
    for (const name of shells) {
      expect(rendersTheBar(read(`layouts/shells/${name}`)), `${name} renders no second bar`).toBe(false);
    }
    expect(installsTheFeed("/** installAlarmBarFeed(useAuthStore, ports) */"), "a docblock does not install").toBe(false);
    expect(rendersTheBar("// <AlarmBar />"), "a comment does not render").toBe(false);
  });
});
