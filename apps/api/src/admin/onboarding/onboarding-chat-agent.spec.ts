import { Logger } from "@nestjs/common";
import type { OnboardingDraft } from "@bms/shared";

import { STOPPED_EARLY_TIME_REPLY } from "./onboarding-agent-loop";
import { FakeLlmProvider, PLAIN_RTU, calls, toolCall } from "./onboarding-agent-loop.spec";
import { CONFIRM_STEP_LABELS } from "./onboarding-chat-rule-based";
import { AGENT_NOT_SET_UP_NOTICE, AGENT_UNAVAILABLE_NOTICE, OnboardingChatService } from "./onboarding-chat.service";
import type { ResolvedLlm } from "./onboarding-llm-resolver";
import { OnboardingValidateService } from "./onboarding-validate.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A chat service whose resolver answers `resolved` and records each organization it was asked about. */
function service(resolved: ResolvedLlm): { chat: OnboardingChatService; asked: string[] } {
  const asked: string[] = [];
  const chat = new OnboardingChatService(
    new OnboardingValidateService(),
    {} as never,
    {} as never,
    { listPointKeys: async () => [] } as never,
    { listLocationTypes: async () => [{ code: "smoc_campus", label: "SMOC campus" }] } as never,
    {
      resolveForOrganization: async (organizationId: string) => {
        asked.push(organizationId);
        return resolved;
      },
    } as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
  );
  return { chat, asked };
}

function ready(llm: FakeLlmProvider): ResolvedLlm {
  return { kind: "ready", provider: llm, source: "organization" };
}

const CONTEXT = { sessionId: "s-42", history: [] };

/** On a fresh draft the guided mode reads the message as the location name: the clearest proof it answered. */
async function turn(chat: OnboardingChatService, message = "Berhampur") {
  return chat.handleTurn(message, {} as OnboardingDraft, "location", "Ion Exchange", "org-7", CONTEXT);
}

/**
 * ADR 0090 Amendment 2 B1: a fallback turn writes nothing. The message was
 * written for the model, so the guided mode does not read it — the reply is the
 * notice and the step prompt. On a fresh draft the guided mode would take this
 * message as the location name, so an empty patch is the proof it did not run.
 */
export async function assertAProviderErrorFallsBackWithTheNotice(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("add_rtu", PLAIN_RTU)), "reject"]);
  const result = await turn(service(ready(llm)).chat, "add an MQTT RTU with two meters");
  assert(Object.keys(result.draftPatch).length === 0, `the fallback writes nothing, got ${JSON.stringify(result.draftPatch)}`);
  assert(result.actionLines.length === 0, "the agent's RTU is discarded and no action line is written");
  assert(result.assistantMessage.startsWith(AGENT_UNAVAILABLE_NOTICE), "the reply starts with the unavailable notice");
  assert(
    result.assistantMessage.includes("The location needs a name and a type first."),
    `the reply holds the location step prompt, got ${result.assistantMessage}`,
  );
  assert(JSON.stringify(result.suggestedReplies) === '["View draft"]', `the location step's replies, got ${JSON.stringify(result.suggestedReplies)}`);
  assert(result.currentPhase === "location", `the phase is derived from the draft, got ${result.currentPhase}`);
}

/** B1 at the RTU step: the guided mode would add a Modbus RTU for this message; the fallback adds nothing. */
export async function assertAProviderErrorAtTheRtuStepAnswersTheRtuPrompt(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("add_rtu", PLAIN_RTU)), "reject"]);
  const draft = {
    location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", type: "smoc_campus", latitude: 19.3, longitude: 84.8 },
  } as OnboardingDraft;
  const result = await service(ready(llm)).chat.handleTurn("modbus please", draft, "rtu", "Ion Exchange", "org-7", CONTEXT);
  assert(Object.keys(result.draftPatch).length === 0, `the fallback writes nothing, got ${JSON.stringify(result.draftPatch)}`);
  assert(result.actionLines.length === 0, "no action line");
  assert(result.assistantMessage.startsWith(AGENT_UNAVAILABLE_NOTICE), "the reply starts with the unavailable notice");
  assert(result.assistantMessage.includes("Add an RTU first."), `the reply holds the RTU step prompt, got ${result.assistantMessage}`);
  assert(
    JSON.stringify(result.suggestedReplies) === JSON.stringify(["MQTT", "Modbus", "BACnet", "OPC-UA", "SNMP", "REST", "Simulator"]),
    `the protocol replies, got ${JSON.stringify(result.suggestedReplies)}`,
  );
  assert(result.currentPhase === "rtu", `the RTU step, got ${result.currentPhase}`);
}

export async function assertNoResolvedProviderMeansNoNotice(): Promise<void> {
  for (const reason of ["platform_off", "platform_incomplete", "organization_off"] as const) {
    const result = await turn(service({ kind: "guided", reason }).chat);
    assert(
      !result.assistantMessage.startsWith(AGENT_UNAVAILABLE_NOTICE) && !result.assistantMessage.startsWith(AGENT_NOT_SET_UP_NOTICE),
      `${reason} answers in the guided mode with no notice`,
    );
    assert(result.draftPatch.location?.name === "Berhampur", `${reason}: the guided mode answered`);
  }
}

/** Plan ruling 13. */
export async function assertAnIncompleteOrgRowIsGuidedModeWithTheSetupNotice(): Promise<void> {
  const result = await turn(service({ kind: "guided", reason: "organization_incomplete" }).chat);
  assert(result.assistantMessage.startsWith(AGENT_NOT_SET_UP_NOTICE), "the reply starts with the setup notice");
  assert(result.draftPatch.location?.name === "Berhampur", "and the guided mode answered");
}

