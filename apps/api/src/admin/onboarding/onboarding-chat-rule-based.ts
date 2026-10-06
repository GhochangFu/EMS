/**
 * F4.217 — the guided (rule-based) onboarding mode, moved verbatim from
 * `onboarding-chat.service.ts`; the agent path and `finalizeTurn` stay there.
 *
 * F3.27 (ADR 0090 Amendment 2): the step order, labels and defaults are
 * unchanged, but every draft write now goes through `guidedWrite` (the tool
 * registry's `runTool`) and answers a code-written action line. A fallback
 * turn (`fallbackTurn`) writes nothing. `GUIDED_TOOL_COVERAGE` classifies
 * every registry tool (B7).
 */
import type {
  LocationTypeDto,
  OnboardingAutoOpenReason,
  OnboardingDraft,
  OnboardingPhase,
  OnboardingProtocol,
} from "@bms/shared";

// F4.104: the length of every draft string field, declared once beside the
// shared contract's copy of the draft schema and imported here as a value.
// `@bms/shared` and not `@bms/shared/contracts` — apps/api compiles with
// moduleResolution "node" and ignores the exports map (ADR 0030 Amendment 2).
import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";

import { quoteCell } from "../spreadsheet-guard";
import type { ToolContext, ToolState } from "./onboarding-agent-tools";
import type { OnboardingCatalogService } from "./onboarding-catalog.service";
import { catalogCodeFromLocationName, cutToBound } from "./onboarding-draft-caps";
import { MAX_RTU_TOPIC_CHARS } from "./onboarding-excel.service";
import * as locationTypes from "./onboarding-location-type-match";
import {
  MQTT_RTU_ADDED_REPLY,
  mqttRtusWaitingPrompt,
  needsMqttSetup,
  protocolTestText,
  rtuForTopicTurn,
  TOPIC_TURN,
  topicHasWildcard,
} from "./onboarding-chat-summaries";
import { guidedWrite } from "./onboarding-guided-writes";
import type { ValidateTemplateContext } from "./onboarding-template-refs";
import type { OnboardingDraftInput } from "./onboarding.schema";
import { draftNeedsPointKeys, type OnboardingValidateService } from "./onboarding-validate.service";

export type ChatTurnResult = {
  assistantMessage: string;
  draftPatch: OnboardingDraftInput;
  currentPhase: OnboardingPhase;
  suggestedReplies?: string[];
  validationErrors?: { path: string; message: string }[];
  readyToCommit?: boolean;
  autoOpenPreview?: boolean;
  autoOpenReason?: OnboardingAutoOpenReason;
  /** F3.21 decision 6: code-written lines for each draft write, on the agent path and (F3.27, ADR 0090 Amendment 2 B4) the guided one. */
  actionLines: string[];
  /** F3.21 decision 5: set when the agent proposed a commit; the caller binds it to the stored draft's hash. */
  commitProposal?: { summary: string };
  // No `credentialsToEncrypt` here by design (ADR 0022 decision 2): a chat turn
  // can no longer yield a credential, so the field is removed rather than left
  // permanently undefined where someone could re-populate it. `mergeDraft`
  // still accepts credentials — `POST :id/credentials` is its only caller now.
};

/**
 * What one turn validates against, read once at its start: the active location
 * types (`F4.162`, plan D9) and the template context (`F3.22`, ADR 0091).
 */
export type TurnVocabulary = {
  readonly types: readonly LocationTypeDto[];
  readonly templates: ValidateTemplateContext;
};

/**
 * What the guided mode needs from `OnboardingChatService`. `finalizeTurn` is
 * passed in, not moved: the agent path validates and shapes its result there too.
 */
export type RuleBasedTurnDeps = {
  readonly validateService: Pick<OnboardingValidateService, "inferPhase">;
  /**
   * F3.27 (ADR 0090 Amendment 2 B4): the context the agent's tools run in,
   * built by the same `OnboardingChatService.toolContext`, so a guided write
   * through `guidedWrite` meets the agent path's checks. Its `organizationId`
   * is the turn's organization.
   */
  readonly tools: ToolContext;
  readonly catalogService: Pick<OnboardingCatalogService, "listPointKeys" | "formatPointKeysForChat">;
  readonly finalizeTurn: (
    assistantMessage: string,
    draftPatch: OnboardingDraftInput,
    currentPhase: OnboardingPhase,
    suggestedReplies: string[] | undefined,
    userMessage: string,
    draft: OnboardingDraft,
    turn: TurnVocabulary,
  ) => ChatTurnResult;
};

