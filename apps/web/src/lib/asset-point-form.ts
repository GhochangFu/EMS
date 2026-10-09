import type { AdminAssetPointDto, QualityPolicy } from "@bms/shared";

import type {
  CreateAdminAssetPointInput,
  UpdateAdminAssetPointInput,
} from "../api/admin/asset-points";

/**
 * ADR 0056 Amendment 3 part A (`F2.31`, `F2.27`) — the single-row Add/Edit
 * mapping dialog's form, and the two request bodies built from it.
 *
 * Everything is text, because an `<input type="number">` and a `<select>`
 * report an empty control as `""`, and that is the state the optional fields
 * need a spelling for. `rtuId` is `""` for "no RTU chosen".
 */
export type AssetPointForm = {
  assetId: string;
  pointKey: string;
  sourceDataKey: string;
  sensorCode: string;
  unit: string;
  rtuId: string;
  scaleMultiplier: string;
  scaleOffset: string;
  engMin: string;
  engMax: string;
  qualityPolicy: QualityPolicy | "";
};

/** The four numeric metadata fields, so the walkers below cannot skip one silently. */
const NUMBER_FIELDS = ["scaleMultiplier", "scaleOffset", "engMin", "engMax"] as const;

/** A blank Add form for one asset (`""` when the page has no asset in scope). */
export function emptyAssetPointForm(assetId: string): AssetPointForm {
  return {
    assetId,
    pointKey: "",
    sourceDataKey: "",
    sensorCode: "",
    unit: "",
    rtuId: "",
    scaleMultiplier: "",
    scaleOffset: "",
    engMin: "",
    engMax: "",
    qualityPolicy: "",
  };
}

/**
 * The Edit form, seeded from what the row **stores** — never from the
 * effective value (`templateDefaults`). Seeding a template default into a box
 * would turn it into a per-asset override on the next save. `null` reads as
 * an empty box.
 */
export function formFrom(item: AdminAssetPointDto): AssetPointForm {
  const text = (value: number | null) => (value === null ? "" : String(value));
  return {
    assetId: item.assetId,
    pointKey: item.pointKey,
    sourceDataKey: item.sourceDataKey,
    sensorCode: item.sensorCode ?? "",
    unit: item.unit ?? "",
    rtuId: item.rtuId ?? "",
    scaleMultiplier: text(item.scaleMultiplier),
    scaleOffset: text(item.scaleOffset),
    engMin: text(item.engMin),
    engMax: text(item.engMax),
    qualityPolicy: item.qualityPolicy ?? "",
  };
}

/**
 * A box's number, or `undefined` when it holds something that is not a finite
 * number — `JSON.stringify(NaN)` is `null`, which would read as a clear nobody
 * asked for.
 */
function numberOf(text: string): number | undefined {
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The create body. Every empty box is **omitted**: on a create there is
 * nothing to clear, an omitted metadata field and `null` mean the same thing,
 * and an omitted `rtuId` leaves the point on the asset's own gateway (the
 * create route's rule).
 */
export function createBodyFrom(form: AssetPointForm): CreateAdminAssetPointInput {
  const body: CreateAdminAssetPointInput = {
    assetId: form.assetId,
    pointKey: form.pointKey,
    sourceDataKey: form.sourceDataKey,
  };
  if (form.sensorCode !== "") body.sensorCode = form.sensorCode;
  if (form.unit !== "") body.unit = form.unit;
  if (form.rtuId !== "") body.rtuId = form.rtuId;
  for (const field of NUMBER_FIELDS) {
    const text = form[field].trim();
    const value = text === "" ? undefined : numberOf(text);
    if (value !== undefined) body[field] = value;
  }
  if (form.qualityPolicy !== "") body.qualityPolicy = form.qualityPolicy;
  return body;
}

/**
 * The edit body: the **diff** against the loaded row. A key is sent only when
 * the form differs from what the row stores, so an unchanged form is `{}` and
 * a save that touched one box states one field — which is what lets the
 * API's `statedPointMetadata` see what the operator actually changed.
 *
 * Per field:
 * - `pointKey`, `sourceDataKey` — required; an emptied box is never sent.
 * - `sensorCode`, `unit` — the PATCH body has them optional, not nullable,
 *   so an emptied box is omitted (the dialog cannot clear them; a known gap).
 * - the four numbers — compared as numbers; an emptied box on a row that
 *   stores a value is `null` (back to the template); a non-number is not sent.
 * - `qualityPolicy` — `""` on a row that stores one is `null`.
 * - `rtuId` — `""` on a wired row is `null` (unwire); another id rewires.
 *   Untouched, it is absent, so a `computed` row (which refuses `rtuId` on
 *   presence) stays editable.
 */
export function editBodyFrom(
  loaded: AdminAssetPointDto,
  form: AssetPointForm,
): UpdateAdminAssetPointInput {
  const body: UpdateAdminAssetPointInput = {};
  if (form.pointKey !== "" && form.pointKey !== loaded.pointKey) body.pointKey = form.pointKey;
  if (form.sourceDataKey !== "" && form.sourceDataKey !== loaded.sourceDataKey) {
    body.sourceDataKey = form.sourceDataKey;
  }
  if (form.sensorCode !== "" && form.sensorCode !== (loaded.sensorCode ?? "")) {
    body.sensorCode = form.sensorCode;
  }
  if (form.unit !== "" && form.unit !== (loaded.unit ?? "")) body.unit = form.unit;
  for (const field of NUMBER_FIELDS) {
    const text = form[field].trim();
    const stored = loaded[field];
    if (text === "") {
      if (stored !== null) body[field] = null;
      continue;
    }
    const value = numberOf(text);
    if (value !== undefined && value !== stored) body[field] = value;
  }
  if (form.qualityPolicy === "") {
    if (loaded.qualityPolicy !== null) body.qualityPolicy = null;
  } else if (form.qualityPolicy !== loaded.qualityPolicy) {
    body.qualityPolicy = form.qualityPolicy;
  }
  if (form.rtuId !== (loaded.rtuId ?? "")) body.rtuId = form.rtuId === "" ? null : form.rtuId;
  return body;
}
