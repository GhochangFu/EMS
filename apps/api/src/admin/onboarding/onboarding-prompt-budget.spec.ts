import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";
import type { OnboardingDraft } from "@bms/shared";

import { OnboardingChatService } from "./onboarding-chat.service";
import {
  PROMPT_DRAFT_BUDGET_BYTES,
  PROMPT_OMITTED_MARKER,
  PROMPT_STRING_MAX,
  serialiseDraftForPrompt,
  shedFreeFormRecords,
  shedOverLongStrings,
} from "./onboarding-prompt-budget";
import { redactDraftForLlm } from "./onboarding-redaction";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const bytes = (text: string): number => Buffer.byteLength(text);

/**
 * The depth the deep fixtures below are built at, and the same number
 * `stack-safe-json.spec.ts` uses for the same reason.
 *
 * `JSON.stringify` throws a `RangeError` somewhere in the 4,000–4,800 band —
 * `F4.115` measured 4,173 inside `bms-api-1` on node v20.20.2 — and that band
 * moves with the platform, so nothing here asserts on it. 20,000 is far enough
 * above every measurement that a recursive rewrite of either shed pass, or a
 * missing depth pre-check, reddens on a dev machine, in CI and in the container
 * alike.
 */
const DEEP = 20_000;

/** Built with a loop: a recursive builder would throw before the code under test does. */
function chain(depth: number, leaf: unknown): unknown {
  let node: unknown = leaf;
  for (let i = 0; i < depth; i += 1) {
    node = { next: node };
  }
  return node;
}

/**
 * Follows `chain`'s links iteratively and returns the bottom value. The step
 * ceiling is a runaway guard: a walk that somehow returned a cycle would
 * otherwise hang the suite instead of failing it.
 */
function leafOf(value: unknown): unknown {
  let node = value;
  for (let steps = 0; steps <= DEEP + 1; steps += 1) {
    if (typeof node !== "object" || node === null || !("next" in node)) {
      return node;
    }
    node = (node as { next: unknown }).next;
  }
  return "RUNAWAY";
}

type ShedDraft = {
  location?: { name?: string; meta?: unknown };
  rtus?: { code?: string; displayName?: string; protocol?: string; config?: unknown; meta?: unknown }[];
  assets?: { code?: string; meta?: unknown }[];
  pointKeys?: { code?: string; name?: string; description?: unknown }[];
  assetPoints?: { pointKey?: string }[];
};

const parse = (text: string): ShedDraft => JSON.parse(text) as ShedDraft;

/**
 * The demo estate at the scale the seed ships, with realistic strings — the
 * floor `PROMPT_DRAFT_BUDGET_BYTES` is derived against (Task 0 measured this
 * shape at 82,280 bytes through `redactDraftForLlm`).
 *
 * Every array is populated, because a draft with an empty `assetPoints` would
 * make "an ordinary session is forwarded whole" a claim about a draft no
 * operator has.
 */
function demoEstateDraft(): unknown {
  const units = ["kW", "kWh", "A", "V", "degC", "m3/h", "bar", "%"];
  const rtus = Array.from({ length: 10 }, (_, i) => ({
    code: `BERHAMPUR-RTU-${i + 1}`,
    displayName: `Berhampur RTU ${i + 1}`,
    protocol: "mqtt",
    config: {
      host: "phe.thinkiot.co.in",
      port: 8883,
      tls: true,
      topic: `BERHAMPUR-RTU-${i + 1}/Topic1`,
    },
    credentialsSet: true,
    ingestEnabled: true,
  }));
  const pointKeys = Array.from({ length: 40 }, (_, k) => ({
    code: `electrical.feeder.metric.${k}`,
    name: `Feeder metric ${k}`,
    domain: "electrical",
    unit: units[k % units.length],
    description: `Measured at the feeder panel and published on the RTU telemetry topic (${k}).`,
  }));
  return {
    location: {
      name: "Berhampur",
      code: "BERHAMPUR",
      slug: "berhampur",
      type: "smoc_campus",
      latitude: 22.3159,
      longitude: 87.3222,
      province: "Odisha",
    },
    rtus,
    pointKeys,
    assets: Array.from({ length: 99 }, (_, a) => ({
      rtuIndex: a % 10,
      code: `BERHAMPUR-ASSET-${a + 1}`,
      name: `Device ${a + 1}`,
      siteName: "Berhampur",
      domain: "electrical",
    })),
    assetPoints: Array.from({ length: 495 }, (_, p) => ({
      assetIndex: p % 99,
      pointKey: pointKeys[p % 40].code,
      sourceDataKey: `plc/tag/${p}`,
      sensorCode: `SENS-${p}`,
      unit: pointKeys[p % 40].unit,
    })),
    onboardingMeta: { rtuTargetCount: 10, importedFromExcel: true },
  };
}

