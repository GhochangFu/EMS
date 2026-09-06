import { MAPPING_SHEET_FIELDS } from "@bms/shared";
import type {
  MappingSheetCellValue,
  MappingSheetChangeDto,
  MappingSheetColumn,
  MappingSheetCreateDto,
  MappingSheetErrorCode,
  MappingSheetErrorDto,
  MappingSheetField,
  MappingSheetUpdateDto,
  PointMetadataFields,
  PointSourceKind,
} from "@bms/shared";

import type { ParsedMappingRow } from "./mapping-sheet-rows";
import { assetPointKey, assetSourceKey } from "./mapping-sheet-snapshot";
import type { ExistingRow, PlanSnapshot, SnapshotAsset } from "./mapping-sheet-snapshot";
import { NO_POINT_METADATA, validateMergedPointMetadata } from "./point-metadata.schema";

/**
 * The plan, pure (`F2.7`, ADR 0056 decision 7): a parsed `MAPPINGS` sheet
 * diffed against one location's snapshot, applying **steps 5–15** of the
 * import evaluation order so every row lands in exactly one of five buckets —
 * `creates`, `updates`, `unchanged`, `untouchedSuggestions`, `errors` — and
 * reports at most one code.
 *
 * Steps 1–4 and the cell-level checks of 10–12 ran in `parseMappingSheet`;
 * the latter arrive as `row.cellError` and are raised here at their place in
 * the order, so an inactive asset with a garbage cell reports `asset_inactive`
 * and an untouched suggestion with one reports nothing.
 *
 * Design decisions applied:
 * - **4 / Q-B** — a blank `active` on a row with no mapping is a suggestion not
 *   taken (step 7); on an existing row it keeps the stored state.
 * - **5** — blank `unit`: `NULL` on an update (an explicit clear),
 *   `template.unit ?? catalog.unit ?? NULL` on a create; the five blank →
 *   `NULL` (inherit) on both; `rtu_code` blank → `rtu_id NULL`, and the kind
 *   stays `manual` on a manual row, becomes `unmapped` on a measured one, is
 *   `unmapped` on a create; non-blank → `measured` (`asset_points_source_ref_check`).
 * - **6** — `asset_name` is informational: never a change, never an error.
 * - **8** — `source_data_key_duplicate` is a row error here, never a 23505 in
 *   the commit transaction (step 14, both halves — see `applySourceKeyRule`).
 *
 * Step 8 (`point_key_unknown`) applies to rows with **no** existing mapping:
 * an existing row's key was resolved when it was created, and re-validating it
 * would make a catalog key retired since then break decision 7's round trip.
 *
 * The identity property — a location's own export plans as zero creates, zero
 * updates, zero errors — is `assertExportedRowsPlanAsIdentity`.
 */

/** The full next state of one `asset_points` row, for an INSERT or an UPDATE … SET of every column the sheet owns. */
export type PlannedWrite = {
  readonly rtuId: string | null;
  readonly sourceKind: PointSourceKind;
  readonly sourceDataKey: string;
  readonly unit: string | null;
  readonly metadata: PointMetadataFields;
  readonly active: boolean;
};

/** A row the commit inserts. */
export type PlannedCreate = {
  readonly row: number;
  readonly assetId: string;
  readonly assetCode: string;
  readonly pointKey: string;
  readonly rtuId: string | null;
  readonly sourceKind: PointSourceKind;
  readonly sourceDataKey: string;
  readonly unit: string | null;
  readonly metadata: PointMetadataFields;
  readonly active: boolean;
};

/** A row the commit updates by id, with the field-level changes and the full next state. */
export type PlannedUpdate = {
  readonly row: number;
  readonly assetPointId: string;
  readonly assetCode: string;
  readonly pointKey: string;
  readonly changes: MappingSheetChangeDto[];
  readonly write: PlannedWrite;
};

