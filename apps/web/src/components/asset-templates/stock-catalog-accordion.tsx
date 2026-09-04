/**
 * The Stock catalog card's domain accordion (`F2.17`).
 *
 * AGENTS.md §5 is discharged for this component: neither `ESKOM_SMOC.html`
 * nor `TRINETRA.html` carries a master-data or stock-catalog screen, and
 * neither holds an accordion idiom at all. §9.3 therefore applies — the shape
 * comes from the existing in-repo component, `org-location-accordion.tsx`,
 * with the heading line following the mockups' card-header-with-count shape
 * (`Assets · NAM Region` above `N devices`).
 *
 * ## Four deliberate differences from `org-location-accordion.tsx`
 *
 * 1. **No `useEffect` that resets the open set when `groups` changes.** That
 *    component has one, and copying it here would be a defect: TanStack Query
 *    hands back a NEW array on every refetch — and the catalog card refetches
 *    on every import, because `importM.onSuccess` invalidates
 *    `["admin", "asset-templates"]`. The effect would therefore wipe the
 *    viewer's collapse the moment they imported anything. The set is seeded
 *    from storage ONCE, in a lazy `useState` initializer, and changes only on
 *    a click.
 *
 * 2. **The header is one line in one text node.** `org-location-accordion`
 *    stacks a title over a summary line, which makes the button's accessible
 *    name the concatenation of both. Here the name is exactly
 *    `"<label> · <n> entries"`, so a spec can assert it as a string rather
 *    than a fragment — and the singular is real: one entry reads "1 entry".
 *
 * 3. **The panel is a `<ul>` of the caller's rows**, not a card grid, and it
 *    keeps `divide-y divide-gray-100` so the row separators the flat list had
 *    survive the grouping. It carries `aria-label` so one group's rows can be
 *    addressed without counting lists — the templates card above renders
 *    `<ul>`s of its own.
 *
 * 4. **No empty state.** Zero groups returns `null`; the page already renders
 *    "The stock catalog is empty — nothing to import." A second sentence
 *    saying the same thing in different words would be worse than none.
 *
 * ## Why the rows come in as a render prop
 *
 * `renderEntry` is not a style choice. `tests/f2.14-stock-viewer-reachable
 * .test.ts:87-94` reads `asset-templates-page.tsx` AS TEXT and requires the
 * literal ``<Link to={`/admin/asset-templates/stock/`` to stay in that file —
 * a registered route nothing links to is reachable only by typing the URL.
 * Lifting the `<li>` body in here would turn that guard red by design, so the
 * page keeps its own row markup and this component owns only the grouping.
 *
 * ## Storage
 *
 * The thunk `() => window.localStorage` is passed to
 * `stock-catalog-collapse.ts`, never a `Storage` instance: the ACCESS to
 * `window.localStorage` can itself throw, and evaluating the thunk inside
 * that module's `try` is what covers it. No `typeof window` guard here — that
 * would be a second, weaker copy of a check that already lives one layer
 * down.
 *
 * The write sits inside the state updater, as `app-shell.tsx:146-152` does
 * for the sidebar. React may invoke an updater twice under StrictMode; this
 * one is idempotent, because it writes the set it just computed.
 */
import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import type { StockAssetTemplateDto } from "@bms/shared";

import {
  readCollapsedDomains,
  writeCollapsedDomains,
} from "../../lib/stock-catalog-collapse";
import type { StockCatalogGroup } from "../../lib/stock-catalog-groups";

type StockCatalogAccordionProps = {
  groups: readonly StockCatalogGroup[];
  /** The row for one entry — a `<li>`. The accordion keys it by `entry.code`. */
  renderEntry: (entry: StockAssetTemplateDto) => ReactNode;
};

/** The stock catalog grouped under one collapsible heading per domain. */
export function StockCatalogAccordion({ groups, renderEntry }: StockCatalogAccordionProps) {
  // The stored set is the COLLAPSED one, so a domain this build has never
  // seen — the next domain pack's — arrives open with no migration.
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(
    () => new Set(readCollapsedDomains(() => window.localStorage)),
  );

  function toggleDomain(domain: string): void {
    setCollapsedDomains((current) => {
      const next = new Set(current);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      writeCollapsedDomains(() => window.localStorage, [...next]);
      return next;
    });
  }

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const expanded = !collapsedDomains.has(group.domain);
        const panelId = `stock-domain-panel-${group.domain}`;
        const count = group.entries.length;

        return (
          <section
            key={group.domain}
            className="rounded-lg border border-gray-200 bg-white"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggleDomain(group.domain)}
            >
              <span className="font-condensed text-sm font-bold text-bms-ink">
                {`${group.label} · ${count} ${count === 1 ? "entry" : "entries"}`}
              </span>
              <span
                className={`text-sm font-semibold text-bms-muted transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
                aria-hidden
              >
                ▼
              </span>
            </button>
            {expanded ? (
              <ul
                id={panelId}
                aria-label={`${group.label} entries`}
                className="divide-y divide-gray-100 border-t border-gray-100 px-3"
              >
                {group.entries.map((entry) => (
                  <Fragment key={entry.code}>{renderEntry(entry)}</Fragment>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