/**
 * A draft the operator's own session would hold is forwarded **whole**.
 *
 * This is the "does not fire when it should not" half, and without it every
 * assertion below is satisfied by a function that sheds everything always. Byte
 * equality against `redactDraftForLlm` rather than a deep-equal: the prompt
 * carries the serialisation, so bytes are the property, and they are the
 * stronger claim.
 *
 * The self-check comes first. If the fixture ever grew past the budget the two
 * asserts after it would still pass — on a draft that was shed, for the wrong
 * reason — so the fixture states that it is under budget rather than assuming it.
 */
export function assertAnUnderBudgetDraftIsForwardedIntact(): void {
  const draft = demoEstateDraft();
  const redacted = JSON.stringify(redactDraftForLlm(draft));

  assert(
    bytes(redacted) <= PROMPT_DRAFT_BUDGET_BYTES,
    "the demo-estate fixture must itself be under budget, or this case proves nothing about an unshed forward",
  );

  const out = serialiseDraftForPrompt(draft);

  assert(out === redacted, "an under-budget draft must be forwarded byte-for-byte as redacted");
  assert(
    out.includes('"host":"phe.thinkiot.co.in"'),
    "the model still needs the connection config of an ordinary estate",
  );
  assert(
    !out.includes(PROMPT_OMITTED_MARKER),
    "nothing may be shed from a draft that fits the budget",
  );
}

/**
 * Stage 1 — the four free-form records go first, and everything the rulings
 * protect stays.
 *
 * The four are the draft's only `z.record(z.unknown())` fields
 * (`onboarding.schema.ts`), so they are the only ones holding data no code in
 * this repository can name: whatever a caller or the model wrote. Ruling 2 sheds
 * those before any code, name or protocol, and there is one assert per record
 * rather than one over all four — dropping `"meta"` from the shed's key set
 * leaves `config` shed and reddens exactly three, which is a different defect
 * from stage 1 not running at all.
 */
export function assertOverBudgetShedsTheFourRecordsFirst(): void {
  const draft = {
    location: { name: "Berhampur", code: "BERHAMPUR", meta: { blob: "L".repeat(1_000) } },
    rtus: [
      {
        code: "BERHAMPUR-RTU-1",
        displayName: "Berhampur RTU 1",
        protocol: "mqtt",
        config: { host: "phe.thinkiot.co.in", blob: "C".repeat(300_000) },
        meta: { blob: "R".repeat(1_000) },
      },
    ],
    assets: [{ rtuIndex: 0, code: "BERHAMPUR-ASSET-1", meta: { blob: "A".repeat(1_000) } }],
  };

  assert(
    bytes(JSON.stringify(redactDraftForLlm(draft))) > PROMPT_DRAFT_BUDGET_BYTES,
    "the fixture must start over budget, or nothing below is a claim about shedding",
  );

  const out = serialiseDraftForPrompt(draft);
  const shed = parse(out);

  assert(shed.rtus?.[0]?.config === PROMPT_OMITTED_MARKER, "rtus[].config must be shed");
  assert(shed.rtus?.[0]?.meta === PROMPT_OMITTED_MARKER, "rtus[].meta must be shed");
  assert(shed.assets?.[0]?.meta === PROMPT_OMITTED_MARKER, "assets[].meta must be shed");
  assert(shed.location?.meta === PROMPT_OMITTED_MARKER, "location.meta must be shed");

  assert(shed.rtus?.[0]?.code === "BERHAMPUR-RTU-1", "an RTU code is what the model reasons about");
  assert(shed.rtus?.[0]?.displayName === "Berhampur RTU 1", "and so is its name");
  assert(shed.rtus?.[0]?.protocol === "mqtt", "and its protocol");
  assert(shed.location?.name === "Berhampur", "and the location's name");

  assert(
    bytes(out) <= PROMPT_DRAFT_BUDGET_BYTES,
    "shedding the four records must bring this draft under the budget",
  );
}

