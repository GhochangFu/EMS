import { z } from "zod";

import type { LlmToolCall } from "./llm-port";
import { defineToolRegistry, jsonSchemaOf, runToolCall, type ToolGuard } from "./tool-registry";
import { succeed, type ToolOutcome } from "./tool-result";

/** The generic tool registry skeleton (`F3.85`, ADR 0099). `runToolCall` never throws. */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const args = z.object({ value: z.string() }).strict();
const registry = defineToolRegistry({ alpha: args, beta: args }, { alpha: "The alpha tool.", beta: "The beta tool." });
type Name = "alpha" | "beta";

function call(name: string, argumentsText: string): LlmToolCall {
  return { id: "call_1", name, arguments: argumentsText };
}

/** A dispatch that records what reached it. */
function recordingDispatch(): { seen: string[]; dispatch: (name: Name, a: Record<string, unknown>) => Promise<ToolOutcome> } {
  const seen: string[] = [];
  return {
    seen,
    dispatch: async (name, a) => {
      seen.push(`${name}:${JSON.stringify(a)}`);
      return succeed({ ran: name }, `ran ${name}`);
    },
  };
}

export async function assertAnUnknownNameFails(): Promise<void> {
  const d = recordingDispatch();
  const outcome = await runToolCall(registry, call("gamma", "{}"), d.dispatch, []);
  assert(!outcome.ok && outcome.error === "Unknown tool 'gamma'.", `an unknown name fails: ${JSON.stringify(outcome)}`);
  assert(d.seen.length === 0, "nothing is dispatched");
}

export async function assertBadJsonFails(): Promise<void> {
  const outcome = await runToolCall(registry, call("alpha", "{not json"), recordingDispatch().dispatch, []);
  assert(!outcome.ok && outcome.error === "The arguments are not valid JSON.", `bad JSON fails: ${JSON.stringify(outcome)}`);
}

export async function assertAGuardRefusalFailsWithItsText(): Promise<void> {
  const d = recordingDispatch();
  const outcome = await runToolCall(registry, call("alpha", '{"value":"x"}'), d.dispatch, [() => "Refused by the guard."]);
  assert(!outcome.ok && outcome.error === "Refused by the guard.", `the guard's text is the failure: ${JSON.stringify(outcome)}`);
  assert(d.seen.length === 0, "a refused call is not dispatched");
}

export async function assertTheFirstRefusingGuardWins(): Promise<void> {
  const outcome = await runToolCall(registry, call("alpha", '{"value":"x"}'), recordingDispatch().dispatch, [
    () => "first",
    () => "second",
  ]);
  assert(outcome.error === "first", `guards run in order and the first refusal answers: ${outcome.error}`);
}

export async function assertANameScopedGuardRefusesAAndPassesB(): Promise<void> {
  const onlyAlpha: ToolGuard<Name> = (name, raw) =>
    name === "alpha" && (raw as { value?: unknown }).value === "secret" ? "alpha refuses it" : null;
  const d = recordingDispatch();
  const refused = await runToolCall(registry, call("alpha", '{"value":"secret"}'), d.dispatch, [onlyAlpha]);
  const passed = await runToolCall(registry, call("beta", '{"value":"secret"}'), d.dispatch, [onlyAlpha]);
  assert(!refused.ok && refused.error === "alpha refuses it", `tool A is refused: ${JSON.stringify(refused)}`);
  assert(passed.ok && d.seen.join("|") === 'beta:{"value":"secret"}', `tool B with the same arguments passes: ${d.seen.join("|")}`);
}

export async function assertASchemaFailureNamesTheIssue(): Promise<void> {
  const outcome = await runToolCall(registry, call("alpha", '{"value":1}'), recordingDispatch().dispatch, []);
  assert(!outcome.ok && (outcome.error ?? "").startsWith("Invalid arguments: value: "), `a schema failure names its path: ${outcome.error}`);
}

export async function assertEmptyArgumentsParseAsAnEmptyObject(): Promise<void> {
  const outcome = await runToolCall(registry, call("alpha", "  "), recordingDispatch().dispatch, []);
  assert(!outcome.ok && (outcome.error ?? "").startsWith("Invalid arguments: value: "), `blank arguments reach the schema as {}: ${outcome.error}`);
}

export async function assertAThrowingDispatchFailsWithTheGenericText(): Promise<void> {
  const outcome = await runToolCall(
    registry,
    call("alpha", '{"value":"x"}'),
    async () => {
      throw new Error("database exploded: secret detail");
    },
    [],
  );
  assert(
    !outcome.ok && outcome.error === "The tool failed. Try again or continue without it.",
    `a throwing dispatch fails with the generic text: ${JSON.stringify(outcome)}`,
  );
}

export async function assertAValidCallIsDispatchedWithParsedArguments(): Promise<void> {
  const d = recordingDispatch();
  const outcome = await runToolCall(registry, call("alpha", '{"value":"x"}'), d.dispatch, [() => null]);
  assert(outcome.ok && outcome.actionLine === "ran alpha", `a valid call dispatches: ${JSON.stringify(outcome)}`);
  assert(d.seen.join("|") === 'alpha:{"value":"x"}', `the parsed arguments reach dispatch: ${d.seen.join("|")}`);
}

export function assertAUnionGetsARootObjectType(): void {
  const schema = jsonSchemaOf(z.union([z.object({ a: z.string() }).strict(), z.object({ b: z.string() }).strict()]));
  assert(schema.type === "object", `a union's root is typed object: ${JSON.stringify(schema.type)}`);
  assert(Array.isArray(schema.anyOf) && schema.$schema === undefined, `the anyOf is kept and $schema dropped: ${JSON.stringify(schema)}`);
}

export function assertTheDefinitionsFollowTheSchemaOrder(): void {
  const names = registry.definitions.map((definition) => `${definition.name}=${definition.description}`).join("|");
  assert(names === "alpha=The alpha tool.|beta=The beta tool.", `definitions in key order with descriptions: ${names}`);
  assert(registry.isToolName("alpha") && !registry.isToolName("toString"), "isToolName reads own keys only");
}
