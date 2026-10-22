import { expect } from "vitest";

import { FakeLlmProvider } from "../admin/onboarding/onboarding-agent-loop.spec";
import type { LlmMessage, LlmReply, LlmToolDefinition } from "../llm/llm-port";
import { GLOBAL_ADMIN, harness, ORG_X, ORG_Y, turn } from "./copilot-turn.service.spec";
import { COPILOT_SYSTEM_PROMPT, copilotScopeMessage } from "./copilot-turn.service";

/**
 * `F4.249` (ADR 0099 Amendment 7 C2) — the prefix a provider can cache stays
 * byte-stable: the tool definitions and the first system message. Over the
 * `copilot-turn.service.spec.ts` harness; each claim has its own `it()` in the
 * sibling `.test.ts` (ADR 0014).
 */

/** A scripted provider that also records the tool definitions of every call, serialized. */
class ToolRecordingProvider extends FakeLlmProvider {
  readonly toolsSeen: string[] = [];

  override async complete(input: {
    messages: readonly LlmMessage[];
    tools?: readonly LlmToolDefinition[];
    signal: AbortSignal;
  }): Promise<LlmReply> {
    this.toolsSeen.push(JSON.stringify(input.tools ?? null));
    return super.complete(input);
  }
}

/**
 * `F4.249` (ADR 0099 Amendment 7 C2): the cached prefix — the tool definitions
 * and the first system message — is byte-identical across two turns that differ
 * in clock, scope and open wizard, for the same role and intent flags.
 */
export async function assertTheCachedPrefixIsByteStableAcrossTurns(): Promise<void> {
  const tools = { list_assets: () => ({ ok: true as const, result: { items: [] }, organizationIds: [] }) };
  const first = new ToolRecordingProvider([{ kind: "final", text: "ok" }]);
  const hFirst = harness(first, { tools });
  hFirst.service.clock = () => new Date("2026-10-11T06:00:00Z");
  await turn(hFirst, "any alarms?");

  const second = new ToolRecordingProvider([{ kind: "final", text: "ok" }]);
  const hSecond = harness(second, { tools, conversationOrg: null, platform: { kind: "ready", allowed: [ORG_Y] } });
  hSecond.service.clock = () => new Date("2027-03-02T21:15:00Z");
  await turn(hSecond, "any alarms?", GLOBAL_ADMIN, [{ catalogId: "dashboard.create", params: {} }]);

  const a = first.seen[0] ?? [];
  const b = second.seen[0] ?? [];
  // The two turns really differ after the prefix: another scope line, and a wizard line on the second only.
  expect(a[1]).toEqual({ role: "system", content: copilotScopeMessage([ORG_X]) });
  expect(b[1]).toEqual({ role: "system", content: copilotScopeMessage([ORG_Y]) });
  expect(b.filter((m) => m.role === "system").length).toBe(a.filter((m) => m.role === "system").length + 1);
  // The prefix: the first message is the fixed prompt, byte for byte, in both.
  expect(a[0]).toEqual({ role: "system", content: COPILOT_SYSTEM_PROMPT });
  expect(JSON.stringify(b[0])).toBe(JSON.stringify(a[0]));
  // The tool definitions serialize byte-identically, and there are some.
  expect(first.toolsSeen).toHaveLength(1);
  expect(JSON.parse(first.toolsSeen[0] ?? "[]").length).toBeGreaterThan(1);
  expect(second.toolsSeen[0]).toBe(first.toolsSeen[0]);
}

/** `F4.249` C2: the fixed prompt carries no clock and no organization id. */
export function assertTheFixedPromptCarriesNoDateOrOrganization(): void {
  expect(COPILOT_SYSTEM_PROMPT).not.toMatch(/d{4}-d{2}-d{2}/);
  expect(COPILOT_SYSTEM_PROMPT).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  expect(COPILOT_SYSTEM_PROMPT).not.toContain(ORG_X);
}
