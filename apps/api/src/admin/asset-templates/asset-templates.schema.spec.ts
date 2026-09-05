import { CALC_DIALECT, CALC_DIALECT_V2, formatCalcError, parseFormula } from "@bms/shared";

import {
  createAssetTemplateBodySchema,
  instantiateAssetsBodySchema,
  updateAssetTemplateBodySchema,
  templatePointBodySchema,
} from "./asset-templates.schema";

function firstMessage(result: { success: false; error: { issues: { message: string }[] } }): string {
  return result.error.issues[0]?.message ?? "";
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const validTemplate = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  code: "RO-SKID",
  name: "RO Skid",
  assetType: "ro_skid",
  domain: "water",
  points: [{ pointKey: "RO_FEED_PRESSURE" }],
};

/** Zod contracts for the ADR 0015 template surface (backlog F2.1). */
export function runAssetTemplateSchemaTests(): void {
  // ---- point defaults ------------------------------------------------------

  const point = templatePointBodySchema.parse({ pointKey: "RO_FEED_PRESSURE" });
  assert(
    point.kind === "measured",
    `a point with no kind must default to "measured", got "${point.kind}"`,
  );
  assert(point.required === true, "a point must default to required");
  assert(point.sortOrder === 0, "a point must default to sortOrder 0");

  assert(
    !templatePointBodySchema.safeParse({ pointKey: "X", kind: "computed" }).success,
    'an unknown kind such as "computed" must be rejected — the CHECK constraint ' +
      "would otherwise reject it as a 500 rather than a 400",
  );

  // ---- F2.13 / ADR 0052 decision 2, ADR 0040 open question 4: meta.tier -----
  //
  // `bms.template_points.meta jsonb` has existed since `0024`; nothing could
  // write it until this row. A closed shape, not `z.record` — `meta` is
  // provenance with exactly one known key today.

  const withTier = templatePointBodySchema.safeParse({
    pointKey: "X",
    meta: { tier: "core" },
  });
  assert(withTier.success, "meta.tier: \"core\" must parse");
  assert(
    withTier.success && withTier.data.meta?.tier === "core",
    "the parsed point must carry the tier back",
  );

  assert(
    !templatePointBodySchema.safeParse({ pointKey: "X", meta: { tier: "gold" } }).success,
    'meta.tier must be one of "core" | "extended" | "manual" — "gold" must be refused',
  );
  assert(
    !templatePointBodySchema.safeParse({ pointKey: "X", meta: { note: "x" } }).success,
    "an unrecognized meta key must be refused — meta is a closed shape, not a free-form bag",
  );
  assert(
    templatePointBodySchema.safeParse({ pointKey: "X" }).success,
    "an absent meta must still parse — most points carry no provenance",
  );

  // ---- ADR 0036 decision 5: derived points must carry a formula -------------

  assert(
    !templatePointBodySchema.safeParse({ pointKey: "X", kind: "derived" }).success,
    "a derived point with no formula must now be rejected — F2.3 requires one",
  );
  assert(
    templatePointBodySchema.safeParse({
      pointKey: "X",
      kind: "derived",
      formula: "{A}",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
    }).success,
    "a derived point with a formula, the frozen dialect, and a trigger must be accepted",
  );

  // ---- ADR 0037 decision 4: trigger mode is per formula ----------------------

  assert(
    !templatePointBodySchema.safeParse({
      pointKey: "X",
      kind: "derived",
      formula: "{A}",
      formulaDialect: "bms-calc-v1",
    }).success,
    "a derived point with no calcTrigger must now be rejected — F2.4 requires one",
  );
  assert(
    !templatePointBodySchema.safeParse({
      pointKey: "X",
      kind: "derived",
      formula: "{A}",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
      calcIntervalSeconds: 60,
    }).success,
    "a streaming point must not carry calcIntervalSeconds",
  );
  assert(
    !templatePointBodySchema.safeParse({
      pointKey: "X",
      kind: "derived",
      formula: "{A}",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "scheduled",
    }).success,
    "a scheduled point without calcIntervalSeconds must be rejected",
  );
  for (const bad of [9, 86_401]) {
    assert(
      !templatePointBodySchema.safeParse({
        pointKey: "X",
        kind: "derived",
        formula: "{A}",
        formulaDialect: "bms-calc-v1",
        calcTrigger: "scheduled",
        calcIntervalSeconds: bad,
      }).success,
      `calcIntervalSeconds of ${bad} is outside 10..86400 and must be rejected`,
    );
  }
  for (const good of [10, 86_400]) {
    assert(
      templatePointBodySchema.safeParse({
        pointKey: "X",
        kind: "derived",
        formula: "{A}",
        formulaDialect: "bms-calc-v1",
        calcTrigger: "scheduled",
        calcIntervalSeconds: good,
      }).success,
      `calcIntervalSeconds of ${good} is within 10..86400 and must be accepted`,
    );
  }
  assert(
    !templatePointBodySchema.safeParse({
      pointKey: "X",
      kind: "measured",
      calcTrigger: "streaming",
    }).success,
    "a measured point must not carry calcTrigger",
  );
  const validScheduled = templatePointBodySchema.safeParse({
    pointKey: "X",
    kind: "derived",
    formula: "{A}",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 300,
    maxInputAgeSeconds: 600,
  });
  assert(validScheduled.success, "a valid scheduled point with all three fields must parse");
  assert(
    validScheduled.success &&
      validScheduled.data.calcTrigger === "scheduled" &&
      validScheduled.data.calcIntervalSeconds === 300 &&
      validScheduled.data.maxInputAgeSeconds === 600,
    "all three calc fields must survive parsing unchanged",
  );
  assert(
    !templatePointBodySchema.safeParse({
      pointKey: "X",
      kind: "measured",
      formula: "{A}",
      formulaDialect: "bms-calc-v1",
    }).success,
    "a measured point must not carry a formula",
  );
  assert(
    !templatePointBodySchema.safeParse({
      pointKey: "X",
      kind: "derived",
      formula: "{A}",
      formulaDialect: "unvalidated",
    }).success,
    "a derived point's formulaDialect must be bms-calc-v1, not any other string",
  );

  // ---- ADR 0036 decision 7: a derived point's siblings ------------------------

  const withUndeclaredRef = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    points: [
      { pointKey: "A" },
      { pointKey: "D", kind: "derived", formula: "{A} + {B}", formulaDialect: "bms-calc-v1" },
    ],
  });
  assert(!withUndeclaredRef.success, "a derived formula referencing an undeclared point must fail");
  assert(
    withUndeclaredRef.success === false &&
      withUndeclaredRef.error.issues.some((issue) => issue.path.join(".").includes("1")),
    "the error must name the offending point's index",
  );

  const withDerivedRef = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    points: [
      { pointKey: "A" },
      { pointKey: "D1", kind: "derived", formula: "{A}", formulaDialect: "bms-calc-v1" },
      { pointKey: "D2", kind: "derived", formula: "{D1}", formulaDialect: "bms-calc-v1" },
    ],
  });
  assert(!withDerivedRef.success, "a derived formula referencing another derived point must fail");

  const withSelfRef = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    points: [{ pointKey: "D", kind: "derived", formula: "{D}", formulaDialect: "bms-calc-v1" }],
  });
  assert(!withSelfRef.success, "a derived formula referencing itself must fail");

  const withMeasuredOnlyRefs = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    points: [
      { pointKey: "A" },
      { pointKey: "B" },
      {
        pointKey: "D",
        kind: "derived",
        formula: "{A} + {B}",
        formulaDialect: "bms-calc-v1",
        calcTrigger: "streaming",
      },
    ],
  });
  assert(
    withMeasuredOnlyRefs.success,
    "a derived formula referencing only measured siblings must succeed",
  );

  const malformed = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    points: [
      {
        pointKey: "D",
        kind: "derived",
        formula: "{A} +",
        formulaDialect: "bms-calc-v1",
        calcTrigger: "streaming",
      },
    ],
  });
  assert(!malformed.success, "a malformed formula must fail");
  assert(
    malformed.success === false && !firstMessage(malformed).includes("{A} +"),
    "the malformed-formula error must not echo the formula text",
  );

  // ---- duplicate point keys ------------------------------------------------

  // The unique index would catch this, but only after the caller has been told
  // a constraint name. Rejecting here names the offending code instead.
  const duplicates = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    points: [{ pointKey: "RO_FEED_PRESSURE" }, { pointKey: "RO_FEED_PRESSURE" }],
  });
  assert(!duplicates.success, "a template repeating a point key must be rejected");
  assert(
    JSON.stringify(duplicates.error?.issues ?? []).includes("RO_FEED_PRESSURE"),
    "the duplicate-point-key error must name the offending code, not just the index",
  );

  // ---- identity and version are never caller-supplied -----------------------

  // **The mechanism changed in `E7.1f`; the guarantee did not, and it got
  // stronger.** These four assertions used to prove that `version`, `status`,
  // `code` and `organizationId` were *silently stripped* — parsed away, with
  // the write answering 200. That was the ADR 0029 Amendment 3 defect exactly:
  // a caller who sent `version: 7` was told the request succeeded and had no
  // way to learn the field was discarded. The schemas are now `.strict()`, so
  // the same four keys are **refused, by name**.
  //
  // This is the one place in the repository where a caller genuinely depended
  // on a field being stripped — found by running the full suite, which is what
  // ruling 4 asks for ("check that no current caller depends on a field being
  // stripped: today those callers receive 200, and after this they receive
  // 400"). The dependency was this test, not a client, so nothing shipped
  // breaks. It is rewritten rather than deleted because what it protects is
  // unchanged: a row IS a version (ADR 0015 fork 2), and if a caller could set
  // `version` the pin in `assets.template_id` and the version it claims could
  // disagree — the exact failure the collapsed table exists to make impossible.

  const withVersion = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    version: 7,
    status: "published",
  } as Record<string, unknown>);
  assert(
    !withVersion.success,
    "create must refuse caller-supplied version/status rather than strip them — version is " +
      "assigned by the version-bump rule and publishing is an endpoint, not a field",
  );
  assert(
    JSON.stringify(withVersion.error?.issues ?? []).includes("version"),
    "the refusal must name `version`, so a caller learns the field was rejected instead of " +
      "inferring from a 200 that it was applied",
  );

  // Update carries neither identity nor lifecycle: `code` and `organizationId`
  // are what a published version's pin resolves through.
  const update = updateAssetTemplateBodySchema.parse({ name: "Renamed" });
  assert(update.name === "Renamed", "update must accept a name change");
  for (const forbidden of ["code", "organizationId", "status"]) {
    const rejected = updateAssetTemplateBodySchema.safeParse({
      name: "Renamed",
      [forbidden]: forbidden === "organizationId" ? "22222222-2222-4222-8222-222222222222" : "x",
    } as Record<string, unknown>);
    assert(
      !rejected.success,
      `${forbidden} is not editable, so an update carrying it must be refused rather than ` +
        "quietly parsed away",
    );
    assert(
      JSON.stringify(rejected.error?.issues ?? []).includes(forbidden),
      `the refusal must name ${forbidden}`,
    );
  }

  // ---- content: the E1.7 overlay, as tightened by ADR 0019 -----------------
  //
  // This block asserted the opposite until E1.7 landed — that `content`
  // round-tripped *arbitrary* object shapes. It did, deliberately, while the
  // shape was unspecified. The contract itself is proven by
  // `asset-templates-content.schema.spec.ts`; what matters here is only that the
  // create/update bodies route `content` through it rather than past it.

  const withContent = createAssetTemplateBodySchema.parse({
    ...validTemplate,
    content: {
      kpis: [
        {
          code: "SEC",
          name: "Specific energy",
          unit: "kWh/m3",
          pointKeys: ["RO_FEED_PRESSURE"],
          expression: "power / permeate_flow",
          dialect: "unvalidated",
        },
      ],
    },
  });
  assert(
    JSON.stringify(withContent.content).includes("kWh/m3"),
    "valid content must survive the create-body parse",
  );
  assert(
    withContent.content?.contentVersion === 1,
    "the create body must apply the envelope default, not pass content through untouched",
  );
  assert(
    !createAssetTemplateBodySchema.safeParse({
      ...validTemplate,
      content: { kpis: [{ code: "SEC", unit: "kWh/m3" }] },
    }).success,
    "the pre-E1.7 loose shape must now be rejected — otherwise `content` bypasses the contract",
  );
  assert(
    !updateAssetTemplateBodySchema.safeParse({ content: { health: {} } }).success,
    "the update body must reject reserved sections too, not only the create body",
  );
  assert(
    !createAssetTemplateBodySchema.safeParse({ ...validTemplate, content: [] }).success,
    "content must be an object — an array would break the keyed overlay",
  );

  // ---- required fields -----------------------------------------------------

  for (const field of ["organizationId", "code", "name", "assetType", "domain"]) {
    const body: Record<string, unknown> = { ...validTemplate };
    delete body[field];
    assert(
      !createAssetTemplateBodySchema.safeParse(body).success,
      `${field} must be required on create`,
    );
  }

  // A template with no points parses — it is only rejected at publish, so an
  // author can save an empty draft and come back to it.
  const empty = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    points: undefined,
  });
  assert(empty.success, "a draft with no points must parse; publish is where it is rejected");
  assert(
    empty.success && empty.data.points.length === 0,
    "points must default to an empty array rather than undefined",
  );

  runInstantiateSchemaTests();
}

