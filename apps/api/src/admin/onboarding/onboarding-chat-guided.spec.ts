import type { OnboardingDraft, OnboardingPhase } from "@bms/shared";

import { CREDENTIAL_TOOL_ERROR } from "./onboarding-agent-tools";
import { buildService, JWT, ORG, sessionRow, withoutOpenAi } from "./onboarding-chat-caps.spec";
import { REVIEW_REPLY } from "./onboarding-chat-rule-based";
import { chatService, ruleBasedTurn } from "./onboarding-chat.service.spec";
import { PROMPT_OMITTED_MARKER } from "./onboarding-prompt-budget";
import { DRAFT_TOO_DEEP_MESSAGE, MAX_ONBOARDING_DRAFT_DEPTH } from "./onboarding.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * F3.27 U2 (ADR 0090 Amendment 2 B2, B3, B6, Q-B) — the guided prompts name
 * only an input the code parses, the review reply points at the Commit button
 * and the Asset Templates editor, and at `point_keys`, `assets` and `mappings`
 * only the offered label writes. Kept out of `onboarding-chat.service.spec.ts`,
 * which is at AGENTS.md §4.5's line ceiling.
 */
const PLACE = { name: "Berhampur", slug: "berhampur", code: "BERHAMPUR", type: "smoc_campus", latitude: 22.3, longitude: 87.3 };
const RTU = { code: "RTU-1", displayName: "RTU-1", protocol: "modbus_tcp", config: { host: "127.0.0.1", port: 502, unitId: 1, pollIntervalMs: 5000 }, credentialsSet: false, ingestEnabled: false };
const KW = { code: "kw", name: "Active Power", domain: "electrical", unit: "kW" };
const ASSET = { rtuIndex: 0, code: "BERHAMPUR-ASSET-1", name: "Primary Device", siteName: "Berhampur", domain: "electrical" };
const POINT = { assetIndex: 0, pointKey: "kw", sourceDataKey: "s09_r01", unit: "kW" };

/** One draft per phase, so a turn reaches the branch of the phase it names. */
function draftAt(phase: OnboardingPhase): OnboardingDraft {
  const draft: Record<OnboardingPhase, unknown> = {
    location: {},
    rtu: { location: PLACE },
    point_keys: { location: PLACE, rtus: [RTU] },
    assets: { location: PLACE, rtus: [RTU], pointKeys: [KW] },
    mappings: { location: PLACE, rtus: [RTU], pointKeys: [KW], assets: [ASSET] },
    review: { location: PLACE, rtus: [RTU], pointKeys: [KW], assets: [ASSET], assetPoints: [POINT] },
  };
  return draft[phase] as OnboardingDraft;
}

const PHASES: readonly OnboardingPhase[] = ["location", "rtu", "point_keys", "assets", "mappings", "review"];

/** B2 — every guided answer and prompt is checked for an input the code does not parse. */
export async function assertNoGuidedReplyNamesAnInputTheCodeDoesNotParse(): Promise<void> {
  const texts: string[] = [];
  for (const phase of PHASES) {
    for (const message of ["hello", "yes"]) {
      texts.push((await ruleBasedTurn(message, draftAt(phase), phase)).assistantMessage);
    }
  }
  texts.push((await ruleBasedTurn("kw", draftAt("point_keys"), "point_keys")).assistantMessage);
  texts.push((await ruleBasedTurn("One asset", draftAt("assets"), "assets")).assistantMessage);
  texts.push((await ruleBasedTurn("auto map", draftAt("mappings"), "mappings")).assistantMessage);
  const imported = { locationName: "Berhampur", rtuCount: 1, assetCount: 1 };
  texts.push(chatService().excelImportFollowUp({ ...draftAt("assets"), assets: [] }, imported, ["kw"]).assistantMessage);
  texts.push(chatService().excelImportFollowUp(draftAt("mappings"), imported, ["kw"]).assistantMessage);
  assert(texts.length === 17, `every driven turn answered, got ${texts.length}`);
  for (const text of texts) {
    for (const banned of ["->", "How many", "per RTU", "prepare the commit"]) {
      assert(!text.includes(banned), `a guided reply contains "${banned}": ${text}`);
    }
  }
}

/** B2 — the exact text of the changed prompts and replies. */
export async function assertTheChangedGuidedTextIsExact(): Promise<void> {
  const mappings = await ruleBasedTurn("hello", draftAt("mappings"), "mappings");
  assert(
    mappings.assistantMessage === "I did not change the draft. Map the assets: say **auto map** to map each plain asset to **kw**.",
    `got ${mappings.assistantMessage}`,
  );
  const key = await ruleBasedTurn("kw", draftAt("point_keys"), "point_keys");
  assert(
    key.assistantMessage === "Added catalog point key **kw**. Say **One asset** to add one asset on RTU 1.",
    `got ${key.assistantMessage}`,
  );
  const asset = await ruleBasedTurn("One asset", draftAt("assets"), "assets");
  assert(asset.assistantMessage === "Asset added. Say **auto map** to map it to **kw**.", `got ${asset.assistantMessage}`);
}

