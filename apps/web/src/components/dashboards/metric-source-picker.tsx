import type { MetricCatalogKey, WidgetType } from "@bms/shared";

import { METRIC_CATALOG_PRESENTATION, catalogKeysFor } from "../../lib/metric-catalog";

type MetricSourcePickerProps = {
  widgetType: WidgetType;
  /** Already bound on this widget — offered but disabled, never silently missing. */
  bound: readonly MetricCatalogKey[];
  onAdd: (catalogKey: MetricCatalogKey) => void;
};

/**
 * `F3.35` Stage C Unit 6 — the named-metric half of a widget's bindings (ADR 0048 decisions 1
 * and 2). The sibling of `point-picker.tsx`, and deliberately much smaller than it.
 *
 * **No query, and that is the whole difference.** A point picker has to walk
 * locations → asset points because points are rows an administrator declares; the catalog is
 * **code** (`metricCatalogKeySchema`'s own docblock), so the entire list is known at build time
 * and the picker fetches nothing. A reader looking for the missing `useQuery` should stop here
 * rather than add one.
 *
 * **Filtered by shape, not by cardinality.** `catalogKeysFor` reads `WIDGET_SOURCE_SHAPES`, the
 * same record `eachSourceFitsTheWidget` reads on the write path — so an option offered here
 * cannot be one the API answers 400 for. Cardinality is the CALLER's job, exactly as it is for
 * `PointPicker`: `WidgetInspector` stops rendering this component at
 * `WIDGET_CATALOG[type].sources.max`.
 *
 * **An already-bound entry stays visible and disabled.** `dashboard_widget_sources_widget_key_key`
 * refuses the same entry twice on one widget, and removing the option would make the author's
 * own choice vanish from the list they are reading — a disabled row says "you have this"
 * where an absent row says "this does not exist".
 */
export function MetricSourcePicker({ widgetType, bound, onAdd }: MetricSourcePickerProps) {
  const keys = catalogKeysFor(widgetType);
  if (keys.length === 0) {
    return null;
  }
  const isBound = (key: MetricCatalogKey): boolean => bound.includes(key);

  return (
    <div className="space-y-1.5 rounded border border-dashed border-gray-300 p-2">
      <select
        aria-label="Add named metric"
        value=""
        onChange={(event) => {
          // Narrowed by MEMBERSHIP, not by a cast. `event.target.value` is a plain string —
          // the placeholder's is `""` — and casting it first makes the emptiness check a
          // comparison TypeScript can prove is impossible. Reading the value back out of the
          // list this component just rendered is both the honest narrowing and the one that
          // cannot admit a key the shape filter excluded.
          const key = keys.find((candidate) => candidate === event.target.value);
          if (key && !isBound(key)) {
            onAdd(key);
          }
        }}
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
      >
        <option value="" disabled>
          Add a named metric…
        </option>
        {keys.map((key) => (
          <option key={key} value={key} disabled={isBound(key)}>
            {METRIC_CATALOG_PRESENTATION[key].label}
            {isBound(key) ? " (already bound)" : ""}
          </option>
        ))}
      </select>
      <p className="text-[11px] leading-snug text-bms-muted">
        A named metric is counted across this dashboard&rsquo;s own scope, not the whole
        organization.
      </p>
    </div>
  );
}
