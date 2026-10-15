import type { MimicOrgSymbolDto } from "@bms/shared";
import { useMemo } from "react";

import type { MimicLayoutWriteBody } from "../../api/mimic-layouts";
import { editorLayoutFromWriteBody } from "../../lib/mimic-editor";
import { layoutGeometry } from "../../lib/mimic-geometry";
import { NO_READINGS } from "../../lib/mimic-no-readings";
import { useLazyLibraries } from "../widgets/mimic-symbol-libraries/use-lazy-libraries";
import { MimicScene } from "../widgets/mimic-scene";

export type MimicLayoutPreviewProps = {
  /** The proposed layout's write body (a copilot card's stored body, its `cardOnly` keys stripped). */
  body: MimicLayoutWriteBody;
  /** The organization symbols the units may draw; `[]` draws an `org.` unit as its fallback glyph. */
  orgSymbols: readonly MimicOrgSymbolDto[];
};

/**
 * `F3.87` PR 5 (ADR 0099 Amendment 3 A2) — a copilot layout card's drawing: the proposed layout
 * drawn from its body alone, through `layoutGeometry` exactly as the editor's canvas and the
 * "Start from" preview draw theirs (`preset-preview.tsx`). No live data: no query, no socket,
 * every roled unit "Not assigned". The lazy libraries the body chose are loaded on mount.
 */
export function MimicLayoutPreview({ body, orgSymbols }: MimicLayoutPreviewProps) {
  const shapesVersion = useLazyLibraries(body.symbolLibraries ?? []);
  const geometry = useMemo(() => {
    const layout = editorLayoutFromWriteBody(body);
    return layoutGeometry({
      name: layout.name,
      canvasW: layout.canvasW,
      canvasH: layout.canvasH,
      nodes: [...layout.nodes],
      pipes: [...layout.pipes],
      orgSymbols: [...orgSymbols],
    });
    // `shapesVersion` redraws the scene when a lazy library settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, orgSymbols, shapesVersion]);

  return (
    <div
      data-testid="copilot-layout-preview"
      className="surface-pressed mt-2 w-full"
      style={{ aspectRatio: `${body.canvasW} / ${body.canvasH}` }}
    >
      <MimicScene title={`${body.name} preview`} geometry={geometry} nodes={[]} readings={NO_READINGS} compact />
    </div>
  );
}
