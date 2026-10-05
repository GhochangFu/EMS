import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

// F4.104: the length of every draft string field, declared once beside the
// shared contract's copy of the draft schema and imported here as a value.
// `@bms/shared` and not `@bms/shared/contracts` — apps/api compiles with
// moduleResolution "node" and ignores the exports map (ADR 0030 Amendment 2).
import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";
import type {
  LocationTypeDto,
  OnboardingAutoOpenReason,
  OnboardingChatMessage,
  OnboardingDraft,
  OnboardingPhase,
  OnboardingProtocol,
} from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
// F4.105: `quoteCell` bounds how long each echoed cell is; `echoedItems` and
// `moreTail` bound how many of them one list may name. Both axes are declared
// together in that file, because either alone leaves the product unbounded.
import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { cloneJson } from "../stack-safe-json";
import { OnboardingCatalogService } from "./onboarding-catalog.service";
import { OnboardingTemplateCatalogService } from "./onboarding-template-catalog.service";
import type { ValidateTemplateContext } from "./onboarding-template-refs";
import { catalogCodeFromLocationName, cutToBound } from "./onboarding-draft-caps";
import { deriveLocationPatch } from "./onboarding-location-derive";
import { mergeDraftPatch } from "./onboarding-draft-merge";
import { MAX_RTU_TOPIC_CHARS } from "./onboarding-excel.service";
import {
  formatAssetsByRtuSummary,
  mqttSetupTemplate,
  needsMqttSetup,
} from "./onboarding-chat-summaries";
import * as locationTypes from "./onboarding-location-type-match";
// F3.21 (ADR 0090): the model no longer returns a draft patch, so the
// prompt-budget guards live where the draft and the arguments now pass — the
// agent loop's system prompt and the tool registry.
import { runAgentTurn } from "./onboarding-agent-loop";
import { scrubMessages } from "./onboarding-credential-detect";
import { OnboardingLlmResolver } from "./onboarding-llm-resolver";
import {
  attachEncryptedCredentials,
  reconcileSecrets,
  type EncryptedBlob,
} from "./onboarding-redaction";
import type { OnboardingDraftInput } from "./onboarding.schema";
import { OnboardingProtocolService } from "./onboarding-protocol.service";
import { draftNeedsPointKeys, OnboardingValidateService } from "./onboarding-validate.service";

export type ChatTurnResult = {
  assistantMessage: string;
  draftPatch: OnboardingDraftInput;
  currentPhase: OnboardingPhase;
  suggestedReplies?: string[];
  validationErrors?: { path: string; message: string }[];
  readyToCommit?: boolean;
  autoOpenPreview?: boolean;
  autoOpenReason?: OnboardingAutoOpenReason;
  /** F3.21 decision 6: code-written lines for each draft write the agent made. Empty on the guided path. */
  actionLines: string[];
  /** F3.21 decision 5: set when the agent proposed a commit; the caller binds it to the stored draft's hash. */
  commitProposal?: { summary: string };
  // No `credentialsToEncrypt` here by design (ADR 0022 decision 2): a chat turn
  // can no longer yield a credential, so the field is removed rather than left
  // permanently undefined where someone could re-populate it. `mergeDraft`
  // still accepts credentials — `POST :id/credentials` is its only caller now.
};

/** Ruling 6: the reply after a provider failure starts with this sentence. */
export const AGENT_UNAVAILABLE_NOTICE = "The assistant is not available right now, so the guided mode answered.";

/** Plan ruling 13: the reply for an organization whose own AI setting is incomplete starts with this. */
export const AGENT_NOT_SET_UP_NOTICE =
  "The AI assistant is not fully set up for this organization, so the guided mode answered. An admin can finish it on the AI assistant page.";

/**
 * What one turn validates against, read once at its start: the active location
 * types (`F4.162`, plan D9) and the template context (`F3.22`, ADR 0091).
 */