/**
 * Zod contract for instantiation (`F2.2`, ADR 0015 §6 as amended 2026-08-05).
 *
 * The exclusive target is the amendment's whole point: ADR 0018 made
 * `assets.rtu_id` nullable, so the original RTU-only payload could not express
 * a gateway-less asset. Both-supplied is rejected rather than resolved by
 * precedence — the two disagree the moment an RTU moves between locations.
 */
function runInstantiateSchemaTests(): void {
  const RTU_ID = "22222222-2222-4222-8222-222222222222";
  const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
  const oneAsset = [{ code: "PLANTA-CH-01", name: "Chiller 01" }];

  // ---- the exclusive target ------------------------------------------------

  assert(
    instantiateAssetsBodySchema.safeParse({ rtuId: RTU_ID, assets: oneAsset }).success,
    "an rtuId-only payload must parse — that is the wired path",
  );
  assert(
    instantiateAssetsBodySchema.safeParse({ locationId: LOCATION_ID, assets: oneAsset }).success,
    "a locationId-only payload must parse — that is the gateway-less path ADR 0018 requires",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({
      rtuId: RTU_ID,
      locationId: LOCATION_ID,
      assets: oneAsset,
    }).success,
    "supplying both a target RTU and a target location must be rejected, not silently resolved",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({ assets: oneAsset }).success,
    "a payload with no target at all must be rejected",
  );

  // The message has to say which way to go — "invalid input" on an exclusive
  // pair leaves the caller guessing which field to drop.
  const neither = instantiateAssetsBodySchema.safeParse({ assets: oneAsset });
  assert(
    !neither.success &&
      /exactly one of rtuId .* or locationId/.test(neither.error.issues[0]?.message ?? ""),
    "the no-target error must name both fields and say exactly one is wanted",
  );

  // ---- batch-internal duplicate codes --------------------------------------

  // bms.assets.code is GLOBALLY unique, so a repeated code inside one batch
  // fails on the second insert and rolls back all of them. Caught here so the
  // caller is told which code collided rather than reading a constraint name.
  const duplicate = instantiateAssetsBodySchema.safeParse({
    rtuId: RTU_ID,
    assets: [
      { code: "PLANTA-CH-01", name: "Chiller 01" },
      { code: "PLANTA-CH-02", name: "Chiller 02" },
      { code: "PLANTA-CH-01", name: "Chiller 01 again" },
    ],
  });
  assert(!duplicate.success, "a batch repeating an asset code must be rejected");
  assert(
    !duplicate.success &&
      duplicate.error.issues.some((issue) => /PLANTA-CH-01/.test(issue.message)),
    "the duplicate-code error must name the colliding code",
  );
  assert(
    !duplicate.success &&
      duplicate.error.issues.some((issue) => issue.path.join(".") === "assets.2.code"),
    "the duplicate-code error must point at the second occurrence, not the first",
  );

  // ---- entry shape ---------------------------------------------------------

  const parsed = instantiateAssetsBodySchema.safeParse({ rtuId: RTU_ID, assets: oneAsset });
  assert(
    parsed.success && parsed.data.assets[0].siteName === undefined,
    "siteName must be optional — the service falls back to the target location's name",
  );
  assert(
    instantiateAssetsBodySchema.safeParse({
      rtuId: RTU_ID,
      assets: [{ code: "A", name: "A", sourceDataKeyVars: { unit: "01" } }],
    }).success,
    "sourceDataKeyVars must accept string values for pattern substitution",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({
      rtuId: RTU_ID,
      assets: [{ code: "A", name: "A", sourceDataKeyVars: { unit: 1 } }],
    }).success,
    "sourceDataKeyVars must reject non-string values — they are substituted into a varchar",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({ rtuId: RTU_ID, assets: [] }).success,
    "an empty batch must be rejected rather than succeeding with nothing done",
  );
  assert(
    !instantiateAssetsBodySchema.safeParse({ rtuId: "not-a-uuid", assets: oneAsset }).success,
    "the target id must be a uuid",
  );
}

