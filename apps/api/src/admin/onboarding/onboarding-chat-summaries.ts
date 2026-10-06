import { mqttTopicHasWildcard } from "@bms/shared";
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
 * `F4.208` — the topic `OnboardingCommitService` writes to `bms.rtus.mqtt_topic`,
 * read the way it reads it: a string `config.topic`, else a string legacy
 * `config.mqttTopic`, untrimmed; any other value counts as absent. The commit
 * writes it for every protocol, so this does not look at the protocol.
 * `inferPhase` reads unparsed drafts, so `config` may be absent.
 */
export function rtuTopic(rtu: DraftRtu): string {
  const config = rtu.config ?? {};
  return (
    (typeof config.topic === "string" ? config.topic : null) ??
    (typeof config.mqttTopic === "string" ? config.mqttTopic : null) ??
    ""
  );
}

/** The topic `mqttSetupTemplate` prints for an RTU that has no usable one. */
export const MQTT_TOPIC_PLACEHOLDER = "your/topic/here";

/**
 * `F4.215` (owner ruling) — a topic holding an MQTT wildcard, `#` or `+`. Ingest
 * refuses it (`apps/ingest/src/adapters/mqtt.ts` refine) and the host skips the
 * RTU with `invalid-device-config`, so an RTU committed with one never ingests.
 *
 * `F4.221`: the predicate is `@bms/shared`'s `mqttTopicHasWildcard`, the one ingest
 * and the admin RTU routes read too; this name stays for its importers.
 */
export function topicHasWildcard(topic: string): boolean {
  return mqttTopicHasWildcard(topic);
}

/**
 * `F4.208` — a topic the RTU cannot ingest with: blank, the `-` placeholder,
 * wider than the `varchar(255)` column it commits to, or (`F4.215`) a wildcard.
 * The topic half of
 * `needsMqttSetup`, which `inferPhase` and `rtuInHand` read.
 */
export function topicUnusable(rtu: DraftRtu): boolean {
  const topic = rtuTopic(rtu);
  const trimmed = topic.trim();
  return (
    trimmed === "" ||
    trimmed === "-" ||
    trimmed === MQTT_TOPIC_PLACEHOLDER ||
    topic.length > MAX_RTU_TOPIC_CHARS ||
    topicHasWildcard(trimmed)
  );
}

/**
 * `F4.208` (owner ruling) — the index of the RTU a guided `topic: x` turn
 * writes to when the message names none: the first enabled MQTT RTU whose
 * *topic* is unusable, else the last enabled MQTT RTU, else `-1`, and the turn
 * appends a new RTU as before. Not `needsMqttSetup`: an RTU that lacks only its
 * credential would take a topic meant for the RTU added after it.
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

/** An `RTU:` line of `mqttSetupTemplate`; group 1 is the name it carries. */
const RTU_LINE = /^[ \t]*RTU:[ \t]*(.*?)[ \t]*$/gim;

/**
 * The guided turn's `topic: x` — non-global there, so only the first is taken.
 * Since F4.218 it is also the append-time capture (`defaultConfig`), so a topic
 * without the colon is stored nowhere.
 */
export const TOPIC_TURN = /\btopic\s*:\s*(\S+)/i;

/**
 * `F4.208` — the lower-cased message without its `RTU:` lines and without any
 * `topic: x`, which is what the guided turn tests for a protocol word: a
 * display name (`Sim House C`) or another block's topic (`site/mqtt/b`) names
 * no protocol. Only the `topic: x` token goes, not its line, so a typed
 * `mqtt topic: plant/x` still names one.
 */
export function protocolTestText(message: string): string {
  return message.replace(RTU_LINE, "").replace(new RegExp(TOPIC_TURN.source, "gi"), "").toLowerCase();
}

