import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";
import type { OnboardingDraft, OnboardingPhase } from "@bms/shared";

import { MAX_ECHOED_CELL_CHARS } from "../spreadsheet-guard";
import { OnboardingChatService } from "./onboarding-chat.service";
import type { ChatTurnResult } from "./onboarding-chat.service";
import { MAX_RTU_TOPIC_CHARS } from "./onboarding-excel.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { onboardingDraftSchema } from "./onboarding.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The longest a single Excel cell can be. Every hostile string below is exactly this. */
const CELL_MAX = 32_767;

function longCell(fill: string): string {
  return fill.repeat(CELL_MAX);
}

/**
 * `excelImportFollowUp` reads `this.mqttSetupTemplate`,
 * `this.formatAssetsByRtuSummary` and the draft it is handed, and touches none
 * of the four injected services — verified against the method, which is why
 * empty stubs are enough. `onboarding-credentials.spec.ts` is the precedent for
 * this style.
 */
function chatService(): OnboardingChatService {
  return new OnboardingChatService({} as never, {} as never, {} as never, {} as never);
}

/** A topic exactly at the bound — the longest one `parseRtus` accepts. */
const LEGAL_TOPIC = `L/${"o".repeat(MAX_RTU_TOPIC_CHARS - 2)}`;

/**
 * A draft carrying two RTUs and two assets, all named with 32,767-character
 * cells, and the **first RTU's `topic` is one of them**.
 *
 * That cell is load-bearing. `mqttSetupTemplate` prints `topic:` unquoted so
 * the operator can edit the block and paste it back, so it is the one echo site
 * `quoteCell` cannot cover. Before the post-merge review this fixture set every
 * topic to `""`, the template rendered the `your/topic/here` placeholder, and
 * the length assertion below could not see the site it was written to guard.
 * The second RTU keeps a topic at exactly the bound, so the same call also
 * asserts the other direction: a legal topic is echoed whole.
 */
function hostileDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    rtus: [
      {
        code: longCell("C"),
        displayName: longCell("D"),
        protocol: "mqtt",
        config: { host: "phe.thinkiot.co.in", port: 8883, tls: true, topic: longCell("T") },
        credentialsSet: false,
        ingestEnabled: true,
      },
      {
        code: longCell("E"),
        displayName: longCell("F"),
        protocol: "mqtt",
        config: { host: "phe.thinkiot.co.in", port: 8883, tls: true, topic: LEGAL_TOPIC },
        credentialsSet: false,
        ingestEnabled: true,
      },
    ],
    assets: [
      { rtuIndex: 0, code: longCell("G"), name: longCell("H"), siteName: "Berhampur", domain: "electrical" },
      { rtuIndex: 1, code: longCell("I"), name: longCell("J"), siteName: "Berhampur", domain: "electrical" },
    ],
    ...overrides,
  };
}

