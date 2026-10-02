import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type KeyboardEvent } from "react";
import { mimicPanelToneSchema } from "@bms/shared/contracts";
import {
  MIMIC_SYMBOL_LIBRARIES,
  isOrgLibraryKey,
  libraryOfSymbol,
  mimicSymbolLibrary,
  type MimicPanelTone,
  type MimicSymbol,
  type MimicSymbolLibrariesResponse,
  type MimicSymbolLibraryCode,
  type MimicSymbolLibrarySelection,
} from "@bms/shared";

import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import {
  librariesInUse,
  type EditorLayout,
  type EditorLayoutPatch,
  type EditorNode,
  type EditorNodePatch,
} from "../../lib/mimic-editor";
import {
  catalogOrgSymbols,
  inactiveGlobalSymbolKeys,
  liveLibrarySymbolGroups,
  orgLibrarySymbolGroups,
  symbolLabel,
  symbolLabelIn,
} from "../../lib/mimic-symbols";

/**
 * `F3.32c` U6b (ADR 0081 decision 7), `F3.32d` U3 (ADR 0082 decision 2) — the editor's inspector:
 * the layout's name, slug, canvas size and symbol libraries (`F3.32e`, ADR 0084), then the
 * selected node's label, symbol (the chosen libraries' symbols in their groups, matching the
 * palette) and role (a unit), tone (a panel) and its box in cells.
 *
 * **Every field commits on blur or Enter, never per keystroke.** A per-keystroke dispatch would
 * push one history entry per character, and a canvas width typed as `1`, `12`, `126` would be
 * refused at `1` (below 20 cells) and snap back before the author finished typing.
 *
 * The role list is `GET /api/v1/vocabularies`' `assetRoles` (the `asset-role-binding-picker.tsx`
 * rule: the set lives in `bms.asset_roles`, never a hand-kept list), plus "none — passive"
 * (plan D6: a unit with no role is drawn with no status and no values).
 */

export type InspectorOrganization = {
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly value: string;
  readonly onChange: (id: string) => void;
};

export type MimicEditorInspectorProps = {
  layout: EditorLayout;
  selected: EditorNode | null;
  onLayoutChange: (patch: EditorLayoutPatch) => void;
  onNodeChange: (key: string, patch: EditorNodePatch) => void;
  /** Present on a new layout only: the owning organization is fixed once it is saved. */
  organization?: InspectorOrganization;
  /** The organization's catalog (`GET /mimic-symbol-libraries`), or `null` while it loads. */
  catalog: MimicSymbolLibrariesResponse | null;
  /**
   * The libraries the stored version of the layout chooses (`[]` on a new layout). Only these
   * are kept when retired or off (the API's kept exemption), so only these are locked; any other
   * chosen library that is not live can be unchecked, or the draft could never save.
   */
  storedLibraries: readonly MimicSymbolLibrarySelection[];
};

const FIELD = "mt-1 w-full surface-field px-2 py-1 text-xs font-normal";
const LABEL = "block text-xs font-semibold text-ink-muted";

type DraftFieldProps = {
  label: string;
  value: string;
  type?: "text" | "number";
  onCommit: (value: string) => void;
};

/** A text or number field holding a local draft until blur or Enter, then committing once. */
function DraftField({ label, value, type = "text", onCommit }: DraftFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit(): void {
    if (draft !== value) {
      onCommit(draft);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      commit();
    } else if (event.key === "Escape") {
      setDraft(value);
    }
  }

  return (
    <label className={LABEL}>
      {label}
      <input
        type={type}
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={FIELD}
      />
    </label>
  );
}

/** A whole number from a field, or `undefined` for anything else (the reducer then keeps the value). */
function wholeNumber(text: string): number | undefined {
  return /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
}

