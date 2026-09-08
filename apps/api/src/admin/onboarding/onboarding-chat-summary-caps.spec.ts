import type { OnboardingDraft } from "@bms/shared";

import { MAX_ECHOED_ITEMS, echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { chatService } from "./onboarding-chat.service.spec";

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

// ---------------------------------------------------------------------------
// Fixtures — the worst message an upload can still produce
// ---------------------------------------------------------------------------

/**
 * The longest an RTU display name, an asset name or a topic may be: `F4.104`'s
 * `ONBOARDING_DRAFT_STRING_MAX` for the first two, `MAX_RTU_TOPIC_CHARS` for
 * the third. Restated as one number because the fixtures below only need "at
 * the bound", and all three bounds are 255 for the same reason — the columns
 * are `varchar(255)`.
 */
const WORST_CELL_CHARS = 255;

/**
 * A cell at that bound whose first characters are a unique fixed-width tag.
 *
 * The tag has to survive `quoteCell`, which keeps only the first 64
 * characters — so "this item was printed" and "this item was not" are both
 * decidable on the rendered message. Fixed width, so no tag is a substring of
 * another and a count of tags found is exact rather than approximate.
 */
function taggedCell(tag: string): string {
  return `${tag}${"x".repeat(WORST_CELL_CHARS - tag.length)}`;
}

/** The tag of RTU `index` — `Rtu-r007-`, never a substring of `Rtu-r070-`. */
function rtuTag(index: number): string {
  return `Rtu-r${String(index).padStart(3, "0")}-`;
}

/**
 * One `displayNameFixes` line, in the shape `normalizeRtuDisplayNames`
 * produces it: three cells of sheet text, each already through `quoteCell`
 * because that producer quotes them before this message is assembled.
 *
 * At the worst case each of the three is a full 255-character cell, so a fix
 * line is ~290 characters and 99 of them are ~29 KB — the single largest
 * contributor to the base message after the asset names. 99 and not 100 is the
 * true worst case: `normalizeRtuDisplayNames` keeps the first occurrence, so
 * 100 duplicate display names buy 99 fixes.
 */
function fixLine(index: number): string {
  const tag = String(index).padStart(3, "0");
  return (
    `**${quoteCell(taggedCell(`Dup-${tag}-`))}** → ` +
    `**${quoteCell(taggedCell(`Fixed-${tag}-`))}** ` +
    `(from ${quoteCell(taggedCell(`Code-${tag}-`))})`
  );
}

function fixLines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => fixLine(index));
}

/** One MQTT RTU at every bound, `credentialsSet` as the caller needs it. */
function worstRtu(index: number, credentialsSet: boolean): NonNullable<OnboardingDraft["rtus"]>[number] {
  return {
    code: `R${String(index).padStart(3, "0")}`,
    displayName: taggedCell(rtuTag(index)),
    protocol: "mqtt",
    config: {
      host: "phe.thinkiot.co.in",
      port: 8883,
      tls: true,
      // At the bound, so `mqttSetupTemplate` echoes it whole rather than
      // falling back to the placeholder — a topic is the one echo site
      // `quoteCell` cannot cover, and it is what makes a paste-back block
      // ~360 characters instead of ~100.
      topic: taggedCell("t/"),
    },
    credentialsSet,
    ingestEnabled: true,
  };
}

/** The location line's own cell, at the bound like everything else. */
const WORST_LOCATION = taggedCell("Loc-");

/**
 * `**Adjusted RTU display names:**` and the bullets under it, as rendered.
 *
 * Returned as lines rather than searched for by substring, so the assertions
 * below can say *where* the tail is and not only that it exists somewhere in
 * the message. A tail rendered at the very end of the reply would satisfy a
 * bare `includes`.
 */
function fixBlockLines(assistantMessage: string): string[] {
  const lines = assistantMessage.split("\n");
  const header = lines.indexOf("**Adjusted RTU display names:**");
  assert(header >= 0, "this case must render the display-name fix block, or it asserts nothing");
  const block: string[] = [];
  for (let i = header + 1; i < lines.length && lines[i] !== ""; i += 1) {
    block.push(lines[i] as string);
  }
  return block;
}

/**
 * `displayNameFixes` is site 1, and it is capped where it is **rendered**, not
 * where it is produced.
 *
 * `normalizeRtuDisplayNames` (`onboarding-excel.service.ts`) is the only
 * producer and this method is the only consumer — grepped across
 * `apps/api/src`, `apps/web/src` and `packages/shared/src`. AGENTS.md §4.3
 * bounds a value where it reaches a message, so the full array stays available
 * to anything that later wants it and only the echo is cut.
 *
 * The draft here reaches none of the other four sites: no RTU, no asset, point
 * keys already satisfied. So a length assertion is not needed — the fix block
 * is the only list in the message, and the count is asserted exactly.
 */