/** What the sheet would do to the location. */
export type MappingSheetPlan = {
  readonly creates: PlannedCreate[];
  readonly updates: PlannedUpdate[];
  /** Existing rows the sheet restates exactly. */
  readonly unchanged: number;
  /** Rows with no mapping and a blank `active` — the pre-fill left alone. */
  readonly untouchedSuggestions: number;
  /** Row-level refusals, in row order. */
  readonly errors: MappingSheetErrorDto[];
  readonly previewCreates: MappingSheetCreateDto[];
  readonly previewUpdates: MappingSheetUpdateDto[];
};

/** A row that passed steps 5–13 and is waiting on step 14. */
type Candidate = {
  readonly row: ParsedMappingRow;
  readonly assetCode: string;
  readonly asset: SnapshotAsset;
  readonly existing: ExistingRow | undefined;
  readonly write: PlannedWrite;
};

type RowOutcome =
  | { readonly kind: "error"; readonly error: MappingSheetErrorDto }
  | { readonly kind: "untouched" }
  | { readonly kind: "candidate"; readonly candidate: Candidate };

function error(row: ParsedMappingRow, column: MappingSheetColumn, code: MappingSheetErrorCode, message: string): RowOutcome {
  return { kind: "error", error: { row: row.rowNumber, column, code, message } };
}

/** Steps 5–13 for one row. */
function evaluateRow(row: ParsedMappingRow, snapshot: PlanSnapshot): RowOutcome {
  const { cells } = row;
  const assetCode = cells.asset_code;
  const pointKey = cells.point_key;

  // Step 5 — the asset, in this location and active
  const asset = snapshot.assetsByCode.get(assetCode);
  if (asset === undefined) {
    return error(row, "asset_code", "asset_not_found", `Asset '${assetCode}' is not an asset of this location`);
  }
  if (!asset.active) {
    return error(row, "asset_code", "asset_inactive", `Asset '${assetCode}' is inactive; re-activate it before mapping its points`);
  }

  const existing = snapshot.existingByAssetPoint.get(assetPointKey(asset.id, pointKey));
  const templatePoint =
    asset.templateId === null ? undefined : snapshot.templatePoints.get(assetPointKey(asset.templateId, pointKey));

  // Step 6 — a computed / derived point is refused whole
  if (existing?.sourceKind === "computed" || (existing === undefined && templatePoint?.kind === "derived")) {
    return error(
      row,
      "point_key",
      "point_key_computed",
      `'${pointKey}' on '${assetCode}' is a computed point; it has no source tag and the sheet does not edit it`,
    );
  }

  // Step 7 — no mapping and a blank active: the suggestion was not taken
  if (existing === undefined && row.active === null) {
    return { kind: "untouched" };
  }

  // Step 8 — a new key must be live in the catalog or declared by the pinned template
  if (existing === undefined && snapshot.catalog.get(pointKey)?.active !== true && templatePoint === undefined) {
    return error(
      row,
      "point_key",
      "point_key_unknown",
      `'${pointKey}' is neither an active point key in the catalog nor a point of '${assetCode}'s template`,
    );
  }

  // Step 9 — rtu_code resolves to an active RTU of this location
  let rtuId: string | null = null;
  if (cells.rtu_code !== "") {
    rtuId = snapshot.rtusByCode.get(cells.rtu_code) ?? null;
    if (rtuId === null) {
      return error(row, "rtu_code", "rtu_not_found", `No active RTU with code '${cells.rtu_code}' in this location`);
    }
  }

  // Steps 10–12 — the deferred cell error, if any
  if (row.cellError !== null) {
    return { kind: "error", error: row.cellError };
  }

  // Step 13 — the merged band: sheet value ?? template default
  const problems = validateMergedPointMetadata(row.metadata, templatePoint?.defaults ?? NO_POINT_METADATA);
  const firstProblem = problems[0];
  if (firstProblem !== undefined) {
    return error(row, "eng_min", "eng_range_inverted", firstProblem);
  }

  // Design decision 5 — the write
  const sourceKind: PointSourceKind =
    rtuId !== null ? "measured" : existing?.sourceKind === "manual" ? "manual" : "unmapped";
  const unit =
    cells.unit !== ""
      ? cells.unit
      : existing !== undefined
        ? null
        : (templatePoint?.unit ?? snapshot.catalog.get(pointKey)?.unit ?? null);
  const active = row.active !== null ? row.active : existing !== undefined ? existing.active : true;

  return {
    kind: "candidate",
    candidate: {
      row,
      assetCode,
      asset,
      existing,
      write: { rtuId, sourceKind, sourceDataKey: cells.source_data_key, unit, metadata: row.metadata, active },
    },
  };
}

