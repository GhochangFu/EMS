/**
 * The asset-template response contracts, parsed against real payload shapes
 * (`F2.5`, ADR 0038 — Unit 3).
 *
 * These assertions are about the **schemas**, not about
 * `apps/web/src/api/admin/asset-templates.ts`. The client is nine one-line
 * `adminFetch` calls with no branching to test; what can actually go wrong
 * there is a wrong path or a wrong schema argument, which no fixture can catch
 * and which Unit 7 exercises for real. What *can* be caught here is a contract
 * that stopped enforcing something — the failure mode that is silent, survives
 * `tsc`, and is only visible when a payload it should have rejected sails
 * through.
 */
import {
  adminAssetTemplateDtoSchema,
  assetTemplatesListResponseSchema,
  templateDraftDeletedResponseSchema,
} from "@bms/shared/contracts";
import { CALC_DIALECT } from "@bms/shared";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Every field of a template version except `points`. */
const TEMPLATE_BASE = {
  id: "8f14e45f-ceea-467a-9d7f-1b3c2a5e6d70",
  organizationId: "2c9a1b40-7e51-4f8a-b6d3-90ac4e12f558",
  organizationCode: "IONEX",
  organizationName: "Ion Exchange (India) Ltd.",
  code: "CHILLER-STD",
  version: 3,
  name: "Standard Chiller",
  assetType: "chiller",
  domain: "hvac",
  description: "Water-cooled centrifugal chiller.",
  status: "published",
  content: {},
  publishedAt: "2026-08-14T09:00:00.000Z",
  archivedAt: null,
  stockCode: null,
  stockVersion: null,
  createdAt: "2026-08-10T09:00:00.000Z",
  updatedAt: "2026-08-14T09:00:00.000Z",
};

const MEASURED_POINT = {
  id: "b1d0e3a2-4c55-4f61-8e7a-2f9d6c0b1234",
  templateId: TEMPLATE_BASE.id,
  pointKey: "chw_supply_temp",
  label: "CHW Supply Temperature",
  unit: "degC",
  kind: "measured",
  sourceDataKeyPattern: "CH{unit}_CHW_SUPPLY_T",
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
  required: true,
  sortOrder: 0,
  meta: null,
  createdAt: "2026-08-10T09:00:00.000Z",
};

/**
 * A **scheduled** derived point, not a streaming one, on purpose.
 *
 * A streaming point carries `calcIntervalSeconds: null` by the API's own rule,
 * so three of the five fields below would be `null` and the round-trip
 * assertion could not tell "preserved the null" from "dropped the field". Every
 * one of the five is a distinct non-null value here, so a client that loses any
 * of them fails visibly.
 */
const DERIVED_POINT = {
  id: "c2e1f4b3-5d66-4072-9f8b-30ae7d1c2345",
  templateId: TEMPLATE_BASE.id,
  pointKey: "chw_delta_t",
  label: "CHW Delta T",
  unit: "degC",
  kind: "derived",
  sourceDataKeyPattern: null,
  formula: "{chw_return_temp} - {chw_supply_temp}",
  formulaDialect: CALC_DIALECT,
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 900,
  required: false,
  sortOrder: 1,
  meta: { tier: "extended" },
  createdAt: "2026-08-10T09:00:00.000Z",
};

/**
 * The list envelope, and the half of it that a "simplification" would erase.
 *
 * `adminAssetTemplateSummaryDtoSchema` is a `z.intersection` of the DTO minus
 * `points` with `{ pointCount }` (ADR 0030 Amendment 1, rule 2). Rewritten as a
 * flat `z.object` it would still compile, still satisfy `itemsOf`, and still
 * pass the first assertion below — the second is the one that would go red, and
 * is therefore the reason this case exists.
 */