/**
 * `F4.102` — the import summary echoes sheet-supplied text at **five** places,
 * and before this row none of them was bounded. Enumerated rather than counted,
 * because a bare number is a claim nobody can check:
 *
 * 1. `excelImportFollowUp`'s `imported.locationName`;
 * 2. `mqttSetupTemplate`'s `RTU: <displayName>`;
 * 3. `mqttSetupTemplate`'s `topic: <topic>`;
 * 4. `formatAssetsByRtuSummary`'s `<displayName>`;
 * 5. `formatAssetsByRtuSummary`'s `<asset.name>`, once per asset on the line.
 *
 * **The summary is not the whole echo surface, and this docblock claimed it
 * was.** There is a sixth site, outside this file and outside the summary: the
 * `protocol` cell reaches `draftRtuSchema`'s `z.enum`, whose
 * `invalid_enum_value` message repeats the received value into the upload
 * response's `validationErrors` — 65.8 MB of it from a 231,182-byte workbook.
 * No `quoteCell` can reach that message, so it is refused at the parse boundary
 * instead, and the function that asserts it is
 * `assertUnknownRtuProtocolIsRefused` in `onboarding-excel.service.spec.ts` —
 * **not** one of the three sub-cases below. Named here because a count that
 * claims completeness has to be checkable against the thing that holds it; the
 * post-merge review of `c79114c4` found this one by re-deriving it.
 *
 * The `displayNameFixes` lines are sheet text too, but they arrive already
 * quoted from `normalizeRtuDisplayNames`, and `onboarding-excel.service.spec.ts`
 * is what holds that. Site 3 is the one no `quoteCell` can cover — see
 * `hostileDraft` — and the docblock said "four" while it went unguarded.
 *
 * Measured at `ef1a3e11` through the real path: a workbook of 3,000 RTU rows
 * whose cells each held 32,767 characters produced an `assistantMessage` of
 * **393,235,161 characters**, and at 7,000 rows `excelImportFollowUp` died with
 * `RangeError: Invalid string length`. Those two uploads were 198 MB and
 * 461 MB, so `MAX_IMPORT_FILE_BYTES` (5 MiB) now closes them at the door;
 * `quoteCell` ships anyway (owner ruling 3) because a 5 MiB workbook may still
 * declare tens of MiB inflated, i.e. thousands of maximum-length cells.
 *
 * **What that residual is, now that it has been measured.** Through the
 * compiled services on this branch: a **1.75 MB** upload of 20,095 RTU rows —
 * one row under the sheet bound, every `topic` at exactly the 255-character
 * bound and every display name a duplicate, so each row also buys a
 * `displayNameFixes` line — parses in 4.1 s and produces a **13.16 MB**
 * `assistantMessage` at 658 MB RSS, which `OnboardingService.uploadExcel` then
 * appends to the session's stored message history. Every *cell* on that message
 * is bounded; the *counts* are not, because nothing caps the number of RTU rows
 * a workbook may declare. Closing that needs a semantic row cap and a per-line
 * cap on the summary, both filed as their own rows — deliberately not this one.
 *
 * The three sub-cases exist because `excelImportFollowUp` returns from the
 * first branch that matches. One call cannot reach both `mqttSetupTemplate` and
 * `formatAssetsByRtuSummary`, so a single-call assertion would leave one of the
 * five summary sites unguarded and green.
 */
