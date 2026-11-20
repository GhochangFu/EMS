import {
  INGEST_HOST_ALARM_MESSAGE,
  INGEST_HOST_RAISE_AFTER_SECONDS,
  ingestHostDue,
  ingestHostMessage,
} from "./device-alarm-rule";
import type { RtuHealthRow } from "./device-health.reads";
import type { HostBeat } from "./device-state";

/**
 * `F3.89` / ADR 0127 Amendment 2 — the host alarm's raise hold and its text, over plain rows.
 * The database clock is {@link DB_NOW}; a host beat `n` seconds ago is `beat(n)`. A 60 s window
 * puts Stale past 36 s and Offline past 60 s of silence (decision 11), counted to the host's beat.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DB_NOW = Date.parse("2026-11-20T03:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";

function hostBeat(hostKey: string, secondsAgo: number): HostBeat {
  return { hostKey, lastBeatMs: DB_NOW - secondsAgo * 1000, healthySinceMs: DB_NOW - 3_600_000 };
}

/** An RTU heard `silentSeconds` before its host's beat (the beat is `beatSecondsAgo` before DB_NOW). */
function row(
  id: string,
  site: string,
  silentSeconds: number,
  overrides: Partial<RtuHealthRow> = {},
  beatSecondsAgo = 200,
): RtuHealthRow {
  return {
    rtuId: `rtu-${id}`,
    organizationId: ORG,
    code: id,
    displayName: id,
    locationId: `loc-${site}`,
    locationName: site,
    edgeServed: false,
    hostKey: "cloud",
    lastSeenMs: DB_NOW - beatSecondsAgo * 1000 - silentSeconds * 1000,
    monitoredSinceMs: DB_NOW - 7_200_000,
    windowSeconds: 60,
    clockSkewSeconds: null,
    clockSkewAtMs: null,
    ...overrides,
  };
}

function message(rows: RtuHealthRow[], hosts: HostBeat[] = [hostBeat("cloud", 200)]): string {
  return ingestHostMessage(rows, new Map(hosts.map((h) => [h.hostKey, h])), DB_NOW);
}

function expectText(actual: string, expected: string): void {
  assert(actual === expected, `expected\n  ${expected}\ngot\n  ${actual}`);
}

export function assertTheHoldIs120Seconds(): void {
  assert(INGEST_HOST_RAISE_AFTER_SECONDS === 120, `expected 120, got ${INGEST_HOST_RAISE_AFTER_SECONDS}`);
}

/** Reporting → false; stale under the hold → false; at the hold → true; no monitored RTU → null. */
export function assertIngestHostDueWaitsForTheHold(): void {
  const rows = [row("A1", "Lotapata I", 5)];
  assert(ingestHostDue(rows, [hostBeat("cloud", 5)], DB_NOW) === false, "a fresh host is not due");
  assert(ingestHostDue(rows, [hostBeat("cloud", 45)], DB_NOW) === false, "45 s stale (a restart) is not due");
  assert(ingestHostDue(rows, [hostBeat("cloud", 119)], DB_NOW) === false, "119 s is not due");
  assert(ingestHostDue(rows, [hostBeat("cloud", 120)], DB_NOW) === true, "120 s is due");
  assert(ingestHostDue([row("A1", "X", 5, { monitoredSinceMs: null })], [hostBeat("cloud", 600)], DB_NOW) === null, "no monitored RTU → null");
}

/** A host key the RTUs name with no host row has no beat to count from: due at once. */
export function assertARowlessHostIsDueAtOnce(): void {
  assert(ingestHostDue([row("A1", "Lotapata I", 5)], [], DB_NOW) === true, "a rowless host is due");
}

/** Two serving hosts: one stale past the hold makes the organization due even if the other is fresh. */
export function assertOneStaleHostOfTwoIsDue(): void {
  const rows = [row("A1", "S1", 5), row("B1", "S2", 5, { hostKey: "edge" })];
  assert(ingestHostDue(rows, [hostBeat("cloud", 5), hostBeat("edge", 150)], DB_NOW) === true, "one stale host is due");
}

export function assertTheTextNamesHostSitesAndRtus(): void {
  expectText(
    message([row("R2", "Lotapata II", 5), row("R1", "Lotapata I", 5), row("R3", "Lotapata I", 40)]),
    "Ingest host not reporting: cloud — 3 RTUs at 2 sites stopped: Lotapata I, Lotapata II; RTUs: R1, R2, R3",
  );
}

export function assertSingularForms(): void {
  expectText(
    message([row("R1", "Bilsi I", 5)]),
    "Ingest host not reporting: cloud — 1 RTU at 1 site stopped: Bilsi I; RTUs: R1",
  );
}

