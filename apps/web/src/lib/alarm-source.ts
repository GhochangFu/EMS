import type { AlarmListItem } from "@bms/shared";

/**
 * `F3.16` / ADR 0127 decisions 12 and 14 — a device alarm has no asset. Where an
 * asset label would stand, an `rtu_comms` alarm names its RTU (`RTU <code>`) and
 * an `ingest_host` alarm the ingest host. One helper, so the grid, the rail, the
 * details panel and the two wizards say the same thing.
 */
type AlarmSource = Pick<AlarmListItem, "source" | "rtuCode">;

export const INGEST_HOST_LABEL = "Ingest host";

/** The device label, or `null` for a rule alarm (which has an asset). */
export function deviceAlarmLabel(alarm: AlarmSource): string | null {
  if (alarm.source === "rtu_comms") {
    return alarm.rtuCode === null ? "RTU" : `RTU ${alarm.rtuCode}`;
  }
  if (alarm.source === "ingest_host") {
    return INGEST_HOST_LABEL;
  }
  return null;
}

/** The name an alarm is "on": its asset's name, else the device label. */
export function alarmSubjectName(alarm: AlarmSource & { assetName: string | null }): string {
  return alarm.assetName ?? deviceAlarmLabel(alarm) ?? "";
}