export function assertDisplayNameFixListIsCapped(): void {
  const fixes = fixLines(99);
  const followUp = chatService().excelImportFollowUp(
    { rtus: [], assets: [], onboardingMeta: { useExistingPointKeys: true } },
    { locationName: WORST_LOCATION, rtuCount: 0, assetCount: 0 },
    [],
    fixes,
  );
  const block = fixBlockLines(followUp.assistantMessage);
  const bullets = block.filter((line) => line.startsWith("- "));
  assert(
    bullets.length === MAX_ECHOED_ITEMS,
    `${fixes.length} fixes render ${MAX_ECHOED_ITEMS} bullets, got ${bullets.length}`,
  );
  // The tail is the line **immediately after** the last bullet, and it is a
  // plain line rather than a bullet so it cannot be mistaken for a fix.
  assert(
    block.length === MAX_ECHOED_ITEMS + 1,
    `the block is the bullets plus one tail line, got ${block.length} lines`,
  );
  const tail = block[MAX_ECHOED_ITEMS] as string;
  assert(
    /^…and 74 more$/.test(tail),
    `the block closes with a count of what it omitted, got "${tail}"`,
  );

  // Every kept fix is present and every omitted one is absent — an exact
  // count, not a length proxy.
  for (const [index, line] of fixes.entries()) {
    const present = followUp.assistantMessage.includes(line);
    assert(
      present === index < MAX_ECHOED_ITEMS,
      `fix ${index} must be ${index < MAX_ECHOED_ITEMS ? "kept" : "omitted"}, and it is not`,
    );
  }
}

/**
 * `mqttSetupTemplate` is site 2 — the paste-back blocks.
 *
 * **Capping it costs no working function, and that is measured rather than
 * assumed.** The template already does not do what it says past the first
 * block: `defaultConfig` reads one **non-global** `/topic[:\s]+(\S+)/i`, so
 * only the first block's topic is ever taken, and the `phase === "rtu"` branch
 * of `handleRuleBasedTurn` *appends* an RTU rather than updating the ones the
 * import created. Three imported RTUs with blank topics, all three filled in
 * and pasted back, produced **four** RTUs — the three originals still holding
 * `topic: ""`. Pre-existing, filed as its own row, and deliberately not fixed
 * here (owner ruling 4).
 *
 * **The tail counts omissions from the template's own list, never from
 * `mqttIncomplete`.** The two are different predicates: `mqttIncomplete` also
 * requires a missing credential or an unusable topic, while this template
 * takes every enabled MQTT RTU. So the prose can honestly say "MQTT setup
 * still required for 100 RTU(s)" above a list of 25, and a tail computed from
 * the prose's count would be wrong. Pre-existing divergence, not this row's.
 */
export function assertMqttTemplateBlocksAreCapped(): void {
  const rtus = Array.from({ length: 100 }, (_, index) => worstRtu(index, false));
  const followUp = chatService().excelImportFollowUp(
    { rtus, assets: [], onboardingMeta: { useExistingPointKeys: true } },
    { locationName: WORST_LOCATION, rtuCount: rtus.length, assetCount: 0 },
    [],
    fixLines(99),
  );
  const message = followUp.assistantMessage;
  assert(
    message.includes("RTU: "),
    "this case must reach the MQTT paste-back template, or it asserts nothing",
  );

  const blocks = (message.match(/RTU: /g) ?? []).length;
  assert(
    blocks === MAX_ECHOED_ITEMS,
    `${rtus.length} MQTT RTUs render ${MAX_ECHOED_ITEMS} paste-back blocks, got ${blocks}`,
  );

  // The tail sits **after** the END COPY marker, so a copy-paste of the block
  // between the markers cannot capture it and hand it back to `defaultConfig`.
  const lines = message.split("\n");
  const endCopy = lines.findIndex((line) => line.includes("END COPY"));
  assert(endCopy >= 0, "this case must render the END COPY marker, or the position is unassertable");
  const tail = lines[endCopy + 1] as string;
  assert(
    /^…and 75 more$/.test(tail),
    `the line after END COPY states what was omitted, got "${tail}"`,
  );

  for (const [index] of rtus.entries()) {
    const present = message.includes(rtuTag(index));
    assert(
      present === index < MAX_ECHOED_ITEMS,
      `RTU ${index} must be ${index < MAX_ECHOED_ITEMS ? "printed" : "omitted"}, and it is not`,
    );
  }

  // Arithmetic, so the ceiling is not invented: header ~150 + 25 fix lines at
  // ~290 ≈ 7.4 KB + prose ~200 + markers ~130 + 25 blocks at ~360 ≈ 9.1 KB +
  // tail and trailer ~80 ≈ 17.1 KB. Measured 66,072 on the base, so this is
  // red before the cap and has ~2.9 KB of headroom after it.
  assert(
    message.length < 20_000,
    `the MQTT branch must stay under 20,000 characters, got ${message.length}`,
  );
}
