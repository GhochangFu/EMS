/**
 * `F3.87` PR 6b (ADR 0099 Amendment 3 A3, plan D14) — a symbol upload card's
 * drawing: the SVG text the turn stored, as an `<img>` from a
 * `data:image/svg+xml,` URL. Never inline SVG — an `<img>` runs no script.
 * Never a `blob:` URL either: a blob URL carries the app's origin, so "Open
 * image in new tab" would load the SVG as a document that runs its handlers
 * (an `onload` the parser drops rather than refuses) beside the stored tokens;
 * browsers block a top-level `data:` navigation. Fidelity note: the browser
 * draws the raw file; the route stores the parser's shapes, which the
 * libraries page draws once it is applied.
 */
export function SymbolUploadPreview({ svgText, label }: { svgText: string; label: string }) {
  return (
    <div className="surface-pressed mt-2 flex items-center justify-center p-2">
      <img src={`data:image/svg+xml,${encodeURIComponent(svgText)}`} alt={label} width={64} height={64} className="h-16 w-16" />
    </div>
  );
}
