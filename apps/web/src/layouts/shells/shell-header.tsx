import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { create } from "zustand";

import { MyAppearanceDialog } from "../../components/appearance/appearance-dialogs";

import { isMasterDataAdmin } from "../../lib/admin-access";
import { roleLabel } from "../../lib/role-label";
import type { AuthUser } from "../../stores/auth-store";
import { SurfaceSwitch } from "../../components/surface-switch";
import { ThemeSwitch } from "../../components/theme-switch";
import { Wordmark } from "../../components/wordmark";
import { SETTINGS_LOCKED_REASON, SHELL_RAIL_MAX_WIDTH, topNav, useOverlayClosesOnNavigation } from "./navigation-model";

/**
 * `F4.347` — the widest viewport, in px, on which the sidebar shell's header folds the user, the
 * switches, Appearance and Logout into one menu. Above it, the controls fit in one row (measured on
 * AWS 2026-11-10: 493 px of controls beside a 57 px wordmark).
 */
export const HEADER_FOLD_MAX_WIDTH = SHELL_RAIL_MAX_WIDTH;

/**
 * `F4.347` — the same for the rail shell, whose header also carries the status strip and the user
 * on one line: they need about 1,150 px, so the rail folds below `xl`.
 */
export const RAIL_HEADER_FOLD_MAX_WIDTH = 1279;

const HEADER_BUTTON =
  "rounded border border-on-dark/20 px-3 py-1.5 text-xs font-semibold text-on-dark/85 transition hover:border-on-dark/40 hover:bg-on-dark/10 hover:text-on-dark";

/**
 * `F4.341` PR 5 — the chrome header every shell carries (the wordmark, ADR 0083, the user, the
 * theme and surface switches, logout), moved verbatim from `app-shell.tsx`.
 */
export function ShellHeader({
  user,
  locationScopeLabel,
  onLogout,
  viewportWidth,
  pathname,
}: {
  user: AuthUser;
  locationScopeLabel: string;
  onLogout: () => void;
  viewportWidth: number;
  pathname: string;
}) {
  const folded = viewportWidth <= HEADER_FOLD_MAX_WIDTH;
  return (
    <header className="flex h-12 shrink-0 items-center justify-between bg-chrome px-4 text-sm text-on-dark">
      <div className="flex items-center gap-3">
        <Wordmark variant="header" />
        {/* F4.347 — the subtitle needs about 430 px; below `xl` it would push the controls off. */}
        <span className="hidden text-on-dark/70 xl:inline">
          Integrated Building, Energy, Water & Utility Management Platform
        </span>
      </div>
      {folded ? (
        <HeaderMenu user={user} locationScopeLabel={locationScopeLabel} onLogout={onLogout} pathname={pathname} />
      ) : (
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="font-medium">{user.displayName}</div>
          <div className="text-xs text-on-dark/60">
            {roleLabel(user.role)} · {locationScopeLabel}
          </div>
        </div>
        <ThemeSwitch />
        <SurfaceSwitch />
        <AppearanceButton />
        <button
          type="button"
          className="rounded border border-on-dark/20 px-3 py-1.5 text-xs font-semibold text-on-dark/85 transition hover:border-on-dark/40 hover:bg-on-dark/10 hover:text-on-dark"
          onClick={onLogout}
        >
          Logout
        </button>
      </div>
      )}
    </header>
  );
}

/**
 * `F4.347` — on a narrow viewport the header's user, Theme, Surface, Appearance and Logout fold
 * into one Menu button, so the header never runs past the screen. The panel opens below the
 * header; Escape, a press outside it, Appearance and a move to another page close it. `status`
 * lets the rail shell move its status strip into the panel as well.
 */
