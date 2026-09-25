import { hasAnyControlRoomAsset } from "./control-room-access";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const TRACKED = ["CR-Q1", "CR-HVAC-1"] as const;

/**
 * `F4.156` L1 — one tracked row among untracked ones is enough. The predicate
 * asks "can the caller read *any* Control Room asset", not "all of them": a
 * scoped Eskom user reads a subset of the 43 `CR-*` rows and must still see
 * the group.
 */
export function runTrueWhenOneRowCodeIsTrackedTests(): void {
  assert(
    hasAnyControlRoomAsset([{ code: "FEED-PUMP-2" }, { code: "CR-Q1" }], TRACKED) === true,
    "one tracked code among untracked rows grants the Control Room",
  );
}

/** `F4.156` L2 — the defect: a PHE caller reads only PHE rows. */
export function runFalseWhenNoRowCodeIsTrackedTests(): void {
  assert(
    hasAnyControlRoomAsset([{ code: "FEED-PUMP-2" }], TRACKED) === false,
    "no tracked code denies the Control Room",
  );
}

/** `F4.156` L3 — no data is not access: an unresolved or empty read denies. */
export function runFalseForUndefinedOrEmptyTests(): void {
  assert(hasAnyControlRoomAsset(undefined, TRACKED) === false, "undefined rows deny");
  assert(hasAnyControlRoomAsset([], TRACKED) === false, "empty rows deny");
}
