import { useCallback, useState } from "react";
import { createPortal } from "react-dom";

import { AlarmBar } from "../components/alarm-bar/alarm-bar";
import { SHELL_OF_DESIGN } from "../lib/design";
import { useShownDesignSystem } from "../stores/theme-store";
import { RailShell } from "./shells/rail-shell";
import { MyAppearanceDialogHost } from "./shells/shell-header";
import type { AppShellProps } from "./shells/shell-props";
import { SidebarShell } from "./shells/sidebar-shell";

/*
 * `F4.341` PR 5 (ADR 0118 decision 6) — the app shell is a selector over the shells that share one
 * navigation model (`shells/navigation-model.ts`). `F4.346` (Amendment 3 decisions 1 and 3): two
 * shells, `sidebar` and `rail` (`SHELL_OF_DESIGN`), chosen from the design system the page shows —
 * the Appearance panel's preview while there is one, else the saved value. The names other files
 * import from here are re-exported unchanged.
 */
export {
  NAV_ICONS,
  SETTINGS_LOCKED_REASON,
  SHELL_RAIL_MAX_WIDTH,
  navIconEntries,
  type NavIconEntry,
} from "./shells/navigation-model";

const SHELLS = { sidebar: SidebarShell, rail: RailShell } as const;

/**
 * `F4.346` (Amendment 3 decision 3) — a preview that changes the shell swaps the shell component,
 * which would unmount the page under it, and with it an Appearance panel whose unmount ends the
 * preview. So the page body is rendered once, through a portal into one element that each shell's
 * body slot adopts, and keeps its React position (and state) across a swap. The user's own
 * Appearance dialog is hosted here, beside the shell, for the same reason.
 */
export function AppShell({ children, ...props }: AppShellProps) {
  const Shell = SHELLS[SHELL_OF_DESIGN[useShownDesignSystem()]];
  const [body] = useState(() => {
    const node = document.createElement("div");
    node.className = "contents";
    return node;
  });
  return (
    <>
      <Shell {...props}>
        <ShellBodySlot body={body} />
      </Shell>
      {createPortal(children, body)}
      <MyAppearanceDialogHost />
      {/* F4.357 (ADR 0130 decision 1): the alarm bar, in both shells and every design system. */}
      <AlarmBar />
    </>
  );
}

/** Adopts the page body element into the current shell's body area. */
function ShellBodySlot({ body }: { body: HTMLElement }) {
  const adopt = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot !== null && body.parentNode !== slot) slot.appendChild(body);
    },
    [body],
  );
  return <div ref={adopt} className="contents" />;
}