/** The guided steps in the order `inferPhase` walks them. */
const PHASE_ORDER: readonly OnboardingPhase[] = ["location", "rtu", "point_keys", "assets", "mappings", "review"];

/** The protocol replies; each is a protocol `detectProtocol` reads. */
const PROTOCOL_REPLIES = ["MQTT", "Modbus", "BACnet", "OPC-UA", "SNMP", "REST", "Simulator"];

/**
 * F4.220 — the protocol words `detectProtocol` reads, in its order, each a
 * whole word: `simple` and `restriction` name none. A message with none of
 * them falls back to MQTT there. `mqtt` is not listed: it is the fallback.
 */
const PROTOCOL_WORDS: ReadonlyArray<readonly [RegExp, OnboardingProtocol]> = [
  [/\bmodbus(?:[ _/-]?(?:tcp|rtu))?\b/, "modbus_tcp"],
  [/\bbacnet(?:[ _/-]?ip)?\b/, "bacnet"],
  [/\bopc(?:[ _-]?ua)?\b/, "opc_ua"],
  [/\bsnmp(?:v[123]c?)?\b/, "snmp"],
  [/\brest(?:[ _-]?poller|ful)?\b/, "rest_poller"],
  [/\bsim(?:ulat\w*)?\b/, "simulator"],
];

/** True when the text names a protocol as a whole word (`mqtt`, `mqtts`, `mqtt5`, `mqttv3` count). Exported for the service intercept. */
export const NAMES_A_PROTOCOL = new RegExp(
  [...PROTOCOL_WORDS.map(([re]) => re.source), "\\bmqtt(?:s|v?[35])?\\b"].join("|"),
);

/** F4.199 — the "confirm <step>" replies the guided mode offers, matched whole after trim and lower-casing. */
const CONFIRM_STEP_REPLIES: ReadonlyMap<string, OnboardingPhase> = new Map([
  ["confirm rtu", "rtu"],
  ["confirm point keys", "point_keys"],
  ["confirm assets", "assets"],
  ["confirm mappings", "mappings"],
]);

const STEP_NAMES: Readonly<Record<OnboardingPhase, string>> = {
  location: "location",
  rtu: "RTU",
  point_keys: "point keys",
  assets: "assets",
  mappings: "mappings",
  review: "review",
};

/** ADR 0090 Amendment 2 B3, B6 — the guided answer at review and to a commit word: it sends the user to the Commit button and, after it, to the Asset Templates editor. It proposes no commit. */
export const REVIEW_REPLY =
  "The draft is in review. Open the preview and click **Commit**. After the commit, the Asset Templates editor can instantiate templates on this site.";

/**
 * F4.199 — what the draft still needs at `phase`, with only replies that the
 * guided mode answers at that phase: each one reaches the branch its text names.
 */
function stepPrompt(
  phase: OnboardingPhase,
  draft: OnboardingDraft,
  types: readonly LocationTypeDto[],
): { text: string; replies: string[] } {
  switch (phase) {
    case "location": {
      // A named location waits for its type: the location branch reads a type label.
      const name = draft.location?.name;
      if (name && !locationTypes.hasActiveLocationType(draft.location, types)) {
        return { text: locationTypes.locationTypeQuestion(name), replies: types.map((t) => t.label) };
      }
      return { text: "The location needs a name and a type first. What is the location name?", replies: ["View draft"] };
    }
    case "rtu": {
      const waiting = (draft.rtus ?? []).filter(needsMqttSetup).length;
      if ((draft.rtus ?? []).length === 0) {
        return { text: "Add an RTU first. Which communication protocol will RTU 1 use?", replies: [...PROTOCOL_REPLIES] };
      }
      if (waiting > 0) {
        return { text: mqttRtusWaitingPrompt(waiting), replies: ["confirm rtu", "View draft"] };
      }
      return { text: "Each RTU needs a code and a protocol. Open the preview to fix them.", replies: ["View draft"] };
    }
    case "point_keys":
      return { text: "Add a point key: say **kw** to add the catalog key **kw**.", replies: ["kw", "View draft"] };
    case "assets":
      return { text: "Add an asset: say **One asset** to add one.", replies: ["One asset", "View draft"] };
    case "mappings":
      return { text: "Map the assets: say **auto map** to map each plain asset to **kw**.", replies: ["auto map", "View draft"] };
    case "review":
      return { text: "Open the preview and click **Commit**, or say **create it**.", replies: ["create it", "View draft"] };
  }
}

