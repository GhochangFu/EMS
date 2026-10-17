import { userRoleSchema } from "@bms/shared";

import { TOOL_DEFINITIONS as ONBOARDING_TOOL_DEFINITIONS } from "../admin/onboarding/onboarding-agent-tools";
import type { LlmToolDefinition } from "../llm/llm-port";
import { proposeHarness } from "./copilot-propose-tools.spec";
import type { CopilotReadServices } from "./tools/copilot-read-tool";
import { createCopilotReadTools } from "./tools/copilot-read-tool-set";

/**
 * `F4.265` — every JSON Schema `pattern` a tool definition carries reaches
 * the LLM provider verbatim, without flags (`zod-to-json-schema` emits
 * `regex.source`). OpenAI refuses the whole request when one pattern is not
 * an ECMA-262 regex it reads — `'^[^\\p{Cc}]*$' is not a 'regex'` — so one
 * bad field in one tool fails every turn.
 *
 * The walk builds the definitions exactly as a turn sends them: the propose
 * registry for every role (with access and asset-create on, the supersets),
 * the read registry, and the onboarding agent's list. The mimic tools that
 * carried `\p{Cc}` are offered to `admin` and `organization_admin` only, so a
 * walk over one role can miss them; the positive control below proves the
 * walk reaches them.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export type PatternSite = { readonly tool: string; readonly path: string; readonly pattern: string };

/** Every definition a copilot turn or an onboarding turn can send. */
export function allToolDefinitions(): readonly LlmToolDefinition[] {
  const h = proposeHarness();
  const propose = userRoleSchema.options.flatMap(
    (role) => h.tools.registryFor({ access: true, role, assetCreate: true }).definitions,
  );
  // The read services are touched only at dispatch; the registry is static.
  const read = createCopilotReadTools({} as unknown as CopilotReadServices).registry.definitions;
  return [...propose, ...read, ...ONBOARDING_TOOL_DEFINITIONS];
}

/** Every string `pattern` key at any depth of every definition's parameters. */
export function collectPatterns(definitions: readonly LlmToolDefinition[]): PatternSite[] {
  const sites: PatternSite[] = [];
  for (const definition of definitions) {
    const stack: Array<{ node: unknown; path: string }> = [{ node: definition.parameters, path: "" }];
    while (stack.length > 0) {
      const { node, path } = stack.pop()!;
      if (node === null || typeof node !== "object") continue;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "pattern" && typeof value === "string") {
          sites.push({ tool: definition.name, path, pattern: value });
        } else {
          stack.push({ node: value, path: path === "" ? key : `${path}.${key}` });
        }
      }
    }
  }
  return sites;
}

function describeSite(site: PatternSite): string {
  return `${site.tool} ${site.path} ${site.pattern}`;
}

/** The positive control: the walk reaches the real catalog, the mimic tools and the onboarding list. */
export function assertTheWalkReachesTheRealCatalog(): void {
  const definitions = allToolDefinitions();
  const sites = collectPatterns(definitions);
  const has = (tool: string, path: string): boolean => sites.some((s) => s.tool === tool && s.path === path);
  assert(
    has("propose_mimicLibrary_create", "properties.body.properties.label"),
    `the walk must reach propose_mimicLibrary_create's body.label pattern; sites: ${sites.map(describeSite).join(" | ")}`,
  );
  assert(
    has("propose_mimicLibrary_create", "properties.body.properties.licence"),
    "the walk must reach propose_mimicLibrary_create's body.licence pattern",
  );
  assert(
    sites.some((s) => s.tool === "propose_mimicSymbol_upload"),
    "the walk must reach a pattern in propose_mimicSymbol_upload",
  );
  assert(
    definitions.some((d) => d.name === "validate_draft"),
    "the walk must include the onboarding agent's tool definitions (validate_draft)",
  );
  // Measured 2026-10-17: 9 distinct patterns over 113 sites reach the provider.
  // The catalog holds more, but a body over INLINE_BODY_SCHEMA_MAX_CHARS is not
  // inlined into the definition, so its patterns are not sent here.
  const distinct = new Set(sites.map((s) => s.pattern));
  assert(distinct.size >= 9, `the walk must find at least 9 distinct patterns (measured), got ${distinct.size}`);
}

function failingSites(compile: (pattern: string) => void): string[] {
  const failures: string[] = [];
  for (const site of collectPatterns(allToolDefinitions())) {
    try {
      compile(site.pattern);
    } catch (error) {
      failures.push(`${describeSite(site)} (${(error as Error).message})`);
    }
  }
  return failures;
}

/** Every pattern compiles as the provider reads it: no flags. */
export function assertEveryPatternCompilesWithoutFlags(): void {
  const failures = failingSites((p) => new RegExp(p));
  assert(failures.length === 0, `patterns that do not compile without flags: ${failures.join(" | ")}`);
}

/** Every pattern compiles under `u` too, which closes the "valid only through Annex B" class. */
export function assertEveryPatternCompilesWithTheUFlag(): void {
  const failures = failingSites((p) => new RegExp(p, "u"));
  assert(failures.length === 0, `patterns that do not compile with the u flag: ${failures.join(" | ")}`);
}

/**
 * The load-bearing assertion for F4.265. The two compile checks above stay
 * green on `^[^\p{Cc}]*$`: V8 compiles it without flags as an Annex-B
 * identity escape ("not p, {, C, c, }"), and it is valid under `u`. Only this
 * text check reddens when a Unicode property escape comes back.
 */
export function assertNoPatternCarriesAUnicodePropertyEscape(): void {
  const offenders = collectPatterns(allToolDefinitions()).filter(
    (s) => s.pattern.includes("\\p{") || s.pattern.includes("\\P{"),
  );
  assert(
    offenders.length === 0,
    `patterns with a Unicode property escape (OpenAI refuses them): ${offenders.map(describeSite).join(" | ")}`,
  );
}
