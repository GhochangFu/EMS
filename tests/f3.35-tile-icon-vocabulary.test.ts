import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.35` Stage A (ADR 0048 decision 6) — the `value_tile` icon vocabulary and
 * its SVG path map are stated in two different files and must name the same
 * set both ways.
 *
 * Here rather than beside either file for the reason `adr-0025-level-selector.test.ts`
 * and `f3.35-aggregate-window-bounds.test.ts` give: this reads across
 * `packages/shared` and `apps/web`, and no app's Vitest project can see the
 * other. Per §4.6's carve-out, files in `tests/` hold their assertions inline.
 *
 * **What this guards, in each direction.** `widgetIconSchema` is what a saved
 * `value_tile` config is allowed to carry; `WIDGET_ICON_PATH` is what
 * `KpiTile` actually has a `d` attribute for. The two directions fail
 * differently and both are real:
 *
 * - a name in the enum with no entry in the map renders **nothing** — a
 *   blank square in front of an operator, with a green console, because
 *   `icon` parsed, saved and reached the renderer with no path to draw;
 * - an entry in the map with no name in the enum is dead code: no config can
 *   ever select it, because the write path refuses the name before it is
 *   stored.
 */
describe("F3.35 Stage A — the value_tile icon vocabulary", () => {
  /** The enum members, parsed from the contract that governs what a saved config may carry. */
  const enumMembers = (): string[] => {
    const block = /export const widgetIconSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(
      read("packages/shared/src/contracts/dashboard-builder.ts"),
    );
    if (!block) {
      throw new Error(
        "could not find widgetIconSchema's z.enum([...]) in dashboard-builder.ts. The " +
          "declaration's shape changed; update this parser rather than deleting the guard — a " +
          "guard that fails open on the edit it exists to catch is worse than none, because it " +
          "is also reassuring.",
      );
    }
    const members = [...(block[1] as string).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
    if (members.length === 0) {
      throw new Error(
        "widgetIconSchema's z.enum([...]) parsed to zero members. That is not a real state for " +
          "this vocabulary to be in — fix the parser, do not let this pass on an empty set.",
      );
    }
    return members;
  };

  /** `WIDGET_ICON_PATH`'s keys and values, parsed from the frontend catalog. */
  const iconPathEntries = (): Record<string, string> => {
    const block =
      /export const WIDGET_ICON_PATH: Readonly<Record<WidgetIcon, string>> = \{([\s\S]*?)\n\};/.exec(
        read("apps/web/src/lib/widget-catalog.ts"),
      );
    if (!block) {
      throw new Error(
        "could not find WIDGET_ICON_PATH's declaration in widget-catalog.ts. The declaration's " +
          "shape changed; update this parser rather than deleting the guard — a guard that fails " +
          "open on the edit it exists to catch is worse than none, because it is also reassuring.",
      );
    }
    const entries = [...(block[1] as string).matchAll(/(\w+):\s*"([^"]*)"/g)];
    if (entries.length === 0) {
      throw new Error(
        "WIDGET_ICON_PATH parsed to zero entries. That is not a real state for this map to be " +
          "in — fix the parser, do not let this pass on an empty set.",
      );
    }
    const out: Record<string, string> = {};
    for (const entry of entries) {
      out[entry[1] as string] = entry[2] as string;
    }
    return out;
  };

  it("names exactly the same icons the enum declares and the map defines, both directions", () => {
    const enumSet = new Set(enumMembers());
    const mapKeys = iconPathEntries();
    const mapSet = new Set(Object.keys(mapKeys));

    const missingFromMap = [...enumSet].filter((name) => !mapSet.has(name));
    const missingFromEnum = [...mapSet].filter((name) => !enumSet.has(name));

    expect(
      missingFromMap,
      "widgetIconSchema declares these names with no entry in WIDGET_ICON_PATH: " +
        `${missingFromMap.join(", ")}. A value_tile saved with one of these icons renders ` +
        "nothing — a blank square in front of an operator, with a green console, because the " +
        "name reached KpiTile with no `d` attribute to draw.",
    ).toEqual([]);

    expect(
      missingFromEnum,
      "WIDGET_ICON_PATH defines these keys with no matching member in widgetIconSchema: " +
        `${missingFromEnum.join(", ")}. No saved config can ever select one of these — the write ` +
        "path refuses the name before it is stored, so the path is dead code.",
    ).toEqual([]);
  });

  it("gives every path a non-empty `d` value that begins with a moveto command", () => {
    const entries = iconPathEntries();
    for (const [name, path] of Object.entries(entries)) {
      expect(path.length > 0, `WIDGET_ICON_PATH["${name}"] is an empty string`).toBe(true);
      expect(
        path.startsWith("M"),
        `WIDGET_ICON_PATH["${name}"] is "${path}", which does not start with "M" — an SVG \`d\` ` +
          "attribute with no leading moveto draws nothing.",
      ).toBe(true);
    }
  });
});
