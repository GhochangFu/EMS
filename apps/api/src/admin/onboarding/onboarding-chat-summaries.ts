import type { OnboardingDraft } from "@bms/shared";

// F4.105: `quoteCell` bounds how long each echoed cell is; `echoedItems` and
// `moreTail` bound how many of them one list may name. Both axes are declared
// together in that file, because either alone leaves the product unbounded.
import { MAX_ECHOED_ITEMS, echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { MAX_RTU_TOPIC_CHARS } from "./onboarding-excel.service";

type DraftRtu = NonNullable<OnboardingDraft["rtus"]>[number];

/** An RTU the ingest pipeline is meant to read from — the MQTT setup template's own predicate. */
export function isEnabledMqttRtu(rtu: DraftRtu): boolean {
  return rtu.protocol === "mqtt" && rtu.ingestEnabled === true;
}

/**
 * An enabled MQTT RTU that cannot ingest yet — no credential, or no usable
 * topic. This is the **narrower** predicate: the count in the prose comes from
 * it, while the paste-back template renders every enabled MQTT RTU.
 *
 * Declared once and read from both places on purpose. The divergence is
 * pre-existing and deliberate (owner ruling 4 leaves the template's contents
 * alone), but with `F4.105`'s cap in front of it the template has to know which
 * of its RTUs the prose is counting, so that a leading-25 cut keeps them.
 */
export function needsMqttSetup(rtu: DraftRtu): boolean {
  return isEnabledMqttRtu(rtu) && (!rtu.credentialsSet || topicUnusable(rtu));
}

/**
 * `F4.208` — the topic `OnboardingCommitService` writes to `bms.rtus.mqtt_topic`:
 * `config.topic`, else the legacy `config.mqttTopic`, untrimmed. `inferPhase`
 * reads unparsed drafts, so `config` may be absent.
 */
export function rtuTopic(rtu: DraftRtu): string {
  return String(rtu.config?.topic ?? rtu.config?.mqttTopic ?? "");
}

/**
 * `F4.208` — a topic the RTU cannot ingest with: blank, the `-` placeholder, or
 * wider than the `varchar(255)` column it commits to. The one predicate behind
 * `needsMqttSetup`, `inferPhase` and the guided turn's RTU in hand.
 */
export function topicUnusable(rtu: DraftRtu): boolean {
  const topic = rtuTopic(rtu);
  const trimmed = topic.trim();
  return trimmed === "" || trimmed === "-" || topic.length > MAX_RTU_TOPIC_CHARS;
}

/**
 * `F4.208` (owner ruling) — the index of the RTU a guided `topic: x` turn
 * writes to: the first enabled MQTT RTU whose topic is unusable, else the last
 * enabled MQTT RTU, else `-1`, and the turn appends a new RTU as before.
 */
export function rtuInHand(draft: OnboardingDraft): number {
  const rtus = draft.rtus ?? [];
  const waiting = rtus.findIndex((rtu) => isEnabledMqttRtu(rtu) && topicUnusable(rtu));
  if (waiting >= 0) {
    return waiting;
  }
  for (let i = rtus.length - 1; i >= 0; i -= 1) {
    if (isEnabledMqttRtu(rtus[i])) {
      return i;
    }
  }
  return -1;
}

export function mqttSetupTemplate(draft: OnboardingDraft): string {
  const mqttRtus = (draft.rtus ?? []).filter(isEnabledMqttRtu);
  if (mqttRtus.length === 0) {
    return "";
  }
  // `F4.105` site 2. **Capping this costs no working function**, and that is
  // measured rather than assumed: the template already does not do what it
  // says past the first block. The guided turn reads one *non-global*
  // `/topic[:\s]+(\S+)/i`, so only the first block's topic is ever taken.
  // Until `F4.208` the `phase === "rtu"` branch of `handleRuleBasedTurn` also
  // *appended* an RTU instead of updating the ones the import created; since
  // then a `topic:` turn that names no protocol sets the topic of the RTU in
  // hand (`rtuInHand`) — the first one still waiting — so a pasted template
  // fills one RTU per message. Reading several blocks from one paste stays a
  // recorded limit (owner ruling, `F4.208`).
  //
  // **The two predicates diverge, and the cap turned that from untidy into an
  // elision — so this list is sorted, not filtered.** `mqttIncomplete` — a
  // local of `excelImportFollowUp` in `onboarding-chat.service.ts`, the list
  // that function's "MQTT setup still required" sentence counts — is
  // strictly narrower than this one: it also
  // requires a missing credential or an unusable topic. Before the cap every
  // enabled MQTT RTU printed, so the ones the prose meant were always among
  // them. A leading-25 cut alone does not keep that promise — measured here:
  // 30 enabled MQTT RTUs of which only the last lacked a topic produced
  // "**MQTT setup still required** for 1 RTU(s)", 25 paste-back blocks for
  // RTUs that needed nothing, and the one that did need work **nowhere in the
  // message**.
  //
  // Sorting the incomplete ones to the front repairs exactly what the cap
  // broke. Filtering to `excelImportFollowUp`'s `mqttIncomplete` would also
  // change *which* RTUs the
  // template contains, and that divergence is pre-existing and deliberate
  // (owner ruling 4 leaves the template's contents and its instruction text
  // alone). A reorder is safe **here and only here**: nothing in the block
  // below keys off position, unlike `formatAssetsByRtuSummary` where the
  // index *is* the asset map's key. `Array.prototype.sort` is stable
  // (ES2019), so the complete RTUs keep their input order behind the
  // incomplete ones.
  //
  // **The tail still counts omissions from this list, never from
  // `excelImportFollowUp`'s `mqttIncomplete`.** Its sentence can honestly
  // say "still required for 100
  // RTU(s)" over 25 blocks; a tail derived from the prose's number would be
  // wrong.
  const setupOrder = [...mqttRtus].sort(
    (left, right) => Number(needsMqttSetup(right)) - Number(needsMqttSetup(left)),
  );
  const { shown, omitted } = echoedItems(setupOrder);
  const blocks = shown.map((rtu) => {
    const existingTopic = String(rtu.config.topic ?? rtu.config.mqttTopic ?? "").trim();
    // `topic:` is the one echo site `quoteCell` cannot cover — the operator
    // copies this block, edits it and pastes it back, and the quotes would be
    // captured into the stored topic by `defaultConfig`'s
    // `/topic[:\s]+(\S+)/i`. So it is bounded by *length* instead, against the
    // same `MAX_RTU_TOPIC_CHARS` the sheet is refused on, and an unusable
    // value falls back to the placeholder rather than being cut: a truncated
    // topic pasted back subscribes to a topic nobody asked for. A draft can
    // reach here without passing `parseRtus` (chat and the draft API both
    // write `config.topic`), which is why the bound is applied twice.
    const topic =
      existingTopic && existingTopic !== "-" && existingTopic.length <= MAX_RTU_TOPIC_CHARS
        ? existingTopic
        : "your/topic/here";
    return [
      // Quoting this breaks no round trip: the paste-back parser is
      // `defaultConfig`'s `/topic[:\s]+(\S+)/i`, which reads the `topic:`
      // line below and never this one.
      `RTU: ${quoteCell(rtu.displayName)}`,
      `topic: ${topic}`,
      // No username/password lines (ADR 0022, decision 2). A copy-paste block
      // that models credential entry teaches exactly the behaviour this ADR
      // forbids — and the filled-in version would now be refused by the
      // detector, stranding anyone who followed the instruction.
    ].join("\n");
  });
  return [
    "**Copy from START to END, edit the values, and paste your reply here.**",
    "────────── START COPY ──────────",
    blocks.join("\n---\n"),
    "────────── END COPY ──────────",
    // **Outside the markers, deliberately.** Inside them the operator copies
    // it, edits around it and pastes it back, and it would reach
    // `defaultConfig`'s parser as if it were part of the template.
    //
    // Named, for the same reason the assets summary names its own RTU tail:
    // this message also carries the display-name fix list, whose tail counts
    // *fixes*. Two bare `…and N more` lines in one reply, counting different
    // things, is what the noun exists to prevent. The API-layer check for
    // this row asserted the noun here and found it missing, because the
    // first pass added it only at the site the review quoted.
    moreTail(omitted, "RTUs"),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatAssetsByRtuSummary(draft: OnboardingDraft): string {
  const rtus = draft.rtus ?? [];
  const assets = draft.assets ?? [];
  // One pass to index, then one lookup per RTU. This was `rtus.map` wrapping
  // `assets.filter`, i.e. O(rtus × assets) closure calls on the event loop
  // with nothing between it and a request: the F4.102 security review measured
  // 30 ms, 471 ms and 2,027 ms at 1,000, 5,000 and 10,050 of each — all
  // reachable inside the row bound and the 5 MiB upload cap. Push order is
  // input order, so each line reads exactly as it did.
  const assetsByRtu = new Map<number, NonNullable<OnboardingDraft["assets"]>>();
  for (const asset of assets) {
    const bucket = assetsByRtu.get(asset.rtuIndex);
    if (bucket) {
      bucket.push(asset);
    } else {
      assetsByRtu.set(asset.rtuIndex, [asset]);
    }
  }
  // `F4.105` sites 3 and 4. Both halves are sheet text: the RTU display name,
  // and every asset name under it. One line can carry as many cells as the
  // RTU has assets, so the per-cell bound is what keeps each name a hint —
  // and these two counts are what keep the *number* of them a summary.
  //
  // **The two caps share one budget on the asset axis, and that is the whole
  // point.** A per-section 25 on both would leave 25 lines × 25 names ≈
  // 51 KB; one budget of 25 asset names across the whole summary brings the
  // worst message to **12,718** characters, from **84,945** without either
  // bound. Both instrumented on the fixture in
  // `onboarding-chat-summary-caps.spec.ts`, whose docblock decomposes them.
  // Owner ruling 3.
  //
  // `shownRtus` is `slice(0, MAX_ECHOED_ITEMS)`, a **prefix**, so index `i`
  // here is still the original `rtuIndex` the `assetsByRtu` map is keyed on.
  // Reordering or filtering the RTUs before this loop silently
  // mis-attributes every asset.
  //
  // The index above is built over **all** assets and before this slice, on
  // purpose: it is what keeps the trip count at one pass, and a rewrite that
  // filtered the assets per rendered RTU would make 25 scans and redden
  // `assertAssetsByRtuSummaryIsIndexedNotRescanned`.
  const { shown: shownRtus, omitted: omittedRtus } = echoedItems(rtus);
  let remaining = MAX_ECHOED_ITEMS;
  let rtusWithAssetsLeft = shownRtus.filter(
    (_rtu, index) => (assetsByRtu.get(index)?.length ?? 0) > 0,
  ).length;
  const lines = shownRtus.map((rtu, index) => {
    const rtuAssets = assetsByRtu.get(index) ?? [];
    // An asset whose `rtuIndex` matches no RTU is in the map and on no line,
    // which is what the filter this replaced did.
    if (rtuAssets.length === 0) {
      return `- **${quoteCell(rtu.displayName)}**: (no assets yet)`;
    }
    rtusWithAssetsLeft -= 1;
    // **The reserve** — one name held back for each later line that has
    // assets — is what keeps every line informative, and it is what makes the
    // shared budget satisfy both halves of ruling 3 at once: the total taken
    // is exactly ≤ 25, *and* each line still names its first assets and
    // carries its own tail. Spend greedily instead and line 1 takes all 25
    // while lines 2..25 name nothing, with the same total and the same line
    // count — which is why `assertAssetsByRtuSummaryIsCapped` asserts the
    // distribution and not only the total.
    //
    // **No `Math.max(1, allowance)`.** The invariant
    // `remaining >= rtusWithAssetsLeft` holds at entry (`MAX_ECHOED_ITEMS`
    // against at most that many shown lines) and is preserved, because
    // `take <= remaining − rtusWithAssetsLeft` gives
    // `remaining − take >= rtusWithAssetsLeft`. So `allowance >= 1` always,
    // and a defensive floor would be an uncoverable branch that told the next
    // reader the invariant can fail.
    const allowance = remaining - rtusWithAssetsLeft;
    const take = Math.min(rtuAssets.length, allowance);
    remaining -= take;
    const names = rtuAssets.slice(0, take).map((asset) => quoteCell(asset.name));
    const assetList = [...names, moreTail(rtuAssets.length - take)].filter(Boolean).join(", ");
    return `- **${quoteCell(rtu.displayName)}**: ${assetList}`;
  });
  // **Assets on the omitted RTUs are named nowhere**, and that elision comes
  // from this line cap rather than from the asset budget. The headline
  // `**500** asset(s)` is what keeps the message honest about it — the count
  // stays exact while the list stops being a data dump.
  //
  // This is the one tail that names its unit, and the reason is local: it is
  // the only place where two tails counting **different things** share a
  // block. `…and 4 more` sits inline on a line and counts that RTU's assets;
  // this one closes the list and counts RTUs. The noun is a literal here and
  // never a value from an item — see `moreTail`.
  if (omittedRtus > 0) {
    lines.push(moreTail(omittedRtus, "RTUs"));
  }
  return `**Assets by RTU:**\n${lines.join("\n")}`;
}