// ---- F2.9 / ADR 0055: the write-side dialect guards --------------------------

type Issue = { path: (string | number)[]; message: string };

/** The issues of a refusal, or a throw naming what was expected. */
function refusalOf(body: unknown, what: string): Issue[] {
  const result = createAssetTemplateBodySchema.safeParse(body);
  if (result.success) {
    throw new Error(`${what}: expected a refusal, but the body parsed`);
  }
  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

function acceptanceOf(body: unknown, what: string): void {
  const result = createAssetTemplateBodySchema.safeParse(body);
  if (!result.success) {
    throw new Error(`${what}: expected acceptance, refused with ${describeIssues(result.error.issues)}`);
  }
}

function pointRefusalOf(point: unknown, what: string): Issue[] {
  const result = templatePointBodySchema.safeParse(point);
  if (result.success) {
    throw new Error(`${what}: expected a refusal, but the point parsed`);
  }
  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

function pointAcceptanceOf(point: unknown, what: string): void {
  const result = templatePointBodySchema.safeParse(point);
  if (!result.success) {
    throw new Error(`${what}: expected acceptance, refused with ${describeIssues(result.error.issues)}`);
  }
}

function describeIssues(issues: readonly Issue[]): string {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" | ");
}

/**
 * Matches on the **last** path segment, so a per-point issue (`calcTrigger`)
 * and the same field seen through the array (`points.1.calcTrigger`) read the
 * same way — and, more importantly, so a case that legitimately produces two
 * issues is not asserted through `issues[0]`, whose identity depends on
 * emission order rather than on the rule under test.
 */
function refusedAt(issues: readonly Issue[], field: string): boolean {
  return issues.some((issue) => issue.path[issue.path.length - 1] === field);
}

function messagesOf(issues: readonly Issue[]): string {
  return issues.map((issue) => issue.message).join(" | ");
}

/** A complete, valid `bms-calc-v2` point, before the field under test is set. */
function v2Point(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    pointKey: "E",
    kind: "derived",
    formula: "sum({kw} @site)",
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    ...overrides,
  };
}