type TurnVocabulary = {
  readonly types: readonly LocationTypeDto[];
  readonly templates: ValidateTemplateContext;
};

/** The guided steps in the order `inferPhase` walks them. */
const PHASE_ORDER: readonly OnboardingPhase[] = ["location", "rtu", "point_keys", "assets", "mappings", "review"];

/** The protocol replies; each is a protocol `detectProtocol` reads. */
const PROTOCOL_REPLIES = ["MQTT", "Modbus", "BACnet", "OPC-UA", "SNMP", "REST", "Simulator"];

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

/**
 * F4.199 — what the draft still needs at `phase`, with only replies that the
 * guided mode answers at that phase: each one reaches the branch its text names.
 */
function stepPrompt(phase: OnboardingPhase, draft: OnboardingDraft): { text: string; replies: string[] } {
  switch (phase) {
    case "location":
      return { text: "The location needs a name and a type first. What is the location name?", replies: ["View draft"] };
    case "rtu": {
      const waiting = (draft.rtus ?? []).filter(needsMqttSetup).length;
      if ((draft.rtus ?? []).length === 0) {
        return { text: "Add an RTU first. Which communication protocol will RTU 1 use?", replies: [...PROTOCOL_REPLIES] };
      }
      if (waiting > 0) {
        return {
          text:
            `${waiting} MQTT RTU(s) still need credentials or a topic. Set each RTU's credentials with the ` +
            "**Credentials** field on the RTU step — never in this chat — then say **confirm rtu**.",
          replies: ["confirm rtu", "View draft"],
        };
      }
      return { text: "Each RTU needs a code and a protocol. Open the preview to fix them.", replies: ["View draft"] };
    }
    case "point_keys":
      return { text: "Add a point key: say **kw** to add the catalog key **kw**.", replies: ["kw", "View draft"] };
    case "assets":
      return { text: "Add an asset: say **One asset** to add one.", replies: ["One asset", "View draft"] };
    case "mappings":
      return { text: "Map the assets: say **auto map** to map each asset to **kw**.", replies: ["auto map", "View draft"] };
    case "review":
      return { text: "Open the preview and click **Commit**, or say **create it**.", replies: ["create it", "View draft"] };
  }
}

/**
 * Conversational onboarding: the tool-calling agent when a provider resolves
 * for the organization (`F3.21`, ADR 0090), the rule-based guided mode
 * otherwise.
 */
@Injectable()
export class OnboardingChatService {
  constructor(
    private readonly validateService: OnboardingValidateService,
    private readonly crypto: CredentialCryptoService,
    private readonly protocolService: OnboardingProtocolService,
    private readonly catalogService: OnboardingCatalogService,
    private readonly vocabularies: VocabulariesService,
    private readonly llmResolver: OnboardingLlmResolver,
    private readonly templateCatalog: OnboardingTemplateCatalogService,
  ) {}

  private readonly logger = new Logger(OnboardingChatService.name);

  /** Produces opening assistant message for a new session. */
  openingMessage(orgName: string): ChatTurnResult {
    return {
      assistantMessage: `Welcome! I'll help you onboard a new location under **${orgName}**.\n\nWhat is the location name? (Example: **Berhampur**)\n\nYou can also **download the Excel template** or **upload a filled workbook** anytime for location + RTUs + assets.`,
      draftPatch: {},
      currentPhase: "location",
      suggestedReplies: ["View draft"],
      actionLines: [],
    };
  }