export function runTemplateListEnvelopeTests(): void {
  const valid = assetTemplatesListResponseSchema.safeParse({
    items: [{ ...TEMPLATE_BASE, pointCount: 2 }],
  });
  assert(valid.success, "a summary row carrying pointCount must parse");

  const row = valid.success ? valid.data.items[0] : undefined;
  assert(row !== undefined, "the parsed envelope must contain the row");
  assert(
    row !== undefined && !("points" in row),
    "the summary row must not carry points — the list omits them and the editor fetches them per template",
  );
  assert(
    row !== undefined && row.pointCount === 2,
    "pointCount must survive the intersection",
  );

  const missingCount = assetTemplatesListResponseSchema.safeParse({
    items: [{ ...TEMPLATE_BASE }],
  });
  assert(
    !missingCount.success,
    "a row without pointCount must be REJECTED — if this passes, the intersection was flattened and the right side is no longer enforced",
  );
}

/**
 * The five calc fields a `PATCH` would silently delete.
 *
 * `templatePointsBodySchema` replaces the whole `points` array on every draft
 * update, so the editor's write path is a round trip: read a point, edit one
 * field, send every point back. A read DTO that does not carry `formula`,
 * `formulaDialect`, `calcTrigger`, `calcIntervalSeconds` and
 * `maxInputAgeSeconds` cannot be round-tripped — the missing fields come back
 * as `undefined` and the server stores the point without them.
 */
export function runTemplateDetailRoundTripTests(): void {
  const parsed = adminAssetTemplateDtoSchema.safeParse({
    ...TEMPLATE_BASE,
    points: [MEASURED_POINT, DERIVED_POINT],
  });
  assert(parsed.success, "a detail payload with a measured and a derived point must parse");
  if (!parsed.success) {
    return;
  }

  const derived = parsed.data.points.find((point) => point.kind === "derived");
  assert(derived !== undefined, "the derived point must survive parsing");
  if (!derived) {
    return;
  }

  assert(derived.formula === DERIVED_POINT.formula, "formula must round-trip");
  assert(derived.formulaDialect === CALC_DIALECT, "formulaDialect must round-trip");
  assert(derived.calcTrigger === "scheduled", "calcTrigger must round-trip");
  assert(derived.calcIntervalSeconds === 300, "calcIntervalSeconds must round-trip");
  assert(derived.maxInputAgeSeconds === 900, "maxInputAgeSeconds must round-trip");

  const measured = parsed.data.points.find((point) => point.kind === "measured");
  assert(
    measured?.sourceDataKeyPattern === "CH{unit}_CHW_SUPPLY_T",
    "a measured point keeps its source-data-key pattern; the braces are instantiation tokens, not calc references",
  );
}

/**
 * `z.literal(true)`, not `z.boolean()`.
 *
 * The route deletes the draft or throws, so it has no `false` to send. Accepting
 * one would mean the UI treats a changed API as a successful delete.
 */
export function runTemplateDraftDeletedTests(): void {
  assert(
    templateDraftDeletedResponseSchema.safeParse({ deleted: true }).success,
    "{ deleted: true } must parse",
  );
  assert(
    !templateDraftDeletedResponseSchema.safeParse({ deleted: false }).success,
    "{ deleted: false } must be rejected — the route has no failure response, so a false means the API changed",
  );
}

/**
 * `content` reads back as an open record, and that is not symmetric.
 *
 * **Read side** — `z.record(z.unknown())`, because `F2.1` shipped the column
 * open and a deployment may hold rows written before ADR 0019 tightened it. A
 * DTO claiming `TemplateContent` would be lying about those rows.
 *
 * **Write side** — `templateContentSchema`, the tiered contract, which rejects
 * closed sections outright. So a row can be read and cannot be written back
 * unchanged. Unit 6's merge preserves the keys this UI does not edit; it must
 * not assume that preserving them makes the `PATCH` succeed.
 */
export function runTemplateContentRecordTests(): void {
  const parsed = adminAssetTemplateDtoSchema.safeParse({
    ...TEMPLATE_BASE,
    content: { maintenance: { intervalDays: 90 }, legacyKeyFromBeforeAdr0019: true },
    points: [],
  });
  assert(parsed.success, "content must accept keys this UI does not know about");
  if (!parsed.success) {
    return;
  }
  assert(
    "legacyKeyFromBeforeAdr0019" in parsed.data.content,
    "an unknown content key must survive the read — Unit 6's merge depends on it being here to preserve",
  );
}
