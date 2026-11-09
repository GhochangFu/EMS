import type { ReactNode } from "react";

import type { AuthUser } from "../../stores/auth-store";

/** `F4.341` PR 5 — the props every shell takes (they were `AppShell`'s). */
export type AppShellProps = {
  user: AuthUser;
  children: ReactNode;
  /**
   * Breadcrumb/KPI strip above the page body, matching the mockups' ribbon row
   * (`TRINETRA.html` `shell(...)` second argument). Required: every screen the
   * shell renders is post-authentication, so there is no state in which the
   * strip has nothing to say.
   */
  kpiRibbon: ReactNode;
};