  /** Builds assistant follow-up after an Excel workbook import. */
  excelImportFollowUp(
    draft: OnboardingDraft,
    imported: { locationName: string; rtuCount: number; assetCount: number },
    orgPointKeyCodes: string[],
    displayNameFixes: string[] = [],
  ): { assistantMessage: string; suggestedReplies: string[] } {
    // `F4.102`. Everything this method interpolates from the import is sheet
    // text, and a cell may hold 32,767 characters. `quoteCell` is applied at
    // each site rather than to the finished message, because four of the five
    // sites live in `mqttSetupTemplate` and `formatAssetsByRtuSummary`, which
    // build their strings before this one is assembled (AGENTS.md §4.3); the
    // fifth is the location name below. One of those four — the `topic:` line —
    // cannot take `quoteCell` at all, and is bounded by length instead; see
    // `mqttSetupTemplate`. `onboarding-chat.service.spec.ts` enumerates all
    // five.
    //
    // The summary is not the whole echo surface. A **sixth** site leaves the
    // import by another route: the `protocol` cell reaches `draftRtuSchema`'s
    // `z.enum`, whose `invalid_enum_value` message repeats the value into the
    // upload response's `validationErrors`. Nothing here can bound it, so it is
    // refused at the parse boundary instead — `OnboardingExcelService.parseRtus`
    // and `assertUnknownRtuProtocolIsRefused` in
    // `onboarding-excel.service.spec.ts`.
    const summaryParts = [`location **${quoteCell(imported.locationName)}**`];
    if (imported.rtuCount > 0) {
      summaryParts.push(`**${imported.rtuCount}** RTU(s)`);
    }
    if (imported.assetCount > 0) {
      summaryParts.push(`**${imported.assetCount}** asset(s)`);
    }
    const lines = [`Imported Excel data: ${summaryParts.join(", ")}.`];

    if (displayNameFixes.length > 0) {
      // `F4.105` site 1. Capped where it is **rendered**, not where it is
      // produced: `normalizeRtuDisplayNames` is the only producer and this is
      // the only consumer, and §4.3 bounds a value where it reaches a message,
      // so the full array stays available to anything that later wants it. 99
      // of these at the worst case are ~29 KB of one reply.
      //
      // The tail is a plain line and not a bullet, so it cannot be read as one
      // more fix.
      const { shown, omitted } = echoedItems(displayNameFixes);
      lines.push(
        `\n**Adjusted RTU display names:**\n${[
          ...shown.map((line) => `- ${line}`),
          moreTail(omitted),
        ]
          .filter(Boolean)
          .join("\n")}`,
      );
    }

    const mqttIncomplete = (draft.rtus ?? []).filter(needsMqttSetup);

    if (mqttIncomplete.length > 0) {
      lines.push(
        `\n**MQTT setup still required** for ${mqttIncomplete.length} RTU(s). ` +
          // ADR 0022 decision 2: this used to end "or paste credentials in
          // chat" and was followed by a template containing username/password
          // lines. Missed in the first pass and caught by the 2026-08-10
          // security review — the prompt text is part of the fix, because an
          // instruction to paste secrets re-opens the hole at the UI layer.
          "Set each RTU's credentials with the **Credentials** field on the RTU step — never in this chat. The topic can be completed here:",
      );
      lines.push(`\n${mqttSetupTemplate(draft)}`);
      lines.push("\nFill in the template and send it back, then say **confirm rtu**.");
      return {
        assistantMessage: lines.join("\n"),
        suggestedReplies: ["confirm rtu", "View draft"],
      };
    }

    if (draftNeedsPointKeys(draft)) {
      if (orgPointKeyCodes.length > 0) {
        // `F4.105` site 5, and the one the owner overruled the plan on (ruling
        // 5). This carried a bare literal `8` twice, closed by a bare `, …`
        // that said nothing about how much was left; it now takes the same
        // bound as the other four, so one message carries one number.
        //
        // **This list is a catalog read rather than sheet text**, and that is
        // the only part of the old rationale here that survived review. Two
        // things it also said were false, and the same two sentences justified
        // leaving site 6 uncapped:
        //
        // - it is **not** "the organisation's own" catalog.
        //   `OnboardingCatalogService.listPointKeys` ignores its
        //   `organizationId`; the catalog went fleet-wide at migration `0057`
        //   (`F3.39`) and every organisation reads every code;
        // - its length **is** influenced, just not by one upload.
        //   `OnboardingCommitService` inserts into the same fleet-wide
        //   `bms.point_keys` with no per-organisation quota, and `F4.103` caps
        //   a draft at 500 keys — so one commit grows this list permanently,
        //   for everyone.
        //
        // The growth term is measured and recorded on
        // `formatPointKeysForChat`, which renders the whole catalog and is the
        // site that hurts. It is **not closed by this row**: the cap bounds
        // what the message repeats, not what the table holds.
        const { shown, omitted } = echoedItems(orgPointKeyCodes);
        const preview = [...shown.map((code) => `\`${code}\``), moreTail(omitted)]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `\nYour organization already has point keys (${preview}). ` +
            "Say **use existing keys** or **confirm point keys** to continue.",
        );
        return {
          assistantMessage: lines.join("\n"),
          suggestedReplies: ["use existing keys", "confirm point keys", "View draft"],
        };
      }
      lines.push("\nAdd point keys (e.g. **kw**), then say **confirm point keys**.");
      return {
        assistantMessage: lines.join("\n"),
        suggestedReplies: ["kw", "confirm point keys", "View draft"],
      };
    }