export function assertExcelImportFollowUpBoundsEchoedText(): void {
  const service = chatService();

  // --- sites 1, 2 and 3: the location name, and the MQTT paste-back template -
  // Every RTU is `credentialsSet: false`, so the incomplete branch fires and
  // `mqttSetupTemplate` runs whatever each topic holds.
  const mqtt = service.excelImportFollowUp(
    hostileDraft(),
    { locationName: longCell("L"), rtuCount: 2, assetCount: 2 },
    [],
    [],
  );
  assert(
    mqtt.assistantMessage.includes("RTU: "),
    "this sub-case must reach the MQTT setup template, or site 2 goes unasserted",
  );
  assert(
    mqtt.assistantMessage.includes("topic: "),
    "this sub-case must render a topic line, or site 3 goes unasserted",
  );
  assert(
    mqtt.assistantMessage.length < 4000,
    `the MQTT follow-up must be bounded, got ${mqtt.assistantMessage.length} characters`,
  );
  assert(
    mqtt.assistantMessage.includes("more characters"),
    "a cut cell says how much was omitted",
  );
  // Site 3 in both directions. The over-long topic is replaced by the
  // placeholder — never cut, because a truncated topic pasted back subscribes
  // to a topic nobody asked for — and the one at exactly the bound is printed
  // whole, because the operator copies this block and edits it.
  assert(
    !mqtt.assistantMessage.includes("T".repeat(MAX_RTU_TOPIC_CHARS + 1)),
    "a topic past the bound must not be echoed into the template",
  );
  assert(
    mqtt.assistantMessage.includes("topic: your/topic/here"),
    `an unusable topic falls back to the placeholder, got "${mqtt.assistantMessage.slice(0, 300)}"`,
  );
  assert(
    mqtt.assistantMessage.includes(`topic: ${LEGAL_TOPIC}`),
    `a topic of exactly ${MAX_RTU_TOPIC_CHARS} characters is echoed whole for the paste-back`,
  );

  // --- sites 4 and 5: the assets-by-RTU summary -----------------------------
  // Credentials set, a real topic, point keys satisfied and no asset points:
  // the only branch left is the one that calls `formatAssetsByRtuSummary`.
  const summaryDraft = hostileDraft({
    onboardingMeta: { useExistingPointKeys: true },
    assetPoints: [],
  });
  for (const rtu of summaryDraft.rtus ?? []) {
    rtu.credentialsSet = true;
    rtu.config.topic = "BERHAMPUR-RTU-1/Topic1";
  }
  const summary = service.excelImportFollowUp(
    summaryDraft,
    { locationName: longCell("L"), rtuCount: 2, assetCount: 2 },
    [],
    [],
  );
  assert(
    summary.assistantMessage.includes("Assets by RTU"),
    "this sub-case must reach the assets summary, or sites 4 and 5 go unasserted",
  );
  // Asserted per sub-case on purpose. A length check on the MQTT case alone
  // stays green with sites 4 and 5 unquoted, which is exactly the "asserted in
  // one direction only" failure this row exists to correct.
  assert(
    summary.assistantMessage.length < 4000,
    `the assets summary must be bounded, got ${summary.assistantMessage.length} characters`,
  );
  assert(
    summary.assistantMessage.includes("more characters"),
    "a cut cell says how much was omitted",
  );
  // Both halves of the line — site 4's RTU display name and site 5's asset
  // name — are interpolated on the same line, so each is checked for its own
  // cut.
  const summaryLine = summary.assistantMessage
    .split("\n")
    .find((line) => line.startsWith("- **"));
  assert(summaryLine !== undefined, "the summary lists one line per RTU");
  assert(
    (String(summaryLine).match(/more characters/g) ?? []).length >= 2,
    `the RTU name and the asset name are each cut, got "${String(summaryLine).slice(0, 200)}"`,
  );

  // --- the other direction: an ordinary name is still readable -------------
  // `quoteCell` adds quotes and nothing else under the bound, so the operator
  // still sees the location they uploaded.
  const ordinary = service.excelImportFollowUp(
    hostileDraft(),
    { locationName: "Berhampur", rtuCount: 2, assetCount: 2 },
    [],
    [],
  );
  const firstLine = ordinary.assistantMessage.split("\n")[0];
  assert(
    firstLine.includes("Berhampur"),
    `a name inside ${MAX_ECHOED_CELL_CHARS} characters is echoed whole, got "${firstLine}"`,
  );
}

/** An RTU with nothing left to complete, so `excelImportFollowUp` walks past the MQTT branch. */
function completeRtu(name: string): NonNullable<OnboardingDraft["rtus"]>[number] {
  return {
    code: name,
    displayName: name,
    protocol: "mqtt",
    config: { host: "phe.thinkiot.co.in", port: 8883, tls: true, topic: "site/topic" },
    credentialsSet: true,
    ingestEnabled: true,
  };
}

function assetOf(rtuIndex: number, name: string): NonNullable<OnboardingDraft["assets"]>[number] {
  return { rtuIndex, code: name, name, siteName: "Berhampur", domain: "electrical" };
}

/** The draft shape that reaches `formatAssetsByRtuSummary` — every earlier branch satisfied. */
function summaryDraftOf(
  rtus: NonNullable<OnboardingDraft["rtus"]>,
  assets: NonNullable<OnboardingDraft["assets"]>,
): OnboardingDraft {
  return { rtus, assets, assetPoints: [], onboardingMeta: { useExistingPointKeys: true } };
}

