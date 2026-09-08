import { MAX_ECHOED_ITEMS, echoedItems, moreTail } from "../spreadsheet-guard";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F4.105` — `quoteCell` bounds how long each echoed cell is; nothing bounded
 * **how many** cells the post-upload summary echoes. Enumerated rather than
 * counted, because `F4.102`'s lasting lesson is that a bare number is a claim
 * nobody can check and that its own echo surface took three passes to count.
 *
 * The five list-rendering sites `MAX_ECHOED_ITEMS` now binds, all of them
 * inside one assistant message:
 *
 * 1. `excelImportFollowUp`'s `displayNameFixes` bullets;
 * 2. `mqttSetupTemplate`'s paste-back blocks;
 * 3. `formatAssetsByRtuSummary`'s RTU lines;
 * 4. `formatAssetsByRtuSummary`'s asset names under those lines — bounded by a
 *    **single budget of 25 across the whole summary**, not 25 per line, so
 *    sites 3 and 4 cannot multiply (owner ruling 3);
 * 5. `excelImportFollowUp`'s point-key preview, which carried a bare literal
 *    `8` until owner ruling 5 moved it here so one message carries one number.
 *
 * **A sixth list site exists and is deliberately outside this row.**
 * `OnboardingCatalogService.formatPointKeysForChat` renders one bullet per
 * organisation point key into the "use existing keys" turn of
 * `handleRuleBasedTurn`, and nothing bounds it. It is named here for the same
 * reason `assertExcelImportFollowUpBoundsEchoedText` names the `z.enum` site it
 * does not hold: a count that claims completeness has to be checkable. It is
 * not reached by an upload, it is a catalog read rather than sheet text, and it
 * is not in `excelImportFollowUp` — so it is a filed row, not a silent fix.
 *
 * **Why these assertions are here and not in `spreadsheet-guard.spec.ts`,**
 * where the symbols they exercise are declared: all five call sites are in the
 * onboarding summary, and that spec has no fixture that reaches any of them.
 * Splitting the enumeration above across two files is what would let a site go
 * missing.
 *
 * Its own file, and not the bottom of `onboarding-chat.service.spec.ts`,
 * because that file is at 958 of AGENTS.md §4.5's 1000 lines — the same split
 * `F4.104` needed for `onboarding-excel-cell-bounds.spec.ts`.
 */
export function assertEchoedItemsHelpersAreBounded(): void {
  const thirty = Array.from({ length: 30 }, (_, index) => `item-${index}`);
  const over = echoedItems(thirty);
  assert(
    over.shown.length === MAX_ECHOED_ITEMS,
    `a list past the cap shows exactly ${MAX_ECHOED_ITEMS}, got ${over.shown.length}`,
  );
  assert(
    over.omitted === thirty.length - MAX_ECHOED_ITEMS,
    `the omitted count is what was left, got ${over.omitted}`,
  );
  assert(
    over.shown[0] === thirty[0] &&
      over.shown[MAX_ECHOED_ITEMS - 1] === thirty[MAX_ECHOED_ITEMS - 1],
    // A prefix, not a sample: every caller below keys something off the index
    // an item had in the input, and `formatAssetsByRtuSummary` keys its whole
    // asset map off it.
    "the shown items are the input's leading prefix, in input order",
  );

  // The boundary is inclusive: a list *at* the cap is shown whole and gains no
  // tail at all.
  const exact = thirty.slice(0, MAX_ECHOED_ITEMS);
  const atCap = echoedItems(exact);
  assert(
    atCap.shown.length === MAX_ECHOED_ITEMS && atCap.omitted === 0,
    `a list at the cap is shown whole, got ${atCap.shown.length} shown and ${atCap.omitted} omitted`,
  );
  assert(moreTail(atCap.omitted) === "", `a list at the cap gains no tail, got "${moreTail(0)}"`);
  assert(moreTail(-1) === "", `a negative omission gains no tail either, got "${moreTail(-1)}"`);

  assert(moreTail(5) === "…and 5 more", `the tail states the count, got "${moreTail(5)}"`);

  // --- tail purity ---------------------------------------------------------
  // `moreTail` takes a number, not an item, so the type system carries half of
  // this. Asserted anyway, because the tail wording is what a future edit will
  // "improve" — and because interpolating the first omitted item is the
  // cheapest way to reintroduce the unbounded echo this row closes.
  for (const omitted of [1, 7, 74, 475, 20_095]) {
    assert(
      /^…and \d+ more$/.test(moreTail(omitted)),
      `the tail carries a count and nothing else, got "${moreTail(omitted)}"`,
    );
  }

  // **Load-bearing trap.** `onboarding-chat.service.spec.ts` counts
  // `/more characters/g` occurrences on one summary line to prove that the RTU
  // name and the asset name were *each* cut by `quoteCell`. A tail carrying
  // that substring inflates the count and makes that existing assertion pass
  // for the wrong reason — one cut cell plus one tail would read as two cut
  // cells.
  assert(
    !moreTail(5).includes("more characters"),
    `the tail must not collide with quoteCell's "(+N more characters)" — ` +
      `assertExcelImportFollowUpBoundsEchoedText counts those, got "${moreTail(5)}"`,
  );

  // Both directions on the cap itself: an explicit `max` is honoured, so the
  // helper is usable at a different bound without a second copy of the slice.
  const three = echoedItems(thirty, 3);
  assert(
    three.shown.length === 3 && three.omitted === 27,
    `an explicit max is honoured, got ${three.shown.length} shown and ${three.omitted} omitted`,
  );

  const empty = echoedItems([] as readonly string[]);
  assert(
    empty.shown.length === 0 && empty.omitted === 0 && moreTail(empty.omitted) === "",
    "an empty list shows nothing and omits nothing",
  );
}
