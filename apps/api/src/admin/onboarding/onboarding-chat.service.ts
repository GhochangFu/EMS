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
  redactDraftForLlm,
} from "./onboarding-redaction";
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
  credentialsToEncrypt?: { rtuIndex: number; credentials: Record<string, unknown> };
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
          "Add **username** and **password** columns in Excel and re-upload, or paste credentials in chat:",
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
Never include password or secret values in assistantMessage. If user gives credentials, set draftPatch only with credentialsSet true for the RTU.
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
      parsed.draftPatch ?? {},
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
      const creds = this.extractCredentials(message);
      const result = this.finalizeTurn(
        protocol === "mqtt"
          ? "MQTT RTU added. Share username and password, or say **skip credentials** for now."
          : `Added ${protocol} RTU. Ingest adapter is not connected yet — config will be stored. Add point keys next?`,
        patch,
        creds ? "rtu" : "point_keys",
        ["Add point key kw", "View draft", "Add another RTU"],
        message,
        { ...draft, rtus: patch.rtus },
      );
      if (creds) {
        result.credentialsToEncrypt = { rtuIndex: (draft.rtus?.length ?? 0), credentials: creds };
      }
      return result;
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
    userMessage: string,
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

    const creds = this.extractCredentials(userMessage);
    let credentialsToEncrypt: ChatTurnResult["credentialsToEncrypt"];
    if (creds && mergedDraft.rtus?.length) {
      credentialsToEncrypt = {
        rtuIndex: mergedDraft.rtus.length - 1,
        credentials: creds,
      };
    }

    return {
      assistantMessage,
      draftPatch,
      currentPhase: phase,
      suggestedReplies,
      validationErrors: validation.errors,
      readyToCommit: validation.readyToCommit,
      autoOpenPreview,
      autoOpenReason,
      credentialsToEncrypt,
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

  private extractCredentials(message: string): Record<string, unknown> | null {
    if (/skip credential/i.test(message)) {
      return null;
    }
    const userMatch = message.match(/user(?:name)?[:\s]+(\S+)/i);
    const passMatch = message.match(/pass(?:word)?[:\s]+(\S+)/i);
    if (userMatch || passMatch) {
      return {
        username: userMatch?.[1] ?? "",
        password: passMatch?.[1] ?? "",
      };
    }
    return null;
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

    for (const cred of credList) {
      if (CredentialCryptoService.isConfigured()) {
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
        `username: pheadmin`,
        `password: your-password`,
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
