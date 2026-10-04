/**
 * `F4.157` / ADR 0077 decision 7 — a draft may hold a location without a type
 * (owner ruling OQ2), and the validator is what keeps that draft from
 * committing and keeps the chat asking for the type.
 *
 * The draft schema cannot do either: `type` is `.optional()` there on purpose,
 * so the chat can store the name in one turn and the type in the next. The
 * cross-field error and the phase are the two places the absence is caught.
 */
import type { OnboardingDraft } from "@bms/shared";

import { MAX_ECHOED_ITEMS, moreTail, quoteCell } from "../spreadsheet-guard";
import { EMPTY_TEMPLATE_CONTEXT, type TemplateRef, type ValidateTemplateContext } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The four seeded active codes of `bms.location_types`, in `sort_order`.
 * `F4.162` (plan D9): the validator takes the active codes as a required
 * argument, so a type retired after it was stored is caught here too.
 */
const CODES: readonly string[] = ["smoc_campus", "rsmoc", "csmoc", "pump_station"];

/** A draft complete in every section, so the location type is the only gap. */
function completeDraft(type: string | undefined): OnboardingDraft {
  return {
    location: {
      name: "Lotapata",
      slug: "lotapata",
      code: "LOTAPATA",
      ...(type === undefined ? {} : { type }),
      latitude: 22.3,
      longitude: 87.3,
    },
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU 1",
        protocol: "modbus_tcp",
        config: { host: "10.0.0.1", port: 502 },
        credentialsSet: false,
        ingestEnabled: false,
      },
    ],
    pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
    assets: [
      { code: "LOTAPATA-ASSET-1", name: "Asset 1", siteName: "Lotapata", rtuIndex: 0, domain: "electrical" },
    ],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01" }],
  } as OnboardingDraft;
}

/** N1 — a location with no type is a `location.type` error, and the draft cannot commit. */
export function assertMissingLocationTypeIsAnError(): void {
  const result = new OnboardingValidateService().validate(completeDraft(undefined), CODES, EMPTY_TEMPLATE_CONTEXT);
  const paths = result.errors.map((error) => error.path);
  assert(
    paths.includes("location.type"),
    `a location with no type must carry an error at location.type, got ${JSON.stringify(paths)}`,
  );
  assert(result.readyToCommit === false, "a location with no type must never be ready to commit");
}

/**
 * The positive control for N1: the same draft with a type is clean, so the
 * error above comes from the missing type and not from some other gap in the
 * fixture.
 *
 * `F4.162` N5: this is also the positive control for N3 — the type is an
 * active code, so the draft is ready — and it is what reddens a caller that
 * hands the validator `[]` instead of the active codes.
 */
export function assertTypedLocationIsReadyToCommit(): void {
  const result = new OnboardingValidateService().validate(completeDraft("pump_station"), CODES, EMPTY_TEMPLATE_CONTEXT);
  assert(
    result.errors.length === 0,
    `the fixture with a type must be clean, got ${JSON.stringify(result.errors)}`,
  );
  assert(result.readyToCommit === true, "the fixture with a type must be ready to commit");
}

/** N2 — while the type is missing, the phase stays `location`, so the chat asks for it. */
export function assertMissingLocationTypeKeepsTheLocationPhase(): void {
  const phase = new OnboardingValidateService().inferPhase(completeDraft(undefined), CODES);
  assert(phase === "location", `a location with no type must stay in the location phase, got ${phase}`);
}

/** The positive control for N2: with a type, the same draft infers `review`. */
export function assertTypedLocationLeavesTheLocationPhase(): void {
  const phase = new OnboardingValidateService().inferPhase(completeDraft("pump_station"), CODES);
  assert(phase === "review", `the fixture with a type must reach review, got ${phase}`);
}

/**
 * N3 — a type that is set and not an active code is a `location.type` error
 * whose message names every active code, so the operator is told what to pick.
 * `F4.162` (plan D9, owner ruling OQ3): a type retired after it was stored.
 */
export function assertInactiveLocationTypeIsAnErrorNamingTheCodes(): void {
  const result = new OnboardingValidateService().validate(completeDraft("space_port"), CODES, EMPTY_TEMPLATE_CONTEXT);
  const errors = result.errors.filter((error) => error.path === "location.type");
  assert(errors.length === 1, `an inactive type must carry one error at location.type, got ${JSON.stringify(result.errors)}`);
  for (const code of CODES) {
    assert(errors[0].message.includes(code), `the message must name ${code}, got "${errors[0].message}"`);
  }
}

/**
 * N3 — the message never echoes the stored value. It is operator text from a
 * workbook cell or a `PATCH` body; the codes are what the operator can use.
 */
