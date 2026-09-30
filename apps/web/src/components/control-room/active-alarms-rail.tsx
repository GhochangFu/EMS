import { useQuery } from "@tanstack/react-query";

import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { useActiveAlarms } from "../../hooks/use-active-alarms";
import { ActiveAlarmsRailBody, type RailFeed } from "./active-alarms-rail-body";

/** The page's asset read — TanStack's `status` for `GET /api/v1/assets`. */
export type AssetsStatus = "pending" | "success" | "error";

/** What the rail says when it has no ids, by why it has none. */
const NO_IDS_NOTE: Record<AssetsStatus, string> = {
  pending: "Loading alarms…",
  error: "Alarms unavailable.",
  success: "No assets in scope",
};

/** A query's `status`, as the body's feed: `success` is `ready` and carries its items. */
function feedOf<T>(query: { status: "pending" | "error" | "success"; data?: { items: readonly T[] } }): RailFeed<T> {
  return query.status === "success" && query.data !== undefined
    ? { status: "ready", items: query.data.items }
    : { status: query.status === "success" ? "pending" : query.status };
}

/**
 * The rail reads one of two scopes. `assetIds` is the `F3.28` pages' scope.
 * `organizationId` (`F3.66` step-5 fix) is the Control Room organization
 * page's: the API narrows by organization, intersected with the caller's
 * readable assets, so the page no longer sends every asset id against the
 * API's 200-id cap.
 */
export type ActiveAlarmsRailProps =
  | {
      assetIds: readonly string[];
      /**
       * The state of the page's asset read, which resolves `assetIds`. With no ids
       * the two reads are disabled, and a disabled query answers nothing — so
       * without this the rail would say "No active alarms" on every cold load,
       * before it has asked, and "Loading alarms…" forever after a failed read.
       */
      assetsStatus?: AssetsStatus;
      organizationId?: undefined;
    }
  | {
      organizationId: string;
      assetIds?: undefined;
      assetsStatus?: undefined;
    };

/**
 * The `/cr-overview` alarms rail (`F3.28`, ADR 0074 decision 4). It replaced
 * `ActiveRulesPanel`, which re-derived warnings from rules in the browser;
 * this reads the alarms the server raised, for the page's own assets, and
 * refreshes on `/ws/alarms` events.
 *
 * *Active Alarms* is the newest alarms, message verbatim. *Alarm Summary* is
 * the count per severity, most urgent first, then the total. Both are drawn by
 * `ActiveAlarmsRailBody` (`F3.73` moved the drawing out so the `active_alarms_rail`
 * site widget draws the same rail from its own read); this component owns the
 * two reads, the vocabulary and the no-ids note.
 */
export function ActiveAlarmsRail(props: ActiveAlarmsRailProps) {
  const { assetsStatus = "success" } = props;
  const { active, summary } = useActiveAlarms(
    props.organizationId !== undefined ? { organizationId: props.organizationId } : props.assetIds,
  );
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  // With no ids nothing is fetched: say why, never "No active alarms". The
  // organization scope needs no ids, so it never shows this note.
  const noIdsNote =
    props.organizationId !== undefined || props.assetIds.length > 0 ? null : NO_IDS_NOTE[assetsStatus];

  return (
    <section aria-label="Alarms" className="surface-raised p-4">
      <ActiveAlarmsRailBody
        active={feedOf(active)}
        summary={feedOf(summary)}
        total={summary.data?.total ?? 0}
        severities={vocabQ.data?.alarmSeverities ?? []}
        noIdsNote={noIdsNote}
      />
    </section>
  );
}