/**
 * `F2.9` / ADR 0055 — the dialect, decision 10's trigger rule, decision 11's
 * coverage bound, and the dialect gate on ADR 0036 decision 7's refusal.
 *
 * **The `v1` half is the load-bearing one.** Decision 7 ("a derived formula may
 * only reference measured points") is repealed for `bms-calc-v2` *only*, so the
 * `v1` refusal and both of its messages have to survive the widening verbatim.
 * A `v1` formula stored today still relies on it.
 *
 * The three ADR 0036 decision-7 cases in `runAssetTemplateSchemaTests` above do
 * **not** cover that: none of them carries a `calcTrigger`, so
 * `templatePointBodySchema`'s own per-point refinement refuses every element
 * and the array-level `superRefine` — where the derived-reference rule actually
 * lives — never runs. They pass for a reason unrelated to the rule they name.
 * Every case below therefore carries a complete calc config.
 */
export function runCalcDialectGuardTests(): void {
  // ---- v1 half: decision 7's refusal is kept, verbatim, and still gates -----

  const chain = refusalOf(
    {
      ...validTemplate,
      points: [
        { pointKey: "A" },
        { pointKey: "D", kind: "derived", formula: "{A}", formulaDialect: CALC_DIALECT, calcTrigger: "streaming" },
        { pointKey: "E", kind: "derived", formula: "{D}", formulaDialect: CALC_DIALECT, calcTrigger: "streaming" },
      ],
    },
    "a bms-calc-v1 formula referencing a derived sibling",
  );
  assert(
    messagesOf(chain).includes("references another derived point"),
    "ADR 0036 decision 7's v1 refusal must survive the v2 widening with its message " +
      `verbatim, got: ${describeIssues(chain)}`,
  );

  const self = refusalOf(
    {
      ...validTemplate,
      points: [
        { pointKey: "SELF", kind: "derived", formula: "{SELF}", formulaDialect: CALC_DIALECT, calcTrigger: "streaming" },
      ],
    },
    "a bms-calc-v1 formula referencing itself",
  );
  assert(
    messagesOf(self).includes("references itself"),
    `the v1 self-reference message must survive verbatim, got: ${describeIssues(self)}`,
  );

  // ---- v2 half: decision 7 repealed, decision 10 mirrored ------------------

  acceptanceOf(
    {
      ...validTemplate,
      points: [
        { pointKey: "A" },
        { pointKey: "D", kind: "derived", formula: "{A}", formulaDialect: CALC_DIALECT, calcTrigger: "streaming" },
        v2Point({ formula: "{D} * 2" }),
      ],
    },
    "a bms-calc-v2 formula referencing a derived sibling (ADR 0055 decision 7)",
  );

  acceptanceOf(
    { ...validTemplate, points: [{ pointKey: "A" }, v2Point({})] },
    "a bms-calc-v2 aggregate over a key this template does not declare — the catalog " +
      "check for it is the service's, not the schema's",
  );

  // Decision 10's mirror. A `v2` point resolves its membership once per sweep,
  // so it cannot run on a single incoming reading.
  assert(
    refusedAt(
      pointRefusalOf(
        v2Point({ calcTrigger: "streaming", calcIntervalSeconds: undefined }),
        "a streaming bms-calc-v2 point",
      ),
      "calcTrigger",
    ),
    "a bms-calc-v2 point must be refused at `calcTrigger` when it is not scheduled",
  );

  // The other half of decision 10's mirror: `v2` is scheduled, and a scheduled
  // point needs an interval — so a `v2` point with no interval is a save-time
  // rejection rather than a formula that stores clean and never runs.
  assert(
    refusedAt(
      pointRefusalOf(
        v2Point({ calcIntervalSeconds: undefined }),
        "a bms-calc-v2 point with no interval",
      ),
      "calcIntervalSeconds",
    ),
    "a scheduled bms-calc-v2 point with no calcIntervalSeconds must be refused at " +
      "`calcIntervalSeconds` — decision 10 leaves it no other trigger to fall back to",
  );

  // ---- decision 11: the coverage ratio, bounded on the write side only -----

  assert(
    refusedAt(
      pointRefusalOf(
        {
          pointKey: "E",
          kind: "derived",
          formula: "{A}",
          formulaDialect: CALC_DIALECT,
          calcTrigger: "streaming",
          minCoverageRatio: 0.5,
        },
        "a bms-calc-v1 point carrying minCoverageRatio",
      ),
      "minCoverageRatio",
    ),
    "minCoverageRatio has no meaning under bms-calc-v1 — there is no aggregate to cover",
  );

  for (const bad of [0, 1.5]) {
    pointRefusalOf(v2Point({ minCoverageRatio: bad }), `minCoverageRatio ${bad}`);
  }
  for (const good of [0.5, 1]) {
    pointAcceptanceOf(v2Point({ minCoverageRatio: good }), `minCoverageRatio ${good}`);
  }

  // ---- the parse error is the dsl's own, and never echoes the formula ------

  const noScope = parseFormula("sum({kw})", { dialect: CALC_DIALECT_V2 });
  assert(
    !noScope.ok && noScope.errors[0].code === "scope_required",
    "fixture sanity: `sum({kw})` must be the scope_required case, or the assertion below " +
      "proves nothing about which error the schema surfaces",
  );
  const scopeless = refusalOf(
    { ...validTemplate, points: [{ pointKey: "A" }, v2Point({ formula: "sum({kw})" })] },
    "a bms-calc-v2 aggregate with no scope",
  );
  assert(
    !noScope.ok && messagesOf(scopeless).includes(formatCalcError(noScope.errors[0])),
    `the schema must surface the dsl's own scope_required message, got: ${describeIssues(scopeless)}`,
  );
  assert(
    !messagesOf(scopeless).includes("kw"),
    "a formula error must never echo the referenced point key back to the caller",
  );
}

