/**
 * `F4.359` U6 (ADR 0131 decisions 4, 5 and 9; plan D6, D7) — which active
 * maintenance window covers an alarm. Pure: no read, no clock. The windows are
 * already the active ones (`readActiveWindows`, D2 on the database clock) and
 * the subject already carries the ancestor-or-self locations and the bound
 * assets it is judged on (`maintenance-cover.reads.ts`). The raiser and the
 * lifecycle sweep both decide through {@link firstCoveringWindow}, so one rule
 * answers "is this alarm suppressed, and by which window" everywhere.
 */

/** An active window and its targets, split by kind. */
export type ActiveWindow = {
  readonly id: string;
  readonly organizationId: string;
  readonly startsAt: Date;
  readonly assetIds: readonly string[];
  readonly locationIds: readonly string[];
  readonly ruleIds: readonly string[];
};

/**
 * What an alarm is judged on. `locationAncestorIds` is the ancestor-or-self set
 * of the asset's (rule) or the RTU's (`rtu_comms`) location — the node itself
 * included, so a target on the node covers it. An `ingest_host` alarm carries
 * nothing: it is never covered (decision 5).
 */
export type CoverSubject =
  | {
      readonly source: "rule";
      readonly organizationId: string;
      readonly assetId: string;
      /** `null` when the rule was deleted; the alarm is still covered through its asset. */
      readonly ruleId: string | null;
      readonly locationAncestorIds: readonly string[];
    }
  | {
      readonly source: "rtu_comms";
      readonly organizationId: string;
      readonly locationAncestorIds: readonly string[];
      /** Every asset wired to the RTU (`assets.rtu_id`). */
      readonly boundAssetIds: readonly string[];
    }
  | { readonly source: "ingest_host"; readonly organizationId: string };

function underATargetLocation(window: ActiveWindow, locationAncestorIds: readonly string[]): boolean {
  return window.locationIds.length > 0 && locationAncestorIds.some((id) => window.locationIds.includes(id));
}

/** Decisions 4 and 5 (D7): does this one window cover the subject? */
export function windowCovers(window: ActiveWindow, subject: CoverSubject): boolean {
  if (window.organizationId !== subject.organizationId) return false;
  switch (subject.source) {
    case "rule":
      return (
        window.assetIds.includes(subject.assetId) ||
        (subject.ruleId !== null && window.ruleIds.includes(subject.ruleId)) ||
        underATargetLocation(window, subject.locationAncestorIds)
      );
    case "rtu_comms":
      // D7: the RTU's location is under a target location, or the RTU feeds at
      // least one asset and EVERY one is an asset target of this same window —
      // an RTU that also feeds an asset outside the window keeps its alarm.
      return (
        underATargetLocation(window, subject.locationAncestorIds) ||
        (subject.boundAssetIds.length > 0 && subject.boundAssetIds.every((id) => window.assetIds.includes(id)))
      );
    case "ingest_host":
      return false;
  }
}

/**
 * D6 / decision 9: the first window that covers the subject — the earliest
 * `startsAt`, then the smaller id, whatever order the windows arrive in — or
 * `null` when none does. Its id is what `suppressed_by_window_id` records.
 */
export function firstCoveringWindow(windows: readonly ActiveWindow[], subject: CoverSubject): string | null {
  let first: ActiveWindow | null = null;
  for (const window of windows) {
    if (!windowCovers(window, subject)) continue;
    if (
      first === null ||
      window.startsAt.getTime() < first.startsAt.getTime() ||
      (window.startsAt.getTime() === first.startsAt.getTime() && window.id < first.id)
    ) {
      first = window;
    }
  }
  return first?.id ?? null;
}
