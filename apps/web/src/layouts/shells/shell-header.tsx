import { useState } from "react";
import { Link } from "react-router-dom";

import { MyAppearanceDialog } from "../../components/appearance/appearance-dialogs";

import { isMasterDataAdmin } from "../../lib/admin-access";
import { roleLabel } from "../../lib/role-label";
import type { AuthUser } from "../../stores/auth-store";
import { SurfaceSwitch } from "../../components/surface-switch";
import { ThemeSwitch } from "../../components/theme-switch";
import { Wordmark } from "../../components/wordmark";
import { SETTINGS_LOCKED_REASON, topNav } from "./navigation-model";

/**
 * `F4.341` PR 5 — the chrome header every shell carries (the wordmark, ADR 0083, the user, the
 * theme and surface switches, logout), moved verbatim from `app-shell.tsx`.
 */
export function ShellHeader({
  user,
  locationScopeLabel,
  onLogout,
}: {
  user: AuthUser;
  locationScopeLabel: string;
  onLogout: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between bg-chrome px-4 text-sm text-on-dark">
      <div className="flex items-center gap-3">
        <Wordmark variant="header" />
        <span className="hidden text-on-dark/70 sm:inline">
          Integrated Building, Energy, Water & Utility Management Platform
        </span>
      </div>
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
    </header>
  );
}

/**
 * `F4.341` PR 12 (ADR 0118 decision 11) — the user's own Appearance chooser, in every shell's header.
 */
export function AppearanceButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="rounded border border-on-dark/20 px-3 py-1.5 text-xs font-semibold text-on-dark/85 transition hover:border-on-dark/40 hover:bg-on-dark/10 hover:text-on-dark"
        onClick={() => setOpen(true)}
      >
        Appearance
      </button>
      {open ? <MyAppearanceDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
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