// ---- F2.9 Task 12: the save-time cycle check over the template's own points --

/** The cycle issues, by the one phrase every cycle message carries. */
function cycleIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((issue) => issue.message.includes("dependency cycle"));
}

/**
 * `F2.9` Task 12 / ADR 0055 decision 8 — the array-level `superRefine` runs
 * `templateCycles(points)` and reports each point that lies on a cycle.
 *
 * **This is the half decision 7 left open.** `runCalcDialectGuardTests` above
 * proves a `v2` formula may now reference a derived sibling; what has to be
 * refused instead is the *cycle*, and a cycle is a property of the whole array,
 * not of one point. Two consequences are asserted here rather than assumed:
 *
 * - the check spans the array — `{D} ↔ {E}` is invisible to any per-point rule,
 *   and is reported at **both** points, because either one is a legitimate
 *   place for the author to break the loop;
 * - it is scoped to this template's own points, which is all a template save
 *   can see (plan correction 52). The message says so; a `@site` aggregate over
 *   the template's **own** declared key is the sharpest case, since that is the
 *   one cross-asset form which does resolve against a virtual asset.
 */
export function runTemplateCycleGuardTests(): void {
  const pair = refusalOf(
    {
      ...validTemplate,
      points: [v2Point({ pointKey: "D", formula: "{E}" }), v2Point({ pointKey: "E", formula: "{D}" })],
    },
    "two bms-calc-v2 points referencing each other",
  );
  const both = cycleIssues(pair);
  assert(
    both.length === 2,
    "a two-point cycle must be reported at both points — either is a legitimate place to " +
      `break it, and neither is more at fault. Got: ${describeIssues(pair)}`,
  );
  assert(
    both.every((issue) => issue.path[issue.path.length - 1] === "formula"),
    `each cycle issue must land on the formula field that forms it, got: ${describeIssues(pair)}`,
  );
  assert(
    both.every((issue) => issue.message.includes("D") && issue.message.includes("E")),
    `the message must name the cycle's members so the author can break it, got: ${describeIssues(pair)}`,
  );
  // Plan correction 52: the check sees only this template's points, and the
  // message must not read as "this template has no cycles".
  assert(
    both.every((issue) => issue.message.includes("cannot rule out")),
    "the message must say what it found, not what it ruled out — a template has no location, " +
      `so @domain, @group and {CODE.key} resolve to nothing here. Got: ${describeIssues(pair)}`,
  );

  const selfAggregate = refusalOf(
    { ...validTemplate, points: [v2Point({ pointKey: "T", formula: "sum({T} @site)" })] },
    "a bms-calc-v2 point aggregating its own key over @site",
  );
  assert(
    cycleIssues(selfAggregate).length === 1,
    "a site sum that includes the point's own key is a one-edge cycle — the declaring asset " +
      `is a member of its own site. Got: ${describeIssues(selfAggregate)}`,
  );

  acceptanceOf(
    {
      ...validTemplate,
      points: [{ pointKey: "A" }, v2Point({ pointKey: "D", formula: "{A}" })],
    },
    "a bms-calc-v2 point referencing a measured sibling — no cycle, and the check must not " +
      "refuse a v2 formula merely for being one",
  );
}