export function assertInactiveLocationTypeMessageDoesNotEchoTheValue(): void {
  const result = new OnboardingValidateService().validate(completeDraft("space_port"), CODES, EMPTY_TEMPLATE_CONTEXT);
  const error = result.errors.find((candidate) => candidate.path === "location.type");
  const message = error?.message ?? "";
  assert(error !== undefined, `the positive half: an error at location.type exists, got ${JSON.stringify(result.errors)}`);
  assert(!message.includes("space_port"), `the message must not echo the stored value, got "${message}"`);
}

/**
 * N3 — the draft is not ready to commit. Two guards hold this claim: the
 * `location.type` error and the location phase (N4). Only both removed
 * redden it.
 */
export function assertInactiveLocationTypeIsNotReadyToCommit(): void {
  const result = new OnboardingValidateService().validate(completeDraft("space_port"), CODES, EMPTY_TEMPLATE_CONTEXT);
  assert(result.readyToCommit === false, "a draft whose type is not active must never be ready to commit");
}

/** N4 — an inactive type keeps the phase at `location`, so the chat asks for the type again. */
export function assertInactiveLocationTypeKeepsTheLocationPhase(): void {
  const phase = new OnboardingValidateService().inferPhase(completeDraft("space_port"), CODES);
  assert(phase === "location", `an inactive type must stay in the location phase, got ${phase}`);
}

/**
 * More active codes than the echo cap: `MAX_ECHOED_ITEMS + 5`, zero-padded so
 * no code is a substring of another (`lt_1` would match inside `lt_10`).
 */
const MANY_CODES: readonly string[] = Array.from(
  { length: MAX_ECHOED_ITEMS + 5 },
  (_, i) => `lt_${String(i + 1).padStart(2, "0")}`,
);

function inactiveTypeMessage(codes: readonly string[]): string {
  const result = new OnboardingValidateService().validate(completeDraft("space_port"), codes, EMPTY_TEMPLATE_CONTEXT);
  const error = result.errors.find((candidate) => candidate.path === "location.type");
  assert(error !== undefined, `an error at location.type exists, got ${JSON.stringify(result.errors)}`);
  return error!.message;
}

/**
 * N5 — security review L2: the message names at most `MAX_ECHOED_ITEMS` codes.
 * Mutation: join every code without `echoedItems`.
 */
export function assertInactiveLocationTypeMessageNamesAtMostTheCap(): void {
  const message = inactiveTypeMessage(MANY_CODES);
  const named = message.match(/lt_\d{2}/g) ?? [];
  assert(
    named.length === MAX_ECHOED_ITEMS,
    `the message must name ${MAX_ECHOED_ITEMS} codes, named ${named.length}: "${message}"`,
  );
}

/** N5 — the cut list ends with the "more" tail counting the omitted codes. */
export function assertInactiveLocationTypeMessageCarriesTheMoreTail(): void {
  const message = inactiveTypeMessage(MANY_CODES);
  assert(message.endsWith(moreTail(5)), `the message must end with "${moreTail(5)}", got "${message}"`);
}

/**
 * N6 — with no active code the message says so, and never ends on "use one
 * of: " with nothing after it. Mutation: drop the empty-list branch.
 */
export function assertNoActiveTypeMessageSaysNoneIsActive(): void {
  const message = inactiveTypeMessage([]);
  assert(
    message.endsWith("no location type is active"),
    `an empty active list must say no location type is active, got "${message}"`,
  );
}

/*
 * `F3.22` (ADR 0091 decisions 2, 6, 7 and 11) — the template rules, V1–V12.
 *
 * Every V fixture is {@link templatedDraft} with **one** rule broken, and each
 * asserts the whole error list, so removing a rule's branch reddens its own
 * `it()` and no other. `templatedDraft` itself is V12, the positive control: it
 * exercises every rule's passing branch — an authored template with a required
 * pattern and a variable, a stock entry whose `patterns` cover its required
 * point, an organization template, and a plain asset with its mapping.
 * Messages are rebuilt here from literals and `quoteCell`, so a reworded
 * message is a red test (F4.105).
 */

/** The catalog this fixture validates against: one organization template (v1 published, v2 draft) and one stock entry. */
const TEMPLATES: ValidateTemplateContext = {
  organization: [
    {
      code: "ORG-T",
      version: 1,
      name: "Feeder",
      domain: "electrical",
      status: "published",
      points: [{ pointKey: "kw", kind: "measured", required: true, sourceDataKeyPattern: "{asset_code}_KW" }],
      alarmCount: 0,
      dashboardWidgetCount: 0,
    },
    {
      code: "ORG-T",
      version: 2,
      name: "Feeder",
      domain: "electrical",
      status: "draft",
      points: [],
      alarmCount: 0,
      dashboardWidgetCount: 0,
    },
  ],
  stock: [
    {
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
      alarmCount: 0,
      dashboardWidgetCount: 0,
    },
  ],
};

