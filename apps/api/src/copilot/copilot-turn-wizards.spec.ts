import { expect } from "vitest";

import { calls, FakeLlmProvider, toolCall } from "../admin/onboarding/onboarding-agent-loop.spec";
import { FILL_NO_OPEN_WIZARD_ERROR } from "./copilot-open-wizards";
import type { CopilotToolResult } from "./copilot-read-tools";
import { GLOBAL_ADMIN, harness, ORG_X, turn } from "./copilot-turn.service.spec";

/**
 * `F4.245` / ADR 0099 Amendment 4 — the turn hands the open wizards to the
 * tools and tells the model which records are open; an `open_page` call names
 * the page's records, so a fill in the same turn may wait for one. The fill's
 * own checks are `copilot-propose-fill.spec.ts`'s. In its own file:
 * `copilot-turn.service.spec.ts` is near the line cap. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPEN_A = [{ catalogId: "dashboard.update", params: { id: A } }];
const FILL_A = { catalogId: "dashboard.update", params: { id: A }, stepId: "basics", values: { name: "Main" } };

/** Mutation: the turn passes `[]` instead of the body's wizards — the fill is refused and the response has none. */
export async function aTurnWithTheOpenWizardGetsTheFill(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("fill_step", FILL_A)), { kind: "final", text: "Filled." }]);
  const response = await turn(harness(llm), "name it Main", GLOBAL_ADMIN, OPEN_A);
  expect(response.fillStep).toStrictEqual(FILL_A);
}

/** The adjacent negative: the same model call with nothing open gets no fill, and the model reads the refusal. */
export async function aTurnWithoutTheOpenWizardGetsNoFill(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("fill_step", FILL_A)), { kind: "final", text: "Propose instead." }]);
  const response = await turn(harness(llm), "name it Main", GLOBAL_ADMIN, []);
  expect(response.fillStep).toBeNull();
  expect(JSON.stringify(llm.seen[1])).toContain(FILL_NO_OPEN_WIZARD_ERROR);
}

/** Mutation: drop the open-wizards system message — the model is never told which records are open. */
export async function theModelIsToldWhichRecordsAreOpen(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  await turn(harness(llm), "hi", GLOBAL_ADMIN, OPEN_A);
  const system = (llm.seen[0] ?? []).filter((m) => m.role === "system").map((m) => m.content);
  expect(system.some((content) => typeof content === "string" && content.includes(`- dashboard.update {"id":"${A}"}: "T"`))).toBe(true);
}

/** Mutation: drop the provenance loop — a record's name reached the model, so its organization is on the reply. */
export async function anOpenRecordsOrganizationIsTheReplysProvenance(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  const response = await turn(harness(llm), "hi", GLOBAL_ADMIN, OPEN_A);
  expect(response.messages.find((m) => m.role === "assistant")?.organizationIds).toEqual([ORG_X]);
}

const OPEN_PAGE: CopilotToolResult = { ok: true, result: { route: "/admin/dashboards/plant-a" }, organizationIds: [], navigateTo: "/admin/dashboards/plant-a" };

/** Owner ruling (nav). Mutation: do not record the page's wizards — the fill after `open_page` is refused. */
export async function aFillAfterOpenPageInOneTurnIsAccepted(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("open_page", {})), calls(toolCall("fill_step", FILL_A)), { kind: "final", text: "Opened." }]);
  const h = harness(llm, { tools: { open_page: () => OPEN_PAGE }, slugId: A });
  const response = await turn(h, "open plant-a and name it Main", GLOBAL_ADMIN, []);
  expect(response.navigateTo).toBe("/admin/dashboards/plant-a");
  expect(response.fillStep).toStrictEqual(FILL_A);
}

/** Mutation: drop the result's `wizards` — the model never reads the opened page's record params. */
export async function theOpenPageResultNamesThePagesRecords(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("open_page", {})), { kind: "final", text: "Opened." }]);
  const h = harness(llm, { tools: { open_page: () => OPEN_PAGE }, slugId: A });
  await turn(h, "open plant-a", GLOBAL_ADMIN, []);
  const tool = (llm.seen[1] ?? []).find((m) => m.role === "tool");
  expect(JSON.stringify(tool)).toContain(`{\\"catalogId\\":\\"dashboard.update\\",\\"params\\":{\\"id\\":\\"${A}\\"},\\"name\\":\\"T\\"}`);
}
