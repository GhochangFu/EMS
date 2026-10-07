import type { OnboardingDraft } from "@bms/shared";

import {
  EXISTING_SCOPE_NOTE,
  PROMPT_MARKER_TOOL_ERROR,
  TOOL_RESULT_MAX_CHARS,
  runTool,
  type ToolContext,
  type ToolState,
} from "./onboarding-agent-tools";
import type { ExistingQuery, ExistingRow } from "./onboarding-inventory.service";
import { PROMPT_OMITTED_MARKER } from "./onboarding-prompt-budget";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * F3.26 (ADR 0095 decisions 1, 2, 3, 6, 8): `find_existing` reads the session
 * organization's committed rows through `ctx.inventory`, caps them, counts the
 * rest exactly, carries one constant scope note, and writes nothing.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Recorded = { organizationId: string; query: ExistingQuery };

type InventoryFake = {
  readonly calls: Recorded[];
  readonly ctx: ToolContext;
};

function context(result: { rows: ExistingRow[]; total: number } | Error = { rows: [], total: 0 }): InventoryFake {
  const calls: Recorded[] = [];
  const ctx: ToolContext = {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [], listInUsePointKeys: async () => new Set<string>() },
    protocols: {
      getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }),
      formatForAssistant: () => "MQTT",
    },
    inventory: {
      listExisting: async (organizationId, query) => {
        calls.push({ organizationId, query });
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
    },
    validator: new OnboardingValidateService(),
    templates: EMPTY_TEMPLATE_CONTEXT,
  };
  return { calls, ctx };
}

function call(name: string, args: unknown): { id: string; name: string; arguments: string } {
  return { id: "c1", name, arguments: typeof args === "string" ? args : JSON.stringify(args) };
}

