/**
 * The formula editor (`F2.5`, ADR 0038 decisions 4, 5, 6, 7 — Unit 5).
 *
 * **This is the only module in the repository allowed to import `codemirror`
 * or `@codemirror/*`.** Everything else reaches it through
 * `formula-editor-lazy.tsx`, which is what keeps the library in its own chunk.
 * `tests/adr-0038-formula-editor.test.ts` asserts that; the bundler does not.
 *
 * One component serves both authored-formula surfaces — a derived point's
 * `formula` and a KPI's `expression` (decision 4) — because they share one
 * parser, `parseFormula`, run under the dialect each surface carries in its
 * rules (`bms-calc-v1` or `bms-calc-v2`, ADR 0055). They share nothing else,
 * so `FormulaEditorRules` is a discriminated union rather than a flag.
 *
 * **Composed from `minimalSetup`, never `basicSetup`** (ADR 0038 Amendment 1).
 * `basicSetup` imports and uses `highlightSelectionMatches` and `searchKeymap`,
 * which would make `@codemirror/search` a live import by construction and turn
 * decision 7's bundle check from an assertion into a measurement.
 * `minimalSetup` already carries `history`, so Ctrl+Z works without
 * `@codemirror/commands` appearing here.
 *
 * **Nothing in this file answers a question.** Every rule lives in
 * `src/lib/formula-editor-rules.ts` and `src/lib/calc-decorations.ts`, under
 * test. The split predates ADR 0042's jsdom component tests, when a `.tsx` was
 * unreachable by any test here; the coverage gate still does not look above
 * `src/lib`, so logic left in this file stays outside it. The one thing a spec
 * does check here is the theme (`formula-editor-theme.spec.tsx`, `F3.65c`): the
 * `EditorView.darkTheme` facet through `editorIsDark`, and the rules of
 * `CALC_THEME_SPEC` by selector.
 */
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { forceLinting, linter, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { useEffect, useRef } from "react";

import { calcDecorations } from "../../lib/calc-decorations";
import {
  completionKeys,
  decorationDialect,
  editorDiagnosticRanges,
  flattenNewlines,
  isCheckedDialect,
  scopeCompletions,
  validateEditorFormula,
  type FormulaEditorRules,
} from "../../lib/formula-editor-rules";
import { useTheme, useThemeStore } from "../../stores/theme-store";

/** The rules for the surface, plus the field's own controlled-input props. */
export type FormulaEditorProps = FormulaEditorRules & {
  value: string;
  onChange: (next: string) => void;
  /** ADR 0038 decision 3: a published version renders read-only, never editable. */
  readOnly?: boolean;
  ariaLabel?: string;
};

/**
 * Colours for the token classes `calc-decorations.ts` emits.
 *
 * An `EditorView.theme` rather than a rule in `index.css`: it ships inside this
 * lazy chunk, so a page that never opens the Calculations tab never downloads
 * it. Every value is a role's `rgb(var(--role))` CSS string (ADR 0078 decision
 * 5, plan D4) — a theme object cannot carry a Tailwind class name, so this file
 * joins `index.css`'s Leaflet rules, the login hero gradient and the CRAC
 * gradient stops as a place that reads a role as a raw CSS string rather than
 * a class. `.cm-calc-function`'s `simulated-ink` is a **hue reuse, not a
 * semantic one** (OQ7): the role exists for simulated-value ink elsewhere in
 * the app, and this token borrows its violet for the unrelated reason that
 * `#7c3aed` was already that hue.
 *
 * **The base theme's light/dark rules** (`F3.65c` review). `@codemirror/view`
 * paints the drawn cursor, the selection and the tooltips from `&light` /
 * `&dark` base rules, chosen by the `EditorView.darkTheme` facet — which
 * `FormulaEditor` sets from the theme store. The cursor, the selection, the
 * tooltip surface and the highlighted completion are overridden here too, so
 * those read roles in both themes. Still library colours: the disabled
 * completion flash (`#777` / `#444`), the light `.cm-tooltip-section` divider
 * (`#bbb`), and `@codemirror/lint`'s markers (the `#d11` diagnostic bar, the
 * `#f11` underline). An `EditorView.theme` cannot
 * name `&light` / `&dark` (it throws "Unsupported selector"), so each rule
 * below repeats its base rule's selector shape at the same specificity, and
 * wins because a base theme mounts first (`Prec.lowest`). The focused
 * selection key is therefore the base rule's whole `> .cm-scroller >
 * .cm-selectionLayer` chain; a shorter selector would lose. `info-wash` and
 * `well` are the selection backgrounds on which every token ink above clears
 * 4.5:1 in dark as well as light (`tests/f3.65a-colour-contrast.test.ts`).
 * There is no `caretColor`: `drawSelection` (in `minimalSetup`) sets
 * `.cm-content { caretColor: transparent !important }` and draws `.cm-cursor`
 * instead, so a caret colour here would have no effect.
 */
export const CALC_THEME_SPEC = {
  "&": {
    fontSize: "13px",
    border: "1px solid rgb(var(--line))",
    borderRadius: "0.25rem",
    backgroundColor: "rgb(var(--surface))",
    color: "rgb(var(--ink))",
  },
  "&.cm-focused": { outline: "2px solid rgb(var(--focus))", outlineOffset: "-1px" },
  ".cm-content": {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    padding: "0.5rem 0.75rem",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "rgb(var(--ink))" },
  ".cm-selectionBackground": { background: "rgb(var(--well))" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "rgb(var(--info-wash))",
  },
  // The completion popup, its info panel and the lint message are each a
  // `.cm-tooltip` mounted inside the editor (no tooltip `parent` is set), so
  // this theme's prefix reaches them.
  ".cm-tooltip": {
    backgroundColor: "rgb(var(--surface))",
    color: "rgb(var(--ink))",
    border: "1px solid rgb(var(--line-strong))",
  },
  // `@codemirror/autocomplete`'s `&light` / `&dark` rule for the highlighted
  // option (`#17c` / `#347` under white), at the same specificity.
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    background: "rgb(var(--accent-strong))",
    color: "rgb(var(--on-accent))",
  },
  ".cm-calc-ref": { color: "rgb(var(--accent-strong))", fontWeight: "600" },
  ".cm-calc-number": { color: "rgb(var(--ink))" },
  ".cm-calc-function": { color: "rgb(var(--simulated-ink))" },
  ".cm-calc-operator": { color: "rgb(var(--ink-muted))" },
  ".cm-calc-punctuation": { color: "rgb(var(--ink-muted))" },
  // `bms-calc-v2` only (ADR 0055): a scope reads like a keyword, a string like
  // a literal. Neither is emitted under `v1`, so a `v1` formula never sees them.
  ".cm-calc-scope": { color: "rgb(var(--warning-ink))", fontWeight: "600" },
  ".cm-calc-string": { color: "rgb(var(--info-ink))" },
  // `bms-calc-v3` only (ADR 0070): a `$key` parameter reads like a reference
  // to something stored, not a point — the ref green, italic.
  ".cm-calc-param": { color: "rgb(var(--accent-strong))", fontStyle: "italic" },
  // `bms-calc-v3` only (ADR 0070 decision 5, `E4.1b`): a window literal reads
  // like a keyword — the scope amber, so `24h` and `@site` sit in one family.
  ".cm-calc-window": { color: "rgb(var(--warning-ink))", fontStyle: "italic" },
};