/**
 * `F4.208` — the RTU a guided `topic: x` turn writes to. A message with an
 * `RTU:` line — a block of `mqttSetupTemplate`, pasted back — targets the
 * enabled MQTT RTU its **first** `RTU:` line names, as the template prints it
 * (`quoteCell(displayName)`) or by its bare display name or code. The first,
 * because `TOPIC_TURN` takes the first `topic:`, which is the first block's.
 * A message with no `RTU:` line, or a name that matches no such RTU or several,
 * falls back to `rtuInHand`.
 */
export function rtuForTopicTurn(message: string, draft: OnboardingDraft): number {
  const name = [...message.matchAll(RTU_LINE)][0]?.[1];
  if (name !== undefined) {
    const matches = (draft.rtus ?? []).flatMap((rtu, index) =>
      isEnabledMqttRtu(rtu) && [quoteCell(rtu.displayName), rtu.displayName, rtu.code].includes(name) ? [index] : [],
    );
    if (matches.length === 1) {
      return matches[0];
    }
  }
  return rtuInHand(draft);
}

/** `F4.208` — the guided reply to an added MQTT RTU; it names both routes to its topic. */
export const MQTT_RTU_ADDED_REPLY =
  "MQTT RTU added. Add its credentials with the **Credentials** field on the RTU step — never in this chat — " +
  "set its topic in the preview, or write **topic: <topic>**, then say **confirm rtu**.";

/** `F4.208` — the guided RTU step's prompt while `waiting` MQTT RTUs still need setup. */
export function mqttRtusWaitingPrompt(waiting: number): string {
  return (
    `${waiting} MQTT RTU(s) still need credentials or a topic. Set each RTU's credentials with the ` +
    "**Credentials** field on the RTU step — never in this chat — set each topic in the preview, or write " +
    "**topic: <topic>**, then say **confirm rtu**."
  );
}

export function mqttSetupTemplate(draft: OnboardingDraft): string {
  const mqttRtus = (draft.rtus ?? []).filter(isEnabledMqttRtu);
  if (mqttRtus.length === 0) {
    return "";
  }
  // `F4.105` site 2. **Capping this costs no working function**, and that is
  // measured rather than assumed: the template already does not do what it
  // says past the first block. The guided turn reads one *non-global*
  // `/\btopic\s*:\s*(\S+)/i`, so only the first block's topic is ever taken.
  // Until `F4.208` the `phase === "rtu"` branch of `handleRuleBasedTurn` also
  // *appended* an RTU instead of updating the ones the import created; since
  // then, while the derived phase is `rtu`, a `topic:` turn that names no
  // protocol sets the topic of `rtuForTopicTurn`'s RTU: the one the first
  // pasted `RTU:` line names, else `rtuInHand`'s — so the first block's topic
  // lands on the first block's RTU, one RTU per message. Reading
  // several blocks from one paste stays a recorded limit (owner ruling, `F4.208`).
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
    const existingTopic = rtuTopic(rtu).trim();
    // `topic:` is the one echo site `quoteCell` cannot cover — the operator
    // copies this block, edits it and pastes it back, and the quotes would be
    // captured into the stored topic by the guided turn's
    // `/\btopic\s*:\s*(\S+)/i` (or `defaultConfig`'s `TOPIC_TURN` when
    // the turn appends). So it is bounded by *length* instead, against the
    // same `MAX_RTU_TOPIC_CHARS` the sheet is refused on, and an unusable
    // value falls back to the placeholder rather than being cut: a truncated
    // topic pasted back subscribes to a topic nobody asked for. A draft can
    // reach here without passing `parseRtus` (chat and the draft API both
    // write `config.topic`), which is why the bound is applied twice.
    const topic =
      existingTopic && existingTopic !== "-" && existingTopic.length <= MAX_RTU_TOPIC_CHARS
        ? existingTopic
        : MQTT_TOPIC_PLACEHOLDER;
    return [
      // Quoting this breaks no round trip: the topic is read from the `topic:`
      // line below, and `rtuForTopicTurn` matches this line against
      // `quoteCell(displayName)` — this exact form — to pick the RTU.
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
