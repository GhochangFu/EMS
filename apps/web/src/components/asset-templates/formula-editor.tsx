/**
 * The formula editor (`F2.5`, ADR 0038 decisions 4, 5, 6, 7 — Unit 5).
 *
 * **This is the only module in the repository allowed to import `codemirror`
 * or `@codemirror/*`.** Everything else reaches it through
 * `formula-editor-lazy.tsx`, which is what keeps the library in its own chunk.
 * Unit 8 asserts that statically; the rule is not enforced by the bundler.
 *
 * One component serves both authored-formula surfaces — a derived point's
 * `formula` and a KPI's `expression` (decision 4) — because they share the
 * `bms-calc-v1` parser. They share nothing else, so `mode` is a discriminated
 * union rather than a flag: the two arms genuinely need different props.
 *
 * **Composed from `minimalSetup`, never `basicSetup`** (ADR 0038 Amendment 1).
 * `basicSetup` imports and uses `highlightSelectionMatches` and `searchKeymap`,
 * which would make `@codemirror/search` a live import by construction and turn
 * decision 7's bundle check from an assertion into a measurement.
 * `minimalSetup` already carries `history`, so Ctrl+Z works without
 * `@codemirror/commands` appearing here.
 *
 * All the logic worth testing lives in `src/lib/` — `calc-decorations.ts`,
 * `calc-preview.ts` and `template-formula-validation.ts`. This file is the
 * wiring between those and CodeMirror, and `apps/web`'s Vitest project runs
 * `environment: "node"` over `src/**\/*.test.ts`, so a `.tsx` is not reachable
 * by a test here at all. Keeping it thin is what makes that acceptable.
 */
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { forceLinting, linter, type Diagnostic } from "@codemirror/lint";
import { Compartment, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { useEffect, useRef } from "react";

import type { TemplateKpi } from "@bms/shared";

import { calcDecorations } from "../../lib/calc-decorations";
import {
  validateDerivedFormula,
  validateKpiExpression,
  type FormulaPoint,
  type FormulaValidation,
} from "../../lib/template-formula-validation";

/**
 * What the editor needs, per surface.
 *
 * The plan's prop list was `{ value, onChange, mode, resolvableKeys,
 * kpiPointKeys?, readOnly, dialect }`. A single `resolvableKeys: string[]`
 * cannot serve both arms: `validateDerivedFormula` needs each sibling's
 * **kind** (ADR 0036 decision 7 forbids derived-to-derived chaining) and needs
 * to know which point is being edited, while the KPI arm needs two separate
 * key lists that must agree in both directions. Spelling it as a union moves
 * a guaranteed runtime failure to compile time, the same reasoning
 * `InstantiateAssetsInput` uses in `api/admin/asset-templates.ts`.
 */
export type FormulaEditorProps = {
  value: string;
  onChange: (next: string) => void;
  /** ADR 0038 decision 3: a published version renders read-only, never editable. */
  readOnly?: boolean;
  ariaLabel?: string;
} & (
  | {
      mode: "derived";
      /** Every point this template declares, with its kind. */
      points: readonly FormulaPoint[];
      /** The point being edited. Referencing it is a self-reference. */
      selfPointKey: string;
    }
  | {
      mode: "kpi";
      /** The keys `points[]` declares — the `findUnresolvedContentRefs` half. */
      declaredPointKeys: readonly string[];
      /** The KPI's own `pointKeys`, cross-checked in both directions. */
      kpiPointKeys: readonly string[];
      /** `"unvalidated"` suppresses every check (decision 9). */
      dialect: TemplateKpi["dialect"];
    }
);

/**
 * Runs the right validator for the surface.
 *
 * Whitespace-only text is `"unvalidated"` rather than an empty-expression
 * error. A derived point that has no formula yet is not a mistake, and
 * underlining an untouched field reads as one.
 */
function validate(props: FormulaEditorProps, text: string): FormulaValidation {
  if (text.trim().length === 0) {
    return { state: "unvalidated" };
  }
  if (props.mode === "derived") {
    return validateDerivedFormula(text, props.points, props.selfPointKey);
  }
  return validateKpiExpression(
    { expression: text, pointKeys: props.kpiPointKeys, dialect: props.dialect },
    props.declaredPointKeys,
  );
}

/**
 * The keys `{` completion offers.
 *
 * In derived mode this is **measured siblings only**, minus the point being
 * edited: those are exactly the references the server will accept, so
 * completion prevents the error rather than reporting it (decision 7's
 * justification for taking `@codemirror/autocomplete`).
 */
function completionKeys(props: FormulaEditorProps): string[] {
  if (props.mode === "derived") {
    return props.points
      .filter((point) => point.kind === "measured" && point.pointKey !== props.selfPointKey)
      .map((point) => point.pointKey);
  }
  return [...props.declaredPointKeys];
}

/** True when the surface is checked at all — a `"unvalidated"` KPI is not. */
function isCheckedDialect(props: FormulaEditorProps): boolean {
  return props.mode === "derived" || props.dialect === "bms-calc-v1";
}

/**
 * Colours for the token classes `calc-decorations.ts` emits.
 *
 * An `EditorView.theme` rather than a rule in `index.css`: it ships inside this
 * lazy chunk, so a page that never opens the Calculations tab never downloads
 * it. The palette is `tailwind.config.js`'s `bms` scale, by value — a theme
 * object cannot carry a Tailwind class name.
 */
const calcTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    border: "1px solid #e5e7eb",
    borderRadius: "0.25rem",
    backgroundColor: "#ffffff",
  },
  "&.cm-focused": { outline: "2px solid #00A651", outlineOffset: "-1px" },
  ".cm-content": {
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    padding: "0.5rem 0.75rem",
    caretColor: "#1A2230",
  },
  ".cm-calc-ref": { color: "#007C3C", fontWeight: "600" },
  ".cm-calc-number": { color: "#1D2430" },
  ".cm-calc-function": { color: "#7c3aed" },
  ".cm-calc-operator": { color: "#4A5464" },
  ".cm-calc-punctuation": { color: "#4A5464" },
});

