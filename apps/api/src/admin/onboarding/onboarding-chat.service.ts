import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

// F4.104: the length of every draft string field, declared once beside the
// shared contract's copy of the draft schema and imported here as a value.
// `@bms/shared` and not `@bms/shared/contracts` — apps/api compiles with
// moduleResolution "node" and ignores the exports map (ADR 0030 Amendment 2).
import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";
import type {
  OnboardingAutoOpenReason,
  OnboardingChatMessage,
  OnboardingDraft,
  OnboardingPhase,
  OnboardingProtocol,
} from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
// F4.105: `quoteCell` bounds how long each echoed cell is; `echoedItems` and
// `moreTail` bound how many of them one list may name. Both axes are declared
// together in that file, because either alone leaves the product unbounded.
import { MAX_ECHOED_ITEMS, echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { cloneJson } from "../stack-safe-json";
import { OnboardingCatalogService } from "./onboarding-catalog.service";
import { cutToBound, cutToBoundWithHashSuffix } from "./onboarding-draft-caps";
import { MAX_RTU_TOPIC_CHARS } from "./onboarding-excel.service";
// F4.107: the draft goes into the prompt through this, not through
// `redactDraftForLlm` directly — the redaction says nothing about size, and
// nothing measured the serialised draft before this row. The module owns the
// budget, the two shed passes, the marker, the sentence that explains it to the
// model and the guard that refuses a patch echoing it back.
import {
  PROMPT_MARKER_SENTENCE,
  carriesPromptMarker,
  serialiseDraftForPrompt,
} from "./onboarding-prompt-budget";
import { attachEncryptedCredentials, reconcileSecrets } from "./onboarding-redaction";
import { onboardingDraftSchema } from "./onboarding.schema";
import type { OnboardingDraftInput } from "./onboarding.schema";
import { OnboardingProtocolService } from "./onboarding-protocol.service";
import { OnboardingValidateService } from "./onboarding-validate.service";

export type ChatTurnResult = {
  assistantMessage: string;
  draftPatch: OnboardingDraftInput;
  currentPhase: OnboardingPhase;
  suggestedReplies?: string[];
  validationErrors?: { path: string; message: string }[];
  readyToCommit?: boolean;
  autoOpenPreview?: boolean;
  autoOpenReason?: OnboardingAutoOpenReason;
  // No `credentialsToEncrypt` here by design (ADR 0022 decision 2): a chat turn
  // can no longer yield a credential, so the field is removed rather than left
  // permanently undefined where someone could re-populate it. `mergeDraft`
  // still accepts credentials — `POST :id/credentials` is its only caller now.
};

type DraftRtu = NonNullable<OnboardingDraft["rtus"]>[number];

/** An RTU the ingest pipeline is meant to read from — the MQTT setup template's own predicate. */
function isEnabledMqttRtu(rtu: DraftRtu): boolean {
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
function needsMqttSetup(rtu: DraftRtu): boolean {
  const topic = String(rtu.config.topic ?? "").trim();
  return isEnabledMqttRtu(rtu) && (!rtu.credentialsSet || topic === "" || topic === "-");
}

/** Conversational onboarding bot with OpenAI or rule-based fallback. */
@Injectable()
export class OnboardingChatService {
  constructor(
    private readonly validateService: OnboardingValidateService,
    private readonly crypto: CredentialCryptoService,
    private readonly protocolService: OnboardingProtocolService,
    private readonly catalogService: OnboardingCatalogService,
  ) {}

  /** Produces opening assistant message for a new session. */
  openingMessage(orgName: string): ChatTurnResult {
    return {
      assistantMessage: `Welcome! I'll help you onboard a new location under **${orgName}**.\n\nWhat is the location name? (Example: **Berhampur**)\n\nYou can also **download the Excel template** or **upload a filled workbook** anytime for location + RTUs + assets.`,
      draftPatch: {},
      currentPhase: "location",
      suggestedReplies: ["View draft"],
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
      lines.push(`\n${this.mqttSetupTemplate(draft)}`);
      lines.push("\nFill in the template and send it back, then say **confirm rtu**.");
      return {
        assistantMessage: lines.join("\n"),
        suggestedReplies: ["confirm rtu", "View draft"],
      };
    }

    if (!draft.onboardingMeta?.useExistingPointKeys && (draft.pointKeys?.length ?? 0) === 0) {
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

    if (!draft.assetPoints || draft.assetPoints.length === 0) {
      lines.push(
        `\n${this.formatAssetsByRtuSummary(draft)}\n\n` +
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

  /** Handles one user chat turn against the current draft. */
  async handleTurn(
    message: string,
    draft: OnboardingDraft,
    phase: OnboardingPhase,
    orgName: string,
    organizationId?: string,
  ): Promise<ChatTurnResult> {
    const lower = message.toLowerCase().trim();
    if (
      organizationId &&
      /protocol|modbus|bacnet|mqtt|opc|snmp|rest|simulator/.test(lower) &&
      /what|which|available|list|show|support/.test(lower)
    ) {
      const context = await this.protocolService.getContextForOrganization(organizationId);
      const exampleRtu = draft.location?.name
        ? `${draft.location.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-RTU-1`
        : "LOCATION-RTU-1";
      return this.finalizeTurn(
        `Here are the protocols available in BMS:\n\n${this.protocolService.formatForAssistant(context, exampleRtu)}`,
        {},
        phase,
        ["MQTT", "Modbus TCP", "View draft"],
        message,
        draft,
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        return await this.handleOpenAiTurn(message, draft, phase, orgName, apiKey);
      } catch {
        // fall through to rule-based
      }
    }
    return await this.handleRuleBasedTurn(message, draft, phase, orgName, organizationId);
  }

  private async handleOpenAiTurn(
    message: string,
    draft: OnboardingDraft,
    phase: OnboardingPhase,
    orgName: string,
    apiKey: string,
  ): Promise<ChatTurnResult> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const system = `You are a TRINETRA BMS onboarding assistant for organization ${orgName}.
Current phase: ${phase}. Return JSON with keys: assistantMessage, draftPatch (partial), currentPhase, suggestedReplies (optional string array).
Phases: location, rtu, point_keys, assets, mappings, review.
Protocols: mqtt, modbus_tcp, bacnet, opc_ua, snmp, rest_poller, simulator, catalog.
Never include password or secret values in assistantMessage. Credentials are NEVER collected through this chat — if the user offers one, tell them to use the Credentials field on the RTU step. Never set credential values in draftPatch.
${PROMPT_MARKER_SENTENCE}
Draft context (redacted): ${serialiseDraftForPrompt(draft)}`;

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      assistantMessage?: string;
      draftPatch?: OnboardingDraftInput;
      currentPhase?: OnboardingPhase;
      suggestedReplies?: string[];
    };

    // F4.107 review, L1: the prompt asks the model not to copy a marker back
    // (`PROMPT_MARKER_SENTENCE`), and an instruction is not a control. A patch
    // echoing the marker into `rtus[].config` already fails the parse below and
    // is discarded; one echoing it into `pointKeys[].description` **passes**,
    // and `mergeDraft` replaces that array wholesale — so the operator's prose
    // would be overwritten by a system literal and committed. Both get the same
    // answer, which is the empty patch the first case already produces. Whole
    // patch, not the offending leaf: dropping a `config` key lets `.default({})`
    // blank a real connection config. `carriesPromptMarker` walks it with the
    // shared iterative rebuild, so a deep reply cannot throw here either.
    const echoed: unknown = parsed.draftPatch ?? {};
    const draftPatch: OnboardingDraftInput = carriesPromptMarker(echoed)
      ? {}
      : // M2 from the 2026-08-10 review: this was cast straight from the model's
        // JSON and merged with a spread that preserves unknown keys, so a
        // `_secrets` key in the reply could overwrite the encrypted credential
        // store, and `rtus[].config.password` could land as plaintext. Client
        // input via `patchDraft` was already validated; model output was not.
        (onboardingDraftSchema.safeParse(echoed).data ?? {});

    return this.finalizeTurn(
      parsed.assistantMessage ?? "Thanks, I've updated the draft.",
      draftPatch,
      parsed.currentPhase ?? phase,
      parsed.suggestedReplies,
      message,
      draft,
    );
  }

  private async handleRuleBasedTurn(
    message: string,
    draft: OnboardingDraft,
    phase: OnboardingPhase,
    orgName: string,
    organizationId?: string,
  ): Promise<ChatTurnResult> {
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
          { ...draft, ...patch },
        );
      }
    }

    if (/^(yes|create|commit|confirm)/.test(lower)) {
      return this.finalizeTurn(
        "I'll prepare the commit — open the preview to confirm everything looks correct.",
        patch,
        "review",
        ["View draft", "Validate"],
        message,
        draft,
      );
    }

    if (phase === "location" || !draft.location?.name) {
      // F4.104 — **this branch is the draft's default producer, not a
      // fallback.** `.env.example` ships `OPENAI_API_KEY=` empty, so
      // `handleTurn` reaches here on every turn of an ordinary deployment. And
      // unlike `handleOpenAiTurn` above, which passes the model's patch through
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
      const name = cutToBound(message.trim(), ONBOARDING_DRAFT_STRING_MAX["location.name"]);
      const slug = cutToBoundWithHashSuffix(
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        ONBOARDING_DRAFT_STRING_MAX["location.slug"],
        "lower",
      );
      const code = cutToBound(
        name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
        ONBOARDING_DRAFT_STRING_MAX["location.code"],
      );
      patch.location = {
        name,
        slug: slug || "location",
        code: code || "LOC",
        type: lower.includes("rsmoc")
          ? "rsmoc"
          : lower.includes("csmoc")
            ? "csmoc"
            : "smoc_campus",
        latitude: draft.location?.latitude ?? -25.7,
        longitude: draft.location?.longitude ?? 28.2,
        province: draft.location?.province,
        capital: draft.location?.capital,
      };
      return this.finalizeTurn(
        `Got it — location **${name}**. Which communication protocol will RTU 1 use?`,
        patch,
        "rtu",
        ["MQTT", "Modbus", "BACnet", "OPC-UA", "SNMP", "REST", "Simulator"],
        message,
        { ...draft, ...patch },
      );
    }

    if (phase === "rtu" || !draft.rtus?.length) {
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
        ["Add point key kw", "View draft", "Add another RTU"],
        message,
        { ...draft, rtus: patch.rtus },
      );
    }

    if (phase === "point_keys" || !draft.pointKeys?.length) {
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
        { ...draft, ...patch },
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
      const site = draft.location?.name ?? orgName;
      patch.assets = [
        {
          rtuIndex: 0,
          code: cutToBoundWithHashSuffix(
            `${site.replace(/\s+/g, "-").toUpperCase()}-ASSET-1`,
            ONBOARDING_DRAFT_STRING_MAX["assets.code"],
            "upper",
          ),
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
        { ...draft, ...patch },
      );
    }

    if (phase === "mappings" || !draft.assetPoints?.length) {
      patch.assetPoints = [
        { assetIndex: 0, pointKey: "kw", sourceDataKey: "s09_r01", unit: "kW" },
      ];
      return this.finalizeTurn(
        "Mapping added. I've opened the preview — review the draft and say **create it** when ready.",
        patch,
        "review",
        ["create it", "View draft", "Validate"],
        message,
        { ...draft, ...patch },
      );
    }

    return this.finalizeTurn(
      "We're in review. Say **create it** to commit, or tell me what to change.",
      patch,
      "review",
      ["create it", "View draft"],
      message,
      draft,
    );
  }

  private finalizeTurn(
    assistantMessage: string,
    draftPatch: OnboardingDraftInput,
    currentPhase: OnboardingPhase,
    suggestedReplies: string[] | undefined,
    _userMessage: string,
    mergedDraft: OnboardingDraft,
  ): ChatTurnResult {
    const validation = this.validateService.validate(mergedDraft);
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
        ? (cloneJson(current) as OnboardingDraft & { _secrets?: Record<string, string> })
        : {};
    const merged: OnboardingDraft = {
      ...base,
      ...patch,
      location: patch.location ? { ...base.location, ...patch.location } : base.location,
      rtus: patch.rtus ?? base.rtus,
      pointKeys: patch.pointKeys ?? base.pointKeys,
      assets: patch.assets ?? base.assets,
      assetPoints: patch.assetPoints ?? base.assetPoints,
      onboardingMeta: patch.onboardingMeta
        ? { ...base.onboardingMeta, ...patch.onboardingMeta }
        : base.onboardingMeta,
    };

    let stored: OnboardingDraft & { _secrets?: Record<string, { c: string; iv: string }> } =
      merged as OnboardingDraft & { _secrets?: Record<string, { c: string; iv: string }> };

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

    for (const cred of credList) {
      if (configured) {
        const enc = this.crypto.encrypt(cred.credentials);
        stored = attachEncryptedCredentials(stored, cred.rtuIndex, enc.ciphertext, enc.iv);
      } else if (Array.isArray(stored.rtus) && stored.rtus[cred.rtuIndex]) {
        stored.rtus[cred.rtuIndex] = { ...stored.rtus[cred.rtuIndex], credentialsSet: true };
      }
    }

    return stored;
  }

  private mqttSetupTemplate(draft: OnboardingDraft): string {
    const mqttRtus = (draft.rtus ?? []).filter(isEnabledMqttRtu);
    if (mqttRtus.length === 0) {
      return "";
    }
    // `F4.105` site 2. **Capping this costs no working function**, and that is
    // measured rather than assumed: the template already does not do what it
    // says past the first block. `defaultConfig` reads one *non-global*
    // `/topic[:\s]+(\S+)/i`, so only the first block's topic is ever taken, and
    // the `phase === "rtu"` branch of `handleRuleBasedTurn` *appends* an RTU
    // instead of updating the ones the import created — three imported RTUs,
    // all three topics filled in and pasted back, produced four RTUs and left
    // the three originals on `topic: ""`. Pre-existing, filed as its own row,
    // and deliberately not fixed here (owner ruling 4).
    //
    // **The two predicates diverge, and the cap turned that from untidy into an
    // elision — so this list is sorted, not filtered.** `mqttIncomplete`, which
    // the prose above counts, is strictly narrower than this one: it also
    // requires a missing credential or an unusable topic. Before the cap every
    // enabled MQTT RTU printed, so the ones the prose meant were always among
    // them. A leading-25 cut alone does not keep that promise — measured here:
    // 30 enabled MQTT RTUs of which only the last lacked a topic produced
    // "**MQTT setup still required** for 1 RTU(s)", 25 paste-back blocks for
    // RTUs that needed nothing, and the one that did need work **nowhere in the
    // message**.
    //
    // Sorting the incomplete ones to the front repairs exactly what the cap
    // broke. Filtering to `mqttIncomplete` would also change *which* RTUs the
    // template contains, and that divergence is pre-existing and deliberate
    // (owner ruling 4 leaves the template's contents and its instruction text
    // alone). A reorder is safe **here and only here**: nothing in the block
    // below keys off position, unlike `formatAssetsByRtuSummary` where the
    // index *is* the asset map's key. `Array.prototype.sort` is stable
    // (ES2019), so the complete RTUs keep their input order behind the
    // incomplete ones.
    //
    // **The tail still counts omissions from this list, never from
    // `mqttIncomplete`.** The prose can honestly say "still required for 100
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

  private formatAssetsByRtuSummary(draft: OnboardingDraft): string {
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