/**
 * ADR 0090 Amendment 2 B1 — the answer to an agent turn that fell back after a
 * provider error. The message was written for the model, so the guided mode
 * does not read it: the turn writes nothing and answers the step prompt for the
 * phase the draft is at. The caller puts `AGENT_UNAVAILABLE_NOTICE` before it.
 */
export function fallbackTurn(
  deps: RuleBasedTurnDeps,
  message: string,
  draft: OnboardingDraft,
  turn: TurnVocabulary,
): ChatTurnResult {
  const { types } = turn;
  const derived = deps.validateService.inferPhase(draft, types.map((t) => t.code));
  const prompt = stepPrompt(derived, draft, types);
  return deps.finalizeTurn(prompt.text, {}, derived, prompt.replies, message, draft, turn);
}

/** Runs one guided (rule-based) chat turn: `deps` supplies validateService.inferPhase, catalogService (point-key listing) and finalizeTurn; resolves to the `ChatTurnResult` that `deps.finalizeTurn` builds. */
export async function handleRuleBasedTurn(
  deps: RuleBasedTurnDeps,
  message: string,
  draft: OnboardingDraft,
  phase: OnboardingPhase,
  orgName: string,
  turn: TurnVocabulary,
): Promise<ChatTurnResult> {
  const { types } = turn;
  const { organizationId } = deps.tools;
  const lower = message.toLowerCase().trim();
  const patch: OnboardingDraftInput = {};
  // F4.199 (owner ruling 2026-10-05, "normalise, then no-op"): a typed label
  // works as its button — one space, no trailing `.!?`. The commit phrase in
  // `OnboardingService.chat` stays exact, so "confirm commit." commits nothing.
  const intent = lower.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
  const derived = deps.validateService.inferPhase(draft, types.map((t) => t.code));
  // F3.27 (ADR 0090 Amendment 2 B4, B5): every draft write below runs through
  // `guidedWrite` against this one working copy, so the caps, the depth bound,
  // the element schemas and the credential and prompt-marker refusals are the
  // agent path's own. A refusal changes nothing and answers its sentence.
  const state: ToolState = { working: draft };
  const refused = (error: string): ChatTurnResult => {
    const prompt = stepPrompt(derived, draft, types);
    return deps.finalizeTurn(`I did not change the draft. ${error} ${prompt.text}`, {}, derived, prompt.replies, message, draft, turn);
  };

  // Anchored and phase-gated: before the point-key step this switched the
  // draft to the existing keys from a step it had not reached.
  const keysReply = /^(use existing keys|confirm point keys)$/.test(intent);
  if (keysReply && derived === "point_keys") {
    const orgKeys = await deps.catalogService.listPointKeys(organizationId);
    if (orgKeys.length > 0) {
      // `mergeDraftPatch` merges `onboardingMeta` field by field, so the other meta fields survive.
      const written = await guidedWrite("use_existing_point_keys", { value: true }, state, deps.tools);
      if (!written.ok) {
        return refused(written.error);
      }
      const result = deps.finalizeTurn(
        `Using existing organization point keys:\n\n${deps.catalogService.formatPointKeysForChat(orgKeys)}\n\nSay **confirm assets** or add assets per RTU.`,
        { onboardingMeta: state.working.onboardingMeta },
        "assets",
        ["confirm assets", "View draft"],
        message,
        draft,
        turn,
      );
      return { ...result, actionLines: [written.actionLine] };
    }
  }

  // F4.199: the whole message, never a prefix. As a prefix this rule also
  // took the "confirm rtu", "confirm point keys", "confirm assets" and
  // "confirm mappings" reply buttons, so they answered with the commit line
  // and their step never ran. It commits nothing either way: only the typed
  // `confirm commit` phrase or the Commit button commits (ADR 0090 decision 5).
  if (/^(yes|create|create it|commit|confirm)$/.test(intent)) {
    return deps.finalizeTurn(
      REVIEW_REPLY,
      patch,
      "review",
      ["View draft"],
      message,
      draft,
      turn,
    );
  }

  // F4.199: a "confirm <step>" reply answers here and changes nothing. The
  // phase branches below read the stored phase and not the message, so
  // without this one "confirm rtu" appended an RTU and "confirm point keys"
  // appended `kw`.
  const confirmedStep = keysReply ? "point_keys" : CONFIRM_STEP_REPLIES.get(intent);
  if (confirmedStep) {
    return confirmStepTurn(deps, confirmedStep, message, draft, turn);
  }
  // Any other message that starts like a confirm is not a label: it changes
  // nothing and answers with the step the draft is at.
  if (/^(yes|confirm|commit|create)\b/.test(intent)) {
    const prompt = stepPrompt(derived, draft, types);
    return deps.finalizeTurn(`I did not change the draft. ${prompt.text}`, {}, derived, prompt.replies, message, draft, turn);
  }

  // F4.162 (plan D9): a stored type that is not active counts as missing, so a
  // type retired after it was stored is asked for again before the RTU step.
  if (phase === "location" || !locationTypes.hasActiveLocationType(draft.location, types)) {
    // F4.157 / ADR 0077 decision 7: the type is matched or the stored active
    // one, never defaulted. The message is the name unless the chat waits for
    // a type; `kept` is then spread over the derived fields. See `resolveLocationTurn`.
    const { type, kept } = locationTypes.resolveLocationTurn(message, draft.location, types);
    // F4.104 — **this branch is the draft's default producer, not a
    // fallback.** `.env.example` ships `LLM_PROVIDER=` empty (`F3.21`), so
    // `handleTurn` reaches here on every turn of an ordinary deployment. And
    // unlike the old single-shot model branch (removed by `F3.21`), which passed the model's patch through
    // `onboardingDraftSchema.safeParse`, this method assembles its patch in
    // code and parses nothing: a bound on the schema binds only the producers
    // that parse it, and this is not one of them. Four sites derive a draft
    // string from the chat message — here, `assets[].code`/`siteName` below,
    // `defaultConfig`'s `topic`, F4.208's topic turn — and each is cut to the same imported
    // bound the schema carries. `code` was already `.slice(0, 64)`; the
    // pattern was right and incomplete, and the literal is now derived
    // (§4.8).
    //
    // The cut itself is `cutToBound`, not `.slice()` — `.slice()` counts
    // UTF-16 code units and can halve a surrogate pair, which Postgres refuses
    // in `jsonb` — and the two globally unique identifiers among the five,
    // `location.slug` and `assets[].code`, take `cutToBoundWithHashSuffix` so
    // that a cut cannot manufacture a cross-tenant collision. Both are
    // recorded in full on those two functions.
    //
    // **Sliced, not refused — the opposite of what the workbook upload does
    // one file away, and deliberately so.** `cellLengthProblem` refuses an
    // over-long cell because a workbook amplifies: one 5 MiB upload declares
    // thousands of 32,767-character cells, and a silently shortened asset code
    // commits plant under a name nobody chose. A chat turn amplifies nothing —
    // `chatBodySchema` caps `message` at 8,000 characters and one turn yields
    // one string — so length here is not the denial-of-service axis, and a 400
    // would replace today's graceful per-field validation error with a dead
    // end in the middle of a conversation. What makes the cut safe is that the
    // operator **sees** it: the wizard's draft preview shows the shortened
    // name and lets them edit it.
    //
    // That visibility is exactly what the workbook's `topic` cell lacks, which
    // is why `parseRtus` refuses it rather than cutting it. `config.topic`
    // *here* is a third case again: the operator types it in this session and
    // `mqttSetupTemplate` prints it back, and `bms.rtus.mqtt_topic` is
    // `varchar(255)`, so an over-length topic could never commit anyway.
    //
    // The most damaging of the three is not the long one. See the `assets`
    // branch: a 56-character location name — legal at every bound — produced
    // an asset code past 64 that `OnboardingValidateService` then refused, so
    // `readyToCommit` could never become true.
    // `cutToBound`, never a bare `.slice()`: `name` is arbitrary Unicode from
    // the request body, and a cut through the middle of a surrogate pair
    // produces a lone half that Postgres refuses in `jsonb` — a 500 from a
    // body no schema rejects. The full account is on `cutToBound`.
    //
    // `slug` is additionally **hash-suffixed when the cut fires** (owner
    // ruling 6): `bms.locations.slug` is globally unique —
    // `locations_slug_unique`, `0010_phase5_location_access.sql:16`, never
    // dropped — and the commit has no `onConflict`, so a plain cut turns two
    // tenants sharing a 64-character slugified prefix into an uncaught unique
    // violation: a 500, and an oracle that some other organisation holds that
    // slug.
    //
    // **`code` is deliberately left on the plain cut.** Ruling 6 names `slug`
    // and `assets[].code`, and `location.code`'s uniqueness is a *different*
    // constraint: `0016` dropped `locations_code_unique` for the org-scoped
    // `locations_org_code_idx`, so the collision it can still produce is
    // between two locations of the **same** organisation, which is neither a
    // cross-tenant oracle nor something this row was scoped to change. It is a
    // residual, not a closed hole; do not read the `slug` suffix as covering
    // it.
    //
    // Neither derivation strictly needs the surrogate-safe cut — each
    // `replace` runs *before* it and maps every non-`[a-z0-9]` /
    // non-`[A-Z0-9]` unit, surrogate halves included, to a separator — but
    // both go through it anyway, so reordering the two steps cannot
    // reintroduce the split.
    const name = kept?.name ?? cutToBound(message.trim(), ONBOARDING_DRAFT_STRING_MAX["location.name"]);
    // A kept location's non-empty slug and code win; an empty one (a blank
    // workbook cell, a `PATCH` that cleared it) is derived from the name.
    // F3.27: the cut above runs before the call, and `set_location` derives
    // the rest with the same `deriveLocationPatch`. It also keeps the stored
    // slug and code when the name is unchanged (F3.21 code review #4).
    const written = await guidedWrite(
      "set_location",
      {
        name,
        ...(type ? { type } : {}),
        ...(kept?.slug ? { slug: kept.slug } : {}),
        ...(kept?.code ? { code: kept.code } : {}),
      },
      state,
      deps.tools,
    );
    if (!written.ok) {
      return refused(written.error);
    }
    // With no type matched the patch carries none: a stored inactive type is
    // not copied back into it (F4.162 R6); the merge keeps the stored field.
    const { type: _unmatched, ...untyped } = state.working.location ?? { name };
    patch.location = type ? state.working.location : (untyped as OnboardingDraftInput["location"]);
    const actionLines = [written.actionLine];
    if (!type) {
      const ask = locationTypes.locationTypeQuestion(name);
      const labels = types.map((row) => row.label);
      return { ...deps.finalizeTurn(ask, patch, "location", labels, message, draft, turn), actionLines };
    }
    const result = deps.finalizeTurn(
      `Got it — location **${name}**. Which communication protocol will RTU 1 use?`,
      patch,
      "rtu",
      [...PROTOCOL_REPLIES],
      message,
      draft,
      turn,
    );
    return { ...result, actionLines };
  }

  // F4.208 (F4.218 names the colon rule): while the derived phase is `rtu`, "topic: x" (the colon is
  // required) sets the topic of `rtuForTopicTurn`'s RTU rather than append
  // one. Naming a protocol, or "add another rtu", still appends; the protocol
  // test skips topics and `RTU:` lines (`protocolTestText`), so neither
  // `site/sim/rtu` nor an RTU named `Sim House C` is read as `sim`.
  const addAnother = /^add another rtu\b/.test(lower);
  const topicTurn = derived === "rtu" ? message.match(TOPIC_TURN) : null;
  const rest = topicTurn ? protocolTestText(message) : lower;
  const inHand = topicTurn && !addAnother && !NAMES_A_PROTOCOL.test(rest) ? rtuForTopicTurn(message, draft) : -1;
  if (topicTurn && inHand >= 0) {
    const topic = cutToBound(topicTurn[1], MAX_RTU_TOPIC_CHARS);
    // F4.215: ingest refuses a wildcard topic, so the turn stores nothing.
    if (topicHasWildcard(topic)) {
      const waiting = stepPrompt(derived, draft, types);
      const refusal = `I did not change the draft. A topic must name one device; # and + are wildcards. ${waiting.text}`;
      return deps.finalizeTurn(refusal, {}, derived, waiting.replies, message, draft, turn);
    }
    // F3.27 (Amendment 2 Q-D): `update_rtu` merges `config` one level deep,
    // so host, port and TLS stay, and the credentialed-connection check passes.
    const written = await guidedWrite("update_rtu", { index: inHand, patch: { config: { topic } } }, state, deps.tools);
    if (!written.ok) {
      return refused(written.error);
    }
    const merged = state.working;
    const rtus = merged.rtus ?? [];
    patch.rtus = rtus;
    const prompt = stepPrompt(deps.validateService.inferPhase(merged, types.map((t) => t.code)), merged, types);
    const text = `Topic **${quoteCell(topic)}** set on **${quoteCell(rtus[inHand].displayName)}**. ${prompt.text}`;
    return { ...deps.finalizeTurn(text, patch, "rtu", prompt.replies, message, draft, turn), actionLines: [written.actionLine] };
  }

  // F4.218: in the RTU step a message that mentions a topic without `topic:`
  // is a question, not a value. It changes nothing and gets the step prompt;
  // naming a protocol, or "add another rtu", still appends.
  if (derived === "rtu" && !topicTurn && !addAnother && /\btopics?\b/i.test(message) && !NAMES_A_PROTOCOL.test(lower)) {
    const prompt = stepPrompt(derived, draft, types);
    return deps.finalizeTurn(`I did not change the draft. ${prompt.text}`, {}, derived, prompt.replies, message, draft, turn);
  }

  // F4.199: "Add another RTU" is offered past the RTU step too (a non-MQTT
  // RTU moves the phase on to `point_keys`), so it is matched by its text.
  // A reply that names no protocol repeats the last RTU's, so a Modbus RTU
  // is not followed by an MQTT one that waits for credentials.
  if (phase === "rtu" || !draft.rtus?.length || addAnother) {
    const lastProtocol = draft.rtus?.[draft.rtus.length - 1]?.protocol;
    const protocol =
      addAnother && lastProtocol && !NAMES_A_PROTOCOL.test(lower) ? lastProtocol : detectProtocol(lower);
    const rtuCode = `RTU-${(draft.rtus?.length ?? 0) + 1}`;
    // F3.27: no `credentialsSet` here — `add_rtu` sets it to false itself.
    const rtuArgs = {
      code: rtuCode,
      displayName: rtuCode,
      protocol,
      config: defaultConfig(protocol, message),
      ingestEnabled: protocol === "mqtt",
    };
    const written = await guidedWrite("add_rtu", rtuArgs, state, deps.tools);
    if (!written.ok) {
      return refused(written.error);
    }
    patch.rtus = state.working.rtus;
    // ADR 0022 decision 2: this used to say "Share username and password"
    // and `extractCredentials` parsed them straight out of the turn, which
    // is what put plaintext secrets into `onboarding_sessions.messages`.
    // Credentials now arrive only through `POST :id/credentials`.
    const result = deps.finalizeTurn(
      protocol === "mqtt"
        ? MQTT_RTU_ADDED_REPLY
        : `Added ${protocol} RTU. Ingest adapter is not connected yet — config will be stored. Add point keys next?`,
      patch,
      "point_keys",
      addedRtuReplies(deps, state.working, turn),
      message,
      draft,
      turn,
    );
    return { ...result, actionLines: [written.actionLine] };
  }

  // F4.195: the phase's own predicate, so a draft whose assets are all
  // templated, or that uses the existing catalog, is not given `kw`. The
  // stored phase stays a second way in: `onboarding-chat-caps.spec.ts`
  // reaches this append on it with a draft at the point-key cap (F4.103).
  if (phase === "point_keys" || draftNeedsPointKeys(draft)) {
    // Q-B: only the offered label writes; any other message changes nothing.
    if (!/^(kw|add point key kw)$/.test(intent)) {
      return unchangedTurn(deps, message, draft, derived, types, turn);
    }
    const written = await guidedWrite(
      "add_point_key",
      { code: "kw", name: "Active Power", domain: "electrical", unit: "kW" },
      state,
      deps.tools,
    );
    if (!written.ok) {
      return refused(written.error);
    }
    patch.pointKeys = state.working.pointKeys;
    const result = deps.finalizeTurn(
      "Added catalog point key **kw**. Say **One asset** to add one asset on RTU 1.",
      patch,
      "assets",
      ["One asset", "View draft"],
      message,
      draft,
      turn,
    );
    return { ...result, actionLines: [written.actionLine] };
  }

  if (phase === "assets" || !draft.assets?.length) {
    if (intent !== "one asset") {
      return unchangedTurn(deps, message, draft, derived, types, turn);
    }
    // F4.104, and the one site here that was a live functional bug rather
    // than only an unbounded string. `site` is the **stored** location name,
    // so it reaches this branch from any producer and from any draft written
    // before those producers were bounded; `-ASSET-1` then adds eight
    // characters to it. A location name of 57 characters — legal against
    // every bound in this file — produced a 65-character asset code, which
    // `draftAssetSchema.code.max(64)` refuses when
    // `OnboardingValidateService.validate` re-parses the stored draft. The
    // turn still answered 200, and the operator was left with a permanent
    // validation error and no chat instruction that could clear it.
    //
    // Cut the finished code, not `site`: cutting the name to 64 first and
    // then appending the suffix gives 64 + 8 = 72 and fails the same way.
    //
    // **Hash-suffixed when the cut fires** (owner ruling 6).
    // `bms.assets.code` carries `assets_code_unique` from
    // `0000_sprint1_foundation.sql:18` — global, across every tenant — and
    // `OnboardingCommitService` inserts with no `onConflict`, so two long
    // location names agreeing on their first characters would give the second
    // organisation an uncaught unique violation. The suffix costs the trailing
    // `-ASSET-1` marker on a code that had to be cut, which is the trade the
    // ruling makes: a code an operator can still recognise by its prefix and
    // that no other tenant can already hold.
    //
    // `siteName` takes the plain surrogate-safe cut: `bms.assets.site_name` is
    // not unique, so there is nothing for a hash to protect.
    //
    // **Slugified to the catalog class first** (F2.23, ADR 0065 decision 4).
    // F4.104 bounded this code's length and not its alphabet: replacing only
    // whitespace let `St. Mary's Works` produce `ST.-MARY'S-WORKS-ASSET-1`,
    // which decision 1's `CATALOG_CODE_PATTERN` refuses at `assets.0.code` when
    // `validate` re-parses the draft — the same permanent, chat-unclearable
    // error, reopened for charset. `catalogCodeSlug` turns every run outside
    // `[A-Za-z0-9_-]` into one `-`, collapses and trims, and runs **before**
    // `toUpperCase()` because `"ß".toUpperCase()` is `"SS"` — the order
    // decides which code a name yields, and the spec pins it. The hash suffix
    // `cutToBoundWithHashSuffix` appends is `-` plus upper-case hex, inside the
    // class, so the composition stays legal. A name with nothing inside the
    // class yields `-ASSET-1` alone: legal, and the operator's to rename.
    //
    // F3.27: the code and site name are cut before the call. `add_asset`
    // appends, where this branch once replaced the array.
    const site = draft.location?.name ?? orgName;
    const written = await guidedWrite(
      "add_asset",
      {
        rtuIndex: 0,
        code: catalogCodeFromLocationName(site),
        name: "Primary Device",
        siteName: cutToBound(site, ONBOARDING_DRAFT_STRING_MAX["assets.siteName"]),
        domain: "electrical",
      },
      state,
      deps.tools,
    );
    if (!written.ok) {
      return refused(written.error);
    }
    patch.assets = state.working.assets;
    const result = deps.finalizeTurn(
      "Asset added. Say **auto map** to map it to **kw**.",
      patch,
      "mappings",
      ["auto map", "View draft"],
      message,
      draft,
      turn,
    );
    return { ...result, actionLines: [written.actionLine] };
  }

  // F3.22 (ADR 0091 decision 11, code review): the sample mapping goes onto
  // the first plain asset. A templated asset takes its points from its
  // template, and V4 refuses a mapping onto it; a draft whose assets are all
  // templated needs no mapping (V11) and goes on to review.
  const plainIndex = draft.assets?.findIndex((asset) => !asset.template) ?? -1;
  if (plainIndex >= 0 && (phase === "mappings" || !draft.assetPoints?.length)) {
    if (intent !== "auto map") {
      return unchangedTurn(deps, message, draft, derived, types, turn);
    }
    // F3.27 (Amendment 2 Q-C): one `map_point` per plain asset that has no
    // mapping yet. All or nothing: at the first refusal the working copy is
    // dropped, so "I did not change the draft" stays true.
    const mapped = new Set((draft.assetPoints ?? []).map((point) => point.assetIndex));
    const unmapped = (draft.assets ?? []).flatMap((asset, index) => (!asset.template && !mapped.has(index) ? [index] : []));
    if (unmapped.length === 0) {
      return unchangedTurn(deps, message, draft, derived, types, turn);
    }
    const actionLines: string[] = [];
    for (const assetIndex of unmapped) {
      const written = await guidedWrite(
        "map_point",
        { assetIndex, pointKey: "kw", sourceDataKey: "s09_r01", unit: "kW" },
        state,
        deps.tools,
      );
      if (!written.ok) {
        return refused(written.error);
      }
      actionLines.push(written.actionLine);
    }
    patch.assetPoints = state.working.assetPoints;
    const result = deps.finalizeTurn(
      "Mapping added. I've opened the preview — review the draft and say **create it** when ready.",
      patch,
      "review",
      ["create it", "View draft"],
      message,
      draft,
      turn,
    );
    return { ...result, actionLines };
  }

  return deps.finalizeTurn(
    REVIEW_REPLY,
    patch,
    "review",
    ["create it", "View draft"],
    message,
    draft,
    turn,
  );
}

