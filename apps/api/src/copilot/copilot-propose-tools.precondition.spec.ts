import { expect } from "vitest";

import { proposeToolName } from "@bms/shared/copilot";

import { PROPOSE_PRECONDITION_ERROR } from "./copilot-propose-tools";
import { fixtureEntry, proposeHarness, STAMP } from "./copilot-propose-tools.spec";
import type { ResolvedTarget } from "./copilot-target-resolver";

/**
 * `F4.247` / ADR 0099 Amendment 5 C1 — the propose tool stores the target's
 * `updatedAt` as the change's precondition for a flagged entry, stores none for
 * any other, and refuses a flagged entry whose target read no stamp (fail
 * closed). Its own file: `copilot-propose-tools.spec.ts` is at the 1000-line
 * cap. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const BODY = { a: "x", b: [{ z: 1, a: null }] };
const FLAGGED = fixtureEntry({ id: "fixture.flagged", precondition: "updatedAt" });
const UNFLAGGED = fixtureEntry({ id: "fixture.unflagged" });
const STAMPED: ResolvedTarget = { organizationId: ORG_X, organizationName: "Org X", targetName: "T", updatedAt: STAMP };

/** Mutation: store `null` for every entry — the flagged card carries no precondition. */
export async function aFlaggedEntryStoresTheTargetsStamp(): Promise<void> {
  const h = proposeHarness({ catalog: [FLAGGED], target: STAMPED });
  await h.call(proposeToolName(FLAGGED), { body: BODY });
  expect(h.stored[0]?.precondition).toBe(STAMP);
}

/** Mutation: store the stamp for every entry — the unflagged card carries one. */
export async function anUnflaggedEntryStoresNoPrecondition(): Promise<void> {
  const h = proposeHarness({ catalog: [UNFLAGGED], target: STAMPED });
  await h.call(proposeToolName(UNFLAGGED), { body: BODY });
  expect(h.stored).toHaveLength(1);
  expect(h.stored[0]?.precondition).toBeNull();
}

/** Mutation: fall through with `null` when the target read no stamp — a flagged card is stored unguarded. */
export async function aFlaggedEntryWithoutAStampStoresNothing(): Promise<void> {
  const { updatedAt: _stamp, ...unstamped } = STAMPED;
  const h = proposeHarness({ catalog: [FLAGGED], target: unstamped });
  const outcome = await h.call(proposeToolName(FLAGGED), { body: BODY });
  expect(outcome.error).toBe(PROPOSE_PRECONDITION_ERROR);
  expect(h.stored).toEqual([]);
}
