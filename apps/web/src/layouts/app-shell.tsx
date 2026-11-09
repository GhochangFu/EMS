import { SHELL_OF_DESIGN } from "../lib/design";
import { useDesignSystem } from "../stores/theme-store";
import { RailShell } from "./shells/rail-shell";
import type { AppShellProps } from "./shells/shell-props";
import { SidebarShell } from "./shells/sidebar-shell";
import { TopbarShell } from "./shells/topbar-shell";

/*
 * `F4.341` PR 5 (ADR 0118 decision 6) — the app shell is a selector over three shells that share
 * one navigation model (`shells/navigation-model.ts`): the effective design system picks
 * `sidebar`, `topbar` or `rail` (`SHELL_OF_DESIGN`). The names other files import from here are
 * re-exported unchanged.
 */
export {
  COLLAPSED_LABEL_OVERRIDES,
  SETTINGS_LOCKED_REASON,
  SHELL_RAIL_MAX_WIDTH,
  collapsedRailEntries,
  type CollapsedRailEntry,
} from "./shells/navigation-model";

const SHELLS = { sidebar: SidebarShell, topbar: TopbarShell, rail: RailShell } as const;

export function AppShell(props: AppShellProps) {
  const Shell = SHELLS[SHELL_OF_DESIGN[useDesignSystem()]];
  return <Shell {...props} />;
}