const calcTheme = EditorView.theme(CALC_THEME_SPEC);

/**
 * Whether the editor at `dom` applies CodeMirror's `&dark` base rules — the
 * `EditorView.darkTheme` facet. Exported for `formula-editor-theme.spec.tsx`,
 * which may not import CodeMirror itself (`tests/adr-0038-formula-editor.test.ts`).
 */
export function editorIsDark(dom: HTMLElement): boolean {
  const view = EditorView.findFromDOM(dom);
  if (view === null) {
    throw new Error("no CodeMirror editor at this element");
  }
  return view.state.facet(EditorView.darkTheme);
}

/**
 * Keeps the field to one line.
 *
 * Two separate routes have to be closed, and closing one is what makes the
 * other easy to miss:
 *
 * - **Enter.** `minimalSetup` carries `defaultKeymap`, which binds Enter to
 *   `insertNewlineAndIndent`. `Prec.highest` puts this ahead of it; returning
 *   `true` means "handled", so the key does nothing at all.
 * - **Paste.** A transaction filter rewrites each inserted newline as a space.
 *   `flattenNewlines` is length-preserving, so the transaction's own selection
 *   stays correct and does not need recomputing.
 *
 * Neither is about validity. The tokenizer treats `\n` as ordinary whitespace,
 * so a multi-line formula would parse and save — it would just grow the field a
 * line for no reason the author asked for.
 */