/** V12's draft: ready to commit, with every kind of template and a plain asset. */
function templatedDraft(): OnboardingDraft {
  const base = completeDraft("pump_station");
  return {
    ...base,
    templates: [
      {
        code: "PUMP",
        name: "Pump",
        domain: "water",
        points: [{ pointKey: "flow", sourceDataKeyPattern: "{site}_{asset_code}_FLOW" }],
      },
      { stockCode: "WTP", patterns: { ph: "{asset_code}_PH" } },
    ],
    assets: [
      ...(base.assets ?? []),
      {
        code: "PUMP-1",
        name: "Pump 1",
        siteName: "Lotapata",
        rtuIndex: 0,
        domain: "water",
        template: { code: "PUMP", sourceDataKeyVars: { site: "S1" } },
      },
      { code: "WTP-1", name: "WTP 1", siteName: "Lotapata", rtuIndex: 0, domain: "water", template: { code: "WTP" } },
      {
        code: "ORG-1",
        name: "Feeder 1",
        siteName: "Lotapata",
        rtuIndex: 0,
        domain: "electrical",
        template: { code: "ORG-T" },
      },
    ],
  };
}

type Breaker = (draft: OnboardingDraft) => void;

function templateErrors(breaker: Breaker, context: ValidateTemplateContext = TEMPLATES): string {
  const draft = templatedDraft();
  breaker(draft);
  return JSON.stringify(new OnboardingValidateService().validate(draft, CODES, context).errors);
}

function assertOnly(breaker: Breaker, path: string, message: string, context?: ValidateTemplateContext): void {
  const got = templateErrors(breaker, context);
  const expected = JSON.stringify([{ path, message }]);
  assert(got === expected, `expected exactly ${expected}, got ${got}`);
}

/** The asset at `index` of the fixture, which always has one. */
function assetAt(draft: OnboardingDraft, index: number): NonNullable<OnboardingDraft["assets"]>[number] {
  return draft.assets![index];
}

const q = quoteCell;

/** V1 — a code in neither the draft nor the organization's published versions. */
export function assertV1AnUnresolvedTemplateCodeIsAnError(): void {
  assertOnly(
    (d) => {
      assetAt(d, 3).template = { code: "NOPE" };
    },
    "assets.3.template.code",
    `Template ${q("NOPE")} is not in this draft and has no published version in this organization`,
  );
}

/** V2 — a named version that exists and is not published. */
export function assertV2AnUnpublishedVersionIsAnError(): void {
  assertOnly(
    (d) => {
      assetAt(d, 3).template = { code: "ORG-T", version: 2 };
    },
    "assets.3.template.version",
    `Template ${q("ORG-T")} has no published version 2`,
  );
}

/** V3 — the asset's domain differs from its template's. */
export function assertV3ADomainMismatchIsAnError(): void {
  assertOnly(
    (d) => {
      assetAt(d, 1).domain = "electrical";
    },
    "assets.1.domain",
    `Template ${q("PUMP")} is in domain ${q("water")}; an asset built from it must be in the same domain`,
  );
}

/** V4 — a mapping onto a templated asset. */
export function assertV4AMappingOntoATemplatedAssetIsAnError(): void {
  assertOnly(
    (d) => {
      d.assetPoints!.push({ assetIndex: 1, pointKey: "kw", sourceDataKey: "s02" });
    },
    "assetPoints.1.assetIndex",
    `Asset ${q("PUMP-1")} is built from a template; its points come from the template, so map no point to it`,
  );
}

/** V5 — a required measured point with no pattern (the stock entry's `patterns` no longer cover `ph`). */
export function assertV5ARequiredPointWithNoPatternIsAnError(): void {
  assertOnly(
    (d) => {
      d.templates![1] = { stockCode: "WTP", patterns: {} };
    },
    "assets.2.template",
    `Template ${q("WTP")} has no source-key pattern for its required point ${q("ph")}; ` +
      "give that point a pattern before this asset can be built",
  );
}

/** V6 — a required pattern whose variable the asset does not supply. */
export function assertV6AnUnresolvedVariableIsAnError(): void {
  assertOnly(
    (d) => {
      assetAt(d, 1).template = { code: "PUMP", sourceDataKeyVars: {} };
    },
    "assets.1.template.sourceDataKeyVars",
    `Template ${q("PUMP")} needs the variable ${q("site")} for its required point ${q("flow")}`,
  );
}