/**
 * Builds the extension list.
 *
 * Every extension reads the **current** props through `propsRef` rather than
 * closing over a snapshot. The alternative is a `Compartment` per prop and a
 * reconfigure on every keystroke; this way the editor is created once and the
 * only compartment is the one that has to be one — `editable`, which changes
 * the editor's own behaviour rather than a callback's answer.
 */
function buildExtensions(
  propsRef: { current: FormulaEditorProps },
  editable: Compartment,
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
        const text = view.state.doc.toString();
        // `calcDecorations` returns source order, which is what
        // `RangeSetBuilder` requires. It also returns `[]` for text that does
        // not lex — the normal state mid-keystroke, not an error.
        for (const decoration of calcDecorations(text)) {
          builder.add(decoration.from, decoration.to, Decoration.mark({ class: decoration.className }));
        }
        return builder.finish();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  const lintSource = (view: EditorView): Diagnostic[] => {
    const text = view.state.doc.toString();
    const validation = validate(propsRef.current, text);
    if (validation.state !== "error") {
      return [];
    }
    const end = view.state.doc.length;
    return validation.diagnostics.map((diagnostic) => {
      const from = Math.min(Math.max(diagnostic.from, 0), end);
      const to = Math.min(Math.max(diagnostic.to, from), end);
      return {
        // A zero-width diagnostic renders nothing, so it is widened by one
        // character where there is one to take. `eof` positions produce this.
        from: to === from && from > 0 ? from - 1 : from,
        to,
        severity: "error" as const,
        message: diagnostic.message,
      };
    });
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

  return [
    minimalSetup,
    autocompletion({ override: [completions] }),
    linter(lintSource),
    highlight,
    calcTheme,
    // One line only. The two surfaces are single short expressions, capped at
    // 1000 characters by `templatePointBodySchema`; a newline in one would be
    // stored and then rejected.
    EditorView.lineWrapping,
    editable.of(EditorView.editable.of(true)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        propsRef.current.onChange(update.state.doc.toString());
      }
    }),
  ];
}

/**
 * A controlled CodeMirror field for one `bms-calc-v1` expression.
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
      extensions: buildExtensions(propsRef, editable),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [editable]);

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