/** B3 — the review reply and the commit words answer with the constant, and the constant is the exact text. */
export async function assertTheReviewReplyIsExact(): Promise<void> {
  assert(
    REVIEW_REPLY ===
      "The draft is in review. Open the preview and click **Commit**. After the commit, the Asset Templates editor can instantiate templates on this site.",
    `got ${REVIEW_REPLY}`,
  );
  const atReview = await ruleBasedTurn("hello", draftAt("review"), "review");
  assert(atReview.assistantMessage === REVIEW_REPLY, `got ${atReview.assistantMessage}`);
  const yes = await ruleBasedTurn("yes", draftAt("review"), "review");
  assert(yes.assistantMessage === REVIEW_REPLY, `got ${yes.assistantMessage}`);
}

/** B6 — at review with no `templates[]` the reply points at the Asset Templates editor. */
export async function assertTheReviewReplyPointsAtTheAssetTemplatesEditor(): Promise<void> {
  const draft = draftAt("review");
  assert(draft.templates === undefined, "the draft has no templates[]");
  const result = await ruleBasedTurn("hello", draft, "review");
  assert(result.assistantMessage.includes("Asset Templates"), `got ${result.assistantMessage}`);
  assert(result.assistantMessage.toLowerCase().includes("instantiate"), `got ${result.assistantMessage}`);
}

/** B2 — the two import follow-ups, exact last lines. */
export function assertTheImportFollowUpsAreExact(): void {
  const imported = { locationName: "Berhampur", rtuCount: 1, assetCount: 1 };
  const noAssets = chatService().excelImportFollowUp({ ...draftAt("assets"), assets: [] }, imported, ["kw"]);
  assert(
    noAssets.assistantMessage.split("\n").pop() === "Say **One asset** to add an asset, then **confirm assets**.",
    `got ${noAssets.assistantMessage}`,
  );
  const toMap = chatService().excelImportFollowUp(draftAt("mappings"), imported, ["kw"]);
  assert(
    toMap.assistantMessage.split("\n").pop() === "Map the assets: say **auto map** to map each plain asset to **kw**. Then **confirm mappings**.",
    `got ${toMap.assistantMessage}`,
  );
}

async function assertNothingWritten(message: string, phase: OnboardingPhase, draft: OnboardingDraft): Promise<void> {
  const result = await ruleBasedTurn(message, draft, phase);
  assert(Object.keys(result.draftPatch).length === 0, `"${message}" at ${phase} wrote ${JSON.stringify(result.draftPatch)}`);
  assert(result.assistantMessage.startsWith("I did not change the draft."), `got ${result.assistantMessage}`);
}

/** Q-B — a message that is not the offered label changes nothing at the three label steps. */
export async function assertAnythingButTheLabelWritesNothing(): Promise<void> {
  await assertNothingWritten("hello", "point_keys", draftAt("point_keys"));
  await assertNothingWritten("two assets", "assets", draftAt("assets"));
  await assertNothingWritten("source s09_r01 -> point kw", "mappings", draftAt("mappings"));
}

/** Q-B, the positive siblings — each offered label, in its normalised forms, still writes. */
export async function assertTheOfferedLabelsStillWrite(): Promise<void> {
  for (const message of ["kw", "Add point key kw", "KW."]) {
    const result = await ruleBasedTurn(message, draftAt("point_keys"), "point_keys");
    assert(result.draftPatch.pointKeys?.[0]?.code === "kw", `"${message}" wrote ${JSON.stringify(result.draftPatch)}`);
  }
  const asset = await ruleBasedTurn("One asset", draftAt("assets"), "assets");
  assert(asset.draftPatch.assets?.length === 1, `got ${JSON.stringify(asset.draftPatch)}`);
  const map = await ruleBasedTurn("auto map", draftAt("mappings"), "mappings");
  assert(map.draftPatch.assetPoints?.[0]?.sourceDataKey === "s09_r01", `got ${JSON.stringify(map.draftPatch)}`);
}

