import { DASHBOARD_GRID } from "@bms/shared";

import type { SectionTemplateWidgetInput } from "../../api/admin/dashboard-templates";
import { AssetRoleBindingPicker } from "../dashboards/asset-role-binding-picker";

/**
 * One widget's editing surface: title, the four grid fields (bounded by
 * `DASHBOARD_GRID`, never a bare number), and its role bindings.
 *
 * Serves two pages — the authoring detail page
 * (`dashboard-template-detail-page.tsx`) and the read-only stock viewer
 * (`F3.44`) — which is why it lives once, here, rather than once per page.
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
        {editable ? (
          <div className="mt-2">
            <AssetRoleBindingPicker
              onAdd={(binding) =>
                onChange({ bindings: [...bindings, { ...binding, sortOrder: bindings.length }] })
              }
            />
          </div>
        ) : null}
      </div>
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