/**
 * Stage 2 — a string longer than any code or name column, once stage 1 was not
 * enough.
 *
 * `pointKeys.description` is 2,000 characters wide and is the only column wider
 * than `PROMPT_STRING_MAX`. Decision 4 rules it opaque operator prose rather
 * than a code, a name or a protocol, so it is what stage 2 takes. 200 of them is
 * not producer-reachable in one turn and does not need to be: the fixture's job
 * is to be over budget with nothing left in the four records.
 */
export function assertOverBudgetThenShedsOverLongStrings(): void {
  const draft = {
    location: { name: "Berhampur", code: "BERHAMPUR" },
    pointKeys: Array.from({ length: 200 }, (_, k) => ({
      code: `electrical.feeder.metric.${k}`,
      name: `Feeder metric ${k}`,
      description: "D".repeat(ONBOARDING_DRAFT_STRING_MAX["pointKeys.description"]),
    })),
  };

  assert(
    bytes(JSON.stringify(redactDraftForLlm(draft))) > PROMPT_DRAFT_BUDGET_BYTES,
    "the fixture must start over budget with nothing in the four records, or stage 2 is never reached",
  );

  const out = serialiseDraftForPrompt(draft);
  const shed = parse(out);
  const keys = shed.pointKeys ?? [];

  assert(keys.length === 200, "no point key may be dropped — shedding replaces values, never items");
  assert(
    keys.filter((key) => key.description === PROMPT_OMITTED_MARKER).length === 200,
    "every description longer than the widest name column must be shed",
  );
  assert(keys[0]?.code === "electrical.feeder.metric.0", "a point key's code is vocabulary and stays");
  assert(keys[0]?.name === "Feeder metric 0", "and so is its name");
  assert(
    bytes(out) <= PROMPT_DRAFT_BUDGET_BYTES,
    "shedding the over-long strings must bring this draft under the budget",
  );
}

/**
 * `PROMPT_STRING_MAX` is the widest code/name column, pinned rather than derived.
 *
 * Derived by filtering `ONBOARDING_DRAFT_STRING_MAX` it would silently follow
 * that record — a column widened to 4,000 characters would raise the prompt's
 * threshold to 4,000 and stage 2 would stop shedding, with nothing red. Pinned,
 * the same edit reddens here and the widening is a decision someone makes.
 *
 * Three claims, because 255 is three things at once: an upper bound on every
 * other column, a width that actually exists (not a round number chosen above
 * them), and strictly below `pointKeys.description`, which is what leaves stage
 * 2 something to shed.
 */
export function assertPromptStringMaxIsTheWidestNameColumn(): void {
  const widths = Object.entries(ONBOARDING_DRAFT_STRING_MAX);

  assert(widths.length >= 20, "the column record is far smaller than it was — this scan is broken");

  for (const [field, width] of widths) {
    if (field === "pointKeys.description") {
      continue;
    }
    assert(
      width <= PROMPT_STRING_MAX,
      `every code and name column must fit under the prompt's string bound, and ${field} does not`,
    );
  }

  assert(
    widths.some(([, width]) => width === PROMPT_STRING_MAX),
    "PROMPT_STRING_MAX must be a column width the draft actually has, not a round number above all of them",
  );
  assert(
    ONBOARDING_DRAFT_STRING_MAX["pointKeys.description"] > PROMPT_STRING_MAX,
    "pointKeys.description must be wider than the bound, or stage 2 has nothing to shed",
  );
}

/**
 * A stored draft nested 20,000 deep is **shed**, not thrown out of.
 *
 * This is the case the row exists for as much as the size is. `F4.115` proved a
 * draft nested a couple of thousand deep is accepted, stored and still readable
 * by design — `getSession` never parses it and `redactDraftForClient` walks it
 * iteratively. But `JSON.stringify` is recursive, so measuring a budget on such
 * a draft throws a `RangeError` inside the `try` at `onboarding-chat.service.ts`
 * and the bare `catch {}` swallows it: the turn degrades to rule-based with no
 * log line. **The ruler cannot be applied before the depth is shed**, which is
 * why `serialiseDraftForPrompt` checks depth before its first `stringify`.
 *
 * **Every message here is a string literal.** Interpolating any part of the
 * value calls `JSON.stringify` from inside the assert and reports the fixture's
 * `RangeError` in place of the defect.
 */