export function MimicEditorInspector({
  layout,
  selected,
  onLayoutChange,
  onNodeChange,
  organization,
  catalog,
  storedLibraries,
}: MimicEditorInspectorProps) {
  return (
    <div className="space-y-4" data-testid="mimic-editor-inspector">
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase text-ink-muted">Layout</legend>
        {organization ? (
          <label className={LABEL}>
            Organization
            <select
              aria-label="Organization"
              required
              value={organization.value}
              onChange={(event) => organization.onChange(event.target.value)}
              className={FIELD}
            >
              <option value="">Select an organization…</option>
              {organization.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <DraftField label="Name" value={layout.name} onCommit={(name) => onLayoutChange({ name })} />
        <DraftField label="Slug" value={layout.slug} onCommit={(slug) => onLayoutChange({ slug })} />
        <div className="grid grid-cols-2 gap-2">
          <DraftField
            label="Canvas width"
            type="number"
            value={String(layout.canvasW)}
            onCommit={(text) => {
              const value = wholeNumber(text);
              if (value !== undefined) {
                onLayoutChange({ canvasW: value });
              }
            }}
          />
          <DraftField
            label="Canvas height"
            type="number"
            value={String(layout.canvasH)}
            onCommit={(text) => {
              const value = wholeNumber(text);
              if (value !== undefined) {
                onLayoutChange({ canvasH: value });
              }
            }}
          />
        </div>
        <LibraryBoxes
          layout={layout}
          catalog={catalog}
          storedLibraries={storedLibraries}
          onLayoutChange={onLayoutChange}
        />
      </fieldset>
      {selected ? (
        <NodeFields
          key={selected.key}
          node={selected}
          libraries={layout.symbolLibraries}
          catalog={catalog}
          onNodeChange={onNodeChange}
        />
      ) : (
        <p className="text-xs text-ink-muted">Select a unit, panel or label to edit it.</p>
      )}
    </div>
  );
}

/** One "Symbol libraries" row: a library, and whether it may still be offered. */
type LibraryRow = {
  readonly key: MimicSymbolLibrarySelection;
  readonly label: string;
  /** Retired, or turned off for the organization: shown only while chosen, and never toggled. */
  readonly retired: boolean;
};

/** A static library is live unless the catalog says it is retired or off for the organization. */
function staticLive(code: MimicSymbolLibraryCode, catalog: MimicSymbolLibrariesResponse | null): boolean {
  if (catalog === null) return true;
  return catalog.global.some((entry) => entry.code === code && entry.active && entry.enabled);
}

/**
 * The rows, in the order a change reports them: the registry's static libraries, then the
 * organization's own by label, then any chosen `org.` key the catalog does not hold. A live
 * library always has a row; a retired or disabled one only while the layout still chooses it.
 * With no catalog yet (ruling R13) every static library is live and a chosen `org.` key keeps a
 * locked row under its key.
 */
function libraryRows(chosen: readonly MimicSymbolLibrarySelection[], catalog: MimicSymbolLibrariesResponse | null): LibraryRow[] {
  const statics = MIMIC_SYMBOL_LIBRARIES.map((library) => ({
    key: library.code,
    label: library.label,
    retired: !staticLive(library.code, catalog),
  }));
  const orgs = [...(catalog?.organization ?? [])]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((library) => ({ key: library.key, label: library.label, retired: !library.active }));
  const known = new Set<string>([...statics, ...orgs].map((row) => row.key));
  const unknown = chosen
    .filter((key) => isOrgLibraryKey(key) && !known.has(key))
    .map((key) => ({ key, label: key, retired: true }));
  return [...statics, ...orgs, ...unknown].filter((row) => !row.retired || chosen.includes(row.key));
}

/**
 * "Symbol libraries" (ADR 0084 decision 8, rulings R3/R4; ADR 0086 decisions 4 and 7): one check
 * box per live global library and per active organization library. A chosen library a unit uses
 * is disabled and names its units — the reducer would refuse the drop anyway; the hint says why.
 * A chosen library that was retired or turned off says so. When the stored layout already chooses
 * it, it is checked and disabled: the API's kept exemption keeps it. When it does not (a new
 * layout whose organization changed, or a box checked before the switch went off) it can be
 * unchecked, since the save would refuse it; either way it cannot be chosen again once dropped. A change
 * reports the whole list in `libraryRows`' order, so an organization library survives a static
 * toggle.
 */
function LibraryBoxes({
  layout,
  catalog,
  storedLibraries,
  onLayoutChange,
}: {
  layout: EditorLayout;
  catalog: MimicSymbolLibrariesResponse | null;
  storedLibraries: readonly MimicSymbolLibrarySelection[];
  onLayoutChange: (patch: EditorLayoutPatch) => void;
}) {
  const inUse = librariesInUse(layout);
  const rows = libraryRows(layout.symbolLibraries, catalog);
  function toggle(key: MimicSymbolLibrarySelection, on: boolean): void {
    const next = rows.map((row) => row.key).filter((k) => (k === key ? on : layout.symbolLibraries.includes(k)));
    onLayoutChange({ symbolLibraries: next });
  }
  return (
    <div className="space-y-1">
      <p className={LABEL}>Symbol libraries</p>
      {rows.map((row) => {
        const checked = layout.symbolLibraries.includes(row.key);
        const users = inUse.get(row.key);
        const locked = checked && users !== undefined;
        return (
          <div key={row.key}>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                aria-label={`Library ${row.label}`}
                checked={checked}
                disabled={locked || (row.retired && storedLibraries.includes(row.key))}
                onChange={(event) => toggle(row.key, event.target.checked)}
              />
              {row.label}
            </label>
            {row.retired && catalog !== null ? (
              <p className="ml-5 text-[10px] text-ink-muted">{`${row.label} is retired`}</p>
            ) : null}
            {locked ? (
              <p className="ml-5 text-[10px] text-ink-muted">{`${row.label} is used by: ${users.join(", ")}`}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** A library's display name: the registry's for a static code, the catalog's (or the key) for `org.`. */
function libraryLabelOf(code: MimicSymbolLibrarySelection, catalog: MimicSymbolLibrariesResponse | null): string {
  if (isOrgLibraryKey(code)) {
    return catalog?.organization.find((library) => library.key === code)?.label ?? code;
  }
  return mimicSymbolLibrary(code).label;
}

/**
 * The Symbol select's options: one `optgroup` per chosen, live static library × non-empty group
 * of its non-retired symbols (the palette's filter, ADR 0086 decision 5) — core
 * groups keep their plain label, another library's read `${library} · ${group}` — then one per
 * chosen, active organization library × non-empty group with its active symbols. A unit whose
 * symbol no group lists (its library not chosen, or a retired organization symbol) gets one
 * leading option outside every group so the select still shows it. `mimicSymbolLibrary` is never
 * called with an `org.` key.
 */
function SymbolOptions({
  symbol,
  libraries,
  catalog,
}: {
  symbol: MimicSymbol;
  libraries: readonly MimicSymbolLibrarySelection[];
  catalog: MimicSymbolLibrariesResponse | null;
}) {
  const own = libraryOfSymbol(symbol);
  const orgSymbols = catalogOrgSymbols(catalog);
  const inactive = inactiveGlobalSymbolKeys(catalog);
  const staticGroups = MIMIC_SYMBOL_LIBRARIES.filter(
    (library) => libraries.includes(library.code) && staticLive(library.code, catalog),
  ).flatMap((library) =>
    liveLibrarySymbolGroups(library.code, inactive)
      .filter((group) => group.symbols.length > 0)
      .map((group) => ({
        key: `${library.code}:${group.key}`,
        label: library.code === "core" ? group.label : `${library.label} · ${group.label}`,
        options: group.symbols.map((s) => ({ value: s, label: symbolLabel(s) })),
      })),
  );
  const orgGroups = [...(catalog?.organization ?? [])]
    .filter((library) => library.active && libraries.includes(library.key))
    .sort((a, b) => a.label.localeCompare(b.label))
    .flatMap((library) =>
      orgLibrarySymbolGroups(library)
        .filter((group) => group.symbols.length > 0)
        .map((group) => ({
          key: `${library.key}:${group.key}`,
          label: `${library.label} · ${group.label}`,
          options: group.symbols.map((s) => ({ value: s.key as MimicSymbol, label: s.label })),
        })),
    );
  const groups = [...staticGroups, ...orgGroups];
  const listed = groups.some((group) => group.options.some((option) => option.value === symbol));
  const ownLabel = symbolLabelIn(symbol, orgSymbols);
  return (
    <>
      {listed ? null : (
        <option value={symbol}>{own === "core" ? ownLabel : `${ownLabel} (${libraryLabelOf(own, catalog)})`}</option>
      )}
      {groups.map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function NodeFields({
  node,
  libraries,
  catalog,
  onNodeChange,
}: {
  node: EditorNode;
  libraries: readonly MimicSymbolLibrarySelection[];
  catalog: MimicSymbolLibrariesResponse | null;
  onNodeChange: (key: string, patch: EditorNodePatch) => void;
}) {
  const vocabQ = useQuery({ queryKey: vocabulariesQueryKey, queryFn: fetchVocabularies });
  const roles = vocabQ.data?.assetRoles ?? [];
  const change = (patch: EditorNodePatch): void => onNodeChange(node.key, patch);

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase text-ink-muted">
        {node.kind === "unit" ? "Unit" : node.kind === "panel" ? "Panel" : "Label"} · {node.key}
      </legend>
      <DraftField label="Label" value={node.label} onCommit={(label) => change({ label })} />
      {node.kind === "unit" ? (
        <>
          <label className={LABEL}>
            Symbol
            <select
              aria-label="Symbol"
              value={node.symbol ?? "unit"}
              onChange={(event) => change({ symbol: event.target.value as MimicSymbol })}
              className={FIELD}
            >
              <SymbolOptions symbol={node.symbol ?? "unit"} libraries={libraries} catalog={catalog} />
            </select>
          </label>
          <label className={LABEL}>
            Role
            <select
              aria-label="Role"
              value={node.roleCode ?? ""}
              onChange={(event) => change({ roleCode: event.target.value === "" ? null : event.target.value })}
              className={FIELD}
            >
              <option value="">none — passive</option>
              {node.roleCode !== null && !roles.some((role) => role.code === node.roleCode) ? (
                <option value={node.roleCode}>{node.roleCode}</option>
              ) : null}
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={node.fanOut === true}
              onChange={(event) => change({ fanOut: event.target.checked })}
            />
            Fan out — draw every member of the role
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={node.isSource === true}
              onChange={(event) => change({ isSource: event.target.checked })}
            />
            Energy source
          </label>
        </>
      ) : null}
      {node.kind === "panel" ? (
        <label className={LABEL}>
          Tone
          <select
            aria-label="Tone"
            value={node.tone ?? "info"}
            onChange={(event) => change({ tone: event.target.value as MimicPanelTone })}
            className={FIELD}
          >
            {mimicPanelToneSchema.options.map((tone) => (
              <option key={tone} value={tone}>
                {tone}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid grid-cols-4 gap-2">
        {(["x", "y", "w", "h"] as const).map((axis) => (
          <DraftField
            key={axis}
            label={axis.toUpperCase()}
            type="number"
            value={String(node[axis])}
            onCommit={(text) => {
              const value = wholeNumber(text);
              if (value !== undefined) {
                change({ [axis]: value });
              }
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
