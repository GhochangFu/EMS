/**
 * A stock catalog entry, shaped as the template the six tab components take
 * (`F2.14`, ADR 0052 decisions 1 and 10).
 *
 * The read-only viewer renders a `StockAssetTemplateDto` through `DetailsTab`,
 * `PointsTab`, `CalculationsTab`, `KpisTab`, `AlarmsTab` and `DashboardsTab`
 * with `editable={false}`. Those tabs take an `AdminAssetTemplateDto`, and a
 * stock entry is the *write* shape — no row identity, no organization, no
 * timestamps. This module bridges the two at one tested seam, so no tab
 * changes.
 *
 * **What the tabs actually read off `template`** (measured at `b423a50`):
 * `id` (the `updateAdminAssetTemplate(template.id, …)` argument, and a
 * `useEffect` dependency), `status` (the same dependency, plus
 * `formulaFieldsAreReadOnly(template.status)` on Calculations and KPIs),
 * `content`, `points`, and — Details only — `name` / `assetType` / `domain` /
 * `description`. Nothing reads `organizationId`, `version`, `publishedAt` or
 * the timestamps; those are stamped only so the object *is* an
 * `AdminAssetTemplateDto` at runtime, which the spec parses to prove.
 *
 * **Why `status` is `published`, not `draft`.** `editable={false}` gates every
 * save control, but it is not the gate on the formula editors:
 * `formulaFieldsAreReadOnly(status)` is `!capabilities(status).editable`, and
 * `capabilities("draft").editable` is `true`. A `draft` here would render a
 * writable `FormulaEditorLazy` on Calculations and KPIs inside a screen with
 * no save path. `published` is the status ADR 0015 makes immutable, which is
 * exactly what repository data is. The spec asserts the *property* through
 * those two functions, never the literal.
 *
 * **Why the id is not a uuid.** No tab fetches by `template.id`, and every
 * mutation sits behind a control the viewer never renders — so the id reaches
 * no request. It is still a sentinel that cannot pass the API's
 * `idParamSchema` on purpose: if a future edit does let it escape, the answer
 * is a 400 naming a fake id rather than a write against a real row.
 *
 * **When this module should give way.** Adapting the entry is right while
 * there is one read-only consumer. Narrowing the tabs' prop to the
 * content-and-points subset (a discriminated `editable` union, or a read/edit
 * component split) becomes the right answer the day a second read-only
 * consumer appears. This row does not create one.
 */
import type { AdminAssetTemplateDto, StockAssetTemplateDto } from "@bms/shared";

/**
 * The synthetic row id every stock view carries. Deliberately not a uuid —
 * see the module docblock.
 */
export const STOCK_VIEW_TEMPLATE_ID = "stock-catalog-entry";

/**
 * One fixed instant for the timestamps a catalog entry does not have. The
 * epoch rather than `Date.now()`: the view must be stable across renders,
 * and nothing displays it.
 */
const STOCK_VIEW_TIMESTAMP = new Date(0).toISOString();

/** Shapes a stock catalog entry as the read-only `AdminAssetTemplateDto` the tabs render. */
export function stockEntryAsTemplate(entry: StockAssetTemplateDto): AdminAssetTemplateDto {
  return {
    id: STOCK_VIEW_TEMPLATE_ID,
    organizationId: "",
    organizationCode: "",
    organizationName: "",
    code: entry.code,
    // `0`, never `entry.stockVersion`: a catalog entry is not a row and has no
    // row version. ADR 0052 keeps the two stamps apart for two reasons, and
    // `stockVersion` below carries the real number.
    version: 0,
    name: entry.name,
    assetType: entry.assetType,
    domain: entry.domain,
    description: entry.description,
    status: "published",
    content: entry.content,
    publishedAt: null,
    archivedAt: null,
    stockCode: entry.code,
    stockVersion: entry.stockVersion,
    createdAt: STOCK_VIEW_TIMESTAMP,
    updatedAt: STOCK_VIEW_TIMESTAMP,
    points: entry.points.map((point) => ({
      id: `stock:${entry.code}:${point.pointKey}`,
      templateId: STOCK_VIEW_TEMPLATE_ID,
      pointKey: point.pointKey,
      label: point.label,
      unit: point.unit,
      kind: point.kind,
      sourceDataKeyPattern: point.sourceDataKeyPattern,
      formula: point.formula,
      formulaDialect: point.formulaDialect,
      calcTrigger: point.calcTrigger,
      calcIntervalSeconds: point.calcIntervalSeconds,
      maxInputAgeSeconds: point.maxInputAgeSeconds,
      required: point.required,
      sortOrder: point.sortOrder,
      // The one type bridge: the stock shape is `{ tier } | undefined`, the
      // admin read shape is `{ tier? } | null`.
      meta: point.meta ?? null,
      createdAt: STOCK_VIEW_TIMESTAMP,
    })),
  };
}

/** The catalog entry with this code, or `undefined` — the lookup is the validation. */
export function findStockEntry(
  items: readonly StockAssetTemplateDto[],
  code: string,
): StockAssetTemplateDto | undefined {
  return items.find((entry) => entry.code === code);
}
