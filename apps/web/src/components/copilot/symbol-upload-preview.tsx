import { useEffect, useState } from "react";

/**
 * `F3.87` PR 6b (ADR 0099 Amendment 3 A3, plan D14) — a symbol upload card's
 * drawing: the SVG text the turn stored, as an `<img>` from a blob URL typed
 * `image/svg+xml`. Never inline SVG — an `<img>` runs no script and reaches
 * nothing outside its own document. The URL is made after mount and revoked on
 * unmount. Fidelity note: the browser draws the raw file; the route stores the
 * parser's shapes, which the libraries page draws once it is applied.
 */
export function SymbolUploadPreview({ svgText, label }: { svgText: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [svgText]);
  if (src === null) return null;
  return (
    <div className="surface-pressed mt-2 flex items-center justify-center p-2">
      <img src={src} alt={label} width={64} height={64} className="h-16 w-16" />
    </div>
  );
}
