/**
 * The Asset Templates list page's own tab registry (`F2.21` part 1).
 *
 * This is **not** `template-tabs.ts`. That one is the *detail* page's seven
 * authoring tabs, is fixed by ADR 0038 decision 2, and is scanned as source
 * text by `tests/adr-0038-template-authoring-ui.test.ts`. That scan is
 * path-scoped to `apps/web/src/lib/template-tabs.ts`, which is what makes a
 * second registry in this directory safe — an `id: "templates"` here is not an
 * eighth authoring tab. Do not merge the two files.
 *
 * ## Why a tab strip at all
 *
 * `asset-templates-page.tsx` stacked two `SectionCard`s, Templates then Stock
 * catalog, and the owner's report on 2026-09-04 was that the catalog is "very
 * hard and not user friendly for the users to find ... beneath this". Stacking
 * makes the second list's reachability a function of how long the first one is,
 * and the first one grows without limit. Tabs make them peers, so neither can
 * bury the other.
 *
 * Kept pure and in `lib/` for the reason `vocabulary.ts` records — `apps/web`'s
 * Vitest project runs `environment: "node"` over `src/**\/*.test.ts`, so a
 * `.tsx` is unreachable by any test here, and the coverage gate's `include`
 * reaches `apps/web/src/lib/**` and nothing above it. `resolveAssetTemplatesPageTab`
 * is a real rule with a real fallback, so it has to be somewhere a test can see
 * it. The strip stays a `.tsx` and holds no logic.
 */

/** The two lists this page shows, and the only two. */
export type AssetTemplatesPageTabId = "templates" | "stock";

export type AssetTemplatesPageTab = {
  id: AssetTemplatesPageTabId;
  label: string;
  /** One line under the strip, saying what this list holds. */
  hint: string;
  /**
   * `true` when the tab is only for a user who may author templates.
   *
   * Declared here rather than tested at the call site, because the resolver
   * below has to know it — see its docblock for what the flag actually
   * protects against, which is a page with no list on it rather than any
   * server-side refusal.
   */
  authorOnly: boolean;
};

export const ASSET_TEMPLATES_PAGE_TABS: readonly AssetTemplatesPageTab[] = [
  {
    id: "templates",
    label: "Templates",
    hint: "The templates this organization owns, newest version first.",
    authorOnly: false,
  },
  {
    id: "stock",
    label: "Stock catalog",
    hint: "Repository class templates every organization can import (ADR 0052).",
    authorOnly: true,
  },
];

/** The tab a bare `/admin/asset-templates` opens. */
export const DEFAULT_ASSET_TEMPLATES_PAGE_TAB: AssetTemplatesPageTabId = "templates";

/**
 * Resolves a `?tab=` value to a tab id, given what the viewer may do.
 *
 * Two fallbacks, and they are different failures:
 *
 * - **Unknown or absent** — a typo, a stale bookmark, or a tab that existed in
 *   an earlier version. Falls back to Templates, because a page that renders no
 *   list at all reads as broken rather than as a bad link. Same reasoning as
 *   `resolveTemplateTab`.
 * - **Known but not permitted** — someone following an author's link to
 *   `?tab=stock` who may not author. Also falls back to Templates.
 *
 * ## What the second fallback is, and is not
 *
 * **It is not a security control, and the trust boundary is the opposite way
 * round from the obvious guess.** `admin-route.tsx` admits `admin`,
 * `organization_admin` and `location_admin` to this page. Of those exactly one
 * has `mayAuthor` false — `location_admin`, because `canAuthorTemplates` is
 * `isMasterDataAdmin(role) && role !== "location_admin"` (ADR 0015 §7: import
 * is an authoring act). And `location_admin` is a role the SERVER permits to
 * list the catalog: `assertCanList` calls `requireMasterDataUser`, and
 * `isMasterDataRole` includes it.
 *
 * So the client here is deliberately **stricter** than the server. `viewer` and
 * `operator`, whom the server does refuse, never reach this page at all, so
 * this branch never runs for them.
 *
 * What it prevents is a **page with no list on it**. Both cards are guarded —
 * Templates on `tab === "templates"`, stock on `tab === "stock" && mayAuthor` —
 * so a `location_admin` landing on `stock` with no fallback would see a tab
 * strip and nothing else. (An earlier version of this comment said "a card that
 * never stops loading". That needs `stockQ.isPending` to render, and the page's
 * own second guard makes it unreachable. Corrected rather than left standing.)
 *
 * Because it is not a security control, `stockQ`'s `enabled: mayAuthor` and the
 * page's own `&& mayAuthor` are kept as well: client-side policy that stops the
 * request being made, not the thing that makes it safe.
 *
 * `mayAuthor` is passed in rather than read here, because this module is pure
 * and the permission comes from `canAuthorTemplates(user.role)`.
 */
export function resolveAssetTemplatesPageTab(
  value: string | undefined | null,
  mayAuthor: boolean,
): AssetTemplatesPageTabId {
  const match = ASSET_TEMPLATES_PAGE_TABS.find((tab) => tab.id === value);
  if (!match || (match.authorOnly && !mayAuthor)) {
    return DEFAULT_ASSET_TEMPLATES_PAGE_TAB;
  }
  return match.id;
}

/** The tabs a given viewer may actually open — the strip renders exactly these. */
export function visibleAssetTemplatesPageTabs(
  mayAuthor: boolean,
): readonly AssetTemplatesPageTab[] {
  return ASSET_TEMPLATES_PAGE_TABS.filter((tab) => mayAuthor || !tab.authorOnly);
}
