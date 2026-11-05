import { useQuery } from "@tanstack/react-query";
import { MIMIC_HEADLINE_POINTS } from "@bms/shared/contracts";

import { fetchAdminPointKeys } from "../../api/admin/point-keys";

/**
 * `F4.307` (ADR 0081 Amendment 1 decision 5) — the inspector's "Points" block on a roled unit:
 * the unit's own value rows, in display order, then an "Add point" select of the active catalog
 * (`fetchAdminPointKeys("true")`, the `catalog-key-select.tsx` read) minus the keys already
 * listed. At `MIMIC_HEADLINE_POINTS` the select is disabled with the hint "3 of 3".
 *
 * A listed key the active catalog does not hold (deactivated since it was listed) reads
 * `code (inactive)` and keeps its row, so the author can still remove it. Every change reports
 * the whole new list once; the reducer dedupes and clamps it again.
 */

const LABEL = "block text-xs font-semibold text-ink-muted";
const FIELD = "mt-1 w-full surface-field px-2 py-1 text-xs font-normal";
const BUTTON = "surface-field px-1.5 py-0.5 text-[10px] text-ink disabled:opacity-50";

export function PointListField({
  pointKeys,
  onChange,
}: {
  pointKeys: readonly string[];
  onChange: (pointKeys: readonly string[]) => void;
}) {
  // `F3.39`: one fleet-wide catalog, so no organization in the key.
  const catalogQ = useQuery({ queryKey: ["admin", "point-keys", "true"], queryFn: () => fetchAdminPointKeys("true") });
  const catalog = catalogQ.data?.items;
  const nameOf = new Map((catalog ?? []).map((item) => [item.code, item.name]));
  const full = pointKeys.length >= MIMIC_HEADLINE_POINTS;

  function move(index: number, by: -1 | 1): void {
    const next = [...pointKeys];
    const other = index + by;
    const a = next[index];
    const b = next[other];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[other] = a;
    onChange(next);
  }

  return (
    <div role="group" aria-label="Points" className="space-y-1">
      <p className={LABEL}>Points</p>
      {pointKeys.length > 0 ? (
        <ul aria-label="Listed points" className="space-y-1">
          {pointKeys.map((code, index) => {
            const name = nameOf.get(code);
            return (
              <li key={code} className="flex items-center gap-1 text-xs text-ink">
                <span className="min-w-0 flex-1 truncate">
                  {name !== undefined ? (
                    <>
                      {name} <span className="text-ink-muted">· {code}</span>
                    </>
                  ) : catalog !== undefined ? (
                    <span className="text-ink-muted">{`${code} (inactive)`}</span>
                  ) : (
                    code
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Move ${code} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className={BUTTON}
                >
                  Up
                </button>
                <button
                  type="button"
                  aria-label={`Move ${code} down`}
                  disabled={index === pointKeys.length - 1}
                  onClick={() => move(index, 1)}
                  className={BUTTON}
                >
                  Down
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${code}`}
                  onClick={() => onChange(pointKeys.filter((k) => k !== code))}
                  className={BUTTON}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[10px] text-ink-muted">None listed — the unit shows its asset's headline points.</p>
      )}
      <label className={LABEL}>
        Add point
        <select
          aria-label="Add point"
          value=""
          disabled={full}
          onChange={(event) => {
            if (event.target.value !== "") onChange([...pointKeys, event.target.value]);
          }}
          className={FIELD}
        >
          <option value="">Select a catalog point…</option>
          {(catalog ?? [])
            .filter((item) => !pointKeys.includes(item.code))
            .map((item) => (
              <option key={item.id} value={item.code}>
                {item.name} · {item.code}
              </option>
            ))}
        </select>
      </label>
      {full ? <p className="text-[10px] text-ink-muted">{`${MIMIC_HEADLINE_POINTS} of ${MIMIC_HEADLINE_POINTS}`}</p> : null}
    </div>
  );
}