/**
 * `formatAssetsByRtuSummary` costs one pass over the assets, not one per RTU
 * (post-merge review, finding 3).
 *
 * It was `rtus.map` wrapping `assets.filter` — O(rtus × assets) closure calls on
 * the event loop, with nothing between it and a request. The security review
 * measured 30 ms, 471 ms and **2,027 ms** at 1,000, 5,000 and 10,050 of each,
 * all inside every guard this row added: the row bound admits ~20,090 rows, and
 * a workbook of repeated short cells deflates far under the 5 MiB cap.
 *
 * **The trip count is asserted, not just the clock.** A wall-clock ceiling alone
 * is a flaky gate under a contended full-suite run and says nothing about why.
 * The fixture counts calls to `assets.filter`: the indexed version makes none,
 * the quadratic one makes one per RTU. The clock is kept as a second, generous
 * ceiling because the trip count is a proxy and a future rewrite could satisfy
 * it while being slow another way.
 *
 * The behaviour half is asserted first and by whole-string equality, because
 * "identical output" is the constraint the optimisation had to meet: asset order
 * within a line, the `(no assets yet)` case, and an asset whose `rtuIndex`
 * matches no RTU appearing nowhere.
 */
export function assertAssetsByRtuSummaryIsIndexedNotRescanned(): void {
  const service = chatService();

  // --- behaviour: identical output, including the two edge cases ------------
  const small = service.excelImportFollowUp(
    summaryDraftOf(
      [completeRtu("A"), completeRtu("B"), completeRtu("C")],
      [
        assetOf(0, "a-first"),
        assetOf(2, "c-only"),
        assetOf(0, "a-second"),
        // No RTU has index 7. `Map.get(7)` and `filter(a => a.rtuIndex === 7)`
        // agree that it belongs to no line, and it must stay that way: an
        // orphan silently attributed to RTU 0 would be a wrong summary.
        assetOf(7, "orphan"),
      ],
    ),
    { locationName: "Berhampur", rtuCount: 3, assetCount: 4 },
    [],
    [],
  );
  const summarySection = small.assistantMessage
    .split("\n")
    .filter((line) => line.startsWith("- **"))
    .join("\n");
  assert(
    summarySection ===
      ["- **'A'**: 'a-first', 'a-second'", "- **'B'**: (no assets yet)", "- **'C'**: 'c-only'"].join(
        "\n",
      ),
    `the summary must be unchanged by the indexing, got:\n${summarySection}`,
  );
  assert(
    !small.assistantMessage.includes("orphan"),
    "an asset whose rtuIndex matches no RTU belongs to no line",
  );

  // --- cost: the shape the review measured at 2,027 ms ----------------------
  const count = 10_050;
  const rtus = Array.from({ length: count }, (_, index) => completeRtu(`RTU-${index}`));
  const assets = Array.from({ length: count }, (_, index) => assetOf(index, `Asset-${index}`));
  let assetScans = 0;
  const nativeFilter = Array.prototype.filter as unknown as (
    this: unknown[],
    ...args: unknown[]
  ) => unknown[];
  Object.defineProperty(assets, "filter", {
    configurable: true,
    value(this: unknown[], ...args: unknown[]): unknown[] {
      assetScans += 1;
      return nativeFilter.apply(this, args);
    },
  });

  const started = performance.now();
  const big = service.excelImportFollowUp(
    summaryDraftOf(rtus, assets),
    { locationName: "Berhampur", rtuCount: count, assetCount: count },
    [],
    [],
  );
  const elapsedMs = performance.now() - started;

  assert(
    big.assistantMessage.includes("Assets by RTU"),
    "this sub-case must reach the assets summary, or it measures the wrong branch",
  );
  assert(
    big.assistantMessage.split("\n").filter((line) => line.startsWith("- **")).length === count,
    "every RTU still gets its line — a cheaper summary that lists fewer is not the same summary",
  );
  assert(
    assetScans <= 1,
    `the summary must index the assets once, not rescan them per RTU: ${assetScans} scans for ${count} RTUs`,
  );
  // A ceiling, not a benchmark. Measured 2,027 ms before the index and single
  // -digit ms after, so this sits far from both and survives a contended run.
  assert(
    elapsedMs < 750,
    `${count} RTUs × ${count} assets must not cost a quadratic walk, took ${elapsedMs.toFixed(0)} ms`,
  );
}

