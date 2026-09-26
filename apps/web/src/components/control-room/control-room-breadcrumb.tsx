import { Link } from "react-router-dom";

import type { Crumb } from "../../lib/control-room-levels";

type ControlRoomBreadcrumbProps = {
  crumbs: readonly Crumb[];
};

/**
 * `F3.66` (ADR 0076 decision 2, plan D2) — the Control Room levels above the
 * current page, from `controlRoomCrumbs`. Renders nothing for one crumb or
 * none: a skipped level carries no crumb, so a one-crumb trail names only the
 * page the user is already on. Markup follows `AdminBreadcrumb`; the last crumb
 * is text, every earlier crumb with a `to` is a link.
 */
export function ControlRoomBreadcrumb({ crumbs }: ControlRoomBreadcrumbProps) {
  if (crumbs.length <= 1) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-bms-muted">
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
          {index > 0 ? <span>/</span> : null}
          {crumb.to && index < crumbs.length - 1 ? (
            <Link to={crumb.to} className="font-semibold text-bms-green hover:underline">
              {crumb.label}
            </Link>
          ) : (
            <span className="font-semibold text-bms-ink">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
