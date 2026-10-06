import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type {
  OnboardingAutoOpenReason,
  OnboardingChatMessage,
  OnboardingDraft,
  OnboardingPhase,
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
import { mergeDraftPatch } from "./onboarding-draft-merge";
import { formatAssetsByRtuSummary, mqttSetupTemplate, needsMqttSetup } from "./onboarding-chat-summaries";
import {
  fallbackTurn,
  handleRuleBasedTurn,
  NAMES_A_PROTOCOL,
  type ChatTurnResult,
  type RuleBasedTurnDeps,
  type TurnVocabulary,
} from "./onboarding-chat-rule-based";
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

export type { ChatTurnResult } from "./onboarding-chat-rule-based";

/** Ruling 6: the reply after a provider failure starts with this sentence. */
export const AGENT_UNAVAILABLE_NOTICE = "The assistant is not available right now, so the guided mode answered.";

/** Plan ruling 13: the reply for an organization whose own AI setting is incomplete starts with this. */
export const AGENT_NOT_SET_UP_NOTICE =
  "The AI assistant is not fully set up for this organization, so the guided mode answered. An admin can finish it on the AI assistant page.";

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
   * What the guided mode and the fallback turn (`onboarding-chat-rule-based.ts`,
   * F4.217) read from this service. The arrow keeps `this`: an unbound
   * `finalizeTurn` would throw on `this.validateService`.
   */
  private ruleBasedDeps(): RuleBasedTurnDeps {
    return {
      validateService: this.validateService,
      catalogService: this.catalogService,
      finalizeTurn: (...args) => this.finalizeTurn(...args),
    };
  }

  /** The guided mode (`onboarding-chat-rule-based.ts`, F4.217). */
  private guidedTurn(
    message: string,
    draft: OnboardingDraft,
    phase: OnboardingPhase,
    orgName: string,
    turn: TurnVocabulary,
    organizationId?: string,
  ): Promise<ChatTurnResult> {
    return handleRuleBasedTurn(
      this.ruleBasedDeps(),
      message,
      draft,
      phase,
      orgName,
      turn,
      organizationId,
    );
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
      // F4.220: whole words, so "restriction" is not a protocol question.
      (NAMES_A_PROTOCOL.test(lower) || /\bprotocols?\b/.test(lower)) &&
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
      return await this.guidedTurn(message, draft, phase, orgName, turn, organizationId);
    }
    const resolved = await this.llmResolver.resolveForOrganization(organizationId);
    if (resolved.kind === "guided") {
      const guided = await this.guidedTurn(message, draft, phase, orgName, turn, organizationId);
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
      // Ruling 6: the turn's edits are already discarded, and the user is told
      // why. ADR 0090 Amendment 2 B1: the guided mode does not read the
      // message — it was written for the model — so the turn writes nothing
      // and answers the step prompt for the phase the draft is at.
      const fallback = fallbackTurn(this.ruleBasedDeps(), message, draft, turn);
      return { ...fallback, assistantMessage: `${AGENT_UNAVAILABLE_NOTICE}\n\n${fallback.assistantMessage}` };
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
