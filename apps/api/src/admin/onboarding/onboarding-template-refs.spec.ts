/**
 * `F3.22` (ADR 0091 decisions 2 and 6) — the pure read seam the validator, the
 * template tools and the commit share: what a draft entry or an organization
 * version looks like as a {@link TemplateRef}, which one an asset's `template`
 * names, the variables a template asks for, and the token grammar.
 */
import type { OnboardingDraft } from "@bms/shared";

import { quoteCell } from "../spreadsheet-guard";
import {
  draftTemplateRef,
  heldVersions,
  patternGrammarProblem,
  resolveTemplateForAsset,
  templateVariables,
  type TemplateRef,
  type ValidateTemplateContext,
} from "./onboarding-template-refs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** One organization template version; `points` only for a published one, as the catalog reads them. */
function orgVersion(code: string, version: number, status: TemplateRef["status"], pattern: string | null): TemplateRef {
  return {
    code,
    version,
    name: code,
    domain: "electrical",
    status,
    points:
      status === "published"
        ? [{ pointKey: `kw_v${version}`, kind: "measured", required: true, sourceDataKeyPattern: pattern }]
        : [],
    alarmCount: 0,
    dashboardCount: 0,
    dashboardWidgetCount: 0,
  };
}

const STOCK_WTP: TemplateRef = {
  code: "WTP",
  version: null,
  name: "Water treatment plant",
  domain: "water",
  status: null,
  points: [
    { pointKey: "ph", kind: "measured", required: true, sourceDataKeyPattern: null },
    { pointKey: "turbidity", kind: "measured", required: false, sourceDataKeyPattern: null },
    { pointKey: "score", kind: "derived", required: true, sourceDataKeyPattern: null },
  ],
  alarmCount: 2,
  dashboardCount: 1,
  dashboardWidgetCount: 3,
};

const CONTEXT: ValidateTemplateContext = {
  organization: [
    orgVersion("ORG-T", 1, "published", "{asset_code}_{feeder}_KW"),
    orgVersion("ORG-T", 2, "published", "{asset_code}_KW"),
    orgVersion("ORG-T", 3, "draft", null),
    orgVersion("OLD", 4, "archived", null),
  ],
  stock: [STOCK_WTP],
};

/** R1 — an authored entry's points default to `required: true`, `kind: "measured"`, an empty pattern to none. */
export function assertAnAuthoredEntryTakesTheCommitDefaults(): void {
  const ref = draftTemplateRef(
    {
      code: "PUMP",
      name: "Pump",
      domain: "water",
      points: [
        { pointKey: "flow", sourceDataKeyPattern: "{site}_FLOW" },
        { pointKey: "head", sourceDataKeyPattern: "", required: false },
      ],
    },
    CONTEXT,
  );
  assert(ref !== null, "an authored entry always yields a ref");
  const points = ref!.points;
  assert(
    JSON.stringify(points) ===
      JSON.stringify([
        { pointKey: "flow", kind: "measured", required: true, sourceDataKeyPattern: "{site}_FLOW" },
        { pointKey: "head", kind: "measured", required: false, sourceDataKeyPattern: null },
      ]),
    `the authored points take the commit's defaults, got ${JSON.stringify(points)}`,
  );
}

/** R2 — a stock entry is the catalog's points with `patterns` laid over the measured ones only. */
export function assertAStockEntryOverlaysItsPatterns(): void {
  const ref = draftTemplateRef({ stockCode: "WTP", patterns: { ph: "{asset_code}_PH", score: "X" } }, CONTEXT);
  assert(ref !== null && ref.code === "WTP" && ref.domain === "water", `the stock entry resolves, got ${JSON.stringify(ref)}`);
  const patterns = ref!.points.map((point) => point.sourceDataKeyPattern);
  assert(
    JSON.stringify(patterns) === JSON.stringify(["{asset_code}_PH", null, null]),
    `only the measured point named in patterns takes one, got ${JSON.stringify(patterns)}`,
  );
  assert(STOCK_WTP.points[0].sourceDataKeyPattern === null, "the catalog's own ref is not mutated");
}

/** R3 — a stock code the catalog does not ship yields no ref. */
export function assertAnUnknownStockCodeYieldsNoRef(): void {
  assert(draftTemplateRef({ stockCode: "NOPE" }, CONTEXT) === null, "an unknown stock code has no ref");
}

function draftWith(templates: OnboardingDraft["templates"]): OnboardingDraft {
  return { templates };
}

/** R4 — the draft entry wins over an organization version with the same code (decision 6 order). */
export function assertTheDraftEntryResolvesFirst(): void {
  const draft = draftWith([{ code: "ORG-T", name: "Local", domain: "water", points: [] }]);
  const resolved = resolveTemplateForAsset(draft, { code: "ORG-T" }, CONTEXT);
  assert("ref" in resolved && resolved.source === "draft", `the draft entry resolves, got ${JSON.stringify(resolved)}`);
}