/** V7 — a variable the template does not ask for. */
export function assertV7AnUnknownVariableIsAnError(): void {
  assertOnly(
    (d) => {
      assetAt(d, 1).template = { code: "PUMP", sourceDataKeyVars: { site: "S1", bus: "B2" } };
    },
    "assets.1.template.sourceDataKeyVars",
    `${q("bus")} is not a variable of template ${q("PUMP")}; its variables are: site`,
  );
}

/** V8 — two draft templates with one code. */
export function assertV8ADuplicateTemplateCodeIsAnError(): void {
  assertOnly(
    (d) => {
      d.templates!.push({ code: "PUMP", name: "Pump again", domain: "water", points: [] });
    },
    "templates.2.code",
    `Template ${q("PUMP")} appears more than once in this draft`,
  );
}

/** V8 — one authored template declaring a point key twice. */
export function assertV8ADuplicatePointKeyIsAnError(): void {
  assertOnly(
    (d) => {
      d.templates![0] = {
        code: "PUMP",
        name: "Pump",
        domain: "water",
        points: [
          { pointKey: "flow", sourceDataKeyPattern: "{site}_{asset_code}_FLOW" },
          { pointKey: "flow", required: false },
        ],
      };
    },
    "templates.0.points.1.pointKey",
    `Point ${q("flow")} appears more than once in template ${q("PUMP")}`,
  );
}

/** V9 — a stock code this release does not ship (on an entry no asset uses, so V1 stays quiet). */
export function assertV9AnUnknownStockCodeIsAnError(): void {
  assertOnly(
    (d) => {
      d.templates!.push({ stockCode: "NOPE" });
    },
    "templates.2.stockCode",
    `${q("NOPE")} is not a stock template this release ships`,
  );
}

/** V9 — a `patterns` key that is not a measured point of the stock entry (`score` is derived). */
export function assertV9APatternOnANonMeasuredPointIsAnError(): void {
  assertOnly(
    (d) => {
      d.templates![1] = { stockCode: "WTP", patterns: { ph: "{asset_code}_PH", score: "SCORE" } };
    },
    "templates.1.patterns.score",
    `${q("score")} is not a measured point of stock template ${q("WTP")}`,
  );
}

/** V10 — a draft template code the organization already holds, in any status (decision 6). */
export function assertV10AHeldCodeIsAnErrorNamingTheVersions(): void {
  const held: TemplateRef = { ...TEMPLATES.organization[1], code: "PUMP", version: 3, status: "archived" };
  assertOnly(
    () => undefined,
    "templates.0.code",
    `This organization already holds template ${q("PUMP")} (versions: 3); choose another code`,
    { ...TEMPLATES, organization: [...TEMPLATES.organization, held] },
  );
}

/** V10 — the same rule on a stock entry, at its `stockCode`. */
export function assertV10AHeldStockCodeIsAnError(): void {
  const held: TemplateRef = { ...TEMPLATES.organization[1], code: "WTP", version: 1, status: "published" };
  assertOnly(
    () => undefined,
    "templates.1.stockCode",
    `This organization already holds template ${q("WTP")} (versions: 1); choose another code`,
    { ...TEMPLATES, organization: [...TEMPLATES.organization, held] },
  );
}

/** V11 — a draft whose assets are all templated reaches `review` with no mappings. */
export function assertV11AnAllTemplatedDraftNeedsNoMappings(): void {
  const draft = templatedDraft();
  draft.assets = draft.assets!.slice(1);
  draft.assetPoints = [];
  const phase = new OnboardingValidateService().inferPhase(draft, CODES);
  assert(phase === "review", `an all-templated draft reaches review, got ${phase}`);
}

/** V11 — a mixed draft still needs a mapping for its plain asset. */
export function assertV11AMixedDraftStillNeedsMappings(): void {
  const draft = templatedDraft();
  draft.assetPoints = [];
  const phase = new OnboardingValidateService().inferPhase(draft, CODES);
  assert(phase === "mappings", `a draft with a plain asset and no mapping stays in mappings, got ${phase}`);
}

/** V12 — the positive control: the fixture is clean and ready to commit. */
export function assertV12ATemplatedDraftIsReadyToCommit(): void {
  const result = new OnboardingValidateService().validate(templatedDraft(), CODES, TEMPLATES);
  assert(result.errors.length === 0, `the fixture is clean, got ${JSON.stringify(result.errors)}`);
  assert(result.readyToCommit === true, `the fixture is ready to commit, got phase ${result.suggestedPhase}`);
}

/** Decision 11 — a template no asset uses is valid: an upload that replaced `assets[]` keeps it. */
export function assertAnUnreferencedTemplateIsValid(): void {
  const got = templateErrors((d) => {
    d.templates!.push({ code: "SPARE", name: "Spare", domain: "water", points: [{ pointKey: "x" }] });
  });
  assert(got === "[]", `an unreferenced template is not an error, got ${got}`);
}