export async function assertCapTimeDoesNotFallBack(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("add_rtu", PLAIN_RTU)), "hang"]);
  const { chat } = service(ready(llm));
  const saved = setTimeout;
  // The real deadline is 45 s; the loop takes its options from the constants,
  // so this case shortens every timer the turn creates to 20 ms.
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => saved(fn, 20)) as unknown as typeof setTimeout;
  let result;
  try {
    result = await turn(chat, "add an RTU");
  } finally {
    (globalThis as { setTimeout: unknown }).setTimeout = saved;
  }
  assert(result.assistantMessage === STOPPED_EARLY_TIME_REPLY, `the time cap answers itself, got ${result.assistantMessage}`);
  assert(result.draftPatch.rtus?.length === 1 && result.actionLines.length === 1, "the completed edit is kept");
}

export function assertMergeDraftClearsAStoredProposal(): void {
  const { chat } = service({ kind: "guided", reason: "platform_off" });
  const stored = {
    location: { name: "Berhampur" },
    _commitProposal: { draftHash: "a".repeat(64), summary: "s", proposedAt: "x" },
  };
  const merged = chat.mergeDraft(stored, {}) as Record<string, unknown>;
  assert(!("_commitProposal" in merged), "any write clears the proposal");
  assert((merged.location as { name?: string })?.name === "Berhampur", "positive control: the rest of the draft is kept");
  assert("_commitProposal" in stored, "the caller's object is untouched");
}

export async function assertTheTurnLogsOneTextFreeLineWithTheProviderName(): Promise<void> {
  const original = Logger.prototype.log;
  const logged: unknown[][] = [];
  Logger.prototype.log = function (...args: unknown[]) {
    logged.push(args);
  } as typeof Logger.prototype.log;
  try {
    const llm = new FakeLlmProvider([calls(toolCall("add_point_key", { code: "kw", name: "argument-text-abc" })), { kind: "final", text: "ok" }]);
    await turn(service(ready(llm)).chat, "message-text-xyz");
  } finally {
    Logger.prototype.log = original;
  }
  const lines = logged.filter((args) => args[1] === "onboarding agent turn");
  assert(lines.length === 1, `one agent-turn line, got ${lines.length}`);
  const record = lines[0][0] as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  assert(keys === "durationMs,provider,sessionId,source,stopReason,toolCalls,tools", `exactly the named fields: ${keys}`);
  assert(record.provider === "openrouter" && record.source === "organization" && record.sessionId === "s-42", "provider, source and session");
  const text = JSON.stringify(record);
  assert(!text.includes("message-text-xyz") && !text.includes("argument-text-abc"), "no message or argument text");
}

export async function assertTheResolverIsCalledOncePerTurnWithTheSessionsOrganization(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  const { chat, asked } = service(ready(llm));
  await turn(chat);
  assert(JSON.stringify(asked) === '["org-7"]', `one resolve for the session's organization, got ${JSON.stringify(asked)}`);
}

const AT_RTU = {
  location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", type: "smoc_campus", latitude: 19.3, longitude: 84.8 },
} as OnboardingDraft;

/**
 * F3.25 (ADR 0094 decision 8, plan Q6): a step label is answered by code on
 * the agent path too, typed or with a trailing stop, and never reaches the
 * model. The adjacent positive: a plain message on the same build does.
 */
export async function assertAStepLabelOnTheAgentPathNeverReachesTheModel(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  const { chat } = service(ready(llm));
  // Review finding (2026-10-07): every label, not only the one without an
  // `s` — a `/s+/` typo in `normaliseReply` passed "confirm rtu" alone.
  const typed = CONFIRM_STEP_LABELS.flatMap((label) => [label, `${label}.`, label.toUpperCase()]);
  for (const message of [...typed, "confirm  point keys.", "  Confirm   Assets!  "]) {
    const result = await chat.handleTurn(message, AT_RTU, "rtu", "Ion Exchange", "org-7", CONTEXT);
    assert(llm.calls === 0, `${message}: the model is not called, got ${llm.calls} calls`);
    assert(/^The .+ step /.test(result.assistantMessage), `${message}: the step answer, got ${result.assistantMessage}`);
    assert(JSON.stringify(result.draftPatch) === "{}", `${message}: the turn writes nothing, got ${JSON.stringify(result.draftPatch)}`);
  }
  await chat.handleTurn("Berhampur", AT_RTU, "rtu", "Ion Exchange", "org-7", CONTEXT);
  assert(llm.calls === 1, `a plain message reaches the model once, got ${llm.calls}`);
}

/**
 * F3.25 (ADR 0094 decision 9): the chips of an agent reply are the model's
 * offer, filtered, then the step label and View draft. The commit phrase the
 * model offered is gone; the protocol it offered stays.
 */
export async function assertAnAgentReplysChipsAreTheFilteredOfferPlusTheStepLabel(): Promise<void> {
  const llm = new FakeLlmProvider([
    calls(toolCall("suggest_replies", { replies: ["MQTT", "confirm commit"] })),
    { kind: "final", text: "Which protocol will RTU 1 use?" },
  ]);
  const result = await service(ready(llm)).chat.handleTurn("add an RTU", AT_RTU, "rtu", "Ion Exchange", "org-7", CONTEXT);
  const chips = result.suggestedReplies ?? [];
  assert(chips.includes("MQTT"), `the offered protocol stays, got ${JSON.stringify(chips)}`);
  assert(!chips.some((chip) => chip.toLowerCase() === "confirm commit"), `the commit phrase is dropped, got ${JSON.stringify(chips)}`);
  assert(JSON.stringify(chips) === '["MQTT","confirm rtu","View draft"]', `the full list, got ${JSON.stringify(chips)}`);
}
