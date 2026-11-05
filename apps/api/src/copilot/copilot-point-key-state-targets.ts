import { eq } from "drizzle-orm";

import { type BmsDb, pointKeyStates } from "@bms/db";
import type { CatalogEntry } from "@bms/shared/copilot";

import { isSeededPointKeyState } from "../admin/point-key-states/point-key-states.pure";
import { CopilotTargetRefusal } from "./copilot-telemetry-targets";

/**
 * `F4.309` PR 3 (ADR 0099 Amendment 13 decisions 1 and 4, ruling Q2) — the resolver's reads and
 * refusals for the two state-label entries, beside `copilot-target-resolver.ts` for the AGENTS.md
 * §4.5 line cap.
 *
 * `isSeededPointKeyState` is the API's own pure check (`admin/point-key-states/point-key-states.pure.ts`,
 * the comparison with `POINT_KEY_STATE_SEED` the routes' 409 makes): the resolver lives in the same
 * app, so it imports it rather than moving it to `@bms/shared`.
 */

/** One state-label row as the card names it. */
export type PointKeyStateRow = { readonly pointKey: string; readonly value: number; readonly label: string };

/**
 * The row `id` names, or `null` when there is none (and for an absent id). On the tenant pool:
 * `bms.point_key_states` has no organization and no row-level security, and `bms_tenant` keeps
 * `SELECT` on it (migration `0097` revokes only its writes) — the `pointKeyCode` precedent.
 */
export async function readPointKeyState(db: Pick<BmsDb, "select">, id: string | undefined): Promise<PointKeyStateRow | null> {
  if (id === undefined) return null;
  const [row] = await db
    .select({ pointKey: pointKeyStates.pointKeyCode, value: pointKeyStates.value, label: pointKeyStates.label })
    .from(pointKeyStates)
    .where(eq(pointKeyStates.id, id))
    .limit(1);
  return row ?? null;
}

/** Decision 1: "`<key>` = `<value>` (`<label>`)", the name the card and the open wizard show. */
export function pointKeyStateName(row: PointKeyStateRow): string {
  return `${row.pointKey} = ${row.value} (${row.label})`;
}

/** The sentence the model gets for a seeded row or pair: no card is stored (ruling Q2). */
export function seededPointKeyStateMessage(pointKey: string, value: number): string {
  return (
    `The state label ${pointKey} = ${value} is seeded and read-only: no change to it can be proposed. ` +
    "Edit only a row list_point_key_states shows with seeded false, or add a label for another value."
  );
}

/**
 * Ruling Q2 — the refusal of a seeded target, or `null`: an edit of a seeded row (`row`, the row
 * the path names) or a create of a seeded pair (the body's `pointKey` and `value`). Every other
 * entry has none. The route's 409 still guards at apply.
 */
export function seededPointKeyStateRefusal(
  entry: Pick<CatalogEntry, "id">,
  row: PointKeyStateRow | null,
  body: Readonly<Record<string, unknown>>,
): string | null {
  if (entry.id === "pointKeyState.update" && row !== null) {
    return isSeededPointKeyState(row.pointKey, row.value) ? seededPointKeyStateMessage(row.pointKey, row.value) : null;
  }
  if (entry.id === "pointKeyState.create" && typeof body.pointKey === "string" && typeof body.value === "number") {
    return isSeededPointKeyState(body.pointKey, body.value) ? seededPointKeyStateMessage(body.pointKey, body.value) : null;
  }
  return null;
}

/**
 * Ruling Q2 — what a seeded target resolves to: at propose, the refusal is thrown with its
 * sentence (the propose tool hands it to the model and stores no card); for an open wizard's
 * record (`"record"` mode) the row is simply not found, since no wizard opens on a seeded row.
 */
export function seededAtPropose(sentence: string, mode: "propose" | "record"): null {
  if (mode === "propose") throw new CopilotTargetRefusal(sentence);
  return null;
}
