/**
 * The list page's tab registry and its resolver (`F2.21` part 1).
 *
 * The resolver has two distinct fallbacks and they fail for different reasons,
 * so each is pinned separately. The permission one prevents a page with NO list
 * on it: both cards are guarded, so a `location_admin` landing on `?tab=stock`
 * without the fallback would see a tab strip and nothing else. It is not a
 * security control — the server permits that role to list the catalog, and the
 * client is deliberately stricter. See the resolver's own docblock.
 */
import {
  ASSET_TEMPLATES_PAGE_TABS,
  DEFAULT_ASSET_TEMPLATES_PAGE_TAB,
  resolveAssetTemplatesPageTab,
  visibleAssetTemplatesPageTabs,
} from "./asset-templates-page-tabs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Two tabs, Templates first, and only the stock one is author-gated. */
export function runRegistryShapeTests(): void {
  assert(
    ASSET_TEMPLATES_PAGE_TABS.length === 2,
    `the page shows two lists, got ${ASSET_TEMPLATES_PAGE_TABS.length}`,
  );
  assert(
    ASSET_TEMPLATES_PAGE_TABS.map((tab) => tab.id).join(",") === "templates,stock",
    `the registry drifted — got ${ASSET_TEMPLATES_PAGE_TABS.map((tab) => tab.id).join(",")}`,
  );
  // Templates first is not decoration: it is the default, so a strip that
  // rendered stock first would put the default tab second.
  assert(
    ASSET_TEMPLATES_PAGE_TABS[0].id === DEFAULT_ASSET_TEMPLATES_PAGE_TAB,
    "the default tab must be the first one the strip renders",
  );
  assert(
    ASSET_TEMPLATES_PAGE_TABS.filter((tab) => tab.authorOnly).map((tab) => tab.id).join(",") ===
      "stock",
    "only the stock catalog is author-gated",
  );
  assert(
    ASSET_TEMPLATES_PAGE_TABS.every((tab) => tab.label.length > 0 && tab.hint.length > 0),
    "every tab needs a label and a hint",
  );
}

/** A known, permitted value resolves to itself. */
export function runResolvesKnownValueTests(): void {
  assert(
    resolveAssetTemplatesPageTab("stock", true) === "stock",
    "an author asking for the stock tab should get it",
  );
  assert(
    resolveAssetTemplatesPageTab("templates", true) === "templates",
    "the templates tab resolves to itself",
  );
  assert(
    resolveAssetTemplatesPageTab("templates", false) === "templates",
    "the templates tab is not author-gated",
  );
}

/** Anything unrecognised falls back rather than rendering no list. */
export function runUnknownValueFallsBackTests(): void {
  for (const value of ["", "STOCK", "stocks", "details", "../stock", "0"]) {
    assert(
      resolveAssetTemplatesPageTab(value, true) === DEFAULT_ASSET_TEMPLATES_PAGE_TAB,
      `"${value}" is not a tab id and must fall back to Templates`,
    );
  }
  assert(
    resolveAssetTemplatesPageTab(undefined, true) === DEFAULT_ASSET_TEMPLATES_PAGE_TAB,
    "a bare URL opens Templates",
  );
  assert(
    resolveAssetTemplatesPageTab(null, true) === DEFAULT_ASSET_TEMPLATES_PAGE_TAB,
    "`searchParams.get` returns null when the key is absent",
  );
}

/**
 * A viewer following an author's `?tab=stock` link lands on Templates.
 *
 * Checked in BOTH directions on the same value, because "always returns
 * templates" would pass a one-sided version of this test: the same input with
 * `mayAuthor` true must still resolve to `stock`.
 */
export function runAuthorOnlyTabFallsBackForViewerTests(): void {
  assert(
    resolveAssetTemplatesPageTab("stock", false) === "templates",
    "a viewer must not land on a tab whose data they cannot fetch",
  );
  assert(
    resolveAssetTemplatesPageTab("stock", true) === "stock",
    "the same value must still resolve for an author, or the fallback is unconditional",
  );
}

/** The strip renders only what the viewer may open. */
export function runVisibleTabsTests(): void {
  assert(
    visibleAssetTemplatesPageTabs(true).map((tab) => tab.id).join(",") === "templates,stock",
    "an author sees both tabs",
  );
  assert(
    visibleAssetTemplatesPageTabs(false).map((tab) => tab.id).join(",") === "templates",
    "a viewer sees only the templates tab",
  );
  // The resolver and the strip must not disagree: every visible tab must
  // resolve to itself, or the strip would render a tab that bounces on click.
  for (const mayAuthor of [true, false]) {
    for (const tab of visibleAssetTemplatesPageTabs(mayAuthor)) {
      assert(
        resolveAssetTemplatesPageTab(tab.id, mayAuthor) === tab.id,
        `${tab.id} is rendered for mayAuthor=${mayAuthor} but does not resolve to itself`,
      );
    }
  }
}
