import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type KeyboardEvent } from "react";
import { mimicPanelToneSchema } from "@bms/shared/contracts";
import type { MimicPanelTone, MimicSymbol } from "@bms/shared";

import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import type { EditorLayout, EditorLayoutPatch, EditorNode, EditorNodePatch } from "../../lib/mimic-editor";
import { MIMIC_SYMBOL_GROUPS, symbolLabel } from "../../lib/mimic-symbols";

/**
 * `F3.32c` U6b (ADR 0081 decision 7), `F3.32d` U3 (ADR 0082 decision 2) — the editor's inspector:
 * the layout's name, slug and canvas size, then the selected node's label, symbol (29 symbols in
 * eight groups, matching the palette) and role (a unit), tone (a panel) and its box in cells.
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
};

const FIELD = "mt-1 w-full rounded border border-line px-2 py-1 text-xs font-normal";
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
      </fieldset>
      {selected ? (
        <NodeFields key={selected.key} node={selected} onNodeChange={onNodeChange} />
      ) : (
        <p className="text-xs text-ink-muted">Select a unit, panel or label to edit it.</p>
      )}
    </div>
  );
}

function NodeFields({
  node,
  onNodeChange,
}: {
  node: EditorNode;
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
              {MIMIC_SYMBOL_GROUPS.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.symbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbolLabel(symbol)}
                    </option>
                  ))}
                </optgroup>
              ))}
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
