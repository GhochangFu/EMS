import { assetPointKey, assetSourceKey, storedText } from "./mapping-sheet-snapshot";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `storedText` — the seed writes `unit = ''` on 52 Western Cape rows; the
 * export writes a blank for `''` and `null` alike and the import reads a blank
 * as `null`, so the snapshot must read `''` as `null` or decision 7's round
 * trip reports 52 changes nobody made (found on the running stack at PR 2's
 * step 6).
 */
export function assertStoredTextReadsBlankAsNull(): void {
  assert(storedText(null) === null, "null stays null");
  assert(storedText("") === null, "'' reads as null");
  assert(storedText("   ") === null, "whitespace reads as null");
  assert(storedText("kW") === "kW", "a real unit is untouched");
  assert(storedText(" kW ") === " kW ", "a padded unit is returned as stored — trimming is the parser's job, not the snapshot's");
}

/** The two map keys are `<owner>|<key>`, and distinct owners never collide. */
export function assertKeysAreOwnerScoped(): void {
  assert(assetPointKey("a1", "kw") === "a1|kw", `assetPointKey, got ${assetPointKey("a1", "kw")}`);
  assert(assetSourceKey("a1", "TX01_KW") === "a1|TX01_KW", `assetSourceKey, got ${assetSourceKey("a1", "TX01_KW")}`);
  assert(assetPointKey("a1", "kw") !== assetPointKey("a2", "kw"), "the same key on two owners is two entries");
}