function parsed(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

/** Tiny rows, so 100 of them stay under the result bound and `parsed()` reads them whole. */
function tinyRows(count: number): ExistingRow[] {
  return Array.from({ length: count }, (_, i) => ({ code: `A${i}` }) as unknown as ExistingRow);
}

const ASSET_ROWS: ExistingRow[] = [
  { code: "HQ-PUMP-1", name: "Feed pump", domain: "water", locationCode: "HQ", rtu: "HQ-RTU-1", templateCode: null, templateVersion: null },
  { code: "HQ-MTR-1", name: "Main meter", domain: "electrical", locationCode: "HQ", rtu: null, templateCode: "MFM", templateVersion: 2 },
];

function draft(): OnboardingDraft {
  return {
    location: { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", latitude: 20.1, longitude: 85.1, type: "smoc_campus" },
    rtus: [{ code: "RTU-1", displayName: "RTU-1", protocol: "mqtt", credentialsSet: false, ingestEnabled: false, config: { host: "broker" } }],
  } as OnboardingDraft;
}

/** T1: the service is asked for the session organization, with the arguments exactly as given. */
export async function assertFindExistingAsksTheServiceForTheSessionOrganization(): Promise<void> {
  const { calls, ctx } = context();
  const out = await runTool(call("find_existing", { kind: "asset", search: "pump", locationCode: "HQ" }), { working: {} }, ctx);
  assert(out.ok, `find_existing succeeds, got ${out.content}`);
  assert(calls.length === 1, `the inventory is read once, got ${calls.length}`);
  assert(calls[0].organizationId === "org-1", `the read names the session organization, got ${calls[0].organizationId}`);
  assert(
    JSON.stringify(calls[0].query) === JSON.stringify({ kind: "asset", search: "pump", locationCode: "HQ" }),
    `the query is the arguments exactly, got ${JSON.stringify(calls[0].query)}`,
  );
}

/** T2: 100 rows of 130 are shown and the tail counts the 30 others; 100 of 100 has no tail. */
export async function assertFindExistingIsCappedAndCountsTheRest(): Promise<void> {
  const capped = parsed((await runTool(call("find_existing", { kind: "asset" }), { working: {} }, context({ rows: tinyRows(100), total: 130 }).ctx)).content);
  assert((capped.items as unknown[]).length === 100, `100 items are shown, got ${(capped.items as unknown[]).length}`);
  assert(capped.more === "…and 30 more assets", `the tail counts the rest exactly, got ${String(capped.more)}`);
  const whole = parsed((await runTool(call("find_existing", { kind: "asset" }), { working: {} }, context({ rows: tinyRows(100), total: 100 }).ctx)).content);
  assert((whole.items as unknown[]).length === 100, "100 of 100 items are shown");
  assert(whole.more === undefined, `no tail when nothing is left, got ${String(whole.more)}`);
}

/** T3: every kind's result carries the constant scope note. */
export async function assertFindExistingCarriesTheScopeNote(): Promise<void> {
  for (const kind of ["location", "rtu", "asset"] as const) {
    const out = parsed((await runTool(call("find_existing", { kind }), { working: {} }, context().ctx)).content);
    assert(out.ok === true, `${kind}: find_existing succeeds`);
    assert(out.note === EXISTING_SCOPE_NOTE, `${kind}: the note is the scope note exactly, got ${String(out.note)}`);
  }
}

/** T4: an unknown kind is refused, naming `kind`; a known kind beside it succeeds. */
export async function assertFindExistingRefusesAnUnknownKind(): Promise<void> {
  const refused = await runTool(call("find_existing", { kind: "user" }), { working: {} }, context().ctx);
  assert(!refused.ok, "kind user is refused");
  assert((refused.error ?? "").startsWith("Invalid arguments") && (refused.error ?? "").includes("kind"), `the error names kind, got ${String(refused.error)}`);
  const known = await runTool(call("find_existing", { kind: "location" }), { working: {} }, context().ctx);
  assert(known.ok, `kind location succeeds, got ${known.content}`);
}

/** T5: a 65-character search or location code and an unknown property are schema refusals; 64 characters pass. */
export async function assertFindExistingRefusesOverlongArguments(): Promise<void> {
  const cases: [string, Record<string, unknown>][] = [
    ["search of 65", { kind: "asset", search: "s".repeat(65) }],
    ["locationCode of 65", { kind: "asset", locationCode: "L".repeat(65) }],
    ["an unknown property", { kind: "asset", organizationId: "org-2" }],
  ];
  for (const [label, args] of cases) {
    const out = await runTool(call("find_existing", args), { working: {} }, context().ctx);
    assert(!out.ok && (out.error ?? "").startsWith("Invalid arguments"), `${label} is a schema refusal, got ${out.content}`);
  }
  const atBound = await runTool(call("find_existing", { kind: "asset", search: "s".repeat(64), locationCode: "L".repeat(64) }), { working: {} }, context().ctx);
  assert(atBound.ok, `64 characters pass, got ${atBound.content}`);
}

/** T6: the rows are echoed unchanged; the draft, the proposal and the action line are untouched. */
export async function assertFindExistingEchoesRowsUnchangedAndWritesNothing(): Promise<void> {
  const state: ToolState = { working: draft(), pendingProposal: { summary: "1 location" } };
  const before = JSON.stringify(state.working);
  const out = await runTool(call("find_existing", { kind: "asset" }), state, context({ rows: ASSET_ROWS, total: 2 }).ctx);
  assert(out.ok, `find_existing succeeds, got ${out.content}`);
  assert(JSON.stringify(parsed(out.content).items) === JSON.stringify(ASSET_ROWS), `the items are the rows unchanged, got ${out.content}`);
  assert(JSON.stringify(state.working) === before, "the draft is unchanged");
  assert(out.actionLine === undefined, `no action line, got ${String(out.actionLine)}`);
  assert(state.pendingProposal?.summary === "1 location", "the pending proposal is unchanged");
}

/** T7 (Q-C): the withheld-value marker is refused before the read. */
export async function assertFindExistingRefusesThePromptMarker(): Promise<void> {
  const { calls, ctx } = context();
  const out = await runTool(call("find_existing", { kind: "asset", search: PROMPT_OMITTED_MARKER }), { working: {} }, ctx);
  assert(!out.ok && out.error === PROMPT_MARKER_TOOL_ERROR, `the marker is refused, got ${out.content}`);
  assert(calls.length === 0, "the inventory is not read");
}

/** T8: a failed read is a tool error and the draft is unchanged. */
export async function assertAFailedInventoryReadIsAToolError(): Promise<void> {
  const state: ToolState = { working: draft() };
  const before = JSON.stringify(state.working);
  const out = await runTool(call("find_existing", { kind: "rtu" }), state, context(new Error("connection reset")).ctx);
  assert(!out.ok && out.error === "The tool failed. Try again or continue without it.", `the failure is a tool error, got ${out.content}`);
  assert(!out.content.includes("connection reset"), "the error text does not reach the model");
  assert(JSON.stringify(state.working) === before, "the draft is unchanged");
}

/** T9 (decision 2): a result cut at the bound still carries the scope note and the tail; the items are what is cut. */
export async function assertACutResultKeepsTheScopeNoteAndTheTail(): Promise<void> {
  const rows = Array.from({ length: 100 }, (_, i) => ({ ...ASSET_ROWS[1], code: `HQ-MTR-${i}`, name: `Main meter ${i}` }) as ExistingRow);
  const out = await runTool(call("find_existing", { kind: "asset" }), { working: {} }, context({ rows, total: 400 }).ctx);
  assert(out.ok, "find_existing succeeds");
  assert(out.content.length > TOOL_RESULT_MAX_CHARS, `the realistic result is cut, length ${out.content.length}`);
  assert(out.content.includes(JSON.stringify(EXISTING_SCOPE_NOTE)), "the cut result carries the scope note");
  assert(out.content.includes("…and 300 more assets"), "the cut result carries the tail");
}

/**
 * T10 (review L2): the exact total survives the cut. 100 realistic rows of 100
 * have no tail, yet the cut hides some of them; the total tells the model how
 * many codes exist.
 */
export async function assertACutResultKeepsTheExactTotal(): Promise<void> {
  const rows = Array.from({ length: 100 }, (_, i) => ({ ...ASSET_ROWS[1], code: `HQ-MTR-${i}`, name: `Main meter ${i}` }) as ExistingRow);
  const whole = await runTool(call("find_existing", { kind: "asset" }), { working: {} }, context({ rows, total: 100 }).ctx);
  assert(whole.ok, "find_existing succeeds");
  assert(whole.content.length > TOOL_RESULT_MAX_CHARS, `the realistic result is cut, length ${whole.content.length}`);
  assert(!whole.content.includes("more assets"), "100 of 100 has no tail");
  assert(whole.content.includes('"total":100'), "the cut result carries the exact total");
  const capped = await runTool(call("find_existing", { kind: "asset" }), { working: {} }, context({ rows, total: 400 }).ctx);
  assert(capped.content.includes('"total":400'), "the capped and cut result carries the exact total");
}

type KeyRow = { code: string; name: string; unit: string | null; domain: string | null };

function keyRow(code: string, domain: string | null = "electrical", unit: string | null = "kW", name = `Key ${code}`): KeyRow {
  return { code, name, unit, domain };
}

/** A context whose catalog returns `keys` and records the organization the in-use read received. */
function keyContext(keys: KeyRow[], inUse: string[] = []): { ctx: ToolContext; inUseCalls: string[] } {
  const inUseCalls: string[] = [];
  const base = context().ctx;
  const ctx: ToolContext = {
    ...base,
    catalog: {
      listPointKeys: async () => keys,
      listInUsePointKeys: async (organizationId: string) => {
        inUseCalls.push(organizationId);
        return new Set(inUse);
      },
    },
  };
  return { ctx, inUseCalls };
}

type KeyOut = { code: string; inUse: boolean }[];

async function listKeys(args: unknown, keys: KeyRow[], inUse: string[] = []): Promise<{ out: Record<string, unknown>; items: KeyOut }> {
  const { ctx } = keyContext(keys, inUse);
  const result = await runTool(call("list_point_keys", args), { working: {} }, ctx);
  assert(result.ok, `list_point_keys succeeds, got ${result.content}`);
  const out = parsed(result.content);
  return { out, items: out.pointKeys as KeyOut };
}

const ABCD = (): KeyRow[] => [keyRow("a"), keyRow("b"), keyRow("c"), keyRow("d")];
const codesOf = (items: KeyOut): string => JSON.stringify(items.map((k) => k.code));

/** P1: the keys the organization already maps come first. */
export async function assertInUseKeysComeFirst(): Promise<void> {
  const { items } = await listKeys({}, ABCD(), ["c"]);
  assert(codesOf(items) === '["c","a","b","d"]', `in-use first, got ${codesOf(items)}`);
}

/** P2: each key carries the flag, true on the in-use key only. */
export async function assertEachKeyCarriesTheInUseFlag(): Promise<void> {
  const { items } = await listKeys({}, ABCD(), ["c"]);
  const flags = JSON.stringify(items.map((k) => [k.code, k.inUse]));
  assert(flags === '[["c",true],["a",false],["b",false],["d",false]]', `flags, got ${flags}`);
}

/** P3: the catalog order holds inside each group. */
export async function assertRankingKeepsTheCatalogOrderInsideEachGroup(): Promise<void> {
  const { items } = await listKeys({}, ABCD(), ["c", "a"]);
  assert(codesOf(items) === '["a","c","b","d"]', `stable inside groups, got ${codesOf(items)}`);
}

/** P4: the domain filter is case-insensitive equality; a null domain never matches. */
export async function assertDomainFilterIsCaseInsensitiveEquality(): Promise<void> {
  const keys = [keyRow("a", "electrical"), keyRow("b", "hvac"), keyRow("c", null), keyRow("d", "Electrical")];
  const exact = await listKeys({ domain: "Electrical" }, keys);
  assert(codesOf(exact.items) === '["a","d"]', `case-insensitive match, got ${codesOf(exact.items)}`);
  const prefix = await listKeys({ domain: "electric" }, keys);
  assert(prefix.items.length === 0, `a prefix matches nothing, got ${codesOf(prefix.items)}`);
  assert(!exact.items.some((k) => k.code === "c"), "a null domain never matches");
}

/** P5: the unit filter is case-insensitive equality. */
export async function assertUnitFilterIsCaseInsensitiveEquality(): Promise<void> {
  const keys = [keyRow("a", "electrical", "kW"), keyRow("b", "electrical", "kWh"), keyRow("c", "electrical", null)];
  const { items } = await listKeys({ unit: "kw" }, keys);
  assert(codesOf(items) === '["a"]', `kw keeps kW only, got ${codesOf(items)}`);
}

/** P6: search and domain compose; 130 matches show 100 and count 30. */
export async function assertFiltersComposeWithSearchAndTheCapStays(): Promise<void> {
  const keys = [keyRow("pump_a", "water", "m3", "Feed"), keyRow("pump_b", "electrical", "kW", "Feed"), keyRow("meter", "water", "m3", "Main")];
  const composed = await listKeys({ search: "pump", domain: "water" }, keys);
  assert(codesOf(composed.items) === '["pump_a"]', `search and domain compose, got ${codesOf(composed.items)}`);
  const many = Array.from({ length: 130 }, (_, i) => keyRow(`k${String(i).padStart(3, "0")}`, "electrical", "kW", "k"));
  const capped = await listKeys({ search: "k", domain: "electrical" }, many);
  assert(capped.items.length === 100, `100 shown, got ${capped.items.length}`);
  assert(capped.out.more === "…and 30 more point keys", `the tail counts 30, got ${String(capped.out.more)}`);
}

/** P7: the in-use read receives the session organization. */
export async function assertTheInUseReadIsScopedToTheSessionOrganization(): Promise<void> {
  const { ctx, inUseCalls } = keyContext(ABCD());
  const out = await runTool(call("list_point_keys", {}), { working: {} }, ctx);
  assert(out.ok, "list_point_keys succeeds");
  assert(JSON.stringify(inUseCalls) === '["org-1"]', `the read names org-1 once, got ${JSON.stringify(inUseCalls)}`);
}

/** P8: an unknown argument is refused; a known filter beside it succeeds. */
export async function assertAnUnknownFilterIsRefused(): Promise<void> {
  const { ctx } = keyContext(ABCD());
  const refused = await runTool(call("list_point_keys", { kind: "x" }), { working: {} }, ctx);
  assert(!refused.ok && (refused.error ?? "").startsWith("Invalid arguments"), `kind is refused, got ${refused.content}`);
  const ok = await runTool(call("list_point_keys", { domain: "electrical" }), { working: {} }, keyContext(ABCD()).ctx);
  assert(ok.ok, `domain is accepted, got ${ok.content}`);
}
