import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import type { SectionTemplateBindingInput } from "../../api/admin/dashboard-templates";

type AssetRoleBindingPickerProps = {
  onAdd: (binding: SectionTemplateBindingInput) => void;
};

/**
 * `F3.36` Part F — one binding's whole editing surface: a role `<select>` plus
 * a point-key text input. ADR 0049 decision 4: a template widget says *"the
 * incoming-supply meter's `kW`"*, never *"asset `7f3a`'s `kW`"*, so the two
 * fields together are the whole binding.
 *
 * **The role `<select>` is fed from `GET /api/v1/vocabularies`, never from a
 * hardcoded `<option>` list** — the same `F4.43` guard
 * `asset-groups-page.tsx` holds for the identical vocabulary.
 * `assetRoleCodeSchema` is a bounded string and not a `z.enum` for exactly this
 * reason: the set lives in `bms.asset_roles` and a hand-kept list falling
 * behind renders the FIRST option for an unknown value, which looks like a
 * different role rather than like a bug.
 */
export function AssetRoleBindingPicker({ onAdd }: AssetRoleBindingPickerProps) {
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
  });
  const roles = vocabQ.data?.assetRoles ?? [];

  const [assetRoleCode, setAssetRoleCode] = useState("");
  const [pointKey, setPointKey] = useState("");

  function add(): void {
    if (assetRoleCode === "" || pointKey.trim() === "") {
      return;
    }
    onAdd({ assetRoleCode, pointKey: pointKey.trim() });
    setPointKey("");
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block text-xs font-semibold text-bms-ink">
        Role
        <select
          aria-label="Asset role"
          value={assetRoleCode}
          onChange={(event) => setAssetRoleCode(event.target.value)}
          className="mt-1 rounded border border-gray-200 px-2 py-1 text-xs font-normal"
        >
          <option value="">Select a role…</option>
          {roles.map((role) => (
            <option key={role.code} value={role.code}>
              {role.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-semibold text-bms-ink">
        Point key
        <input
          type="text"
          aria-label="Point key"
          value={pointKey}
          onChange={(event) => setPointKey(event.target.value)}
          placeholder="kW"
          className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal"
        />
      </label>
      <button
        type="button"
        onClick={add}
        disabled={assetRoleCode === "" || pointKey.trim() === ""}
        className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-bms-ink disabled:opacity-60"
      >
        Add binding
      </button>
    </div>
  );
}
