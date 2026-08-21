/**
 * The lazy boundary in front of the formula editor (`F2.5`, ADR 0038
 * decision 7 — Unit 5).
 *
 * **This file must never import a CodeMirror symbol as a value.** The one
 * import below is `import type`, which TypeScript and esbuild erase entirely,
 * so nothing here reaches `formula-editor.tsx` at module-evaluation time. The
 * only path to it is the `import()` inside `React.lazy`, which is what makes
 * Rollup emit CodeMirror as its own chunk instead of folding it into the entry
 * bundle every page downloads.
 *
 * Two units check that this held rather than trusting it: Unit 8 asserts
 * statically that no other module imports `codemirror` or `@codemirror/*`, and
 * Unit 10 measures the built output.
 *
 * **This is the first `React.lazy` in `apps/web`**, so there was no existing
 * example to copy. Two choices worth knowing about:
 *
 * - The `<Suspense>` boundary is **here**, not at the page. A page-level
 *   boundary would blank the whole tab while the chunk loads, and the chunk
 *   loads exactly when the author clicks into Calculations or KPIs — the
 *   moment they are least willing to watch the page disappear.
 * - The fallback is a **sized** skeleton, not `null`. A zero-height fallback
 *   makes the tab jump when the chunk arrives, and the jump lands under the
 *   pointer that is already moving toward the field.
 */
import { Suspense, lazy } from "react";

import type { FormulaEditorProps } from "./formula-editor";

const FormulaEditorImpl = lazy(async () => {
  const editorModule = await import("./formula-editor");
  return { default: editorModule.FormulaEditor };
});

/**
 * Holds the editor's place while its chunk loads.
 *
 * Sized to match the editor's own resting height, so the row does not resize
 * when the real field replaces it.
 */
function FormulaEditorSkeleton() {
  return (
    <div
      className="h-[38px] animate-pulse rounded border border-gray-200 bg-gray-50"
      role="status"
      aria-label="Loading the formula editor"
    />
  );
}

/**
 * The formula editor, loaded on demand.
 *
 * Every caller uses this. Importing `./formula-editor` directly would pull
 * CodeMirror into the entry chunk and defeat the whole arrangement.
 */
export function FormulaEditorLazy(props: FormulaEditorProps) {
  return (
    <Suspense fallback={<FormulaEditorSkeleton />}>
      <FormulaEditorImpl {...props} />
    </Suspense>
  );
}

export type { FormulaEditorProps };
