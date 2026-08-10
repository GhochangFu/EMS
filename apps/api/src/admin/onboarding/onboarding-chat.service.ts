import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type {
  OnboardingAutoOpenReason,
  OnboardingChatMessage,
  OnboardingDraft,
  OnboardingPhase,
  OnboardingProtocol,
} from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { OnboardingCatalogService } from "./onboarding-catalog.service";
import {
  attachEncryptedCredentials,
  reconcileSecrets,
  redactDraftForLlm,
} from "./onboarding-redaction";
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
    const summaryParts = [`location **${imported.locationName}**`];
    if (imported.rtuCount > 0) {
      summaryParts.push(`**${imported.rtuCount}** RTU(s)`);
    }
    if (imported.assetCount > 0) {
      summaryParts.push(`**${imported.assetCount}** asset(s)`);
    }
    const lines = [`Imported Excel data: ${summaryParts.join(", ")}.`];

    if (displayNameFixes.length > 0) {
      lines.push(
        `\n**Adjusted RTU display names:**\n${displayNameFixes.map((line) => `- ${line}`).join("\n")}`,
      );
    }

    const mqttIncomplete = (draft.rtus ?? []).filter(
      (rtu) =>
        rtu.protocol === "mqtt" &&
        rtu.ingestEnabled &&
        (!rtu.credentialsSet ||
          !String(rtu.config.topic ?? "").trim() ||
          String(rtu.config.topic).trim() === "-"),
    );

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
        const preview =
          orgPointKeyCodes.length > 8
            ? `${orgPointKeyCodes.slice(0, 8).map((code) => `\`${code}\``).join(", ")}, …`
            : orgPointKeyCodes.map((code) => `\`${code}\``).join(", ");
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
Draft context (redacted): ${JSON.stringify(redactDraftForLlm(draft))}`;

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

    return this.finalizeTurn(
      parsed.assistantMessage ?? "Thanks, I've updated the draft.",
      // M2 from the 2026-08-10 review: this was cast straight from the model's
      // JSON and merged with a spread that preserves unknown keys, so a
      // `_secrets` key in the reply could overwrite the encrypted credential
      // store, and `rtus[].config.password` could land as plaintext. Client
      // input via `patchDraft` was already validated; model output was not.
      onboardingDraftSchema.safeParse(parsed.draftPatch ?? {}).data ?? {},
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
      const name = message.trim();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 64);
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
      const site = draft.location?.name ?? orgName;
      patch.assets = [
        {
          rtuIndex: 0,
          code: `${site.replace(/\s+/g, "-").toUpperCase()}-ASSET-1`,
          name: "Primary Device",
          siteName: site,
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
        host: process.env.MQTT_HOST ?? "phe.thinkiot.co.in",
        port: Number(process.env.MQTT_PORT ?? 8883),
        tls: true,
        topic: topicMatch?.[1] ?? "",
      };
    }
    if (protocol === "modbus_tcp") {
      return { host: "127.0.0.1", port: 502, unitId: 1, pollIntervalMs: 5000 };
    }
    return {};
  }


  /** Merges draft patch and optional encrypted credentials into stored draft. */
  mergeDraft(
    current: unknown,
    patch: OnboardingDraftInput,
    credentialsToEncrypt?:
      | { rtuIndex: number; credentials: Record<string, unknown> }
      | { rtuIndex: number; credentials: Record<string, unknown> }[],
  ): unknown {
    const base =
      typeof current === "object" && current !== null
        ? (structuredClone(current) as OnboardingDraft & { _secrets?: Record<string, string> })
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
    const mqttRtus = (draft.rtus ?? []).filter(
      (rtu) => rtu.protocol === "mqtt" && rtu.ingestEnabled,
    );
    if (mqttRtus.length === 0) {
      return "";
    }
    const blocks = mqttRtus.map((rtu) => {
      const existingTopic = String(rtu.config.topic ?? rtu.config.mqttTopic ?? "").trim();
      const topic =
        existingTopic && existingTopic !== "-" ? existingTopic : "your/topic/here";
      return [
        `RTU: ${rtu.displayName}`,
        `topic: ${topic}`,
        // No username/password lines (ADR 0022, decision 2). A copy-paste block
        // that models credential entry teaches exactly the behaviour this ADR
        // forbids — and the filled-in version would now be refused by the
        // detector, stranding anyone who followed the instruction.
      ].join("\n");
    });
    return (
      "**Copy from START to END, edit the values, and paste your reply here.**\n" +
      "────────── START COPY ──────────\n" +
      `${blocks.join("\n---\n")}\n` +
      "────────── END COPY ──────────"
    );
  }

  private formatAssetsByRtuSummary(draft: OnboardingDraft): string {
    const rtus = draft.rtus ?? [];
    const assets = draft.assets ?? [];
    const lines = rtus.map((rtu, index) => {
      const rtuAssets = assets.filter((asset) => asset.rtuIndex === index);
      const assetList =
        rtuAssets.length > 0
          ? rtuAssets.map((asset) => asset.name).join(", ")
          : "(no assets yet)";
      return `- **${rtu.displayName}**: ${assetList}`;
    });
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
