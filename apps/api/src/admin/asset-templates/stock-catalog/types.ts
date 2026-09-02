import type { CreateAssetTemplateBody } from "../asset-templates.schema";

/**
 * One entry of the stock asset-template catalog — `F2.13`, ADR 0052 decision 2
 * taken literally: **a create body without an organization, plus a stock
 * version.**
 *
 * Declared in the package that owns the create body, so an entry is exactly
 * what `AssetTemplatesAdminService.create` accepts once an `organizationId` is
 * spread in — that is what lets the import go through the same write path a
 * hand-authored draft takes (decision 5) with no second insert. `@bms/shared`'s
 * `StockAssetTemplateDto` is this type's *listed* projection; the two are held
 * together by `stock-catalog.spec.ts`, which parses every entry under both
 * schemas, not by looking alike.
 *
 * `stockVersion` is per entry, never one catalog-wide constant — improving one
 * class's default must not renumber the others (decision 2). Bumping it is a
 * new release: recorded in the pack module's docblock (decision 6), taken by
 * an organization through a re-import (decision 4), never pushed.
 */
export type StockAssetTemplateEntry = Omit<CreateAssetTemplateBody, "organizationId"> & {
  readonly stockVersion: number;
};

/**
 * What an import writes beside the row — `stock_code` / `stock_version`, held
 * together by `asset_templates_stock_stamp_check` (migration `0061`). One
 * concept, one optional parameter on `create`, so a hand-authored draft (no
 * stamp) and an imported one (stamped, audited as an import) are the same
 * call with one argument's difference.
 */
export type StockImportStamp = {
  readonly stockCode: string;
  readonly stockVersion: number;
};
