import { MAX_ASSET_POINT_BULK_IDS, POINT_METADATA_FIELDS } from "@bms/shared";
import type { QualityPolicy } from "@bms/shared";

/**
 * `F2.7` / ADR 0056 decision 8 — the draft behind "Edit selected", and the
 * patch it turns into.
 *
 * Every field is three-valued and the panel says so with a tick box beside its
 * input: **unticked = leave every selected row alone**, ticked and empty =
 * clear the column back to the template default, ticked with a value = write
 * it. `assetPointBulkPatchSchema` spells the same three states as absent /
 * `null` / value, so the mapping is one-to-one and there is nothing for the two
 * ends to disagree about.
 *
 * The bounds re-stated here are ADR 0056 decision 2's, checked client-side so a
 * mistake is caught before 500 rows are sent — not instead of the server, which
 * is the only side that can resolve a stated bound against each row's own
 * template default (correction 48's shape). One bound alone is therefore never
 * a problem here.
 */

/** The cap, re-exported so the page and the panel read one number (`packages/shared`). */
export { MAX_ASSET_POINT_BULK_IDS };

/** A field the draft carries, with the tick that decides whether it is sent at all. */
export type BulkEditField<T> = { set: boolean; value: T };

/** The seven fields one bulk edit may state: `unit`, the five, and `active`. */
export type BulkEditDraft = {
  unit: BulkEditField<string>;
  scaleMultiplier: BulkEditField<string>;
  scaleOffset: BulkEditField<string>;
  engMin: BulkEditField<string>;
  engMax: BulkEditField<string>;
  /** `""` is "clear it", never "leave it" — the tick decides that. */
  qualityPolicy: BulkEditField<QualityPolicy | "">;
  active: BulkEditField<boolean>;
};

/**
 * The patch `POST /admin/asset-points/bulk-update` accepts.
 *
 * Declared here rather than imported: `assetPointBulkPatchSchema` lives in
 * `apps/api`, which the web may not import, and `packages/shared`'s
 * `pointMetadataShape` is the **read** shape (required-nullable) rather than
 * the write one. An absent key leaves every row as it is; `null` clears.
 */
export type AssetPointBulkPatch = {
  unit?: string | null;
  active?: boolean;
  scaleMultiplier?: number | null;
  scaleOffset?: number | null;
  engMin?: number | null;
  engMax?: number | null;
  qualityPolicy?: QualityPolicy | null;
};

/** Nothing ticked, nothing typed — what the panel opens with, and closes back to. */
export const EMPTY_BULK_EDIT_DRAFT: BulkEditDraft = {
  unit: { set: false, value: "" },
  scaleMultiplier: { set: false, value: "" },
  scaleOffset: { set: false, value: "" },
  engMin: { set: false, value: "" },
  engMax: { set: false, value: "" },
  qualityPolicy: { set: false, value: "" },
  active: { set: false, value: true },
};

/** The four numeric fields, so a walker cannot skip one silently. */
const NUMBER_FIELDS = ["scaleMultiplier", "scaleOffset", "engMin", "engMax"] as const;

type NumberField = (typeof NUMBER_FIELDS)[number];

/** How each field reads in a problem sentence. */
const FIELD_LABELS: Record<keyof BulkEditDraft, string> = {
  unit: "Unit",
  scaleMultiplier: "Scale multiplier",
  scaleOffset: "Scale offset",
  engMin: "Engineering minimum",
  engMax: "Engineering maximum",
  qualityPolicy: "Quality policy",
  active: "Status",
};

/**
 * Compile-time: every one of the five metadata fields is a key of the draft. A
 * sixth column added to `packages/shared` fails `pnpm build` here rather than
 * leaving a bulk editor that silently cannot set it.
 */
type MetadataField = (typeof POINT_METADATA_FIELDS)[number];
const _everyMetadataFieldIsInTheDraft: readonly (keyof BulkEditDraft)[] = POINT_METADATA_FIELDS;
void _everyMetadataFieldIsInTheDraft;
type _EveryNumberFieldIsAMetadataField = Exclude<NumberField, MetadataField> extends never
  ? true
  : never;
const _everyNumberFieldIsAMetadataField: _EveryNumberFieldIsAMetadataField = true;
void _everyNumberFieldIsAMetadataField;

/** The number a ticked numeric field holds: `null` when empty, `NaN` when it is not a number. */
function numberFrom(field: BulkEditField<string>): number | null {
  const text = field.value.trim();
  if (text === "") return null;
  return Number(text);
}

/**
 * The draft as the request body's `patch`.
 *
 * Only ticked fields appear. A ticked field left empty is `null` — the explicit
 * clear — which is why an emptied number cannot simply be dropped: dropping it
 * would leave the stored override in place and report success.
 *
 * Call {@link bulkEditProblems} first: this function does not validate, and a
 * ticked field holding "abc" would serialise as `null` and clear the column.
 */
export function draftToPatch(draft: BulkEditDraft): AssetPointBulkPatch {
  const patch: AssetPointBulkPatch = {};
  if (draft.unit.set) {
    const unit = draft.unit.value.trim();
    patch.unit = unit === "" ? null : unit;
  }
  for (const field of NUMBER_FIELDS) {
    if (draft[field].set) {
      const value = numberFrom(draft[field]);
      // A non-finite number never leaves this function: `JSON.stringify` would
      // send it as `null`, the explicit clear. `bulkEditProblems` refuses the
      // draft first; this is the second lock on the same door.
      if (value === null || Number.isFinite(value)) {
        patch[field] = value;
      }
    }
  }
  if (draft.qualityPolicy.set) {
    patch.qualityPolicy = draft.qualityPolicy.value === "" ? null : draft.qualityPolicy.value;
  }
  if (draft.active.set) {
    patch.active = draft.active.value;
  }
  return patch;
}

/**
 * What stops this draft from being sent, in the operator's words.
 *
 * An empty list means the patch is well formed here; it does not mean the
 * server will take it. A row whose *inherited* band the patch inverts is
 * refused there, naming the row and the inherited bound.
 */
export function bulkEditProblems(draft: BulkEditDraft): string[] {
  const problems: string[] = [];
  const set = (Object.keys(draft) as (keyof BulkEditDraft)[]).filter((field) => draft[field].set);
  if (set.length === 0) {
    problems.push("Nothing is set — tick a field to change it on every selected row.");
    return problems;
  }

  for (const field of NUMBER_FIELDS) {
    // `isFinite`, not `isNaN`: `Number("1e999")` and `Number("Infinity")` are
    // `Infinity`, which `JSON.stringify` renders as `null` — and `null` on the
    // five is the explicit clear. Under `isNaN` alone, "1e999" in a ticked
    // field would have cleared the column on every selected row and reported
    // success (PR 2 code review, finding 1).
    if (draft[field].set && !Number.isFinite(numberFrom(draft[field]) ?? 0)) {
      problems.push(`${FIELD_LABELS[field]} is not a number.`);
    }
  }

  const multiplier = draft.scaleMultiplier.set ? numberFrom(draft.scaleMultiplier) : null;
  if (multiplier === 0) {
    problems.push("Scale multiplier must not be 0 — every reading would become the offset.");
  }

  const min = draft.engMin.set ? numberFrom(draft.engMin) : null;
  const max = draft.engMax.set ? numberFrom(draft.engMax) : null;
  if (min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max) && min >= max) {
    problems.push("Engineering minimum must be below the maximum.");
  }

  return problems;
}
