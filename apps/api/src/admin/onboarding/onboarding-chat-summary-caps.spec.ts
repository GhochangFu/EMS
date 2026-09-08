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

  // Arithmetic, so the ceiling is not invented: header ~150 + 25 fix lines at
  // ~290 ≈ 7.4 KB + prose ~200 + markers ~130 + 25 blocks at ~360 ≈ 9.1 KB +
  // tail and trailer ~80 ≈ 17.1 KB. Measured 66,072 on the base, so this is
  // red before the cap and has ~2.9 KB of headroom after it.
  assert(
    message.length < 20_000,
    `the MQTT branch must stay under 20,000 characters, got ${message.length}`,
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
    /^…and 75 more$/.test(hundredLines.after),
    `the line after the last RTU states what was omitted, got "${hundredLines.after}"`,
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
  // ...and every one of them belongs to a printed RTU. `shownRtus` is a
  // prefix, so index `i` there is still the `rtuIndex` the asset map is keyed
  // on; reordering or filtering the RTUs before the loop would mis-attribute
  // every asset, and nothing else here would notice.
  for (const name of shownAssets) {
    const owner = Number(/^Asset-r(\d{3})-/.exec(name)?.[1] ?? -1);
    assert(
      owner >= 0 && owner < MAX_ECHOED_ITEMS,
      `only a printed RTU's assets may be named, got "${name}"`,
    );
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
      `line ${index} must still name one of its own assets, got "${line}"`,
    );
    // --- 4. the per-line tail survives the shared budget --------------------
    assert(
      /…and 4 more$/.test(line),
      `line ${index} says how many of its own assets it left out, got "${line}"`,
    );
  }
  assert(
    !twentyFive.assistantMessage.includes("…and 0 more"),
    "a line that named everything gains no tail",
  );

  // --- 5. tail purity -------------------------------------------------------
  // Every cell in this fixture is inside `MAX_ECHOED_CELL_CHARS`, so `quoteCell`
  // cuts nothing and the phrase it would have added must be absent entirely.
  // That is the exact check that a tail carrying `more characters` would fail.
  assert(
    !hundred.assistantMessage.includes("more characters"),
    "no cell in this fixture is cut, so the message must carry no cut marker at all",
  );
  for (const tail of hundred.assistantMessage.match(/…and [^\n,]*/g) ?? []) {
    assert(/^…and \d+ more$/.test(tail), `every tail is a count and nothing else, got "${tail}"`);
  }

  // --- 6. the branch's length ceiling ---------------------------------------
  // The worst message still reachable: 100 RTUs and 500 assets at `F4.103`'s
  // section caps, every cell at its `F4.104` bound, 99 duplicate display names.
  // Arithmetic: header ~150 + 25 fix lines at ~290 ≈ 7.4 KB + 25 RTU lines at
  // ~200 ≈ 5.1 KB + tails and trailer ~200 ≈ 12.8 KB. Measured 85,242 on the
  // base, so this is red before the cap.
  const worst = service.excelImportFollowUp(
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

  // --- 7. the shipped template gains no tail at any site --------------------
  // 2 RTUs and 3 assets are both far under 25, so nothing may be elided on the
  // happy path. Driven through the real `parseUpload`, so this cannot drift
  // from the workbook the service actually generates —
  // `assertTemplateRoundTripsUnchanged` gates the parse side of the same file.
  //
  // **Both branches, and the credential-completed one is load-bearing.**
  // `parseRtus` hardcodes `credentialsSet: false` and the template's password
  // cell is blank, so the template as parsed reaches `mqttSetupTemplate` and
  // never `formatAssetsByRtuSummary`. A single as-parsed case would leave
  // sites 3 and 4 unasserted here, and would stay green with the cap set to 2.
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
