import { useId, useState } from "react";
import { MIMIC_SYMBOL_LIBRARIES, type MimicSymbol, type MimicSymbolLibrary, type MimicSymbolLibraryCode } from "@bms/shared";

import { librarySymbolGroups, symbolLabel } from "../../lib/mimic-symbols";
import { MimicGlyph } from "../widgets/mimic-glyphs";
import { MIMIC_LIBRARY_NOTICES } from "../widgets/mimic-symbol-libraries";

/**
 * `F3.32c` U6b (ADR 0081 decision 7), `F3.32d` U3 (ADR 0082 decision 2), `F3.32e` (ADR 0084
 * decision 9) — the editor's palette: a search box, the chosen libraries' symbols in the eight
 * groups (General last), then Panel, Label, Pipe mode, Undo, Redo and Delete.
 *
 * With `libraries` = `["core"]` the palette is the core groups as before ADR 0084. With any other
 * choice it shows one tab per chosen library, in registry order, each with a line naming the
 * library and its licence and — for a vendored library — the licence notice in a `<details>`
 * (ruling R5). A non-empty search hides the tabs and lists the matches of every chosen library;
 * a non-core match names its library, so two libraries' "Pump" buttons stay distinct.
 *
 * The palette holds two pieces of view state — the search text and the active tab — and no
 * layout state: every button dispatches through its callback. A group is a way to find a
 * symbol, never a limit.
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
  /** The layout's chosen libraries (ADR 0084 decision 8); never empty. */
  libraries: readonly MimicSymbolLibraryCode[];
};

const BUTTON = "surface-button px-2 py-1 disabled:opacity-50";
const TAB = "surface-tab px-2 py-1 text-xs";
const SELECTED_TAB = "surface-tab surface-tab-selected px-2 py-1 text-xs";

type SymbolButtonProps = {
  symbol: MimicSymbol;
  name: string;
  onAddUnit: (symbol: MimicSymbol) => void;
};

function SymbolButton({ symbol, name, onAddUnit }: SymbolButtonProps) {
  const label = symbolLabel(symbol);
  return (
    <button
      type="button"
      title={label}
      aria-label={name}
      onClick={() => onAddUnit(symbol)}
      className="surface-raised-sm flex flex-col items-center p-1 text-[10px] text-ink-muted hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <MimicGlyph kind={symbol} x={0} y={0} size={24} className="stroke-ink-muted" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

/** One library's non-empty groups, each a `mimic-palette-group` section with its heading. */
function LibraryGroups({ code, onAddUnit }: { code: MimicSymbolLibraryCode; onAddUnit: (symbol: MimicSymbol) => void }) {
  return (
    <div className="space-y-2">
      {librarySymbolGroups(code)
        .filter((group) => group.symbols.length > 0)
        .map((group) => (
          <section key={group.key} data-testid="mimic-palette-group">
            <h3 className="mb-1 text-xs font-semibold uppercase text-ink-muted">{group.label}</h3>
            <div className="grid grid-cols-4 gap-1">
              {group.symbols.map((symbol) => (
                <SymbolButton key={symbol} symbol={symbol} name={`Add ${symbolLabel(symbol)} unit`} onAddUnit={onAddUnit} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

/** The active tab's library line and, for a vendored library, its licence notice. */
function LibraryNotice({ library }: { library: MimicSymbolLibrary }) {
  return (
    <div className="space-y-1 text-[10px] text-ink-muted">
      <p>{`${library.label} — ${library.licence}`}</p>
      {library.code !== "core" ? (
        <details data-testid="mimic-palette-licence">
          <summary className="cursor-pointer">Licence notice</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{MIMIC_LIBRARY_NOTICES[library.code]}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** A search: one section per chosen library with a label match, case-insensitive. */
function SearchResults({
  libraries,
  term,
  onAddUnit,
}: {
  libraries: readonly MimicSymbolLibrary[];
  term: string;
  onAddUnit: (symbol: MimicSymbol) => void;
}) {
  const results = libraries
    .map((library) => ({
      library,
      symbols: librarySymbolGroups(library.code)
        .flatMap((group) => group.symbols)
        .filter((symbol) => symbolLabel(symbol).toLowerCase().includes(term)),
    }))
    .filter((result) => result.symbols.length > 0);
  if (results.length === 0) {
    return (
      <p role="status" className="text-xs text-ink-muted">
        No symbol matches “{term}”.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {results.map(({ library, symbols }) => (
        <section key={library.code} data-testid="mimic-palette-search-library">
          <h3 className="mb-1 text-xs font-semibold uppercase text-ink-muted">{library.label}</h3>
          <div className="grid grid-cols-4 gap-1">
            {symbols.map((symbol) => (
              <SymbolButton
                key={symbol}
                symbol={symbol}
                name={
                  library.code === "core"
                    ? `Add ${symbolLabel(symbol)} unit`
                    : `Add ${symbolLabel(symbol)} unit from ${library.label}`
                }
                onAddUnit={onAddUnit}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function MimicEditorPalette(props: MimicEditorPaletteProps) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<MimicSymbolLibraryCode | null>(null);
  const idBase = useId();
  const chosen = MIMIC_SYMBOL_LIBRARIES.filter((library) => props.libraries.includes(library.code));
  // A tab whose library was unchecked falls back to the first chosen library.
  const active = chosen.find((library) => library.code === tab) ?? chosen[0];
  const coreOnly = chosen.length === 1 && active?.code === "core";
  const term = query.trim().toLowerCase();

  function symbols() {
    if (term !== "") {
      return <SearchResults libraries={chosen} term={term} onAddUnit={props.onAddUnit} />;
    }
    if (active === undefined) {
      return null;
    }
    if (coreOnly) {
      return <LibraryGroups code="core" onAddUnit={props.onAddUnit} />;
    }
    return (
      <>
        <div role="tablist" aria-label="Symbol libraries" className="flex flex-wrap gap-1">
          {chosen.map((library) => (
            <button
              key={library.code}
              id={`${idBase}-tab-${library.code}`}
              type="button"
              role="tab"
              aria-selected={library.code === active.code}
              aria-controls={`${idBase}-panel`}
              onClick={() => setTab(library.code)}
              className={library.code === active.code ? SELECTED_TAB : TAB}
            >
              {library.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${active.code}`} className="space-y-2">
          <LibraryNotice library={active} />
          <LibraryGroups code={active.code} onAddUnit={props.onAddUnit} />
        </div>
      </>
    );
  }

  return (
    <div className="space-y-3" data-testid="mimic-editor-palette">
      <input
        type="search"
        aria-label="Search symbols"
        placeholder="Search symbols"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="surface-field w-full px-2 py-1 text-xs"
      />
      <div className="space-y-2">{symbols()}</div>
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
          className={props.pipeMode ? "surface-button-primary bg-accent px-2 py-1 text-xs font-semibold text-on-accent" : BUTTON}
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