const singleLine: Extension[] = [
  Prec.highest(keymap.of([{ key: "Enter", run: () => true }])),
  EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged) {
      return transaction;
    }
    const rewritten: { from: number; to: number; insert: string }[] = [];
    let sawNewline = false;
    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const text = inserted.toString();
      if (/[\r\n]/.test(text)) {
        sawNewline = true;
      }
      rewritten.push({ from: fromA, to: toA, insert: flattenNewlines(text) });
    });
    if (!sawNewline) {
      return transaction;
    }
    return { changes: rewritten, selection: transaction.selection, scrollIntoView: true };
  }),
];

/**
 * Builds the extension list.
 *
 * Every extension reads the **current** props through `propsRef` rather than
 * closing over a snapshot. The alternative is a `Compartment` per prop and a
 * reconfigure on every keystroke; this way the editor is created once and the
 * only compartments are the two that have to be — `editable`, which changes
 * the editor's own behaviour rather than a callback's answer, and `darkMode`
 * (`F3.65c`), the `EditorView.darkTheme` facet that picks CodeMirror's light
 * or dark base rules. `dark` is the theme at creation; a toggle after that
 * reconfigures `darkMode`.
 */
function buildExtensions(
  propsRef: { current: FormulaEditorProps },
  editable: Compartment,
  darkMode: Compartment,
  dark: boolean,
): Extension[] {
  const highlight = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        // ADR 0038 decision 9: an `"unvalidated"` KPI gains highlighting only
        // after the author opts in and the expression parses. Until then the
        // field is free text and must look like free text.
        if (!isCheckedDialect(propsRef.current)) {
          return builder.finish();
        }
        // `calcDecorations` returns source order, which is what
        // `RangeSetBuilder` requires. It also returns `[]` for text that does
        // not lex — the normal state mid-keystroke, not an error.
        //
        // `F2.9` Task 15: lexed under the row's own dialect. Without it a `v2`
        // formula is lexed as `v1`, stops at the `@`, and renders unstyled from
        // there on — silent rather than wrong, but the author sees plain text
        // where every other formula is coloured and reads it as broken.
        for (const decoration of calcDecorations(
          view.state.doc.toString(),
          decorationDialect(propsRef.current),
        )) {
          builder.add(
            decoration.from,
            decoration.to,
            Decoration.mark({ class: decoration.className }),
          );
        }
        return builder.finish();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  const lintSource = (view: EditorView): Diagnostic[] => {
    const validation = validateEditorFormula(propsRef.current, view.state.doc.toString());
    if (validation.state !== "error") {
      return [];
    }
    return editorDiagnosticRanges(validation.diagnostics, view.state.doc.length).map((range) => ({
      ...range,
      severity: "error" as const,
    }));
  };

  const completions = (context: CompletionContext): CompletionResult | null => {
    // Only inside a `{`. A point key may hold anything except a brace
    // (`tokenizer.ts:83-98`), so the run is matched by exclusion.
    const opened = context.matchBefore(/\{[^{}]*/);
    if (!opened) {
      return null;
    }
    const alreadyClosed = context.state.sliceDoc(context.pos, context.pos + 1) === "}";
    return {
      from: opened.from + 1,
      options: completionKeys(propsRef.current).map((key) => ({
        label: key,
        type: "variable",
        apply: alreadyClosed ? key : `${key}}`,
      })),
    };
  };

  // `F2.22` T5: the `@` scope source, beside the `{` one. `scopeCompletions`
  // is `[]` unless the surface's dialect is `bms-calc-v2`, and an empty list
  // returns `null` rather than a result with no options — under `v1` there is
  // no `@` grammar, so there is nothing to open a popup for. The `{` source
  // above returns its (possibly empty) key list instead, because a `{` is
  // grammar under both dialects and the popup is right to open there.
  //
  // `[a-z]*` and not `\w*`: a scope name is lowercase letters only
  // (`CALC_SCOPE_KINDS`, matched case-sensitively by the tokenizer), so the
  // run the popup filters on is the run the grammar will read. Whether the
  // matcher fires where an author types is a browser claim (T10), not this
  // file's — nothing here is reachable by a test.
  const scopes = (context: CompletionContext): CompletionResult | null => {
    const opened = context.matchBefore(/@[a-z]*/);
    if (!opened) {
      return null;
    }
    const options = scopeCompletions(propsRef.current);
    if (options.length === 0) {
      return null;
    }
    return {
      from: opened.from,
      options: options.map((scope) => ({
        label: scope.label,
        type: "keyword",
        apply: scope.apply,
        info: scope.info,
      })),
    };
  };

  return [
    ...singleLine,
    minimalSetup,
    autocompletion({ override: [completions, scopes] }),
    linter(lintSource),
    highlight,
    calcTheme,
    EditorView.lineWrapping,
    editable.of(EditorView.editable.of(true)),
    darkMode.of(EditorView.darkTheme.of(dark)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        propsRef.current.onChange(update.state.doc.toString());
      }
    }),
  ];
}