function sameLines(actual: readonly string[], expected: readonly string[], what: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${what}: got ${JSON.stringify(actual)}`);
}

/** U4 (B4, B5) — the asset step writes through `add_asset` and answers its action line. */
export async function assertTheAssetTurnAnswersItsActionLine(): Promise<void> {
  const result = await ruleBasedTurn("One asset", draftAt("assets"), "assets");
  sameLines(result.actionLines, ["Added asset BERHAMPUR-ASSET-1 on RTU RTU-1"], "the add_asset line");
}

/** U4 (Q-C) — auto map maps every plain asset that has no mapping, one `map_point` and one line each. */
export async function assertAutoMapMapsEveryUnmappedPlainAsset(): Promise<void> {
  const second = { ...ASSET, code: "BERHAMPUR-ASSET-2" };
  const draft = { ...draftAt("mappings"), assets: [ASSET, second] } as OnboardingDraft;
  const result = await ruleBasedTurn("auto map", draft, "mappings");
  sameLines(
    result.actionLines,
    ["Mapped s09_r01 → kw on asset BERHAMPUR-ASSET-1", "Mapped s09_r01 → kw on asset BERHAMPUR-ASSET-2"],
    "one map_point line per unmapped plain asset",
  );
  const indexes = (result.draftPatch.assetPoints ?? []).map((point) => point.assetIndex);
  assert(JSON.stringify(indexes) === "[0,1]", `both assets are mapped, got ${JSON.stringify(indexes)}`);
}

/** U4 (Q-C) — a mapped plain asset and a templated asset are skipped; only the unmapped plain one is mapped. */
export async function assertAutoMapSkipsMappedAndTemplatedAssets(): Promise<void> {
  const templated = { ...ASSET, code: "BERHAMPUR-PUMP-1", template: { code: "PUMP" } };
  const plain = { ...ASSET, code: "BERHAMPUR-ASSET-3" };
  const draft = { ...draftAt("mappings"), assets: [ASSET, templated, plain], assetPoints: [POINT] } as OnboardingDraft;
  const result = await ruleBasedTurn("auto map", draft, "mappings");
  sameLines(result.actionLines, ["Mapped s09_r01 → kw on asset BERHAMPUR-ASSET-3"], "only the unmapped plain asset");
}

/** The exact refusal reply a guided write answers: the registry's sentence between the lead and the step prompt. */
function refusalOf(error: string, prompt: string): string {
  return `I did not change the draft. ${error} ${prompt}`;
}

const LOCATION_PROMPT = "The location needs a name and a type first. What is the location name?";

async function assertRefused(message: string, draft: OnboardingDraft, phase: OnboardingPhase, expected: string): Promise<void> {
  const result = await ruleBasedTurn(message, draft, phase);
  assert(result.assistantMessage === expected, `the refusal reply, got ${result.assistantMessage}`);
  assert(Object.keys(result.draftPatch).length === 0, `a refused write changes nothing, got ${JSON.stringify(result.draftPatch)}`);
  sameLines(result.actionLines, [], "a refused write has no action line");
}

/** U4 (B4) — a draft past the depth bound refuses the next guided write with the `PATCH` sentence. */
export async function assertTheDepthBoundIsAGuidedRefusal(): Promise<void> {
  let deep: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < MAX_ONBOARDING_DRAFT_DEPTH; i++) {
    deep = { child: deep };
  }
  const draft = { ...draftAt("point_keys"), rtus: [{ ...RTU, config: { ...RTU.config, extra: deep } }] } as OnboardingDraft;
  await assertRefused(
    "kw",
    draft,
    "point_keys",
    refusalOf(DRAFT_TOO_DEEP_MESSAGE, "Add a point key: say **kw** to add the catalog key **kw**."),
  );
}

/**
 * U4 (B5) — a location name that looks like a credential is refused by
 * `set_location`'s credential walk. Driven through `handleTurn` directly:
 * `OnboardingService.chat` refuses such a message earlier, with the
 * credentials nudge, so this is the guided write's own guard.
 */
export async function assertACredentialLookingNameIsAGuidedRefusal(): Promise<void> {
  await assertRefused("Plant password=hunter2", {}, "location", refusalOf(CREDENTIAL_TOOL_ERROR, LOCATION_PROMPT));
}

/** U4 (B5) — a location name that is the prompt-budget marker is refused. */
export async function assertAPromptMarkerNameIsAGuidedRefusal(): Promise<void> {
  await assertRefused(
    PROMPT_OMITTED_MARKER,
    {},
    "location",
    refusalOf("The arguments carry a withheld-value marker; send real values only.", LOCATION_PROMPT),
  );
}

/**
 * U4 (B4, decision 6) — through `OnboardingService.chat`, a guided RTU turn
 * stores the code-written action line as an `action` message between the
 * user's turn and the reply.
 */
export async function assertAGuidedTurnStoresItsActionMessage(): Promise<void> {
  await withoutOpenAi(async () => {
    const session = sessionRow({ location: PLACE } as OnboardingDraft, "rtu");
    const { service, record } = buildService({ session, results: [[session], ORG, [session], ORG] });
    await service.chat(JWT, "s-1", "modbus please");
    const messages = (record.updates[0]?.messages ?? []) as { role: string; content: string }[];
    const roles = messages.map((m) => m.role);
    assert(JSON.stringify(roles) === JSON.stringify(["user", "action", "assistant"]), `the stored roles, got ${JSON.stringify(roles)}`);
    assert(messages[1]?.content === "Added RTU RTU-1 (modbus_tcp)", `the action text, got ${messages[1]?.content}`);
  });
}