/**
 * Step 14 — `source_data_key_duplicate`, both halves, over the rows that reached
 * it (a row that stopped earlier, or an untouched suggestion, claims no key):
 *
 * 1. **In the sheet**: the same key twice for one asset — the later row is
 *    refused, naming the first.
 * 2. **Against the location**: the key is held by an existing row of another
 *    `point_key` on that asset **that this sheet does not change**. A key is
 *    "released" when the sheet row for its holder survives and moves it. A
 *    refusal un-releases the holder's old key, which can refuse a row that
 *    depended on it — that cascade is followed to a fixpoint, so nothing the
 *    plan lets through can hit `asset_points_asset_source_key_idx` in the
 *    commit transaction (design decision 8).
 *
 * Returns the survivors, in sheet order.
 */
function applySourceKeyRule(candidates: readonly Candidate[], snapshot: PlanSnapshot, errors: MappingSheetErrorDto[]): Candidate[] {
  const refused = new Set<Candidate>();
  const refuse = (candidate: Candidate, message: string): void => {
    refused.add(candidate);
    errors.push({ row: candidate.row.rowNumber, column: "source_data_key", code: "source_data_key_duplicate", message });
  };

  // 14a — in the sheet
  const claims = new Map<string, number>();
  for (const candidate of candidates) {
    const key = assetSourceKey(candidate.asset.id, candidate.write.sourceDataKey);
    const first = claims.get(key);
    if (first !== undefined) {
      refuse(
        candidate,
        `source_data_key '${candidate.write.sourceDataKey}' is already used for '${candidate.assetCode}' by row ${first}`,
      );
      continue;
    }
    claims.set(key, candidate.row.rowNumber);
  }

  // 14b — against existing rows of another point key, with releases
  const releasedBy = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (refused.has(candidate) || candidate.existing === undefined) {
      continue;
    }
    if (candidate.existing.sourceDataKey !== candidate.write.sourceDataKey) {
      releasedBy.set(assetSourceKey(candidate.asset.id, candidate.existing.sourceDataKey), candidate);
    }
  }
  const dependents = new Map<Candidate, Candidate[]>();
  const worklist: Candidate[] = [];
  for (const candidate of candidates) {
    if (refused.has(candidate)) {
      continue;
    }
    const key = assetSourceKey(candidate.asset.id, candidate.write.sourceDataKey);
    const holder = snapshot.existingByAssetSource.get(key);
    if (holder === undefined || holder === candidate.row.cells.point_key) {
      continue;
    }
    const releaser = releasedBy.get(key);
    if (releaser === undefined) {
      refuse(
        candidate,
        `source_data_key '${candidate.write.sourceDataKey}' is already used for '${candidate.assetCode}' by its existing point '${holder}', which this sheet does not change`,
      );
      worklist.push(candidate);
      continue;
    }
    const list = dependents.get(releaser);
    if (list) {
      list.push(candidate);
    } else {
      dependents.set(releaser, [candidate]);
    }
  }
  // The cascade: a refused row releases nothing, so the rows that took its old key fall too.
  while (worklist.length > 0) {
    const fallen = worklist.pop() as Candidate;
    for (const dependent of dependents.get(fallen) ?? []) {
      if (refused.has(dependent)) {
        continue;
      }
      refuse(
        dependent,
        `source_data_key '${dependent.write.sourceDataKey}' is held by '${dependent.assetCode}'s existing point '${fallen.row.cells.point_key}', and row ${fallen.row.rowNumber}, which would have moved it, is refused`,
      );
      worklist.push(dependent);
    }
  }

  return candidates.filter((candidate) => !refused.has(candidate));
}

