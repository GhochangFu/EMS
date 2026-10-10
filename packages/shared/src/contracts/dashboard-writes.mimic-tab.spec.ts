import { expectRejectsAt } from "./dashboard-writes.spec";

import { putDashboardWidgetsBodySchema } from "./dashboard-writes";

/**
 * `F3.74` (plan D7, Task 2.3) — a mimic's config may name the tab it resolves through
 * (`tabKey`, both arms) and ask to be drawn compact (`compact`, the preset arm). A new sibling of
 * `dashboard-writes.spec.ts` (994 lines, plan D13); `dashboard-writes.mimic-tab.test.ts` is the
 * Vitest entry point (ADR 0014). Each claim parses the body and reads the parsed config back, so
 * a field the write surface stripped instead of keeping fails here too.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const LAYOUT_ID = "44444444-4444-4444-8444-444444444444";

const mimicWith = (config: Record<string, unknown>) => ({
  widgetType: "mimic" as const,
  title: "SLD",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 6,
  config,
  points: [],
  sources: [],
});

/** Parses one mimic widget and answers its parsed config, or throws naming the refusal. */
function parsedConfig(config: Record<string, unknown>, what: string): Record<string, unknown> {
  const result = putDashboardWidgetsBodySchema.safeParse({ widgets: [mimicWith(config)] });
  assert(result.success, `${what} — expected success, got ${JSON.stringify(result.error?.issues)}`);
  return (result.data?.widgets[0]?.config ?? {}) as Record<string, unknown>;
}

/** The preset arm keeps `tabKey`. */
export function thePresetArmKeepsTabKey(): void {
  const config = parsedConfig({ source: "preset", preset: "lv_single_line", tabKey: "sld" }, "preset + tabKey");
  assert(config.tabKey === "sld", `preset arm tabKey: expected "sld", got ${JSON.stringify(config.tabKey)}`);
}

/** The layout arm keeps `tabKey`. */
export function theLayoutArmKeepsTabKey(): void {
  const config = parsedConfig({ source: "layout", layoutId: LAYOUT_ID, tabKey: "sld" }, "layout + tabKey");
  assert(config.tabKey === "sld", `layout arm tabKey: expected "sld", got ${JSON.stringify(config.tabKey)}`);
}

/** The preset arm keeps `compact`. */
export function thePresetArmKeepsCompact(): void {
  const config = parsedConfig({ source: "preset", preset: "lv_single_line", compact: true }, "preset + compact");
  assert(config.compact === true, `preset arm compact: expected true, got ${JSON.stringify(config.compact)}`);
}

/** A `tabKey` that is not a tab key (uppercase) is refused at the field. */
export function aMalformedTabKeyIsRefused(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [mimicWith({ source: "preset", preset: "lv_single_line", tabKey: "SLD" })] },
    ["widgets", 0, "config", "tabKey"],
    [],
    "a tabKey outside the tab-key slug must be refused",
  );
}

/** An unknown key on the config is still refused: the arms stay `.strict()`. */
export function anUnknownConfigKeyIsRefused(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [mimicWith({ source: "preset", preset: "lv_single_line", tabKey: "sld", tab: "sld" })] },
    ["widgets", 0, "config"],
    ["tab"],
    "an unknown mimic config key must be refused",
  );
}

/** `compact` is the preset arm's: on the layout arm it is an unknown key. */
export function compactOnTheLayoutArmIsRefused(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [mimicWith({ source: "layout", layoutId: LAYOUT_ID, compact: true })] },
    ["widgets", 0, "config"],
    ["compact"],
    "compact on the layout arm must be refused",
  );
}
