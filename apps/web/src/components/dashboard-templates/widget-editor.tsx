import { DASHBOARD_GRID, SUSTAINABILITY_WATER_POINT_KEYS } from "@bms/shared";

import type { SectionTemplateWidgetInput } from "../../api/admin/dashboard-templates";
import { METRIC_CATALOG_PRESENTATION, metricCatalogLabel } from "../../lib/metric-catalog";
import { WIDGET_CATALOG } from "../../lib/widget-catalog";
import { AssetRoleBindingPicker } from "../dashboards/asset-role-binding-picker";
import { MetricSourcePicker } from "../dashboards/metric-source-picker";

/**
 * The intake-volume water codes — the `kl_` prefixed subset of
 * `SUSTAINABILITY_WATER_POINT_KEYS`, built once as a `Set` rather than a
 * hand-typed list, so a seventh water class (or a renamed code) is picked up
 * here for free.
 *
 * **`outlet_kl_*` is deliberately excluded** (`E4.3` U10, plan Q6
 * clarification): the owner's ruling names the note for a `kl_*` source only,
 * and the note's own sentence ("a water total sums every stage's INLET") would
 * be false if shown under an outlet-keyed tile — no stock template binds
 * `outlet_kl_*` today, so widening the note there is unproven and out of the
 * ruling's scope, not a claim this unit can hold either way.
 */
const WATER_INTAKE_VOLUME_KEYS: ReadonlySet<string> = new Set(
  SUSTAINABILITY_WATER_POINT_KEYS.filter((key) => key.startsWith("kl_")),
);

/**
 * One widget's editing surface: title, the four grid fields (bounded by
 * `DASHBOARD_GRID`, never a bare number), its role bindings and its named
 * metrics.
 *
 * Serves two pages — the authoring detail page
 * (`dashboard-template-detail-page.tsx`) and the read-only stock viewer
 * (`F3.44`) — which is why it lives once, here, rather than once per page.
 *
 * **The Named metric block (`F3.61`) mirrors `WidgetInspector`'s** and reads
 * the same three records: `WIDGET_CATALOG[type].sources` decides whether the
 * block renders at all and when the picker stops, `catalogKeysFor` (inside
 * `MetricSourcePicker`) decides which entries a type may bind, and
 * `metricCatalogLabel` names a bound entry. Add sends `params: {}` and nothing
 * else — every entry the picker offers has the write schema
 * `z.object({}).strict()`; the sustainability entries declare
 * `{ pointKey, aggregate }` (`E4.2`), with an optional `balanceRole` (`E4.3`),
 * and `catalogKeysFor` hides them from the
 * picker. A scope id in `params` is the ADR 0019 problem the binding contract
 * exists to refuse.
 * Remove patches `sources` alone: no column picker exists on a template widget
 * and no stock entry carries `config.columns`, so a `config` clear would be a
 * branch that can never fire (plan §5.3) and it would falsify `updateWidget`'s
 * "never `config`" cast.
 */
