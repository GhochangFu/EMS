import { useId, useState, type ReactNode } from "react";
import {
  MIMIC_SYMBOL_LIBRARIES,
  type MimicOrgSymbolDto,
  type MimicOrgSymbolLibraryDto,
  type MimicSymbol,
  type MimicSymbolLibrariesResponse,
  type MimicSymbolLibrary,
  type MimicSymbolLibrarySelection,
} from "@bms/shared";

import { inactiveGlobalSymbolKeys, liveLibrarySymbolGroups, orgLibrarySymbolGroups, symbolLabel } from "../../lib/mimic-symbols";
import { MimicGlyph } from "../widgets/mimic-glyphs";
import { mimicLibraryNotice } from "../widgets/mimic-symbol-libraries";
import { useLazyLibraries } from "../widgets/mimic-symbol-libraries/use-lazy-libraries";

/**
 * `F3.32c` U6b (ADR 0081 decision 7), `F3.32d` U3 (ADR 0082 decision 2), `F3.32e` (ADR 0084
 * decision 9), `F3.32f` slice 3 (ADR 0086 decisions 4 and 7) — the editor's palette: a search
 * box, the chosen libraries' symbols in the eight groups (General last), then Panel, Label, Pipe
 * mode, Undo, Redo and Delete.
 *
 * With `libraries` = `["core"]` the palette is the core groups as before ADR 0084. With any other
 * choice it shows one tab per chosen library — the static ones in registry order, then the
 * organization's own by label — each with a line naming the library and its licence and, for a
 * vendored library, the licence notice in a `<details>` (ruling R5); an organization library's
 * `<details>` holds its attribution text when it has one. A non-empty search hides the tabs and
 * lists the matches of every offered library; a non-core match names its library, so two
 * libraries' "Pump" buttons stay distinct.
 *
 * **What is offered.** A chosen library the organization turned off, or retired, gets no tab —
 * the canvas still draws the units a stored layout has on it. An organization library offers its
 * ACTIVE symbols only, and a static tab and the search leave out every retired global key
 * (`inactiveSymbolKeys`, ADR 0086 decision 5). With no `catalog` yet (it is loading, ruling R13) the static tabs show as
 * chosen and no organization tab does.
 *
 * The palette holds two pieces of view state — the search text and the active tab — and no
 * layout state: every button dispatches through its callback. A group is a way to find a
 * symbol, never a limit.
 */

export type MimicEditorPaletteProps = {
  /** A unit of `symbol`, labelled `label` (the catalog's for an organization symbol). */
  onAddUnit: (symbol: MimicSymbol, label: string) => void;
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
  libraries: readonly MimicSymbolLibrarySelection[];
  /** The organization's catalog (`GET /mimic-symbol-libraries`), or `null` while it loads. */
  catalog: MimicSymbolLibrariesResponse | null;
};

const BUTTON = "surface-button px-2 py-1 disabled:opacity-50";
const TAB = "surface-tab px-2 py-1 text-xs";
const SELECTED_TAB = "surface-tab surface-tab-selected px-2 py-1 text-xs";

/** One palette tab: a static registry library, or one of the organization's own. */
type PaletteTab =
  | {
      readonly kind: "static";
      readonly key: MimicSymbolLibrarySelection;
      readonly label: string;
      readonly library: MimicSymbolLibrary;
      /** The retired global keys (decision 5): never offered, though the bundle holds them. */
      readonly inactive: ReadonlySet<string>;
    }
  | { readonly kind: "org"; readonly key: MimicSymbolLibrarySelection; readonly label: string; readonly library: MimicOrgSymbolLibraryDto };

/** A static library is offered unless the catalog says it is retired or off for the organization. */
function staticOffered(code: MimicSymbolLibrary["code"], catalog: MimicSymbolLibrariesResponse | null): boolean {
  if (catalog === null) return true;
  return catalog.global.some((entry) => entry.code === code && entry.active && entry.enabled);
}

/** The chosen libraries the palette offers: static in registry order, then active org ones by label. */
function paletteTabs(
  selections: readonly MimicSymbolLibrarySelection[],
  catalog: MimicSymbolLibrariesResponse | null,
): PaletteTab[] {
  const inactive = inactiveGlobalSymbolKeys(catalog);
  const statics: PaletteTab[] = MIMIC_SYMBOL_LIBRARIES.filter(
    (library) => selections.includes(library.code) && staticOffered(library.code, catalog),
  ).map((library) => ({ kind: "static", key: library.code, label: library.label, library, inactive }));
  const orgs: PaletteTab[] = (catalog?.organization ?? [])
    .filter((library) => library.active && selections.includes(library.key))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((library) => ({ kind: "org", key: library.key, label: library.label, library }));
  return [...statics, ...orgs];
}

type SymbolButtonProps = {
  symbol: MimicSymbol;
  label: string;
  name: string;
  orgSymbol: MimicOrgSymbolDto | null;
  onAddUnit: (symbol: MimicSymbol, label: string) => void;
};

function SymbolButton({ symbol, label, name, orgSymbol, onAddUnit }: SymbolButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={name}
      onClick={() => onAddUnit(symbol, label)}
      className="surface-raised-sm flex flex-col items-center p-1 text-[10px] text-ink-muted hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <MimicGlyph kind={symbol} x={0} y={0} size={24} className="stroke-ink-muted" orgSymbol={orgSymbol} />
      </svg>
      <span>{label}</span>
    </button>
  );
}

/** One group section: its heading and its buttons. */
function GroupSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section data-testid="mimic-palette-group">
      <h3 className="mb-1 text-xs font-semibold uppercase text-ink-muted">{label}</h3>
      <div className="grid grid-cols-4 gap-1">{children}</div>
    </section>
  );
}