/** Q-B — a message that is not the offered label changes nothing and gets the step prompt (the `I did not change the draft.` shape). */
function unchangedTurn(
  deps: RuleBasedTurnDeps,
  message: string,
  draft: OnboardingDraft,
  derived: OnboardingPhase,
  types: readonly LocationTypeDto[],
  turn: TurnVocabulary,
): ChatTurnResult {
  const prompt = stepPrompt(derived, draft, types);
  return deps.finalizeTurn(`I did not change the draft. ${prompt.text}`, {}, derived, prompt.replies, message, draft, turn);
}

/**
 * F4.199 — the replies after an RTU is added, from the step the draft is
 * now at. An MQTT RTU waits at `rtu` for its credentials, where no turn
 * reaches the point keys, so "Add point key kw" is offered only at
 * `point_keys`.
 */
function addedRtuReplies(deps: RuleBasedTurnDeps, draft: OnboardingDraft, turn: TurnVocabulary): string[] {
  const next = deps.validateService.inferPhase(draft, turn.types.map((t) => t.code));
  if (next === "rtu") {
    return ["confirm rtu", "View draft", "Add another RTU"];
  }
  if (next === "point_keys") {
    return ["Add point key kw", "View draft", "Add another RTU"];
  }
  return ["View draft", "Add another RTU"];
}

