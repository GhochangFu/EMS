import type { MimicSymbol } from "@bms/shared";

import { MIMIC_SYMBOL_GROUPS, symbolLabel } from "../../lib/mimic-symbols";
import { MimicGlyph } from "../widgets/mimic-glyphs";

/**
 * `F3.32c` U6b (ADR 0081 decision 7), `F3.32d` U3 (ADR 0082 decision 2) — the editor's closed
 * palette: one button per symbol, 29 symbols in eight groups (`MIMIC_SYMBOL_GROUPS`, General
 * last), then Panel, Label, Pipe mode, Undo, Redo and Delete. Every button dispatches through its
 * callback; the palette holds no state of its own. A group is a way to find a symbol, never a
 * limit — every symbol stays usable in every layout.
 */

export type MimicEditorPaletteProps = {
  onAddUnit: (symbol: MimicSymbol) => void;
  onAddPanel: () => void;
  onAddLabel: () => void;
  pipeMode: boolean;
  onTogglePipeMode: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canDelete: boolean;
  onDelete: () => void;
};

const BUTTON = "rounded border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink hover:bg-well disabled:opacity-50";

export function MimicEditorPalette(props: MimicEditorPaletteProps) {
  return (
    <div className="space-y-3" data-testid="mimic-editor-palette">
      <div className="space-y-2">
        {MIMIC_SYMBOL_GROUPS.map((group) => (
          <section key={group.key} data-testid="mimic-palette-group">
            <h3 className="mb-1 text-xs font-semibold uppercase text-ink-muted">{group.label}</h3>
            <div className="grid grid-cols-4 gap-1">
              {group.symbols.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  title={symbolLabel(symbol)}
                  aria-label={`Add ${symbolLabel(symbol)} unit`}
                  onClick={() => props.onAddUnit(symbol)}
                  className="flex flex-col items-center rounded border border-line bg-surface p-1 text-[10px] text-ink-muted hover:bg-well"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
                    <MimicGlyph kind={symbol} x={0} y={0} size={24} className="stroke-ink-muted" />
                  </svg>
                  <span>{symbolLabel(symbol)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={props.onAddPanel} className={BUTTON}>
          Panel
        </button>
        <button type="button" onClick={props.onAddLabel} className={BUTTON}>
          Label
        </button>
        <button
          type="button"
          aria-pressed={props.pipeMode}
          onClick={props.onTogglePipeMode}
          className={props.pipeMode ? "rounded bg-accent px-2 py-1 text-xs font-semibold text-on-accent" : BUTTON}
        >
          Pipe mode
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo} className={BUTTON} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo} className={BUTTON} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <button type="button" onClick={props.onDelete} disabled={!props.canDelete} className={BUTTON} title="Delete">
          Delete
        </button>
      </div>
    </div>
  );
}