// ---------------------------------------------------------------------------
// F4.104 — `handleRuleBasedTurn`, the draft's default producer
// ---------------------------------------------------------------------------

/**
 * The rule-based branch with a **real** validator behind it.
 *
 * `finalizeTurn` calls `validateService.validate`, so that one cannot be a stub
 * — and it is the service that re-parses the merged draft through
 * `onboardingDraftSchema`, i.e. the thing that turns an over-long derived string
 * into the operator's permanent validation error. The other three are untouched
 * on every path below: `crypto` only inside `mergeDraft`, and `catalogService`
 * and `protocolService` only when an `organizationId` is passed.
 */
function ruleBasedChatService(): OnboardingChatService {
  return new OnboardingChatService(
    new OnboardingValidateService(),
    {} as never,
    {} as never,
    {} as never,
  );
}

/**
 * Drives the **real** `handleTurn` into its rule-based branch.
 *
 * Two ways this call silently measures the wrong code, both of them green:
 *
 * 1. `handleTurn:204` takes the OpenAI branch whenever `OPENAI_API_KEY` is set
 *    in the environment running the suite. That branch **does** parse
 *    `onboardingDraftSchema`, so every assertion below would pass while
 *    asserting nothing about the branch this row is about. The key is removed
 *    for the call and restored after it, and each case also pins a value only
 *    the rule-based branch produces.
 * 2. `organizationId` is left undefined. With one, a message mentioning a
 *    protocol *and* a question word is answered by `protocolService` before the
 *    dispatch below is reached.
 */
async function ruleBasedTurn(
  message: string,
  draft: OnboardingDraft,
  phase: OnboardingPhase,
): Promise<ChatTurnResult> {
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    return await ruleBasedChatService().handleTurn(message, draft, phase, "Ion Exchange");
  } finally {
    if (savedKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedKey;
    }
  }
}

/**
 * `assert` above is a plain check rather than a TypeScript assertion function,
 * so it cannot narrow away an `undefined`. This one does both jobs: it is where
 * each case below states which branch it had to reach, and it hands back the
 * value the rest of the case asserts on.
 */
function requiredItem<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** A stored location, as the `assets` and `rtu` branches read it back. */
function locationNamed(name: string): NonNullable<OnboardingDraft["location"]> {
  return {
    name,
    slug: "site",
    code: "SITE",
    type: "smoc_campus",
    latitude: -25.7,
    longitude: 28.2,
  };
}

/**
 * A draft that reaches the `assets` branch: `handleRuleBasedTurn` returns from
 * the first branch that matches, so the location, RTU and point-key branches
 * above it all have to be satisfied first.
 */
function draftBeforeAssets(locationName: string): OnboardingDraft {
  return {
    location: locationNamed(locationName),
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU 1",
        protocol: "mqtt",
        config: { host: "broker", port: 8883, tls: true, topic: "plant/rtu-1" },
        credentialsSet: true,
        ingestEnabled: true,
      },
    ],
    pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
  };
}

/**
 * A location name that is **legal at every bound** — 95 characters, well inside
 * `location.name`'s 255 — and still overflows `assets[].code`, because that code
 * is the name plus nine characters. This is the case that makes the row a
 * functional bug and not only a length axis.
 */
const LEGAL_LOCATION_NAME = "Berhampur Water Treatment Plant ".repeat(3).trim();

/** What the `assets` branch builds its code from, before any cut. */
function assetCodeFor(site: string): string {
  return `${site.replace(/\s+/g, "-").toUpperCase()}-ASSET-1`;
}