/** At most five names of each, then "+N more". */
export function assertTheListsAreCapped(): void {
  const rows = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"].map((site, i) => row(`R${i + 1}`, site, 5));
  rows.push(row("R8", "S1", 5));
  expectText(
    message(rows),
    "Ingest host not reporting: cloud — 8 RTUs at 7 sites stopped: S1, S2, S3, S4, S5, +2 more sites; RTUs: R1, R2, R3, R4, R5, +3 more",
  );
  expectText(
    message(["S1", "S2", "S3", "S4", "S5", "S6"].map((site, i) => row(`R${i + 1}`, site, 5))),
    "Ingest host not reporting: cloud — 6 RTUs at 6 sites stopped: S1, S2, S3, S4, S5, +1 more site; RTUs: R1, R2, R3, R4, R5, +1 more",
  );
}

/** An RTU already Offline at the host's last beat stopped on its own and is left out; a Stale one is in. */
export function assertAnOfflineRtuIsLeftOut(): void {
  expectText(
    message([row("ON", "S1", 5), row("ST", "S1", 40), row("OFF", "S2", 600)]),
    "Ingest host not reporting: cloud — 2 RTUs at 1 site stopped: S1; RTUs: ON, ST",
  );
}

/** Edge-served RTUs count (their uplinks pass through the host); not-monitored ones do not. */
export function assertEdgeServedCountsAndNotMonitoredDoesNot(): void {
  expectText(
    message([row("E1", "S1", 5, { edgeServed: true }), row("N1", "S2", 5, { monitoredSinceMs: null })]),
    "Ingest host not reporting: cloud — 1 RTU at 1 site stopped: S1; RTUs: E1",
  );
}

/** The RTU's display name, else its code. */
export function assertABlankDisplayNameFallsBackToTheCode(): void {
  expectText(
    message([row("LEPPLT1", "S1", 5, { displayName: "  " }), row("X", "S1", 5, { displayName: "Bilsi pump" })]),
    "Ingest host not reporting: cloud — 2 RTUs at 1 site stopped: S1; RTUs: Bilsi pump, LEPPLT1",
  );
}

/** Only the stopped hosts are named, and only their RTUs listed. */
export function assertOnlyTheStoppedHostsAreNamed(): void {
  const hosts = [hostBeat("cloud", 200), hostBeat("fresh", 5), hostBeat("b-host", 300)];
  expectText(
    message([row("C1", "S1", 5), row("F1", "S2", 5, { hostKey: "fresh" }), row("B1", "S3", 5, { hostKey: "b-host" })], hosts),
    "Ingest host not reporting: b-host, cloud — 2 RTUs at 2 sites stopped: S1, S3; RTUs: B1, C1",
  );
}

/** A rowless host is named; with no beat its RTUs have no state, so none is active. */
export function assertARowlessHostIsNamedWithNoActiveRtus(): void {
  expectText(message([row("C1", "S1", 5)], []), "Ingest host not reporting: cloud — no active RTUs");
}

export function assertNoActiveRtusReadsSo(): void {
  expectText(message([row("OFF", "S1", 600)]), "Ingest host not reporting: cloud — no active RTUs");
  assert(message([row("OFF", "S1", 600)]).startsWith(INGEST_HOST_ALARM_MESSAGE), "the prefix is the old text");
}

/** A name is cut to 64 characters and the whole text to 500. */
export function assertLongNamesAreCut(): void {
  const long = "x".repeat(255);
  const text = message([row("R1", long, 5, { displayName: long })]);
  assert(text.includes(`${"x".repeat(63)}…`) && !text.includes("x".repeat(64)), `expected names cut to 64, got ${text}`);
  const many = Array.from({ length: 5 }, (_, i) => row(`R${i}`, `${i}${"y".repeat(200)}`, 5, { displayName: `${i}${"z".repeat(200)}` }));
  const capped = message(many);
  assert(capped.length <= 500 && capped.endsWith("…"), `expected ≤ 500 ending in …, got ${capped.length}`);
}

/** Sites are the distinct names: two sites of one name read once; a blank name is named so. */
export function assertSitesAreDistinctNames(): void {
  expectText(
    message([row("R1", "Pump", 5), row("R2", "Pump", 5, { locationId: "loc-other" }), row("R3", " ", 5)]),
    "Ingest host not reporting: cloud — 3 RTUs at 2 sites stopped: (unnamed site), Pump; RTUs: R1, R2, R3",
  );
}

/** The same rows in any order give the same text. */
export function assertTheTextIsStable(): void {
  const rows = [row("R3", "S2", 5), row("R1", "S1", 5), row("R2", "S3", 5)];
  assert(message(rows) === message([...rows].reverse()), "order of rows changed the text");
}
