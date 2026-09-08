import type { OnboardingDraft } from "@bms/shared";

import { MAX_ECHOED_ITEMS, echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import {
  assetOf,
  chatService,
  completeRtu,
  summaryDraftOf,
} from "./onboarding-chat.service.spec";
import { OnboardingExcelService } from "./onboarding-excel.service";

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
 * The six list-rendering sites `MAX_ECHOED_ITEMS` binds. Five are in the one
 * assistant message an upload produces; the sixth is a later turn of the same
 * conversation:
 *
 * 1. `excelImportFollowUp`'s `displayNameFixes` bullets;
 * 2. `mqttSetupTemplate`'s paste-back blocks;
 * 3. `formatAssetsByRtuSummary`'s RTU lines;
 * 4. `formatAssetsByRtuSummary`'s asset names under those lines — bounded by a
 *    **single budget of 25 across the whole summary**, not 25 per line, so
 *    sites 3 and 4 cannot multiply (owner ruling 3);
 * 5. `excelImportFollowUp`'s point-key preview, which carried a bare literal
 *    `8` until owner ruling 5 moved it here so one message carries one number;
 * 6. `OnboardingCatalogService.formatPointKeysForChat`, one bullet per point
 *    key in the "use existing keys" turn of `handleRuleBasedTurn`. **Asserted
 *    in `onboarding-catalog.service.spec.ts`**, next to the service that owns
 *    it and not here — this file was 1,034 lines with it, over §4.5's 1,000.
 *    The enumeration stays whole; only the fixture moved.
 *
 * **Site 6 was left open in the first pass, on a rationale that was false on
 * both of its clauses** (owner ruling 6 closed it here). It said the list was
 * "the organisation's own catalog" whose length the upload does not control.
 * `listPointKeys` ignores its `organizationId` — the catalog went fleet-wide at
 * migration `0057`, `F3.39` — and `OnboardingCommitService` inserts into that
 * same fleet-wide table with no per-organisation quota, so one commit of a
 * 500-key draft grows this list for every organisation, permanently. Measured
 * on the live seeded database as `bms_fleet`: **613 keys, 18,006 characters**
 * of `code` + `name`, ~26 KB rendered — about twice what the other five caps
 * bring the whole worst-case import summary down to, on a clean seed with no
 * attacker. The **growth** term is not closed by this row; only the echo is.
 *
 * **Why these assertions are here and not in `spreadsheet-guard.spec.ts`,**
 * where the symbols they exercise are declared: every call site is in the
 * onboarding conversation, and that spec has no fixture that reaches any of
 * them. The enumeration above is what must not split — the assertions may live
 * wherever their fixture does, as long as this list says which file holds each
 * one. That is the same discipline `assertExcelImportFollowUpBoundsEchoedText`
 * uses for the `z.enum` site it names but does not hold.
 *
 * Its own file, and not the bottom of `onboarding-chat.service.spec.ts`,
 * because that file was at 958 of AGENTS.md §4.5's 1000 lines when this one
 * was split off — the same split `F4.104` needed for
 * `onboarding-excel-cell-bounds.spec.ts`. This row took it to 995, and the
 * review's one-line JSDoc on `assetOf` to **996**. **The headroom is four
 * lines**: the next edit that adds to that file has to split it first, and
 * this one is already the file the split went to.
 *
 * **The measurement this row is set on, because the filed row's numbers were
 * all dead.** The row claimed 20,095 RTU rows produce a 13.16 MB message;
 * `F4.103`'s `workbookSectionCountProblem` refuses that workbook in 1,634 ms.
 * Re-measured on the base through the real `parseUpload` → `toDraftPatch` →
 * `mergeDraft` → `excelImportFollowUp` chain, at exactly `F4.103`'s section
 * caps with every echo-bearing cell at its `F4.104` bound:
 *
 * | Route | Assets branch | MQTT branch |
 * |---|---|---|
 * | A real 62,640-byte workbook, 100 duplicate display names | **77,817** | **58,647** |
 * | The constructed drafts below, same caps, every cell at the bound | **84,945** | **65,757** |
 * | The same drafts with this bound applied | **12,718** | **16,950** |
 *
 * The fixtures here measure higher than the workbook because every cell is at
 * its bound rather than merely long; the workbook figures are the
 * amplification ones — 77,817 characters from 62,640 bytes is **1.24×**, where
 * the row claimed ~7.5×. A **blank** `rtu_name` buys no fix line (`parseRtus`
 * falls back to the unique code); only a **duplicate** does, which is 99 of 100.
 *
 * **Composition of the 84,945, instrumented rather than estimated — the parts
 * sum to the character.** The earlier figures in this docblock (500 asset names
 * ≈ 36 KB, 99 fix lines ≈ 21 KB, 100 RTU lines ≈ 7 KB) accounted for only ~82 %
 * of the total: they costed a 255-character cell at ~72 rendered characters
 * when `quoteCell` produces **90** (`'` + 64 + `…' (+191 more characters)`),
 * and they left out the line markup and the `", "` separators.
 *
 * | Part | Characters | Share |
 * |---|---|---|
 * | 500 asset names, with their separators (5 × 90 + 4 × 2 per line) | 45,800 | 53.9 % |
 * | 99 fix bullets at 291 (three quoted cells and their markup) | 28,809 | 33.9 % |
 * | 100 RTU-name halves at 98 (`- **` + 90 + `**: `) | 9,800 | 11.5 % |
 * | Newlines, both block headers, the first line and the trailer | 536 | 0.6 % |
 * | **Total** | **84,945** | **100 %** |
 *
 * Under the bound the same decomposition is 25 fix bullets 7,275 + 25 RTU-name
 * halves 2,450 + 25 asset names 2,250 + tails 354 + the rest 389 = **12,718**.
 * The workbook route's 77,817 is **not** decomposed here: its cells are long
 * but not all at the bound, so its parts are its own.
 *
 * The **85,242** and **66,072** this table used to carry do not reproduce from
 * the fixtures below and were replaced rather than adjusted. Nothing in the
 * fixtures changed, so those two numbers were never reachable from them.
 *
 * **So this is not an availability row.** 77,817 characters in 46 ms crashes
 * nothing. It is a message-quality row — 500 asset names is not a summary —
 * and a bound on how fast one session's stored transcript grows. The transcript
 * itself still has no cap and that is `E8.3`'s open residual, not this row's.
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

  // The unit word, where a caller renders two tails counting different things
  // in one block. A **literal at the call site** — never a value from an item;
  // the type cannot say so, which is why `moreTail`'s docblock does.
  assert(
    moreTail(5, "RTUs") === "…and 5 more RTUs",
    `a named tail states the count and its unit, got "${moreTail(5, "RTUs")}"`,
  );
  assert(
    moreTail(0, "RTUs") === "",
    `a named tail is still empty at zero, got "${moreTail(0, "RTUs")}"`,
  );

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
    assert(
      /^…and \d+ more RTUs$/.test(moreTail(omitted, "RTUs")),
      `a named tail carries a count and the literal unit, got "${moreTail(omitted, "RTUs")}"`,
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

/**
 * The same RTU with no topic at all: enabled, credentialed, and still unable to
 * ingest. This is an RTU `mqttIncomplete` counts and the template's own
 * `protocol === "mqtt" && ingestEnabled` filter cannot distinguish.
 */
function topiclessRtu(index: number): NonNullable<OnboardingDraft["rtus"]>[number] {
  const rtu = worstRtu(index, true);
  return { ...rtu, config: { ...rtu.config, topic: "" } };
}

/** The `slot`-th asset of RTU `index`, its name at the bound. */
function worstAsset(index: number, slot: number): NonNullable<OnboardingDraft["assets"]>[number] {
  const tag = `Asset-r${String(index).padStart(3, "0")}-a${slot}-`;
  return {
    rtuIndex: index,
    code: `A${String(index).padStart(3, "0")}-${slot}`,
    name: taggedCell(tag),
    siteName: "Berhampur",
    domain: "electrical",
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

  // Arithmetic, so the ceiling is not invented: header ~160 + 25 fix bullets at
  // 291 = 7,275 + prose ~200 + markers ~130 + 25 blocks at ~360 ≈ 9.0 KB + tail
  // and trailer ~80 ≈ 17.0 KB. Instrumented: **16,950** with the cap and
  // **65,757** without it, so this is red before the cap and has ~3.0 KB of
  // headroom after it. (This comment said 66,072, which did not reproduce.)
  assert(
    message.length < 20_000,
    `the MQTT branch must stay under 20,000 characters, got ${message.length}`,
  );
}

/**
 * The cap must not elide the RTUs the prose above it is counting.
 *
 * **A regression this row introduced, caught in review and fixed here.** The
 * template's filter (`protocol === "mqtt" && ingestEnabled`) is strictly wider
 * than `mqttIncomplete` (which also requires a missing credential or an
 * unusable topic). Before the cap that only made the numbers read oddly: every
 * enabled MQTT RTU printed, so the ones the prose meant were always among them.
 * A leading-25 cut turned it into an elision. Measured on the broken version
 * with the fixture below: prose `**MQTT setup still required** for 1 RTU(s)`,
 * 25 paste-back blocks for RTUs that needed nothing, `…and 5 more`, and the one
 * RTU that did need work **absent from the message**.
 *
 * The fix is a stable sort of the incomplete RTUs to the front, not a filter —
 * filtering would change *which* RTUs the template contains, which is the
 * pre-existing divergence owner ruling 4 leaves alone.
 *
 * So the presence expectation here is deliberately **not** `index < 25`: RTU 29
 * is printed and RTUs 24–28 are not.
 */
export function assertMqttTemplateKeepsTheRtusItsProseCounts(): void {
  const rtus = [
    ...Array.from({ length: 29 }, (_, index) => worstRtu(index, true)),
    topiclessRtu(29),
  ];
  const followUp = chatService().excelImportFollowUp(
    { rtus, assets: [], onboardingMeta: { useExistingPointKeys: true } },
    { locationName: WORST_LOCATION, rtuCount: rtus.length, assetCount: 0 },
    [],
    [],
  );
  const message = followUp.assistantMessage;
  assert(
    message.includes("**MQTT setup still required** for 1 RTU(s)."),
    "exactly one of these RTUs needs setup, or this case is not the one that regressed",
  );
  const blocks = (message.match(/RTU: /g) ?? []).length;
  assert(
    blocks === MAX_ECHOED_ITEMS,
    `30 enabled MQTT RTUs still render ${MAX_ECHOED_ITEMS} blocks, got ${blocks}`,
  );

  // The whole point: the RTU the prose counts is in the message.
  assert(
    message.includes(rtuTag(29)),
    "the one RTU that needs setup must be in the message the prose counts it in — " +
      "without the sort it is the 30th of a list cut at 25 and appears nowhere",
  );
  // ...and first, because an operator reading a 25-block template acts on the
  // top of it. Position, not mere presence.
  const firstBlock = message.split("\n").find((line) => line.startsWith("RTU: ")) ?? "";
  assert(
    firstBlock.includes(rtuTag(29)),
    `the RTUs that need setup sort to the front, got "${firstBlock.slice(0, 40)}"`,
  );
  // The sort is stable, so the complete RTUs keep their input order behind it:
  // 29, then 0..23. 24..28 are the five that fall off.
  for (const [index] of rtus.entries()) {
    const present = message.includes(rtuTag(index));
    const expected = index === 29 || index < MAX_ECHOED_ITEMS - 1;
    assert(
      present === expected,
      `RTU ${index} must be ${expected ? "printed" : "omitted"} under a stable incomplete-first sort, and it is not`,
    );
  }
  const lines = message.split("\n");
  const endCopy = lines.findIndex((line) => line.includes("END COPY"));
  assert(
    /^…and 5 more$/.test(lines[endCopy + 1] as string),
    `the tail counts the template's own omissions, got "${lines[endCopy + 1]}"`,
  );
}

// ---------------------------------------------------------------------------
// Sites 3 and 4 — the RTU lines, and one asset budget across the whole summary
// ---------------------------------------------------------------------------

/** RTU `index`'s display name in the plain fixtures — fixed width, so no name contains another. */
function rtuName(index: number): string {
  return `Rtu-r${String(index).padStart(3, "0")}`;
}

/** The `slot`-th asset of RTU `index` in the plain fixtures. */
function assetName(index: number, slot: number): string {
  return `Asset-r${String(index).padStart(3, "0")}-a${slot}`;
}

/** `rtuCount` RTUs each carrying `perRtu` assets, all named so they can be counted exactly. */
function plainSummaryDraft(rtuCount: number, perRtu: number): OnboardingDraft {
  const rtus = Array.from({ length: rtuCount }, (_, index) => completeRtu(rtuName(index)));
  const assets = Array.from({ length: rtuCount * perRtu }, (_, i) =>
    assetOf(Math.floor(i / perRtu), assetName(Math.floor(i / perRtu), i % perRtu)),
  );
  return summaryDraftOf(rtus, assets);
}

/** The lines the summary renders, one per shown RTU, plus whatever follows them. */
function summaryLines(assistantMessage: string): { bullets: string[]; after: string } {
  const lines = assistantMessage.split("\n");
  const header = lines.indexOf("**Assets by RTU:**");
  assert(header >= 0, "this case must reach the assets summary, or sites 3 and 4 go unasserted");
  const bullets: string[] = [];
  let i = header + 1;
  for (; i < lines.length && lines[i]?.startsWith("- **"); i += 1) {
    bullets.push(lines[i] as string);
  }
  return { bullets, after: lines[i] ?? "" };
}

/**
 * Sites 3 and 4, and the one place where the two caps are **not** independent.
 *
 * A per-section 25 on both axes leaves 25 lines × 25 names ≈ 51 KB, which is
 * why owner ruling 3 gives the asset names a single budget of 25 across the
 * whole summary. The budget is spent with a reserve — one name held back for
 * every later line that has assets — so no line is left naming nothing.
 *
 * **Assertion 3 is the only check on that distribution.** A pure-greedy spend
 * gives line 1 all 25 names and lines 2–25 none, and the total is still ≤ 25
 * and there are still 25 lines: assertions 1 and 2 both stay green. Without it
 * the reserve ships untested.
 *
 * **Tail purity and the branch's length ceiling are their own functions**, for
 * the reason `assertShippedTemplateElidesNothing` was split out for. Six
 * sections behind one `it()` means the first section a mutation reddens is the
 * last one that runs: under `MAX_ECHOED_ITEMS = 2` this function died in
 * section 1 and sections 2–6 were never reached, so two of them were gated by
 * nothing and looked gated. One `it()` per claim is what makes a mutation land
 * on the claim it is aimed at.
 */
export function assertAssetsByRtuSummaryIsCapped(): void {
  const service = chatService();

  // --- 1. the RTU line cap --------------------------------------------------
  const hundred = service.excelImportFollowUp(
    plainSummaryDraft(100, 5),
    { locationName: "Berhampur", rtuCount: 100, assetCount: 500 },
    [],
    [],
  );
  const hundredLines = summaryLines(hundred.assistantMessage);
  assert(
    hundredLines.bullets.length === MAX_ECHOED_ITEMS,
    `100 RTUs render ${MAX_ECHOED_ITEMS} lines, got ${hundredLines.bullets.length}`,
  );
  assert(
    // Named, unlike the other tails: this one closes the block that the inline
    // `…and 4 more` asset tails sit in, and two bare counts of different things
    // in one block read as the same thing.
    /^…and 75 more RTUs$/.test(hundredLines.after),
    `the line after the last RTU states what was omitted, and of what, got "${hundredLines.after}"`,
  );

  // --- 2. one asset budget across the whole summary -------------------------
  // Counted exactly, never inferred from the message length: this is the
  // assertion a per-line cap of 25 fails, and a per-line cap shortens the
  // message enough to satisfy any plausible length ceiling.
  const shownAssets: string[] = [];
  for (let rtu = 0; rtu < 100; rtu += 1) {
    for (let slot = 0; slot < 5; slot += 1) {
      if (hundred.assistantMessage.includes(assetName(rtu, slot))) {
        shownAssets.push(assetName(rtu, slot));
      }
    }
  }
  assert(
    shownAssets.length <= MAX_ECHOED_ITEMS,
    `the asset names share one budget of ${MAX_ECHOED_ITEMS} across the summary, got ${shownAssets.length}`,
  );
  // ...and every one of them belongs to a printed RTU.
  for (const name of shownAssets) {
    const owner = Number(/^Asset-r(\d{3})-/.exec(name)?.[1] ?? -1);
    assert(
      owner >= 0 && owner < MAX_ECHOED_ITEMS,
      `only a printed RTU's assets may be named, got "${name}"`,
    );
  }
  // ...and on **its own line**. `shownRtus` is a prefix, so index `i` there is
  // still the `rtuIndex` the asset map is keyed on, and reordering or filtering
  // the RTUs before the loop attributes every asset to the wrong one.
  //
  // The check above does not see that: reverse the RTUs and the lines still
  // look up `assetsByRtu.get(0..24)`, so every named asset still belongs to a
  // *printed* RTU and the count is still 25. Measured — the whole function
  // stayed green under `echoedItems([...rtus].reverse())`. This is the check
  // that reddens, and `assertAssetsByRtuSummaryIsIndexedNotRescanned`
  // (`onboarding-chat.service.spec.ts`) is the sibling that already catches it
  // by whole-string equality on a 3-RTU fixture.
  for (const [index, line] of hundredLines.bullets.entries()) {
    const named = /^- \*\*'Rtu-r(\d{3})'\*\*/.exec(line)?.[1];
    assert(
      named === String(index).padStart(3, "0"),
      `line ${index} must be RTU ${index}'s, got "${line.slice(0, 30)}"`,
    );
    for (const asset of line.match(/Asset-r(\d{3})-a\d/g) ?? []) {
      assert(
        (/Asset-r(\d{3})-/.exec(asset)?.[1] ?? "") === named,
        `line ${index} names an asset of another RTU — "${asset}" under "${line.slice(0, 30)}"`,
      );
    }
  }

  // --- 3. every printed line still names an asset ---------------------------
  // 25 RTUs × 5 assets against a budget of 25: the reserve gives each line
  // exactly one name and its own tail. Pure greedy gives line 1 five names and
  // lines 6–25 none, with the same total and the same line count.
  const twentyFive = service.excelImportFollowUp(
    plainSummaryDraft(MAX_ECHOED_ITEMS, 5),
    { locationName: "Berhampur", rtuCount: MAX_ECHOED_ITEMS, assetCount: MAX_ECHOED_ITEMS * 5 },
    [],
    [],
  );
  const evenLines = summaryLines(twentyFive.assistantMessage);
  assert(
    evenLines.bullets.length === MAX_ECHOED_ITEMS,
    `25 RTUs render 25 lines, got ${evenLines.bullets.length}`,
  );
  for (const [index, line] of evenLines.bullets.entries()) {
    const named = [0, 1, 2, 3, 4].filter((slot) => line.includes(assetName(index, slot)));
    assert(
      named.length === 1,
      `line ${index} must name exactly one of its own assets under the shared budget — ` +
        `a greedy spend gives the first lines all of theirs and the rest none. ` +
        `Got ${named.length} on "${line}"`,
    );
    // --- 4. the per-line tail survives the shared budget --------------------
    assert(
      /…and 4 more$/.test(line),
      `line ${index} says how many of its own assets it left out, got "${line}"`,
    );
  }
  // --- and a bucket the budget covers gains no tail at all ------------------
  // This replaces `!includes("…and 0 more")`, which could not fail: `moreTail`
  // returns `""` at zero, so that string is unproducible however the render
  // breaks, and the helper assertion already covers the zero case directly.
  // 25 RTUs × **one** asset spends the budget exactly, so each line is its RTU
  // and its one asset and nothing else — asserted by whole-string equality.
  // Drop `moreTail`'s `omitted > 0` guard and all 25 lines gain a tail.
  const exact = service.excelImportFollowUp(
    plainSummaryDraft(MAX_ECHOED_ITEMS, 1),
    { locationName: "Berhampur", rtuCount: MAX_ECHOED_ITEMS, assetCount: MAX_ECHOED_ITEMS },
    [],
    [],
  );
  for (const [index, line] of summaryLines(exact.assistantMessage).bullets.entries()) {
    assert(
      line === `- **${quoteCell(rtuName(index))}**: ${quoteCell(assetName(index, 0))}`,
      `line ${index} names its one asset and stops there, got "${line}"`,
    );
  }
}

/**
 * A tail carries a count, optionally a unit, and **nothing from the data**.
 *
 * Its own `it()` and not section 5 of the function above, because six sections
 * behind one `it()` gate only as far as the first one a mutation reddens. The
 * mutation that reaches this one is the plausible "improvement": have the
 * per-line asset tail name the first asset it left out — `…and 4 more (starting
 * with 'Asset-r000-a1')`. That is the cheapest way to reopen exactly the echo
 * this row closes, and it is invisible to a length ceiling.
 *
 * `more characters` is `quoteCell`'s, not a tail's. Every cell in this fixture
 * is inside `MAX_ECHOED_CELL_CHARS`, so nothing is cut and that phrase must be
 * absent from the whole message — which is the check a tail carrying it fails.
 */
export function assertSummaryTailsCarryNothingButACount(): void {
  const hundred = chatService().excelImportFollowUp(
    plainSummaryDraft(100, 5),
    { locationName: "Berhampur", rtuCount: 100, assetCount: 500 },
    [],
    [],
  );
  const message = hundred.assistantMessage;
  assert(
    message.includes("Assets by RTU"),
    "this case must reach the assets summary, or there are no tails to inspect",
  );
  assert(
    !message.includes("more characters"),
    "no cell in this fixture is cut, so the message must carry no cut marker at all",
  );
  const tails = message.match(/…and [^\n,]*/g) ?? [];
  assert(tails.length > 0, "this fixture must produce tails, or the loop below asserts nothing");
  for (const tail of tails) {
    assert(
      /^…and \d+ more( RTUs)?$/.test(tail),
      `every tail is a count and its unit and nothing else, got "${tail}"`,
    );
  }
}

/**
 * The whole assets branch stays under 15,000 characters at the worst input
 * `F4.103` still admits.
 *
 * Its own `it()` for the same reason as the function above, and this one had no
 * reaching mutation at all while it was section 6 — it sat behind five
 * assertions that every cap mutation reddens first. The one that reaches it is
 * **deleting the `displayNameFixes` cap**: 99 fix lines at ~290 characters put
 * this message at ~32 KB with every other cap still in place. Deleting the RTU
 * line cap also crosses the ceiling, but through a broken reserve — a negative
 * allowance renders empty asset lists — so it is the weaker of the two.
 *
 * The fixture is the worst message an upload can still produce: 100 RTUs and
 * 500 assets at `F4.103`'s section caps, every echo-bearing cell at its
 * `F4.104` bound, 99 duplicate display names. Instrumented at **84,945**
 * characters without the bound and **12,718** with it; the file docblock has
 * the decomposition, which sums to the character.
 */
export function assertAssetsBranchStaysUnderItsCeiling(): void {
  const worst = chatService().excelImportFollowUp(
    summaryDraftOf(
      Array.from({ length: 100 }, (_, index) => worstRtu(index, true)),
      Array.from({ length: 500 }, (_, i) => worstAsset(Math.floor(i / 5), i % 5)),
    ),
    { locationName: WORST_LOCATION, rtuCount: 100, assetCount: 500 },
    [],
    fixLines(99),
  );
  assert(
    worst.assistantMessage.includes("Assets by RTU"),
    "the ceiling case must measure the assets branch, or it measures the wrong one",
  );
  assert(
    worst.assistantMessage.length < 15_000,
    `the assets branch must stay under 15,000 characters, got ${worst.assistantMessage.length}`,
  );
}

/**
 * The other direction, and **its own function on purpose**: nothing may be
 * elided on the happy path.
 *
 * 2 RTUs and 3 assets are both far under 25, so the shipped template's own
 * import summary carries no tail at any of the five sites. Driven through the
 * real `parseUpload`, so it cannot drift from the workbook the service
 * generates — `assertTemplateRoundTripsUnchanged` gates the parse side of the
 * same file.
 *
 * **Why it is not the seventh assertion of the function above.** This is an
 * *absence* assertion, and an absence assertion passes for free when the code
 * that would violate it never runs. The mutation that proves it can fail is
 * `MAX_ECHOED_ITEMS = 2` — and with it folded into the function above, that
 * mutation reddened an earlier assertion and this one was never reached. Its
 * own `it()` is what makes the mutation land on it.
 *
 * **Both branches, and the credential-completed one is load-bearing.**
 * `parseRtus` hardcodes `credentialsSet: false` and the template's password
 * cell is blank, so the template as parsed reaches `mqttSetupTemplate` and
 * never `formatAssetsByRtuSummary`. An as-parsed case alone leaves sites 3 and
 * 4 unasserted here and stays green with the cap set to 2 — 2 RTUs against a
 * cap of 2 produce no tail, while 3 assets against it do.
 */
export function assertShippedTemplateElidesNothing(): void {
  const service = chatService();
  const excel = new OnboardingExcelService();
  const parsed = excel.parseUpload(excel.buildTemplateBuffer("Berhampur"));
  assert(
    parsed.rtus.length === 2 && parsed.assets.length === 3,
    `the shipped template is 2 RTUs and 3 assets, got ${parsed.rtus.length} and ${parsed.assets.length}`,
  );
  const imported = {
    locationName: parsed.location.name,
    rtuCount: parsed.rtus.length,
    assetCount: parsed.assets.length,
  };
  const asParsed = service.excelImportFollowUp(
    { ...excel.toDraftPatch(parsed, {}), assetPoints: [] },
    imported,
    ["kw"],
    parsed.displayNameFixes,
  );
  assert(
    asParsed.assistantMessage.includes("RTU: "),
    "the template as parsed reaches the MQTT template — if that changed, this case moved branch",
  );
  const completed = service.excelImportFollowUp(
    summaryDraftOf(
      parsed.rtus.map((rtu) => ({ ...rtu, credentialsSet: true })),
      parsed.assets,
    ),
    imported,
    ["kw"],
    parsed.displayNameFixes,
  );
  assert(
    completed.assistantMessage.includes("Assets by RTU"),
    "the credential-completed template must reach the assets summary, or assertion 7 gates nothing",
  );
  for (const [what, message] of [
    ["as parsed", asParsed.assistantMessage],
    ["with credentials set", completed.assistantMessage],
  ] as const) {
    // `…and ` and never a bare `…`, which is also `quoteCell`'s ellipsis.
    assert(
      !message.includes("…and "),
      `the shipped template must elide nothing (${what}):\n${message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Site 5 — the point-key preview (owner ruling 5)
// ---------------------------------------------------------------------------

/** An organisation point key code — fixed width, so no code is a substring of another. */
function pointKeyCode(index: number): string {
  return `pk${String(index).padStart(2, "0")}`;
}

/**
 * A draft that reaches the point-key branch: one complete MQTT RTU so the
 * branch above it returns nothing, no `pointKeys`, and no
 * `useExistingPointKeys`.
 */
function pointKeyDraft(): OnboardingDraft {
  return { rtus: [completeRtu("Rtu-r000")], assets: [] };
}

/**
 * Site 5. **A behaviour change, not a rename**, which is why it has its own
 * assertion and its own mutation.
 *
 * This preview carried a bare literal `8` — `orgPointKeyCodes.length > 8` and
 * `.slice(0, 8)` — closed by a bare `, …` that said nothing about how much was
 * left. Owner ruling 5 overruled the plan's "keep 8" and moved it onto the
 * shared bound, so all five lists in this message share one helper, one
 * constant and one tail vocabulary.
 *
 * Unlike the other four this list is a **catalog read**, not sheet text: the
 * upload does not control its length. It is bounded for consistency and
 * readability, not because it is an amplification surface.
 *
 * **The nine-code case is the one that proves the constant actually moved**
 * rather than the literal merely being renamed. Nine is over the old 8 and
 * under the new 25, so the old code truncated it and the new one must not.
 */
export function assertPointKeyPreviewIsCapped(): void {
  const service = chatService();

  // **The nine-code case first**, because it is the one that proves the
  // constant moved rather than the literal merely being renamed: nine is over
  // the old 8 and under the new 25. Asserted before the 30-code case so that
  // reverting the literal reddens *this* check and not only the count below.
  const nine = Array.from({ length: 9 }, (_, index) => pointKeyCode(index));
  const few = service.excelImportFollowUp(
    pointKeyDraft(),
    { locationName: "Berhampur", rtuCount: 1, assetCount: 0 },
    nine,
    [],
  );
  assert(
    few.assistantMessage.includes("already has point keys"),
    "this case must reach the point-key preview, or site 5 goes unasserted",
  );
  for (const code of nine) {
    assert(
      few.assistantMessage.includes(`\`${code}\``),
      `all nine keys are previewed under the new bound, ${code} is missing`,
    );
  }
  // No ellipsis of any kind: no cell in this fixture is cut either, so the old
  // `, …` marker and the new tail are both forbidden here.
  assert(
    !few.assistantMessage.includes("…"),
    `a list under the bound is previewed whole and unmarked, got "${few.assistantMessage}"`,
  );

  const thirty = Array.from({ length: 30 }, (_, index) => pointKeyCode(index));
  const many = service.excelImportFollowUp(
    pointKeyDraft(),
    { locationName: "Berhampur", rtuCount: 1, assetCount: 0 },
    thirty,
    [],
  );
  assert(
    many.assistantMessage.includes("already has point keys"),
    "this case must reach the point-key preview, or site 5 goes unasserted",
  );
  const shown = thirty.filter((code) => many.assistantMessage.includes(`\`${code}\``));
  assert(
    shown.length === MAX_ECHOED_ITEMS,
    `30 organisation point keys preview ${MAX_ECHOED_ITEMS}, got ${shown.length}`,
  );
  assert(
    many.assistantMessage.includes("…and 5 more"),
    `the preview states how many keys it left out, got "${many.assistantMessage}"`,
  );
  for (const [index, code] of thirty.entries()) {
    assert(
      many.assistantMessage.includes(code) === index < MAX_ECHOED_ITEMS,
      `key ${code} must be ${index < MAX_ECHOED_ITEMS ? "previewed" : "omitted"}, and it is not`,
    );
  }
}