/**
 * `handleRuleBasedTurn` derives four schema-bound draft strings from the chat
 * message and from the stored location, and bounds none of them before `F4.104`
 * — `location.name`, `location.slug`, `assets[].code` and `assets[].siteName`.
 *
 * **The assertion is the schema itself.** Each case parses the produced patch
 * through `onboardingDraftSchema` — the same object
 * `OnboardingValidateService.validate` re-parses the stored draft with, and the
 * same one `handleOpenAiTurn` applies to the model's patch and this branch
 * applies to nothing. Asserting against the schema rather than against `255` and
 * `64` means this spec cannot drift from `ONBOARDING_DRAFT_STRING_MAX` when a
 * number there changes.
 *
 * A schema parse only proves the direction it can fail in, so each case also
 * asserts the **oracle is live**: the same patch carrying the *uncut* value is
 * refused by the same parse, on the path naming that field. Without it a slice
 * removed from the service would leave this function green — the parse would
 * simply be testing a value nothing had lengthened.
 *
 * Both directions on the length, too: a 95-character location name and a
 * 21-character chat message come back **unchanged**, so a cut that is too
 * aggressive reddens here as well as one that is missing.
 *
 * `config.topic` is the fifth derived string and it is **not** here — the schema
 * cannot see it. `assertRuleBasedTurnBoundsMqttTopic` holds it.
 */