/** F4.193 — a draft entry named at a version other than 1 is a problem: the commit publishes it as version 1. */
export function assertADraftEntryAtAnotherVersionIsAProblem(): void {
  const draft = draftWith([{ code: "LOCAL", name: "Local", domain: "water", points: [] }]);
  const resolved = resolveTemplateForAsset(draft, { code: "LOCAL", version: 2 }, CONTEXT);
  const expected = `Template ${quoteCell("LOCAL")} is in this draft and publishes as version 1, not 2`;
  assert(
    "problem" in resolved && resolved.problem === expected && resolved.field === "version",
    `expected "${expected}" at version, got ${JSON.stringify(resolved)}`,
  );
}

/** F4.193 — a draft entry named at version 1, the version the commit publishes, resolves. */
export function assertADraftEntryAtVersionOneResolves(): void {
  const draft = draftWith([{ code: "LOCAL", name: "Local", domain: "water", points: [] }]);
  const resolved = resolveTemplateForAsset(draft, { code: "LOCAL", version: 1 }, CONTEXT);
  assert("ref" in resolved && resolved.source === "draft", `version 1 resolves to the draft entry, got ${JSON.stringify(resolved)}`);
}

/** R5 — with no version, the highest **published** version resolves; a later draft version does not. */
export function assertTheHighestPublishedVersionResolves(): void {
  const resolved = resolveTemplateForAsset({}, { code: "ORG-T" }, CONTEXT);
  assert(
    "ref" in resolved && resolved.source === "organization" && resolved.ref.version === 2,
    `version 2 (published) resolves, not 3 (draft), got ${JSON.stringify(resolved)}`,
  );
}

/** R6 — a named published version resolves to that version. */
export function assertANamedPublishedVersionResolves(): void {
  const resolved = resolveTemplateForAsset({}, { code: "ORG-T", version: 1 }, CONTEXT);
  assert("ref" in resolved && resolved.ref.version === 1, `version 1 resolves, got ${JSON.stringify(resolved)}`);
}

/** R7 — a named version that is not published is a problem naming the code and the version. */
export function assertANamedUnpublishedVersionIsAProblem(): void {
  const resolved = resolveTemplateForAsset({}, { code: "ORG-T", version: 3 }, CONTEXT);
  const expected = `Template ${quoteCell("ORG-T")} has no published version 3`;
  assert(
    "problem" in resolved && resolved.problem === expected,
    `expected "${expected}", got ${JSON.stringify(resolved)}`,
  );
}

/** R8 — a code in neither the draft nor the organization's published versions is a problem. */
export function assertAnUnknownCodeIsAProblem(): void {
  const resolved = resolveTemplateForAsset({}, { code: "OLD" }, CONTEXT);
  const expected = `Template ${quoteCell("OLD")} is not in this draft and has no published version in this organization`;
  assert(
    "problem" in resolved && resolved.problem === expected,
    `an archived-only code does not resolve; expected "${expected}", got ${JSON.stringify(resolved)}`,
  );
}

/** R9 — the variables are the measured patterns' tokens minus `asset_code`, in first-appearance order. */
export function assertTemplateVariablesSkipTheReservedOneAndDerivedPoints(): void {
  const ref: TemplateRef = {
    ...STOCK_WTP,
    points: [
      { pointKey: "a", kind: "measured", required: true, sourceDataKeyPattern: "{asset_code}_{feeder}_{phase}" },
      { pointKey: "b", kind: "measured", required: false, sourceDataKeyPattern: "{phase}_{bus}" },
      { pointKey: "c", kind: "derived", required: true, sourceDataKeyPattern: "{derived_only}" },
    ],
  };
  const variables = templateVariables(ref);
  assert(
    JSON.stringify(variables) === JSON.stringify(["feeder", "phase", "bus"]),
    `expected feeder, phase, bus, got ${JSON.stringify(variables)}`,
  );
}

/** R10 — a brace outside a `{token}` is a grammar problem; a well-formed pattern is none. */
export function assertPatternGrammarRefusesAStrayBrace(): void {
  assert(patternGrammarProblem("CH{unit}_{asset_code}_FLOW") === null, "a well-formed pattern has no problem");
  assert(patternGrammarProblem("PLAIN_KEY") === null, "a pattern with no token has no problem");
  for (const bad of ["CH{unit_FLOW", "CH}unit{", "CH{unit-1}", "{}"]) {
    const problem = patternGrammarProblem(bad);
    assert(problem !== null && problem.includes(quoteCell(bad)), `"${bad}" is refused naming it, got ${String(problem)}`);
  }
}

/** R11 — the held versions are every status, ascending; an unheld code holds none. */
export function assertHeldVersionsCountEveryStatus(): void {
  assert(JSON.stringify(heldVersions(CONTEXT, "ORG-T")) === "[1,2,3]", `got ${JSON.stringify(heldVersions(CONTEXT, "ORG-T"))}`);
  assert(JSON.stringify(heldVersions(CONTEXT, "OLD")) === "[4]", "an archived version is held");
  assert(heldVersions(CONTEXT, "NEW").length === 0, "an unheld code holds no version");
}