/** The sheet's value of one editable field on an existing row, for the `from`/`to` of a change. */
function fieldValues(
  field: MappingSheetField,
  existing: ExistingRow,
  write: PlannedWrite,
  snapshot: PlanSnapshot,
): readonly [MappingSheetCellValue, MappingSheetCellValue] {
  switch (field) {
    case "rtuCode":
      return [
        existing.rtuId === null ? null : (snapshot.rtuCodesById.get(existing.rtuId) ?? null),
        write.rtuId === null ? null : (snapshot.rtuCodesById.get(write.rtuId) ?? null),
      ];
    case "sourceDataKey":
      return [existing.sourceDataKey, write.sourceDataKey];
    case "unit":
      return [existing.unit, write.unit];
    case "active":
      return [existing.active, write.active];
    case "scaleMultiplier":
    case "scaleOffset":
    case "engMin":
    case "engMax":
    case "qualityPolicy":
      return [existing.metadata[field], write.metadata[field]];
  }
}

/** Step 15 for an existing row — the field-level changes, in `MAPPING_SHEET_FIELDS` order; empty means `unchanged`. */
function diffExisting(existing: ExistingRow, write: PlannedWrite, snapshot: PlanSnapshot): MappingSheetChangeDto[] {
  const changes: MappingSheetChangeDto[] = [];
  for (const field of MAPPING_SHEET_FIELDS) {
    const [from, to] = fieldValues(field, existing, write, snapshot);
    if (from !== to) {
      changes.push({ field, from, to });
    }
  }
  return changes;
}

/**
 * Diffs the parsed rows against the snapshot, steps 5–15 in order. `rows` are
 * `parseMappingSheet`'s `rows[]` (steps 1–4 already final); the caller
 * concatenates its `errors[]` with this plan's.
 */
export function planMappingSheet(rows: readonly ParsedMappingRow[], snapshot: PlanSnapshot): MappingSheetPlan {
  const errors: MappingSheetErrorDto[] = [];
  const candidates: Candidate[] = [];
  let untouchedSuggestions = 0;

  for (const row of rows) {
    const outcome = evaluateRow(row, snapshot);
    if (outcome.kind === "error") {
      errors.push(outcome.error);
    } else if (outcome.kind === "untouched") {
      untouchedSuggestions += 1;
    } else {
      candidates.push(outcome.candidate);
    }
  }

  const survivors = applySourceKeyRule(candidates, snapshot, errors);

  const creates: PlannedCreate[] = [];
  const updates: PlannedUpdate[] = [];
  const previewCreates: MappingSheetCreateDto[] = [];
  const previewUpdates: MappingSheetUpdateDto[] = [];
  let unchanged = 0;

  for (const { row, assetCode, asset, existing, write } of survivors) {
    const pointKey = row.cells.point_key;
    if (existing === undefined) {
      creates.push({ row: row.rowNumber, assetId: asset.id, assetCode, pointKey, ...write });
      previewCreates.push({
        row: row.rowNumber,
        assetCode,
        pointKey,
        rtuCode: row.cells.rtu_code === "" ? null : row.cells.rtu_code,
        sourceDataKey: write.sourceDataKey,
        unit: write.unit,
        ...write.metadata,
        active: write.active,
      });
      continue;
    }
    const changes = diffExisting(existing, write, snapshot);
    if (changes.length === 0) {
      unchanged += 1;
      continue;
    }
    updates.push({ row: row.rowNumber, assetPointId: existing.id, assetCode, pointKey, changes, write });
    previewUpdates.push({ row: row.rowNumber, assetPointId: existing.id, assetCode, pointKey, changes });
  }

  errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

  return { creates, updates, unchanged, untouchedSuggestions, errors, previewCreates, previewUpdates };
}