export function HeaderMenu({
  user,
  locationScopeLabel,
  onLogout,
  pathname,
  status,
}: {
  user: AuthUser;
  locationScopeLabel: string;
  onLogout: () => void;
  pathname: string;
  status?: ReactNode;
}) {
  const [open, setOpen] = useOverlayClosesOnNavigation(pathname);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(() => false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(() => false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen]);
  return (
    <div ref={root} className="relative" data-testid="header-menu">
      <button
        type="button"
        className={HEADER_BUTTON}
        aria-expanded={open}
        aria-controls="shell-header-menu"
        onClick={() => setOpen((was) => !was)}
      >
        Menu
      </button>
      {open ? (
        <div
          id="shell-header-menu"
          role="group"
          aria-label="Account and display"
          className="absolute right-0 top-full z-40 mt-2 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded border border-on-dark/20 bg-chrome p-3 text-sm text-on-dark shadow-lg"
        >
          {status ? <div className="text-xs text-on-dark/80">{status}</div> : null}
          <div>
            <div className="font-medium">{user.displayName}</div>
            <div className="text-xs text-on-dark/60">
              {roleLabel(user.role)} · {locationScopeLabel}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSwitch />
            <SurfaceSwitch />
          </div>
          <AppearanceButton onOpen={() => setOpen(() => false)} />
          <button type="button" className={HEADER_BUTTON} onClick={onLogout}>
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * `F4.346` (ADR 0118 Amendment 3 decision 3) — whether the user's own Appearance dialog is open. It
 * is held outside the shells: a preview that changes the shell swaps the shell component, and a
 * dialog inside the old shell would unmount and end the preview it started.
 */
const useMyAppearanceDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/**
 * `F4.341` PR 12 (ADR 0118 decision 11) — the user's own Appearance chooser, in every shell's header.
 * The dialog itself is rendered by {@link MyAppearanceDialogHost}, outside the shell (`F4.346`).
 */
export function AppearanceButton({ onOpen }: { onOpen?: () => void } = {}) {
  const setOpen = useMyAppearanceDialog((s) => s.setOpen);
  return (
    <button
      type="button"
      className="rounded border border-on-dark/20 px-3 py-1.5 text-xs font-semibold text-on-dark/85 transition hover:border-on-dark/40 hover:bg-on-dark/10 hover:text-on-dark"
      onClick={() => {
        setOpen(true);
        onOpen?.();
      }}
    >
      Appearance
    </button>
  );
}

/** `F4.346` — the user's own Appearance dialog, rendered by `AppShell` beside the shell. */
export function MyAppearanceDialogHost() {
  const { open, setOpen } = useMyAppearanceDialog();
  return open ? <MyAppearanceDialog onClose={() => setOpen(false)} /> : null;
}

/** The top navigation bar (Overview, Sites, Energy, Settings), moved verbatim from `app-shell.tsx`. */
export function ShellTopNav({ user, pathname }: { user: AuthUser; pathname: string }) {
  return (
    <nav className="flex h-10 shrink-0 items-center gap-1 bg-chrome-nav px-2 text-sm font-medium text-on-dark shadow-sm">
      {topNav.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={`rounded px-3 py-1.5 hover:bg-on-dark/10 ${
            pathname === item.to ? "bg-on-dark/15" : ""
          }`}
        >
          {item.label}
        </Link>
      ))}
      {isMasterDataAdmin(user.role) ? (
        <Link
          to="/admin"
          className={`rounded px-3 py-1.5 hover:bg-on-dark/10 ${
            pathname.startsWith("/admin") ? "bg-on-dark/15" : ""
          }`}
        >
          Settings
        </Link>
      ) : (
        <>
          {/* F4.164 D2 — not `DisabledCommandButton`: it sets native `disabled` (not focusable),
              has no slot for the reason, and its palette is for light surfaces. */}
          <button
            type="button"
            aria-disabled="true"
            aria-describedby="settings-locked-reason"
            title={SETTINGS_LOCKED_REASON}
            onClick={(e) => e.preventDefault()}
            className="ml-1 cursor-not-allowed rounded px-3 py-1.5 text-on-dark/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-dark/80"
          >
            Settings
          </button>
          <span id="settings-locked-reason" className="sr-only">
            {SETTINGS_LOCKED_REASON}
          </span>
        </>
      )}
    </nav>
  );
}