export async function assertRuleBasedTurnBoundsDerivedDraftStrings(): Promise<void> {
  // --- the location branch: an 8,000-character name is what `chatBodySchema`
  // --- allows, and the whole message becomes `location.name` -----------------
  const longMessage = "b".repeat(600);
  assert(
    longMessage.length > ONBOARDING_DRAFT_STRING_MAX["location.name"],
    "this case must send a message past the bound, or it asserts nothing",
  );
  const long = await ruleBasedTurn(longMessage, {}, "location");
  const longLocation = requiredItem(
    long.draftPatch.location,
    "this case must reach the rule-based location branch, or it measures the OpenAI one",
  );
  assert(
    longLocation.type === "smoc_campus",
    "only the rule-based branch defaults the location type — this patch came from elsewhere",
  );
  assert(
    longLocation.name.length === ONBOARDING_DRAFT_STRING_MAX["location.name"],
    `location.name is cut to its bound, got ${longLocation.name.length} characters`,
  );
  assert(
    longLocation.slug.length === ONBOARDING_DRAFT_STRING_MAX["location.slug"],
    // The site that made this row worth writing: `code` three lines away was
    // already `.slice(0, 64)` and `slug`, derived from the same name, was not.
    `location.slug is cut to its bound, got ${longLocation.slug.length} characters`,
  );
  assert(
    longLocation.code.length === ONBOARDING_DRAFT_STRING_MAX["location.code"],
    `location.code is cut to its bound, got ${longLocation.code.length} characters`,
  );
  const longParsed = onboardingDraftSchema.safeParse(long.draftPatch);
  assert(
    longParsed.success,
    `the patch this branch produces must satisfy the draft schema: ${JSON.stringify(
      longParsed.error?.issues.map((issue) => issue.path.join(".")),
    )}`,
  );
  // The oracle is live: the same patch, uncut, is refused on those paths.
  const uncutLocation = onboardingDraftSchema.safeParse({
    location: { ...longLocation, name: longMessage, slug: "b".repeat(600) },
  });
  assert(
    !uncutLocation.success,
    "the schema must refuse the uncut name and slug, or this parse proves nothing",
  );
  const uncutPaths = (uncutLocation.error?.issues ?? []).map((issue) => issue.path.join("."));
  assert(
    uncutPaths.includes("location.name") && uncutPaths.includes("location.slug"),
    `the refusal names both fields, got ${JSON.stringify(uncutPaths)}`,
  );

  // --- the other direction: an ordinary location name survives whole ---------
  const ordinaryMessage = "Berhampur Water Works";
  const ordinary = await ruleBasedTurn(ordinaryMessage, {}, "location");
  assert(
    ordinary.draftPatch.location?.name === ordinaryMessage,
    `a name inside the bound is stored whole, got "${ordinary.draftPatch.location?.name}"`,
  );
  assert(
    ordinary.draftPatch.location?.slug === "berhampur-water-works",
    `the slug is unchanged for an ordinary name, got "${ordinary.draftPatch.location?.slug}"`,
  );

  // --- the assets branch, from a location name that is legal everywhere ------
  // 95 characters + `-ASSET-1` = 104, which `draftAssetSchema.code.max(64)`
  // refuses. The turn answered 200 and the operator was left with a validation
  // error no chat instruction could clear.
  assert(
    LEGAL_LOCATION_NAME.length <= ONBOARDING_DRAFT_STRING_MAX["location.name"] &&
      assetCodeFor(LEGAL_LOCATION_NAME).length > ONBOARDING_DRAFT_STRING_MAX["assets.code"],
    "this case needs a location name that is legal and still overflows the asset code",
  );
  const legalSite = await ruleBasedTurn("One asset", draftBeforeAssets(LEGAL_LOCATION_NAME), "assets");
  const legalAsset = requiredItem(
    legalSite.draftPatch.assets?.[0],
    "this case must reach the rule-based assets branch, or it measures the OpenAI one",
  );
  assert(
    legalAsset.name === "Primary Device",
    "only the rule-based branch names the asset — this patch came from elsewhere",
  );
  assert(
    legalAsset.code.length === ONBOARDING_DRAFT_STRING_MAX["assets.code"],
    `assets[].code is cut to its bound, got ${legalAsset.code.length} characters`,
  );
  assert(
    legalAsset.code === assetCodeFor(LEGAL_LOCATION_NAME).slice(0, legalAsset.code.length),
    // Cut the finished code, not the site: slicing the site first and then
    // appending `-ASSET-1` gives 64 + 8 and fails the same way.
    `the code keeps its leading characters, got "${legalAsset.code}"`,
  );
  assert(
    legalAsset.siteName === LEGAL_LOCATION_NAME,
    "a site name inside its own bound is stored whole",
  );
  const legalParsed = onboardingDraftSchema.safeParse(legalSite.draftPatch);
  assert(
    legalParsed.success,
    `a legal location name must not produce a draft the validator refuses: ${JSON.stringify(
      legalParsed.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    )}`,
  );
  const uncutCode = onboardingDraftSchema.safeParse({
    assets: [{ ...legalAsset, code: assetCodeFor(LEGAL_LOCATION_NAME) }],
  });
  assert(
    !uncutCode.success &&
      (uncutCode.error?.issues ?? []).some((issue) => issue.path.join(".") === "assets.0.code"),
    "the schema must refuse the uncut asset code, or this parse proves nothing",
  );

  // --- the assets branch, from a stored name written before any bound --------
  // `site` is the stored location name, so it reaches here from every producer
  // and from every draft saved before those producers were bounded.
  const storedName = "S".repeat(600);
  const storedSite = await ruleBasedTurn("One asset", draftBeforeAssets(storedName), "assets");
  const storedAsset = requiredItem(
    storedSite.draftPatch.assets?.[0],
    "this case must reach the rule-based assets branch, or it measures the OpenAI one",
  );
  assert(
    storedAsset.name === "Primary Device",
    "only the rule-based branch names the asset — this patch came from elsewhere",
  );
  assert(
    storedAsset.siteName.length === ONBOARDING_DRAFT_STRING_MAX["assets.siteName"],
    `assets[].siteName is cut to its bound, got ${storedAsset.siteName.length} characters`,
  );
  assert(
    storedAsset.code.length === ONBOARDING_DRAFT_STRING_MAX["assets.code"],
    `assets[].code is cut to its bound, got ${storedAsset.code.length} characters`,
  );
  const storedParsed = onboardingDraftSchema.safeParse(storedSite.draftPatch);
  assert(
    storedParsed.success,
    `the patch this branch produces must satisfy the draft schema: ${JSON.stringify(
      storedParsed.error?.issues.map((issue) => issue.path.join(".")),
    )}`,
  );
  const uncutSiteName = onboardingDraftSchema.safeParse({
    assets: [{ ...storedAsset, siteName: storedName }],
  });
  assert(
    !uncutSiteName.success &&
      (uncutSiteName.error?.issues ?? []).some(
        (issue) => issue.path.join(".") === "assets.0.siteName",
      ),
    "the schema must refuse the uncut site name, or this parse proves nothing",
  );
}

