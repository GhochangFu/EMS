import { formatSlaMinutes, type WorkOrderSlaState } from "@bms/shared";

/** `E3.1` / ADR 0122 decision 3: the words of the six SLA states. */
export const SLA_STATE_LABELS: Record<WorkOrderSlaState, string> = {
  none: "No SLA",
  on_track: "On track",
  at_risk: "At risk",
  breached: "Breached",
  met: "Met",
  missed: "Missed",
};

/** `E3.1` / ADR 0122 decision 3: a class string per state; live states are soft, settled ones solid. */
export function slaChipClass(state: WorkOrderSlaState): string {
  switch (state) {
    case "on_track":
      return "border border-line bg-ok-wash text-ok-ink";
    case "met":
      return "border border-ok bg-ok-wash text-ok-ink";
    case "at_risk":
      return "border border-warning-line bg-warning-wash-strong text-warning-ink";
    case "breached":
      return "border border-critical-line bg-critical-wash-strong text-critical-ink-strong";
    case "missed":
      return "border border-critical-line bg-critical-wash-strong text-critical-ink-strong font-semibold";
    case "none":
      return "border border-line bg-well-deep text-neutral-ink";
  }
}

/** `E3.1` / ADR 0122 decision 3: the SLA chip, e.g. `SLA 30 mins · On track`. */
export function WorkOrderSlaChip({
  slaMinutes,
  slaState,
}: {
  slaMinutes: number | null;
  slaState: WorkOrderSlaState;
}) {
  // `none` wins over the minutes: a cancelled ticket keeps its `slaMinutes` and is owed no SLA (decision 6.8).
  const text =
    slaMinutes === null || slaState === "none"
      ? SLA_STATE_LABELS.none
      : `SLA ${formatSlaMinutes(slaMinutes)} · ${SLA_STATE_LABELS[slaState]}`;
  return <span className={`rounded-full px-2 py-0.5 text-2xs ${slaChipClass(slaState)}`}>{text}</span>;
}
