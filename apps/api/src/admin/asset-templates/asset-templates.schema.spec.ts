import {
  createAssetTemplateBodySchema,
  updateAssetTemplateBodySchema,
  templatePointBodySchema,
} from "./asset-templates.schema";

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

  // `derived` is the only other legal value, and it is load-bearing: F2.2 must
  // not emit an asset_points row for a derived point, because
  // asset_points.source_data_key is NOT NULL and a computed tag has no source.
  assert(
    templatePointBodySchema.safeParse({ pointKey: "X", kind: "derived" }).success,
    '"derived" must be accepted as a point kind',
  );
  assert(
    !templatePointBodySchema.safeParse({ pointKey: "X", kind: "computed" }).success,
    'an unknown kind such as "computed" must be rejected — the CHECK constraint ' +
      "would otherwise reject it as a 500 rather than a 400",
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

  // ---- content is the E1.7 overlay surface ---------------------------------

  const withContent = createAssetTemplateBodySchema.parse({
    ...validTemplate,
    content: { kpis: [{ code: "SEC", unit: "kWh/m3" }] },
  });
  assert(
    JSON.stringify(withContent.content).includes("kWh/m3"),
    "content must round-trip arbitrary object shapes until E1.7 tightens it",
  );
  assert(
    !createAssetTemplateBodySchema.safeParse({ ...validTemplate, content: [] }).success,
    "content must be an object — an array would break E1.7's keyed overlay",
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
}