/**
 * The fifth string the rule-based branch derives from the message —
 * `defaultConfig`'s `topic`, which takes `\S+` out of a message
 * `chatBodySchema` allows 8,000 characters of.
 *
 * **Its oracle cannot be the draft schema, and that is a property of the schema
 * rather than of this test.** `config` is `z.record(z.unknown())` in both
 * copies — owner ruling 3 keeps it there, with the rest of the `z.record` axis,
 * for `E8.5` — so `onboardingDraftSchema` structurally cannot see any field
 * inside it, at any length. The bound is `MAX_RTU_TOPIC_CHARS`, the same one
 * `parseRtus` refuses the workbook's `topic` cell on, and it comes from
 * `bms.rtus.mqtt_topic` being `varchar(255)`. The last assertion below states
 * that limit executably: if the schema ever does start seeing `config.topic`,
 * it reddens and this function should switch to the parse.
 */
export async function assertRuleBasedTurnBoundsMqttTopic(): Promise<void> {
  const rawTopic = "t".repeat(600);
  assert(
    rawTopic.length > MAX_RTU_TOPIC_CHARS,
    "this case must send a topic past the bound, or it asserts nothing",
  );
  // Phase `rtu` with a location already stored: the branch above returns first
  // on `phase === "location" || !draft.location?.name`.
  const turn = await ruleBasedTurn(
    `topic: ${rawTopic}`,
    { location: locationNamed("Berhampur") },
    "rtu",
  );
  const rtu = requiredItem(
    turn.draftPatch.rtus?.[0],
    "this case must reach the rule-based RTU branch, or it measures the OpenAI one",
  );
  assert(
    rtu.code === "RTU-1",
    `only the rule-based branch numbers the RTU code, got "${rtu.code}"`,
  );
  assert(
    rtu.protocol === "mqtt",
    `only the MQTT config carries a topic, got protocol "${rtu.protocol}"`,
  );
  const topic = String(rtu.config?.topic ?? "");
  assert(
    topic.length === MAX_RTU_TOPIC_CHARS,
    `config.topic is cut to its bound, got ${topic.length} characters`,
  );
  assert(
    topic === rawTopic.slice(0, MAX_RTU_TOPIC_CHARS),
    "the topic keeps its leading characters",
  );

  // The other direction: a real topic is stored exactly as typed, because
  // `mqttSetupTemplate` prints it back for the operator to edit.
  const ordinary = await ruleBasedTurn(
    "topic: plant/rtu-1/data",
    { location: locationNamed("Berhampur") },
    "rtu",
  );
  assert(
    String(ordinary.draftPatch.rtus?.[0]?.config?.topic ?? "") === "plant/rtu-1/data",
    `a topic inside the bound is stored whole, got "${String(
      ordinary.draftPatch.rtus?.[0]?.config?.topic ?? "",
    )}"`,
  );

  // The stated limit, executable: the schema accepts the uncut topic, so it is
  // not the oracle for this field and cannot be made into one by asserting harder.
  const uncut = onboardingDraftSchema.safeParse({
    rtus: [{ ...rtu, config: { ...rtu.config, topic: rawTopic } }],
  });
  assert(
    uncut.success,
    "config is z.record(z.unknown()) in both copies — if the schema now refuses an " +
      "over-long topic, this function should assert through it instead of through the length",
  );
}
