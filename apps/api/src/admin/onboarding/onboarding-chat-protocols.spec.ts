import { PROTOCOL_CATALOG } from "@bms/shared";

import { OnboardingChatService } from "./onboarding-chat.service";
import { OnboardingProtocolService } from "./onboarding-protocol.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * F3.24a (ADR 0093 decision 5): the guided protocol-question intercept answers
 * the code catalog. A new file because `onboarding-chat.service.spec.ts` is at
 * the AGENTS.md section 4.5 cap. It holds the intercept's positive (I1) and
 * negative (F4.224) cases.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function protocolService(): OnboardingChatService {
  const protocols = {
    getContextForOrganization: async () => ({ catalog: PROTOCOL_CATALOG, orgExamples: [] }),
    formatForAssistant: OnboardingProtocolService.prototype.formatForAssistant,
  };
  return new OnboardingChatService(
    new OnboardingValidateService(),
    {} as never,
    protocols as never,
    { listPointKeys: async () => [] } as never,
    { listLocationTypes: async () => [{ code: "smoc_campus", label: "SMOC campus" }] } as never,
    { resolveForOrganization: async () => ({ kind: "guided", reason: "platform_off" }) } as never,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    { listExisting: async () => ({ rows: [], total: 0 }) } as never,
  );
}

/** I1 - the protocol question answers every catalog entry with its fields and its wiring, and changes nothing. */
export async function assertTheProtocolQuestionAnswersTheCatalog(): Promise<void> {
  const service = protocolService();
  const result = await service.handleTurn("which protocols are available", {}, "location", "Org", "org-1", { sessionId: "s", history: [] });
  const reply = result.assistantMessage;
  for (const text of ["Here are the protocols available in BMS:", "(`mqtt`, live ingest)", "Required: topic", "(`modbus_tcp`, config only)"]) {
    assert(reply.includes(text), `the reply holds "${text}", got ${reply}`);
  }
  assert(Object.keys(result.draftPatch).length === 0, `an empty patch, got ${JSON.stringify(result.draftPatch)}`);
}

/** F4.224 - "listed" is not the question word `list`: the message appends a Modbus RTU and gets no catalog. */
export async function assertAListedRtuMessageAppendsTheRtu(): Promise<void> {
  const service = protocolService();
  const draft = { location: { name: "Pump House", slug: "pump-house", code: "PUMP-HOUSE", type: "smoc_campus", latitude: 22.3, longitude: 87.3 } };
  const result = await service.handleTurn("Modbus RTU at the pump house, listed as P-1", draft, "rtu", "Org", "org-1", { sessionId: "s", history: [] });
  const rtus = result.draftPatch.rtus ?? [];
  assert(rtus.length === 1, `one RTU appended, got ${rtus.length}; reply: ${result.assistantMessage}`);
  assert(rtus[0]?.protocol === "modbus_tcp", `a modbus_tcp RTU, got ${String(rtus[0]?.protocol)}`);
  assert(!result.assistantMessage.startsWith("Here are the protocols available in BMS:"), "the catalog did not answer");
}