/**
 * A controlled CodeMirror field for one calc expression, lexed, linted and
 * completed under the dialect its rules carry (`bms-calc-v1` or `bms-calc-v2`).
 *
 * Import it through `formula-editor-lazy.tsx`, never directly.
 */
export function FormulaEditor(props: FormulaEditorProps) {
  const propsRef = useRef(props);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableRef = useRef<Compartment | null>(null);
  if (editableRef.current === null) {
    editableRef.current = new Compartment();
  }
  const editable = editableRef.current;
  const darkModeRef = useRef<Compartment | null>(null);
  if (darkModeRef.current === null) {
    darkModeRef.current = new Compartment();
  }
  const darkMode = darkModeRef.current;
  const theme = useTheme();

  // No dependency array: every extension reads props through this ref, so it
  // must be current before the next keystroke reaches a callback. The first
  // render initialises it above, so a callback can never see a stale value.
  useEffect(() => {
    propsRef.current = props;
  });

  // Created once. Recreating the view on a prop change would drop the undo
  // history and the cursor.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    const view = new EditorView({
      doc: propsRef.current.value,
      // The theme at creation comes from the store, not from `theme`: a
      // dependency on `theme` would recreate the view on a toggle and drop the
      // undo history. The effect below carries a toggle in.
      extensions: buildExtensions(
        propsRef,
        editable,
        darkMode,
        useThemeStore.getState().theme === "dark",
      ),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [editable, darkMode]);

  // Push an external change in — a reset, or a draft loaded after mount. The
  // guard is what stops the editor fighting its own `onChange`: without it,
  // every keystroke would dispatch a replacement of the text just typed and
  // send the cursor to the end.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === props.value) {
      return;
    }
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } });
  }, [props.value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editable.reconfigure(EditorView.editable.of(props.readOnly !== true)),
    });
  }, [editable, props.readOnly]);

  // `F3.65c` — a theme toggle moves CodeMirror's base rules between `&light`
  // and `&dark` without recreating the view.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: darkMode.reconfigure(EditorView.darkTheme.of(theme === "dark")),
    });
  }, [darkMode, theme]);

  // `linter()` re-runs on a document change. The rules also depend on props —
  // adding a sibling point resolves a reference without the text moving — so a
  // relint is forced when they change. Without this the underline stays under
  // text that is now correct.
  const validationKey =
    props.mode === "derived"
      ? `derived|${props.selfPointKey}|${props.points.map((p) => `${p.pointKey}:${p.kind}`).join(",")}`
      : `kpi|${props.dialect}|${props.kpiPointKeys.join(",")}|${props.declaredPointKeys.join(",")}`;
  useEffect(() => {
    const view = viewRef.current;
    if (view !== null) {
      forceLinting(view);
    }
  }, [validationKey]);

  return (
    <div
      ref={hostRef}
      className="text-sm"
      role="group"
      aria-label={props.ariaLabel ?? "Formula editor"}
      data-formula-mode={props.mode}
      data-formula-readonly={props.readOnly === true ? "true" : "false"}
    />
  );
}
