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
    }).success,
    "a derived point with a formula and the frozen dialect must be accepted",
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
      { pointKey: "D", kind: "derived", formula: "{A} + {B}", formulaDialect: "bms-calc-v1" },
    ],
  });
  assert(
    withMeasuredOnlyRefs.success,
    "a derived formula referencing only measured siblings must succeed",
  );

  const malformed = createAssetTemplateBodySchema.safeParse({
    ...validTemplate,
    points: [{ pointKey: "D", kind: "derived", formula: "{A} +", formulaDialect: "bms-calc-v1" }],
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

  // A row IS a version (ADR 0015 fork 2). If a caller could set `version`, the
  // pin in assets.template_id and the version it claims could disagree — the
  // exact failure the collapsed table exists to make impossible.
  const withVersion = createAssetTemplateBodySchema.parse({
    ...validTemplate,
    version: 7,
    status: "published",
  } as Record<string, unknown>);
  assert(
    !("version" in withVersion),
    "version must not survive parsing — it is assigned by the version-bump rule",
  );
  assert(
    !("status" in withVersion),
    "status must not survive parsing — publishing is an endpoint, not a field",
  );

  // Update carries neither identity nor lifecycle: `code` and `organizationId`
  // are what a published version's pin resolves through.
  const update = updateAssetTemplateBodySchema.parse({
    name: "Renamed",
    code: "SOMETHING-ELSE",
    organizationId: "22222222-2222-4222-8222-222222222222",
    status: "published",
  } as Record<string, unknown>);
  assert(update.name === "Renamed", "update must accept a name change");
  for (const forbidden of ["code", "organizationId", "status"]) {
    assert(
      !(forbidden in update),
      `${forbidden} must not survive an update parse — it is not editable`,
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