    if (!draft.assets || draft.assets.length === 0) {
      lines.push("\nAdd assets per RTU in chat, then say **confirm assets**.");
      return {
        assistantMessage: lines.join("\n"),
        suggestedReplies: ["confirm assets", "View draft"],
      };
    }

    // F4.195: only a plain asset takes a mapping (F3.22 V4, V11), as in
    // `inferPhase`; an all-templated draft goes on to commit.
    if (draft.assets.some((asset) => !asset.template) && (!draft.assetPoints || draft.assetPoints.length === 0)) {
      lines.push(
        `\n${formatAssetsByRtuSummary(draft)}\n\n` +
          "Say **auto map** to map each asset to **kw**, or provide mappings like `source s01 -> point kw`. " +
          "Then **confirm mappings**.",
      );
      return {
        assistantMessage: lines.join("\n"),
        suggestedReplies: ["auto map", "confirm mappings", "View draft"],
      };
    }

    lines.push("\nDraft looks ready. Open the preview and click **Commit**.");
    return {
      assistantMessage: lines.join("\n"),
      suggestedReplies: ["View draft", "Commit"],
    };
  }

  /**
   * Handles one user chat turn against the current draft.
   *
   * `F3.21` (ADR 0090): the resolver picks the provider for this organization
   * and turn. With one, the agent loop runs; with none, the guided
   * (rule-based) mode answers as before. `context` is required, not optional:
   * an optional parameter at an adapter is invisible, and `tsc` names every
   * caller.
   */
  async handleTurn(
    message: string,
    draft: OnboardingDraft,
    phase: OnboardingPhase,
    orgName: string,
    organizationId: string | undefined,
    context: { readonly sessionId: string; readonly history: readonly OnboardingChatMessage[] },
  ): Promise<ChatTurnResult> {
    // F4.162 (plan D9): the active types, read once per turn. Every branch and
    // `finalizeTurn` use this one list, so the reply, the phase and the
    // validation errors agree about which stored type counts as set.
    const types = await this.vocabularies.listLocationTypes();
    // F3.22 (ADR 0091): the template context, read once per turn beside the
    // types, so the agent tools and every `finalizeTurn` validate against one
    // read. With no organization only the stock catalog is listed.
    const templates = await this.templateCatalog.context(organizationId);
    const turn: TurnVocabulary = { types, templates };
    const lower = message.toLowerCase().trim();
    if (
      organizationId &&
      /protocol|modbus|bacnet|mqtt|opc|snmp|rest|simulator/.test(lower) &&
      /what|which|available|list|show|support/.test(lower)
    ) {
      const protocolContext = await this.protocolService.getContextForOrganization(organizationId);
      const exampleRtu = draft.location?.name
        ? `${draft.location.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-RTU-1`
        : "LOCATION-RTU-1";
      return this.finalizeTurn(
        `Here are the protocols available in BMS:\n\n${this.protocolService.formatForAssistant(protocolContext, exampleRtu)}`,
        {},
        phase,
        // F4.199: a protocol reply adds an RTU only at the RTU step; past it
        // the same text reaches the point-key or asset branch.
        this.validateService.inferPhase(draft, types.map((t) => t.code)) === "rtu"
          ? ["MQTT", "Modbus TCP", "View draft"]
          : ["View draft"],
        message,
        draft,
        turn,
      );
    }

    if (!organizationId) {
      return await this.handleRuleBasedTurn(message, draft, phase, orgName, turn, organizationId);
    }
    const resolved = await this.llmResolver.resolveForOrganization(organizationId);
    if (resolved.kind === "guided") {
      const guided = await this.handleRuleBasedTurn(message, draft, phase, orgName, turn, organizationId);
      // Plan ruling 13: an organization that chose a provider but did not
      // finish the setting is told why the guided mode answered. `off` and a
      // platform without a provider get no notice — that is the chosen mode.
      return resolved.reason === "organization_incomplete"
        ? { ...guided, assistantMessage: `${AGENT_NOT_SET_UP_NOTICE}\n\n${guided.assistantMessage}` }
        : guided;
    }

    const agent = await runAgentTurn({
      message,
      draft,
      phase,
      orgName,
      // Security review L5: stored history goes to the model through the same
      // scrub as every client read.
      history: scrubMessages(context.history),
      llm: resolved.provider,
      tools: {
        organizationId,
        activeTypes: types,
        catalog: this.catalogService,
        protocols: this.protocolService,
        validator: this.validateService,
        templates,
      },
    });
    // Decision 9 and plan ruling 10: ids, names and counts — never the
    // message, the arguments, the draft, the summary, the model or a key.
    this.logger.log(
      { sessionId: context.sessionId, provider: resolved.provider.name, source: resolved.source, ...agent.record },
      "onboarding agent turn",
    );
    if (agent.fallback) {
      // Ruling 6: the turn's edits are already discarded; the guided mode
      // answers the same message, and the user is told why.
      const guided = await this.handleRuleBasedTurn(message, draft, phase, orgName, turn, organizationId);
      return { ...guided, assistantMessage: `${AGENT_UNAVAILABLE_NOTICE}\n\n${guided.assistantMessage}` };
    }
    const result = this.finalizeTurn(
      agent.reply,
      agent.draftPatch,
      phase,
      // F4.199: never "confirm commit" — the client sends a button's text as a
      // turn, and the typed phrase is the user's own act (ADR 0090 decision 5).
      ["View draft"],
      message,
      draft,
      turn,
    );
    return {
      ...result,
      actionLines: [...agent.actionLines],
      ...(agent.commitProposal ? { commitProposal: { summary: agent.commitProposal.summary } } : {}),
    };
  }

  private async handleRuleBasedTurn(
    message: string,
    draft: OnboardingDraft,
    phase: OnboardingPhase,
    orgName: string,
    turn: TurnVocabulary,
    organizationId?: string,
  ): Promise<ChatTurnResult> {
    const { types } = turn;
    const lower = message.toLowerCase().trim();
    const patch: OnboardingDraftInput = {};

    if (/use existing keys|confirm point keys/.test(lower) && organizationId) {
      const orgKeys = await this.catalogService.listPointKeys(organizationId);
      if (orgKeys.length > 0) {
        patch.onboardingMeta = {
          ...(draft.onboardingMeta ?? {}),
          useExistingPointKeys: true,
        };
        return this.finalizeTurn(
          `Using existing organization point keys:\n\n${this.catalogService.formatPointKeysForChat(orgKeys)}\n\nSay **confirm assets** or add assets per RTU.`,
          patch,
          "assets",
          ["confirm assets", "View draft"],
          message,
          draft,
          turn,
        );
      }
    }

    // F4.199: the whole message, never a prefix. As a prefix this rule also
    // took the "confirm rtu", "confirm point keys", "confirm assets" and
    // "confirm mappings" reply buttons, so they answered with the commit line
    // and their step never ran. It commits nothing either way: only the typed
    // `confirm commit` phrase or the Commit button commits (ADR 0090 decision 5).
    if (/^(yes|create|create it|commit|confirm)$/.test(lower)) {
      return this.finalizeTurn(
        "I'll prepare the commit — open the preview to confirm everything looks correct.",
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
    const confirmedStep = CONFIRM_STEP_REPLIES.get(lower);
    if (confirmedStep) {
      return this.confirmStepTurn(confirmedStep, message, draft, turn);
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
      // that parse it, and this is not one of them. Three sites derive a draft
      // string from the chat message — here, `assets[].code`/`siteName` below,
      // and `defaultConfig`'s `topic` — and each is cut to the same imported
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
      // `F3.21`: the derivation is shared with the agent's `set_location` tool.
      patch.location = deriveLocationPatch({ name, stored: draft.location, kept, type });
      if (!type) {
        const ask = locationTypes.locationTypeQuestion(name);
        const labels = types.map((row) => row.label);
        return this.finalizeTurn(ask, patch, "location", labels, message, draft, turn);
      }
      return this.finalizeTurn(
        `Got it — location **${name}**. Which communication protocol will RTU 1 use?`,
        patch,
        "rtu",
        [...PROTOCOL_REPLIES],
        message,
        draft,
        turn,
      );
    }

    // F4.199: "Add another RTU" is offered past the RTU step too (a non-MQTT
    // RTU moves the phase on to `point_keys`), so it is matched by its text.
    if (phase === "rtu" || !draft.rtus?.length || /^add another rtu\b/.test(lower)) {
      const protocol = this.detectProtocol(lower);
      const rtuCode = `RTU-${(draft.rtus?.length ?? 0) + 1}`;
      const rtuPatch = {
        code: rtuCode,
        displayName: rtuCode,
        protocol,
        config: this.defaultConfig(protocol, message),
        credentialsSet: false,
        ingestEnabled: protocol === "mqtt",
      };
      patch.rtus = [...(draft.rtus ?? []), rtuPatch];
      // ADR 0022 decision 2: this used to say "Share username and password"
      // and `extractCredentials` parsed them straight out of the turn, which
      // is what put plaintext secrets into `onboarding_sessions.messages`.
      // Credentials now arrive only through `POST :id/credentials`.
      return this.finalizeTurn(
        protocol === "mqtt"
          ? "MQTT RTU added. Add its credentials with the **Credentials** field on the RTU step — never in this chat — or carry on without them for now."
          : `Added ${protocol} RTU. Ingest adapter is not connected yet — config will be stored. Add point keys next?`,
        patch,
        "point_keys",
        this.addedRtuReplies(mergeDraftPatch(draft, patch), turn),
        message,
        draft,
        turn,
      );
    }

    // F4.195: the phase's own predicate, so a draft whose assets are all
    // templated, or that uses the existing catalog, is not given `kw`. The
    // stored phase stays a second way in: `onboarding-chat-caps.spec.ts`
    // reaches this append on it with a draft at the point-key cap (F4.103).
    if (phase === "point_keys" || draftNeedsPointKeys(draft)) {
      patch.pointKeys = [
        ...(draft.pointKeys ?? []),
        { code: "kw", name: "Active Power", domain: "electrical", unit: "kW" },
      ];
      return this.finalizeTurn(
        "Added catalog point key **kw**. How many assets should we create on this RTU?",
        patch,
        "assets",
        ["One asset", "View draft"],
        message,
        draft,
        turn,
      );
    }

    if (phase === "assets" || !draft.assets?.length) {
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
      const site = draft.location?.name ?? orgName;
      patch.assets = [
        {
          rtuIndex: 0,
          code: catalogCodeFromLocationName(site),
          name: "Primary Device",
          siteName: cutToBound(site, ONBOARDING_DRAFT_STRING_MAX["assets.siteName"]),
          domain: "electrical",
        },
      ];
      return this.finalizeTurn(
        "Asset added. Provide a mapping like `source s09_r01 -> point kw`, or say **auto map**.",
        patch,
        "mappings",
        ["auto map", "View draft"],
        message,
        draft,
        turn,
      );
    }

    // F3.22 (ADR 0091 decision 11, code review): the sample mapping goes onto
    // the first plain asset. A templated asset takes its points from its
    // template, and V4 refuses a mapping onto it; a draft whose assets are all
    // templated needs no mapping (V11) and goes on to review.
    const plainIndex = draft.assets?.findIndex((asset) => !asset.template) ?? -1;
    if (plainIndex >= 0 && (phase === "mappings" || !draft.assetPoints?.length)) {
      patch.assetPoints = [
        { assetIndex: plainIndex, pointKey: "kw", sourceDataKey: "s09_r01", unit: "kW" },
      ];
      return this.finalizeTurn(
        "Mapping added. I've opened the preview — review the draft and say **create it** when ready.",
        patch,
        "review",
        ["create it", "View draft"],
        message,
        draft,
        turn,
      );
    }

    return this.finalizeTurn(
      "We're in review. Say **create it** to commit, or tell me what to change.",
      patch,
      "review",
      ["create it", "View draft"],
      message,
      draft,
      turn,
    );
  }

  /**
   * F4.199 — the replies after an RTU is added, from the step the draft is
   * now at. An MQTT RTU waits at `rtu` for its credentials, where no turn
   * reaches the point keys, so "Add point key kw" is offered only at
   * `point_keys`.
   */
  private addedRtuReplies(draft: OnboardingDraft, turn: TurnVocabulary): string[] {
    const next = this.validateService.inferPhase(draft, turn.types.map((t) => t.code));
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
  private confirmStepTurn(
    step: OnboardingPhase,
    message: string,
    draft: OnboardingDraft,
    turn: TurnVocabulary,
  ): ChatTurnResult {
    const derived = this.validateService.inferPhase(draft, turn.types.map((t) => t.code));
    const position = PHASE_ORDER.indexOf(derived) - PHASE_ORDER.indexOf(step);
    const name = STEP_NAMES[step];
    const lead =
      position > 0
        ? `The ${name} step is complete.`
        : position === 0
          ? `The ${name} step is not complete yet.`
          : `The ${name} step comes later.`;
    const prompt = stepPrompt(derived, draft);
    return this.finalizeTurn(`${lead} ${prompt.text}`, {}, derived, prompt.replies, message, draft, turn);
  }

  private finalizeTurn(
    assistantMessage: string,
    draftPatch: OnboardingDraftInput,
    currentPhase: OnboardingPhase,
    suggestedReplies: string[] | undefined,
    _userMessage: string,
    draft: OnboardingDraft,
    turn: TurnVocabulary,
  ): ChatTurnResult {
    // F4.157 review: the draft `mergeDraft` will store, merged by the same
    // helper — never a shallow `{ ...draft, ...patch }`, which drops the stored
    // location fields a location patch does not carry. F4.162: validated
    // against the turn's active codes, so an inactive stored type is reported.
    const validation = this.validateService.validate(
      mergeDraftPatch(draft, draftPatch),
      turn.types.map((t) => t.code),
      turn.templates,
    );
    const phase = validation.suggestedPhase ?? currentPhase;
    let autoOpenPreview = false;
    let autoOpenReason: OnboardingAutoOpenReason | undefined;

    if (validation.errors.length > 0) {
      autoOpenPreview = true;
      autoOpenReason = "validation_errors";
    } else if (phase === "review") {
      autoOpenPreview = true;
      autoOpenReason = validation.readyToCommit ? "ready_to_commit" : "review";
    }

    // ADR 0022 decision 2 — no credential is ever lifted out of a chat turn.
    // A turn that looks like it carries one is refused upstream in
    // `OnboardingService.chat` before it reaches here or the LLM.
    return {
      assistantMessage,
      draftPatch,
      currentPhase: phase,
      suggestedReplies,
      validationErrors: validation.errors,
      readyToCommit: validation.readyToCommit,
      autoOpenPreview,
      autoOpenReason,
      actionLines: [],
    };
  }

  private detectProtocol(lower: string): OnboardingProtocol {
    if (lower.includes("modbus")) return "modbus_tcp";
    if (lower.includes("bacnet")) return "bacnet";
    if (lower.includes("opc")) return "opc_ua";
    if (lower.includes("snmp")) return "snmp";
    if (lower.includes("rest")) return "rest_poller";
    if (lower.includes("sim")) return "simulator";
    return "mqtt";
  }

  private defaultConfig(protocol: OnboardingProtocol, message: string): Record<string, unknown> {
    const topicMatch = message.match(/topic[:\s]+(\S+)/i);
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


  /**
   * Merges draft patch and optional encrypted credentials into stored draft.
   *
   * `F4.115`: `cloneJson`, not `structuredClone`. This is the clone that made a
   * deeply nested stored draft *unrepairable* — every write path runs through
   * here, so the `PATCH :id/draft` that would have flattened the value threw a
   * `RangeError` on the stored draft before it applied the patch, and answered
   * 500 like every read did.
   *
   * It takes the same whole-value clone rather than something narrower. A clone
   * copying only the levels this method, `reconcileSecrets` and the credential
   * branch actually mutate would be a claim about the mutation set of three
   * functions across two files; `structuredClone`'s guarantee is "the caller's
   * object is untouched", and only how it is computed changes here.
   */
  mergeDraft(
    current: unknown,
    patch: OnboardingDraftInput,
    credentialsToEncrypt?:
      | { rtuIndex: number; credentials: Record<string, unknown> }
      | { rtuIndex: number; credentials: Record<string, unknown> }[],
  ): unknown {
    const base =
      typeof current === "object" && current !== null
        ? (cloneJson(current) as OnboardingDraft & { _secrets?: Record<string, string>; _commitProposal?: unknown })
        : {};
    // F3.21 (ADR 0090 decision 5): every draft write clears a commit proposal.
    // `chat` re-attaches one only for a turn that proposed, hashed on the
    // draft it stores, so a proposal never outlives a change it did not see.
    delete (base as { _commitProposal?: unknown })._commitProposal;
    const merged = mergeDraftPatch(base, patch);

    let stored: OnboardingDraft & { _secrets?: Record<string, EncryptedBlob> } =
      merged as OnboardingDraft & { _secrets?: Record<string, EncryptedBlob> };

    const credList = credentialsToEncrypt
      ? Array.isArray(credentialsToEncrypt)
        ? credentialsToEncrypt
        : [credentialsToEncrypt]
      : [];

    // M4: `rtus` was just replaced wholesale from client or model input, so any
    // `_secrets` entry may now be orphaned or contested. Reconcile BEFORE
    // attaching, so a credential written in this same call is not judged
    // against the pre-merge RTU list.
    const configured = CredentialCryptoService.isConfigured();
    stored = reconcileSecrets(stored, { deriveCredentialsSet: configured });

    // ADR 0062 decision 8: with no key configured, the credential is dropped —
    // as it already was — and the draft must not claim otherwise. The branch
    // that used to set `credentialsSet: true` here is deleted rather than kept
    // as a false success.
    for (const cred of credList) {
      if (configured) {
        const enc = this.crypto.encrypt(cred.credentials);
        stored = attachEncryptedCredentials(
          stored,
          cred.rtuIndex,
          enc.ciphertext,
          enc.iv,
          enc.keyVersion,
        );
      }
    }

    return stored;
  }

  /** Creates a chat message row. */
  createMessage(role: OnboardingChatMessage["role"], content: string): OnboardingChatMessage {
    return {
      id: randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
    };
  }
}
