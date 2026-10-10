import type { TabWriteBody } from "@bms/shared";
import { mimicGroupFor } from "./dashboards.pure";

/**
 * `F3.74` (plan D7, Task 2.3) — `mimicGroupFor`, the write guard's group rule, with no database.
 * A mimic resolves against the dashboard's group, else its own tab's group, else the group of the
 * tab its `config.tabKey` names among the body's tabs. One exported claim per `it()`;
 * `dashboards.pure.test.ts` is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SLD_GROUP = "33333333-3333-4333-8333-333333333333";
const HVAC_GROUP = "44444444-4444-4444-8444-444444444444";

const TABS: readonly TabWriteBody[] = [
  { key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null },
  { key: "sld", label: "SLD", sortOrder: 1, assetGroupId: SLD_GROUP },
  { key: "hvac", label: "HVAC", sortOrder: 2, assetGroupId: HVAC_GROUP },
  { key: "notes", label: "Notes", sortOrder: 3, assetGroupId: null },
];

const mimicOn = (tabKey: string, namedTab?: string) => ({
  tabKey,
  config: namedTab === undefined ? {} : { tabKey: namedTab },
});

/** A mimic on a group tab resolves through that tab, even when its config names another one. */
export function ownGroupTabWins(): void {
  const group = mimicGroupFor(null, TABS, mimicOn("hvac", "sld"));
  assert(group === HVAC_GROUP, `own group tab: expected ${HVAC_GROUP}, got ${group}`);
}

/** An Overview mimic naming a group-bound tab resolves through that tab's group. */
export function overviewMimicNamingAGroupTabTakesThatGroup(): void {
  const group = mimicGroupFor(null, TABS, mimicOn("overview", "sld"));
  assert(group === SLD_GROUP, `Overview + tabKey "sld": expected ${SLD_GROUP}, got ${group}`);
}

/** An Overview mimic naming a tab with no group resolves to nothing. */
export function overviewMimicNamingAGroupLessTabIsNull(): void {
  const group = mimicGroupFor(null, TABS, mimicOn("overview", "notes"));
  assert(group === null, `Overview + tabKey "notes" (no group): expected null, got ${group}`);
}

/** An Overview mimic naming a key that is not one of the body's tabs resolves to nothing. */
export function overviewMimicNamingAnAbsentTabIsNull(): void {
  const group = mimicGroupFor(null, TABS, mimicOn("overview", "water"));
  assert(group === null, `Overview + tabKey "water" (absent): expected null, got ${group}`);
}