export function assertADeepStoredDraftIsShedNotThrownOutOf(): void {
  const draft = {
    location: { name: "Berhampur", code: "BERHAMPUR" },
    rtus: [
      {
        code: "BERHAMPUR-RTU-1",
        displayName: "Berhampur RTU 1",
        protocol: "mqtt",
        config: chain(DEEP, "leaf"),
      },
    ],
  };

  const out = serialiseDraftForPrompt(draft);
  const shed = parse(out);

  assert(
    shed.rtus?.[0]?.config === PROMPT_OMITTED_MARKER,
    "a config nested past the draft's depth bound must be shed before anything measures it",
  );
  assert(shed.location?.name === "Berhampur", "and the rest of the draft must survive intact");
  assert(shed.rtus?.[0]?.code === "BERHAMPUR-RTU-1", "including the RTU's own code");
}

/**
 * The **second** shed pass is iterative too, and it needs its own case.
 *
 * The deep-draft assertion above never reaches stage 2: stage 1 replaces the
 * whole `config` by key, so the depth is gone before any string is looked at. A
 * recursive rewrite of `shedOverLongStrings` alone would leave that case green
 * and would still `RangeError` on a draft whose depth sits under a key stage 1
 * does not shed — `pointKeys`, `assets`, `assetPoints` — which is reachable
 * because nothing in the schema bounds nesting inside those arrays' items.
 *
 * Messages are string literals here for the same reason as above.
 */
export function assertShedOverLongStringsIsIterative(): void {
  const deep = chain(DEEP, "S".repeat(300));

  const shed = shedOverLongStrings(deep);

  assert(
    leafOf(shed) === PROMPT_OMITTED_MARKER,
    "the bottom of a 20,000-deep chain must be reached and shed, so the walk was iterative",
  );
}

/**
 * The **first** shed pass is iterative, and it needs its own case as well.
 *
 * Measured, and it corrects the plan this row was built from: that document's
 * mutation table says a recursive rewrite of *either* shed pass reddens
 * `assertADeepStoredDraftIsShedNotThrownOutOf`. It does not. A recursive stage 1
 * passes every other assertion in this file, because its own fixture's depth
 * sits under a `config` key — which stage 1 replaces without descending, so the
 * recursion is never entered. The pass that removes the depth is the one whose
 * walk that fixture cannot exercise.
 *
 * A chain keyed on anything else is what exercises it. Depth under a key that is
 * neither `config` nor `meta` is not reachable through a schema-parsing producer
 * today — `onboarding.schema.ts` enumerates all five draft write sites and the
 * four records are the only free-form ones — so this is a bound on the walk
 * rather than a reproduction of a live defect. `F4.115` is the reason it is
 * pinned anyway: a stored draft is whatever `JSON.parse` accepted, the depth
 * pre-check hands the whole draft to this pass, and a `RangeError` here is
 * swallowed by the bare `catch {}` at `onboarding-chat.service.ts` exactly as it
 * would be in the serialiser.
 *
 * Messages are string literals, for the reason above.
 */
export function assertShedFreeFormRecordsIsIterative(): void {
  const deep = chain(DEEP, "leaf");

  const shed = shedFreeFormRecords(deep);

  assert(
    leafOf(shed) === "leaf",
    "the bottom of a 20,000-deep chain must be reached and rebuilt, so the walk was iterative",
  );
}

/**
 * §4.3 — the marker says that something was withheld and nothing about what.
 *
 * Two pairs, because the two stages could echo differently and only one of them
 * *can* echo a size. Stage 1's key visitor never reads the value it replaces, so
 * the only thing it could leak is the key name; stage 2's leaf visitor is handed
 * the value, so it could leak its length or its first characters.
 *
 * Both drafts in each pair are over budget on their own, which is what makes
 * "identical output" a claim about the marker rather than about one of them
 * being forwarded whole.
 */
export function assertTheMarkerEchoesNothing(): void {
  assert(
    PROMPT_OMITTED_MARKER === "[omitted: over prompt budget]",
    "the marker is a fixed literal: no key, no size, no fragment of the value it replaced",
  );

  const withRecord = (blob: string): unknown => ({
    location: { name: "Berhampur", code: "BERHAMPUR", meta: { blob } },
  });
  const recordA = serialiseDraftForPrompt(withRecord("A".repeat(300_000)));
  const recordB = serialiseDraftForPrompt(withRecord("B".repeat(600_000)));

  assert(
    recordA === recordB,
    "two drafts differing only in a shed record's content and size must forward identical bytes",
  );
  assert(!recordA.includes("AAAA") && !recordA.includes("BBBB"), "no fragment of either value survives");
  assert(recordA.includes(PROMPT_OMITTED_MARKER), "and the marker is what stands in their place");

  const withString = (blob: string): unknown => ({
    location: { name: "Berhampur", code: "BERHAMPUR" },
    pointKeys: [{ code: "electrical.feeder.metric.0", name: "Feeder metric 0", description: blob }],
  });
  const stringA = serialiseDraftForPrompt(withString("A".repeat(300_000)));
  const stringB = serialiseDraftForPrompt(withString("B".repeat(600_000)));

  assert(
    stringA === stringB,
    "two drafts differing only in a shed string's content and size must forward identical bytes",
  );
  assert(!stringA.includes("AAAA") && !stringA.includes("BBBB"), "no fragment of either string survives");
  assert(stringA.includes(PROMPT_OMITTED_MARKER), "and the marker is what stands in their place");
}

