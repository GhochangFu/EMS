import type { ReactNode } from "react";

import type { LiveSvgStatus } from "./types";
import { useSchematicTelemetry } from "./schematic-telemetry-context";

export type LiveSvgChildProps = {
  status: LiveSvgStatus;
  /** Latest kW when point is electrical `kw`. */
  kw: number | null;
  stale: boolean;
};

type LiveSvgComponentProps = {
  /** When omitted, children receive running + null kW (static decoration). */
  assetId?: string;
  children: (props: LiveSvgChildProps) => ReactNode;
};

/**
 * Reusable telemetry-aware SVG wrapper (Sprint 6). Parent must wrap the page
 * in `SchematicTelemetryProvider`. For purely decorative nodes, omit `assetId`.
 */
export function LiveSvgComponent({ assetId, children }: LiveSvgComponentProps) {
  const { slice, status, stale } = useSchematicTelemetry(assetId);
  if (!assetId) {
    return children({ status: "running", kw: null, stale: false });
  }
  return children({ status, kw: slice.kw, stale });
}