/**
 * F4.199 — the answer to a "confirm <step>" reply. The phase is derived from
 * the draft (`inferPhase`), so a confirm cannot skip a step the draft has not
 * met: the answer goes on when the draft is past the step and otherwise says
 * what is still missing. The patch is empty — the turn changes nothing.
 */
function confirmStepTurn(
  deps: RuleBasedTurnDeps,
  step: OnboardingPhase,
  message: string,
  draft: OnboardingDraft,
  turn: TurnVocabulary,
): ChatTurnResult {
  const derived = deps.validateService.inferPhase(draft, turn.types.map((t) => t.code));
  const position = PHASE_ORDER.indexOf(derived) - PHASE_ORDER.indexOf(step);
  const name = STEP_NAMES[step];
  const lead =
    position > 0
      ? `The ${name} step is complete.`
      : position === 0
        ? `The ${name} step is not complete yet.`
        : `The ${name} step comes later.`;
  const prompt = stepPrompt(derived, draft, turn.types);
  return deps.finalizeTurn(`${lead} ${prompt.text}`, {}, derived, prompt.replies, message, draft, turn);
}

function detectProtocol(lower: string): OnboardingProtocol {
  return PROTOCOL_WORDS.find(([re]) => re.test(lower))?.[1] ?? "mqtt";
}