/**
 * The budget is bytes, the string bound is UTF-16 code units, and the comparison
 * is `<=`.
 *
 * The mixture is deliberate and each half is measured where it is spent: the
 * prompt costs bytes on the wire, and `PROMPT_STRING_MAX` is a column width, so
 * it counts what `.max()` counts (`F4.104`). A draft padded with `é` is where
 * the two disagree — `.length` under the bound while the bytes are over — and a
 * budget measured in `.length` forwards it unshed.
 *
 * The self-check runs first. Padded to any other size the two asserts after it
 * are vacuous: a fixture under the bound passes the `<=` case for the wrong
 * reason, and one over it fails for the wrong reason.
 */
export function assertTheBudgetIsMeasuredInBytesAtTheBound(): void {
  const padded = (pad: string): unknown => ({
    location: { name: "Berhampur", code: "BERHAMPUR", meta: { pad } },
  });
  const emptyBytes = bytes(JSON.stringify(redactDraftForLlm(padded(""))));

  const atBound = padded("x".repeat(PROMPT_DRAFT_BUDGET_BYTES - emptyBytes));
  assert(
    bytes(JSON.stringify(redactDraftForLlm(atBound))) === PROMPT_DRAFT_BUDGET_BYTES,
    "the at-bound fixture must serialise to exactly the budget, or the two cases below prove nothing",
  );
  assert(
    parse(serialiseDraftForPrompt(atBound)).location?.meta !== PROMPT_OMITTED_MARKER,
    "a draft exactly at the budget is under it — the comparison is <=, not <",
  );

  const overByOne = padded("x".repeat(PROMPT_DRAFT_BUDGET_BYTES - emptyBytes + 1));
  assert(
    parse(serialiseDraftForPrompt(overByOne)).location?.meta === PROMPT_OMITTED_MARKER,
    "one byte over the budget must shed",
  );

  // `é` is one UTF-16 code unit and two UTF-8 bytes, so this pads to just under
  // the bound by `.length` and just over it by `Buffer.byteLength`.
  const accents = Math.ceil((PROMPT_DRAFT_BUDGET_BYTES - emptyBytes + 2) / 2);
  const wide = padded("é".repeat(accents));
  const wideJson = JSON.stringify(redactDraftForLlm(wide));
  assert(
    wideJson.length < PROMPT_DRAFT_BUDGET_BYTES && bytes(wideJson) > PROMPT_DRAFT_BUDGET_BYTES,
    "the accented fixture must be under the bound by code units and over it by bytes, or it tests nothing",
  );
  assert(
    parse(serialiseDraftForPrompt(wide)).location?.meta === PROMPT_OMITTED_MARKER,
    "a draft over the budget in bytes must shed even when its .length is under it",
  );
}

/**
 * Decision 1, option (a) — what is left after both stages is returned as it is.
 *
 * The rulings shed no code, no name and no protocol, so a draft made only of
 * those can stand above the budget with nothing left to take. **The budget is a
 * shedding threshold, not a hard limit**, and this is the assertion that says
 * so: the function returns valid, untruncated JSON that is still over budget
 * rather than throwing, cutting or dropping items. The two declined
 * alternatives — returning `null` to force the rule-based branch, and a third
 * stage shedding array items — are recorded in the module's docblock.
 *
 * The `> PROMPT_DRAFT_BUDGET_BYTES` assert is what stops the case going vacuous
 * if the fixture ever shrinks under the budget.
 */
