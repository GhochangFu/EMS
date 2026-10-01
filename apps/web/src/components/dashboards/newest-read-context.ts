import { createContext, useContext } from "react";

/** Receives the canvas's newest read in epoch ms, or `null` when it holds none. */
export type ReportNewestRead = (newestMs: number | null) => void;

const ignore: ReportNewestRead = () => undefined;

/**
 * `F3.77` (plan D9, owner ruling OQ5) — how `DashboardLiveCanvas` tells the wall frame the time of
 * its newest read (`newestReadMs`: the latest socket or seeded sample, the catalog read and the
 * tab's site-widgets read). The default is a no-op, so the viewer and the normal site view — which
 * mount no provider — render the canvas unchanged. Only `WallFrame` provides a reporter.
 */
export const NewestReadContext = createContext<ReportNewestRead>(ignore);

export function useReportNewestRead(): ReportNewestRead {
  return useContext(NewestReadContext);
}
