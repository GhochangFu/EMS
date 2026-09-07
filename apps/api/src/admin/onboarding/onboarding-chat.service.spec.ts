import type { OnboardingDraft } from "@bms/shared";

import { MAX_ECHOED_CELL_CHARS } from "../spreadsheet-guard";
import { OnboardingChatService } from "./onboarding-chat.service";
import { MAX_RTU_TOPIC_CHARS } from "./onboarding-excel.service";

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
 * declare tens of MiB inflated, i.e. thousands of maximum-length cells. **No
 * figure is claimed for that residual — it has not been measured.**
 *
 * The three sub-cases exist because `excelImportFollowUp` returns from the
 * first branch that matches. One call cannot reach both `mqttSetupTemplate` and
 * `formatAssetsByRtuSummary`, so a single-call assertion would leave one of the
 * five sites unguarded and green.
 */
export function assertExcelImportFollowUpBoundsEchoedText(): void {
  const service = chatService();

  // --- sites 1, 3 and 5: the location name, and the MQTT paste-back template -
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
    "this sub-case must reach the MQTT setup template, or site 3 goes unasserted",
  );
  assert(
    mqtt.assistantMessage.includes("topic: "),
    "this sub-case must render a topic line, or site 5 goes unasserted",
  );
  assert(
    mqtt.assistantMessage.length < 4000,
    `the MQTT follow-up must be bounded, got ${mqtt.assistantMessage.length} characters`,
  );
  assert(
    mqtt.assistantMessage.includes("more characters"),
    "a cut cell says how much was omitted",
  );
  // Site 5 in both directions. The over-long topic is replaced by the
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

  // --- site 4: the assets-by-RTU summary -----------------------------------
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
    "this sub-case must reach the assets summary, or site 4 goes unasserted",
  );
  // Asserted per sub-case on purpose. A length check on the MQTT case alone
  // stays green with site 4's quoting removed, which is exactly the "asserted
  // in one direction only" failure this row exists to correct.
  assert(
    summary.assistantMessage.length < 4000,
    `the assets summary must be bounded, got ${summary.assistantMessage.length} characters`,
  );
  assert(
    summary.assistantMessage.includes("more characters"),
    "a cut cell says how much was omitted",
  );
  // Both halves of site 4 — the RTU display name and each asset name — are
  // interpolated on the same line, so each is checked for its own cut.
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