export function assertAResidualOverBudgetPayloadIsValidJson(): void {
  const wide = (width: number, index: number): string =>
    `${"P".repeat(width - String(index).length - 1)}-${index}`;
  const draft = {
    location: { name: "Berhampur", code: "BERHAMPUR" },
    assetPoints: Array.from({ length: 700 }, (_, i) => ({
      assetIndex: i % 500,
      pointKey: wide(ONBOARDING_DRAFT_STRING_MAX["assetPoints.pointKey"], i),
      sourceDataKey: wide(ONBOARDING_DRAFT_STRING_MAX["assetPoints.sourceDataKey"], i),
      sensorCode: wide(ONBOARDING_DRAFT_STRING_MAX["assetPoints.sensorCode"], i),
      unit: wide(ONBOARDING_DRAFT_STRING_MAX["assetPoints.unit"], i),
    })),
  };

  const out = serialiseDraftForPrompt(draft);
  const shed = parse(out);

  assert(shed.assetPoints?.length === 700, "no mapping may be dropped to reach the budget");
  assert(shed.location?.name === "Berhampur", "and the draft around them is intact");
  assert(!out.includes(PROMPT_OMITTED_MARKER), "nothing here is shedable — every field is a code");
  assert(
    bytes(out) > PROMPT_DRAFT_BUDGET_BYTES,
    "the residual must really be over budget, or this case is about an ordinary draft",
  );
}

/** The sentence the prompt owes the model once a value can be a marker (decision 6). */
export const PROMPT_MARKER_SENTENCE = `A value shown as ${PROMPT_OMITTED_MARKER} was withheld; do not copy it into draftPatch.`;

/**
 * The measurement on what the OpenAI call is actually handed.
 *
 * Everything above measures the function. This measures the **forward**: the
 * `openai` client is mocked in the `.test.ts` wrapper (the repo's first
 * `vi.mock`, decision 5) and hands back the request object `create()` received,
 * so the assertion is on the bytes that would leave the process rather than on
 * a function that feeds them.
 *
 * **`requests.length === 1` comes first and it is not a formality.** The bare
 * `catch {}` around `handleOpenAiTurn` turns any wrong mock shape into a green
 * rule-based answer, so without this assert every claim below could be measuring
 * a branch that never ran.
 *
 * Three things the call has to line up, each of which silently sends the turn
 * somewhere else: `OPENAI_API_KEY` set for the call and restored after (the
 * inverse of the rule-based helper in `onboarding-chat.service.spec.ts`), no
 * `organizationId`, and a message matching neither of the two protocol regexes,
 * or `protocolService` answers before the OpenAI branch is reached.
 */
export async function assertOpenAiTurnForwardsABoundedPrompt(requests: unknown[]): Promise<void> {
  const draft = {
    location: {
      name: "Berhampur",
      code: "BERHAMPUR",
      slug: "berhampur",
      type: "smoc_campus" as const,
      latitude: 22.3159,
      longitude: 87.3222,
      meta: { blob: "B".repeat(300_000) },
    },
    rtus: [
      {
        code: "BERHAMPUR-RTU-1",
        displayName: "Berhampur RTU 1",
        protocol: "mqtt" as const,
        config: { host: "phe.thinkiot.co.in", port: 8883 },
      },
    ],
  } satisfies OnboardingDraft;

  requests.length = 0;
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "not-a-real-key";
  try {
    const service = new OnboardingChatService(
      new OnboardingValidateService(),
      {} as never,
      {} as never,
      {} as never,
    );
    await service.handleTurn("Tell me about the site", draft, "location", "Ion Exchange");
  } finally {
    if (savedKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedKey;
    }
  }

  assert(
    requests.length === 1,
    "the OpenAI branch must have run — the catch around it turns a wrong mock into a green rule-based answer",
  );

  const request = requests[0] as { messages?: { role?: string; content?: string }[] };
  const system = request.messages?.[0]?.content ?? "";
  const prefix = "Draft context (redacted): ";
  const at = system.indexOf(prefix);

  assert(at >= 0, "the system prompt must still carry the draft context");
  assert(
    system.includes(PROMPT_MARKER_SENTENCE),
    "the prompt must tell the model what a marker means, or a model echoing one drops the whole turn",
  );

  const forwarded = system.slice(at + prefix.length);
  const shed = parse(forwarded);

  assert(shed.location?.meta === PROMPT_OMITTED_MARKER, "the forwarded draft's record must be shed");
  assert(shed.location?.name === "Berhampur", "and its name must survive");
  assert(
    bytes(forwarded) <= PROMPT_DRAFT_BUDGET_BYTES,
    "the JSON embedded in the prompt must be within the budget",
  );
}
