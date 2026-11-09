import type { Crumb } from "../../lib/control-room-levels";
import { Breadcrumb } from "../breadcrumb";

type ControlRoomBreadcrumbProps = {
  crumbs: readonly Crumb[];
};

/**
 * `F3.66` (ADR 0076 decision 2, plan D2) — the Control Room levels above the
 * current page, from `controlRoomCrumbs`. Renders nothing for one crumb or
 * none: a skipped level carries no crumb, so a one-crumb trail names only the
 * page the user is already on. Since `F4.341` it renders through the one
 * `Breadcrumb` (ADR 0118 Amendment 1 A6).
 */
export function ControlRoomBreadcrumb({ crumbs }: ControlRoomBreadcrumbProps) {
  return <Breadcrumb steps={crumbs} />;
}