/** One tab's non-empty groups, each a `mimic-palette-group` section with its heading. */
function LibraryGroups({ tab, onAddUnit }: { tab: PaletteTab; onAddUnit: (symbol: MimicSymbol, label: string) => void }) {
  if (tab.kind === "org") {
    return (
      <div className="space-y-2">
        {orgLibrarySymbolGroups(tab.library)
          .filter((group) => group.symbols.length > 0)
          .map((group) => (
            <GroupSection key={group.key} label={group.label}>
              {group.symbols.map((symbol) => (
                <SymbolButton
                  key={symbol.key}
                  symbol={symbol.key}
                  label={symbol.label}
                  name={`Add ${symbol.label} unit`}
                  orgSymbol={symbol}
                  onAddUnit={onAddUnit}
                />
              ))}
            </GroupSection>
          ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {liveLibrarySymbolGroups(tab.library.code, tab.inactive)
        .filter((group) => group.symbols.length > 0)
        .map((group) => (
          <GroupSection key={group.key} label={group.label}>
            {group.symbols.map((symbol) => (
              <SymbolButton
                key={symbol}
                symbol={symbol}
                label={symbolLabel(symbol)}
                name={`Add ${symbolLabel(symbol)} unit`}
                orgSymbol={null}
                onAddUnit={onAddUnit}
              />
            ))}
          </GroupSection>
        ))}
    </div>
  );
}

/**
 * The active tab's library line and its notice: a vendored library's licence notice, or an
 * organization library's attribution text when it has one. `mimicLibraryNotice` is read for a
 * static code only; a lazy library's notice (`F3.32h`) shows once its module loads.
 */
function LibraryNotice({ tab }: { tab: PaletteTab }) {
  useLazyLibraries(tab.kind === "org" ? [] : [tab.library.code]);
  const notice =
    tab.kind === "org" ? tab.library.attribution : tab.library.code === "core" ? "" : (mimicLibraryNotice(tab.library.code) ?? "");
  return (
    <div className="space-y-1 text-[10px] text-ink-muted">
      <p>{`${tab.label} — ${tab.library.licence}`}</p>
      {/* A plain anchor in a new tab: the editor holds unsaved state, and the palette renders outside a Router. */}
      <a href="/attributions" target="_blank" rel="noopener noreferrer" className="underline">
        Attributions
      </a>
      {notice !== "" ? (
        <details data-testid="mimic-palette-licence">
          <summary className="cursor-pointer">Licence notice</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{notice}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** One search match: the symbol, its label and the stored symbol an org key draws from. */
type SearchMatch = { readonly symbol: MimicSymbol; readonly label: string; readonly orgSymbol: MimicOrgSymbolDto | null };

function tabMatches(tab: PaletteTab, term: string): SearchMatch[] {
  if (tab.kind === "org") {
    return orgLibrarySymbolGroups(tab.library)
      .flatMap((group) => group.symbols)
      .filter((symbol) => symbol.label.toLowerCase().includes(term))
      .map((symbol) => ({ symbol: symbol.key, label: symbol.label, orgSymbol: symbol }));
  }
  return liveLibrarySymbolGroups(tab.library.code, tab.inactive)
    .flatMap((group) => group.symbols)
    .filter((symbol) => symbolLabel(symbol).toLowerCase().includes(term))
    .map((symbol) => ({ symbol, label: symbolLabel(symbol), orgSymbol: null }));
}

/** A search: one section per offered library with a label match, case-insensitive. */
function SearchResults({
  tabs,
  term,
  onAddUnit,
}: {
  tabs: readonly PaletteTab[];
  term: string;
  onAddUnit: (symbol: MimicSymbol, label: string) => void;
}) {
  const results = tabs.map((tab) => ({ tab, matches: tabMatches(tab, term) })).filter((result) => result.matches.length > 0);
  if (results.length === 0) {
    return (
      <p role="status" className="text-xs text-ink-muted">
        No symbol matches “{term}”.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {results.map(({ tab, matches }) => (
        <section key={tab.key} data-testid="mimic-palette-search-library">
          <h3 className="mb-1 text-xs font-semibold uppercase text-ink-muted">{tab.label}</h3>
          <div className="grid grid-cols-4 gap-1">
            {matches.map((match) => (
              <SymbolButton
                key={match.symbol}
                symbol={match.symbol}
                label={match.label}
                name={tab.key === "core" ? `Add ${match.label} unit` : `Add ${match.label} unit from ${tab.label}`}
                orgSymbol={match.orgSymbol}
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
  const [tabKey, setTabKey] = useState<MimicSymbolLibrarySelection | null>(null);
  const idBase = useId();
  const tabs = paletteTabs(props.libraries, props.catalog);
  // A tab whose library was unchecked (or turned off) falls back to the first offered library.
  const active = tabs.find((tab) => tab.key === tabKey) ?? tabs[0];
  const coreOnly = tabs.length === 1 && active?.key === "core";
  const term = query.trim().toLowerCase();

  function symbols() {
    if (term !== "") {
      return <SearchResults tabs={tabs} term={term} onAddUnit={props.onAddUnit} />;
    }
    if (active === undefined) {
      return null;
    }
    if (coreOnly) {
      return <LibraryGroups tab={active} onAddUnit={props.onAddUnit} />;
    }
    return (
      <>
        <div role="tablist" aria-label="Symbol libraries" className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              id={`${idBase}-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={tab.key === active.key}
              aria-controls={`${idBase}-panel`}
              onClick={() => setTabKey(tab.key)}
              className={tab.key === active.key ? SELECTED_TAB : TAB}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${active.key}`} className="space-y-2">
          <LibraryNotice tab={active} />
          <LibraryGroups tab={active} onAddUnit={props.onAddUnit} />
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
