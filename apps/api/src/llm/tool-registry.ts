import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { quoteCell } from "../admin/spreadsheet-guard";
import type { LlmToolCall, LlmToolDefinition } from "./llm-port";
import { fail, issuesOf, type ToolOutcome } from "./tool-result";

/**
 * The skeleton of an agent's tool registry (`F3.85`, ADR 0099), extracted from
 * the onboarding agent (`F3.21`, ADR 0090 decision 4).
 *
 * A registry is a fixed map of tool name → Zod argument schema, plus one
 * description per tool. `runToolCall` is the part every agent shares and
 * **never throws**: an unknown name, malformed JSON, a guard's refusal, a
 * schema failure and a throwing dispatch all come back to the model as an
 * `{ ok: false }` result. What a tool *does* stays with its agent, in the
 * `dispatch` it passes in.
 */

/** A tool's Zod schema as the JSON Schema object a provider reads. */
export function jsonSchemaOf(schema: ZodTypeAny): Record<string, unknown> {
  const converted = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
  delete converted.$schema;
  // A union (`get_template`) converts to a bare `anyOf`; providers read the root as an object schema.
  if (converted.type === undefined) {
    converted.type = "object";
  }
  return converted;
}

export type ToolRegistry<Name extends string> = {
  /** The tools as the model sees them, in the key order of the schema map. */
  readonly definitions: readonly LlmToolDefinition[];
  readonly schemas: Readonly<Record<Name, ZodTypeAny>>;
  /** Whether `name` is one of the registry's tools; a loop records any other name as `unknown` (security review L3). */
  readonly isToolName: (name: string) => name is Name;
};

export function defineToolRegistry<Name extends string>(
  schemas: Readonly<Record<Name, ZodTypeAny>>,
  descriptions: Readonly<Record<Name, string>>,
): ToolRegistry<Name> {
  const definitions = (Object.keys(schemas) as Name[]).map(
    (name): LlmToolDefinition => ({ name, description: descriptions[name], parameters: jsonSchemaOf(schemas[name]) }),
  );
  const isToolName = (name: string): name is Name => Object.prototype.hasOwnProperty.call(schemas, name);
  return { definitions, schemas, isToolName };
}

/**
 * A check on a call's parsed-but-unvalidated arguments, run before the schema.
 * Returns the refusal's sentence, or `null` to pass. **Name-scoped**: a guard
 * that applies to some tools only returns `null` for the others.
 */
export type ToolGuard<Name extends string> = (name: Name, raw: unknown) => string | null;

/** Runs one tool call: name, JSON, the guards in order, the schema, then `dispatch`. Never throws. */
export async function runToolCall<Name extends string>(
  registry: ToolRegistry<Name>,
  call: LlmToolCall,
  dispatch: (name: Name, args: Record<string, unknown>) => Promise<ToolOutcome>,
  guards: readonly ToolGuard<Name>[],
): Promise<ToolOutcome> {
  if (!registry.isToolName(call.name)) {
    return fail(`Unknown tool ${quoteCell(call.name)}.`);
  }
  const name = call.name;
  let raw: unknown;
  try {
    raw = call.arguments.trim() === "" ? {} : JSON.parse(call.arguments);
  } catch {
    return fail("The arguments are not valid JSON.");
  }
  for (const guard of guards) {
    const refusal = guard(name, raw);
    if (refusal !== null) {
      return fail(refusal);
    }
  }
  const parsed = registry.schemas[name].safeParse(raw);
  if (!parsed.success) {
    return fail(`Invalid arguments: ${issuesOf(parsed.error)}`);
  }
  try {
    return await dispatch(name, parsed.data as Record<string, unknown>);
  } catch {
    return fail("The tool failed. Try again or continue without it.");
  }
}