function defaultConfig(protocol: OnboardingProtocol, message: string): Record<string, unknown> {
  // F4.218: the colon is required, as on the topic turn (`TOPIC_TURN`).
  const topicMatch = message.match(TOPIC_TURN);
  if (protocol === "mqtt") {
    return {
      // `host` and `port` are environment or literal and `tls` is a constant;
      // `topic` is the only field of this record the chat message supplies,
      // and `\S+` will take all 8,000 characters `chatBodySchema` allows.
      //
      // F4.104 — cut, where the same value on the *upload* is refused
      // (`parseRtus`) and where `mqttSetupTemplate` falls back to the
      // `your/topic/here` placeholder rather than echo it. Three treatments of
      // one field, and each is the right one for its route: the workbook cell
      // is never shown back, so a cut topic silently subscribes somewhere
      // nobody asked for; the paste-back block *is* copied and edited, so a
      // cut value there would be pasted back as a real topic. This value is
      // typed in the same session and the wizard shows it in the draft
      // preview, so the operator sees what was kept and can correct it. The
      // placeholder path stays reachable regardless — it also fires for `""`,
      // for `"-"` and for a legacy draft written before this bound.
      //
      // Not the schema's job either: `config` is `z.record(z.unknown())` in
      // both copies, so `onboardingDraftSchema` cannot see this field however
      // it is parsed. `bms.rtus.mqtt_topic` is `varchar(255)`, which is where
      // `MAX_RTU_TOPIC_CHARS` comes from — an over-long topic could never
      // commit, it could only sit in the draft and fail late.
      host: process.env.MQTT_HOST ?? "phe.thinkiot.co.in",
      port: Number(process.env.MQTT_PORT ?? 8883),
      tls: true,
      topic: cutToBound(topicMatch?.[1] ?? "", MAX_RTU_TOPIC_CHARS),
    };
  }
  if (protocol === "modbus_tcp") {
    return { host: "127.0.0.1", port: 502, unitId: 1, pollIntervalMs: 5000 };
  }
  return {};
}