export function WidgetEditor({
  row,
  editable,
  onChange,
  onRemove,
}: {
  row: SectionTemplateWidgetInput;
  editable: boolean;
  onChange: (patch: Partial<SectionTemplateWidgetInput>) => void;
  onRemove: () => void;
}) {
  const bindings = row.bindings ?? [];
  const sources = row.sources ?? [];
  const sourceCardinality = WIDGET_CATALOG[row.widgetType].sources;

  return (
    <section className="space-y-2 rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
          {row.key}
        </span>
        {editable ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700"
          >
            Remove
          </button>
        ) : null}
      </div>

      <label className="block text-xs font-semibold text-bms-ink">
        Title
        <input
          type="text"
          disabled={!editable}
          value={row.title ?? ""}
          onChange={(event) => onChange({ title: event.target.value || null })}
          className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal disabled:bg-gray-50"
        />
      </label>

      <div className="grid grid-cols-4 gap-2">
        <label className="block text-[11px] font-semibold text-bms-ink">
          gridX
          <input
            type="number"
            disabled={!editable}
            min={0}
            max={DASHBOARD_GRID.columns - 1}
            value={row.gridX}
            onChange={(event) => onChange({ gridX: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
          />
        </label>
        <label className="block text-[11px] font-semibold text-bms-ink">
          gridY
          <input
            type="number"
            disabled={!editable}
            min={0}
            value={row.gridY}
            onChange={(event) => onChange({ gridY: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
          />
        </label>
        <label className="block text-[11px] font-semibold text-bms-ink">
          gridW
          <input
            type="number"
            disabled={!editable}
            min={DASHBOARD_GRID.minWidgetW}
            max={DASHBOARD_GRID.columns}
            value={row.gridW}
            onChange={(event) => onChange({ gridW: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
          />
        </label>
        <label className="block text-[11px] font-semibold text-bms-ink">
          gridH
          <input
            type="number"
            disabled={!editable}
            min={DASHBOARD_GRID.minWidgetH}
            max={DASHBOARD_GRID.maxWidgetH}
            value={row.gridH}
            onChange={(event) => onChange({ gridH: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
          />
        </label>
      </div>

      <div>
        <span className="text-[11px] font-semibold text-bms-ink">Bindings</span>
        <ul className="mt-1 space-y-1">
          {bindings.map((binding, index) => (
            <li
              key={`${binding.assetRoleCode}-${binding.pointKey}-${index}`}
              className="flex items-center justify-between rounded border border-gray-100 px-2 py-1 text-xs"
            >
              <span>
                {binding.assetRoleCode} · {binding.pointKey}
              </span>
              {editable ? (
                <button
                  type="button"
                  onClick={() =>
                    onChange({ bindings: bindings.filter((_, position) => position !== index) })
                  }
                  aria-label={`Remove binding ${binding.assetRoleCode} ${binding.pointKey}`}
                  className="text-red-700"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {/*
          The role picker disappears once a named metric is bound, as the inspector's point
          picker does (`widget-inspector.tsx`): a widget binds roles or a metric, never both,
          so offering both pickers at once would invite a state the next `PATCH` refuses —
          the contract refuses both since `F3.61`.
        */}
        {editable && sources.length === 0 ? (
          <div className="mt-2">
            <AssetRoleBindingPicker
              onAdd={(binding) =>
                onChange({ bindings: [...bindings, { ...binding, sortOrder: bindings.length }] })
              }
            />
          </div>
        ) : null}
      </div>

      {/*
        Rendered only for a type that can bind one — a gauge, a tank and a chart accept no
        catalog shape, so `WIDGET_CATALOG[type].sources` gives them `max: 0` and the whole
        block is absent rather than empty.
      */}
      {sourceCardinality.max > 0 ? (
        <div>
          <span className="text-[11px] font-semibold text-bms-ink">Named metric</span>
          <ul className="mt-1 space-y-1">
            {sources.map((source, index) => {
              const pointKey = source.params?.pointKey;
              // `E4.3` U10, ADR 0073 "Ruled here without a question" / Q6 clarification: a
              // hand-authored `kl_*` binding with no `balanceRole` sums every water class's
              // inlet, not just the intake stage's — the note fires only there, read-only or
              // not, because the stock viewer (`F3.44`) shows a v3 tile in this same block.
              const showsWaterBalanceNote =
                typeof pointKey === "string" &&
                WATER_INTAKE_VOLUME_KEYS.has(pointKey) &&
                source.params?.balanceRole === undefined;
              return (
                <li
                  key={`${source.catalogKey}-${index}`}
                  className="rounded border border-gray-100 px-2 py-1 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span>{metricCatalogLabel(source.catalogKey)}</span>
                    {editable ? (
                      <button
                        type="button"
                        onClick={() =>
                          onChange({ sources: sources.filter((_, position) => position !== index) })
                        }
                        // `Remove metric <label>`, beside the sibling `Remove binding <role> <key>`
                        // — deliberately not the inspector's bare `Remove <label>`, so the two ×
                        // controls in one editor read as two kinds.
                        aria-label={`Remove metric ${metricCatalogLabel(source.catalogKey)}`}
                        className="text-red-700"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  {showsWaterBalanceNote ? (
                    <p className="mt-1 text-[11px] text-bms-muted">
                      {METRIC_CATALOG_PRESENTATION[source.catalogKey].description}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {editable && sources.length < sourceCardinality.max && bindings.length === 0 ? (
            <div className="mt-2">
              <MetricSourcePicker
                widgetType={row.widgetType}
                bound={sources.map((source) => source.catalogKey)}
                onAdd={(catalogKey) =>
                  onChange({
                    sources: [...sources, { catalogKey, params: {}, sortOrder: sources.length }],
                  })
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The five-line tile preview `DashboardCanvas` draws for one widget. */
export function renderTemplateTile(tile: SectionTemplateWidgetInput) {
  return (
    <div className="h-full rounded border border-gray-200 bg-white p-1 text-[10px] text-bms-muted">
      {tile.title ?? tile.key}
    </div>
  );
}
