import { WIDGET_POINT_CARDINALITY } from "./contracts/dashboard-builder";
import type {
  SectionTemplateWidget,
  TemplateWidgetResolutionDto,
  TemplateWidgetResolutionOutcome,
} from "./index";

/**
 * The pure half of section template instantiation — `F3.36` Part E4, ADR 0049
 * decisions 4 and 6 and **Amendment 2**.
 *
 * **Moved here from `DashboardTemplatesInstantiateService` by `F3.73` (plan
 * Task 2.2), byte for byte.** Two writers now plan template widgets: the group
 * instantiation and the site-layout copy (plan D6), and the seed makes copies
 * through the same planner (plan D12). One planner in the shared package is
 * what keeps the three from reporting the same widget three ways. The bodies of
 * `planTemplateWidget` and `outcomeOf` below are the service's `planWidget` and
 * `outcomeOf` with `this.` removed and nothing else — the docblocks and the
 * tie-break are the service's, and so is every correction they record.
 *
 * The type-only import back from `./index` is erased at emit, so there is no
 * runtime cycle — the `./ingest` precedent.
 */

export interface ResolvedMemberPoint {
  readonly pointId: string;
  /** The asset's `code`, which is what Amendment 2 decision 2's tie-break sorts
   * on. It held a uuid until the `F3.36` correctness review; see
   * `loadMembersByRole`. */
  readonly assetCode: string;
}

/** One member of the target group, carrying the column the tie-break needs. */
export interface GroupMember {
  readonly assetId: string;
  readonly code: string;
}

/** One widget's plan: what to insert, and the report entry that says what became of it. */
export interface TemplateWidgetPlan {
  widget: SectionTemplateWidget;
  points: ResolvedMemberPoint[];
  pointRole: string;
  resolution: TemplateWidgetResolutionDto;
}

/**
 * Resolve one widget's bindings, and say what became of them.
 *
 * **PER BINDING, then combined — and that is a correction.** The first version
 * summed across bindings and decided the outcome from the sums, which reported
 * a widget as `bound` when one of its roles matched nothing at all: a chart
 * binding `chiller/kVA` (three members, all resolving) and `cooling-tower/kW`
 * (no such member) summed to `matched 3, bound 3` and read as complete. That
 * is precisely the silent success Amendment 2 decision 1 exists to prevent,
 * and the widget then never appeared in the list decision 6 calls *"a page
 * that can list exactly which ones need it"*. Found by the `F3.36` correctness
 * review.
 *
 * Two further defects had the same root and are fixed here:
 *
 * - **`matchedMembers` double-counted.** Two bindings naming one role over
 *   three members reported six. The DTO says *"how many asset-group members
 *   the widget's roles matched"*, so it is the size of the UNION.
 * - **The tie-break was per binding.** Ordering was binding index first and
 *   `assets.code` second, so a `max = 1` widget naming two roles bound the
 *   first *binding's* first member. Amendment 2 decision 2 says the first
 *   member by `assets.code`, full stop — so the candidates are sorted
 *   globally before the cap is applied.
 */
export function planTemplateWidget(
  widget: SectionTemplateWidget,
  membersByRole: Map<string, GroupMember[]>,
  pointsByAsset: Map<string, string>,
): TemplateWidgetPlan {
  const cap = WIDGET_POINT_CARDINALITY[widget.widgetType].max;
  const assetRoleCodes = widget.bindings.map((binding) => binding.assetRoleCode);

  const matchedAssetIds = new Set<string>();
  const candidates: ResolvedMemberPoint[] = [];
  const seenPointIds = new Set<string>();
  /** Did EVERY binding resolve every member it matched? */
  let everyBindingWhole = true;

  for (const binding of widget.bindings) {
    const members = membersByRole.get(binding.assetRoleCode) ?? [];
    let resolvedForThisBinding = 0;

    for (const member of members) {
      matchedAssetIds.add(member.assetId);
      const pointId = pointsByAsset.get(`${member.assetId}::${binding.pointKey}`);
      if (!pointId) continue;
      resolvedForThisBinding += 1;
      // Two bindings can name the same (role, pointKey) pair, which would
      // insert one point twice and violate
      // `dashboard_widget_points_widget_point_role_key` — a 500 carrying a
      // constraint name. The contract refuses the duplicate at authoring
      // time; this makes the resolver idempotent regardless.
      if (seenPointIds.has(pointId)) continue;
      seenPointIds.add(pointId);
      candidates.push({ pointId, assetCode: member.code });
    }

    // A binding that matched members but resolved fewer points is short; a
    // binding that matched nothing at all is short by everything.
    if (resolvedForThisBinding < members.length || members.length === 0) {
      everyBindingWhole = false;
    }
  }

  // Amendment 2 decision 2's tie-break, applied to the whole candidate set
  // rather than within a binding. `assets.code` is NOT NULL UNIQUE, so this
  // is a total order and "the first" is a deterministic answer.
  candidates.sort((a, b) => a.assetCode.localeCompare(b.assetCode));
  const points = candidates.slice(0, cap);

  return {
    widget,
    points,
    pointRole: widget.bindings[0]?.pointRole ?? "primary",
    resolution: {
      widgetKey: widget.key,
      assetRoleCodes,
      matchedMembers: matchedAssetIds.size,
      boundPoints: points.length,
      outcome: outcomeOf({
        roleCount: assetRoleCodes.length,
        matchedMembers: matchedAssetIds.size,
        candidates: candidates.length,
        boundPoints: points.length,
        everyBindingWhole,
      }),
    },
  };
}

/**
 * The four outcomes of Amendment 2, in the order they are decided.
 *
 * A widget with no role bindings at all — a metric-catalog tile, which four of
 * Sheet 04's five Electrical KPI tiles are — is `bound`, not `unresolved`. It
 * asked for no role and got none, which is success; reporting it as a
 * shortfall would put an amber flag beside every correctly-bound tile and
 * teach the reader to ignore the report.
 */
function outcomeOf(counts: {
  roleCount: number;
  matchedMembers: number;
  candidates: number;
  boundPoints: number;
  /** False when ANY binding matched no members, or matched more members than
   * it could resolve points for. This is the input the summed version did not
   * have, and its absence is what let a widget with one dead role report
   * `bound`. */
  everyBindingWhole: boolean;
}): TemplateWidgetResolutionOutcome {
  // Asked for no role, got none. Success, and flagging it would put an amber
  // marker beside every correctly-bound metric tile.
  if (counts.roleCount === 0) return "bound";

  // No role matched anything at all.
  if (counts.matchedMembers === 0) return "unresolved";

  // The cap dropped points that HAD resolved. Ranked above `partial` because
  // the administrator's remedy differs: the widget cannot hold them all, so
  // the fix is another widget rather than another point. `matchedMembers` and
  // `boundPoints` still show the size of the gap either way.
  if (counts.boundPoints < counts.candidates) return "truncated";

  // Some binding came up short — either it matched members that carry no such
  // point, or it matched nothing while a sibling binding did.
  if (!counts.everyBindingWhole) return "partial";

  return "bound";
}
