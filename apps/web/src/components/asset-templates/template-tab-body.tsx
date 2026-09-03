import type { AdminAssetTemplateDto } from "@bms/shared";

import type { TemplateTabId } from "../../lib/template-tabs";
import { AlarmsTab } from "./alarms-tab";
import { CalculationsTab } from "./calculations-tab";
import { DashboardsTab } from "./dashboards-tab";
import { DetailsTab } from "./details-tab";
import { KpisTab } from "./kpis-tab";
import { PointsTab } from "./points-tab";

/**
 * Dispatches to one component per tab (Unit 9).
 *
 * **This function is the one file every sub-unit of Unit 9 must touch**, which
 * is why it became a real dispatcher with the first tab rather than waiting for
 * the last. The plan calls Unit 9 a fan-out point and says the five tabs are
 * "disjoint by construction"; they are not, because all five arrive here. With
 * the switch in place each tab was one arm plus its own new file.
 *
 * All five are built, and the last arm is an explicit comparison followed by an
 * exhaustiveness check rather than a bare fallback.
 *
 * **A bare fallback was written first, with a comment claiming a sixth tab
 * would fail to compile. It would not** — verified by widening
 * `TemplateTabId` and rebuilding: `tsc` exits 0 and the new tab silently
 * renders the Alarms editor. Narrowing to `"alarms" | "sixth"` is still
 * assignable to the fallback. The `never` assignment below is what makes the
 * claim true, and it is a compile-time complement to Unit 8's source scan:
 * that catches a change to the registry, this catches a change to the type.
 *
 * **It moved out of `asset-template-detail-page.tsx` in `F2.14`, because it now
 * serves two pages** — that authoring page and the read-only stock catalog
 * viewer (`asset-template-stock-view-page.tsx`). One file rather than two is
 * what keeps the six-arm dispatcher and its `const unreachable: never = tab`
 * in a single place; a copy in the viewer would put the exhaustiveness guard
 * in two, and the two would drift on the day a seventh tab lands.
 */
export function TemplateTabBody({
  tab,
  template,
  editable,
  onSaved,
  onDirtyChange,
}: {
  tab: TemplateTabId;
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  /**
   * Reported by the open tab whenever its form stops matching what is stored.
   * Required, not optional — a tab that forgot to report would silently lose
   * edits again, and an optional prop makes that omission compile.
   */
  onDirtyChange: (dirty: boolean) => void;
}) {
  if (tab === "details") {
    return (
      <DetailsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "points") {
    return (
      <PointsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "calculations") {
    return (
      <CalculationsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "kpis") {
    return (
      <KpisTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "alarms") {
    return (
      <AlarmsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  if (tab === "dashboards") {
    return (
      <DashboardsTab
        template={template}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  // Unreachable while `TemplateTabId` names six tabs. Adding a seventh without
  // an arm here is a type error on this line, naming the tab that has no
  // editor — rather than a silent render of whichever arm came last.
  const unreachable: never = tab;
  return (
    <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
      The {String(unreachable)} editor is not wired up yet.
    </p>
  );
}
