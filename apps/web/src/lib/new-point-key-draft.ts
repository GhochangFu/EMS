/**
 * `F4.313` (ADR 0109 Amendment 1, decisions 7–9, rulings A11–A13) — **New
 * key** in the key picker of the Add calculated point panel and of the
 * asset list's batch wizard: a catalog key made on the spot, then the point.
 *
 * Pure, and here rather than in the components, because the coverage gate
 * reaches `src/lib/**` (the `calc-point-draft.ts` rule).
 *
 * - **The fields** are the Point keys page's own: code, label (`name`) and
 *   unit, validated by the shared `createPointKeyBodySchema` — the body
 *   `POST /admin/point-keys` parses — not by a restatement of its rules.
 * - **Who** (A12): the picker offers {@link NEW_KEY} only when its caller
 *   says so, and the callers say so for a global administrator only
 *   (`canWritePointKeys`), the catalog's existing rule.
 * - **Order** (A13): the caller checks the formula against the new code
 *   first, and only a clean check reaches {@link createKeyThenWritePoint}:
 *   the key, then the point. A `409` on the key ("already exists") is not a
 *   refusal of this flow — the key is in the catalog, which is what it
 *   wanted. A refusal of the point after the key exists is
 *   {@link KeyCreatedPointRefusedError}, whose sentence says the key stays.
 */
import type { AdminAssetDto, AdminAssetPointDto, CreatePointKeyBody } from "@bms/shared";
import { createPointKeyBodySchema } from "@bms/shared/contracts";

import { ApiError } from "./api-error";
import { apiErrorMessage } from "./api-error-message";
import { calcPointDraftProblems, knownRefsFor, type BatchRefusal, type CalcPointDraft } from "./calc-point-draft";

/**
 * The picker's **New key** option value. `+` is outside `CATALOG_CODE_PATTERN`,
 * so no catalog code can ever equal it.
 */
export const NEW_KEY = "+new-key";

/**
 * The text the four fields hold. `openedDomain` is what the Domain field was
 * pre-filled with (`F4.315` C1): the leave prompt compares against it, so an
 * untouched pre-filled draft is not a change.
 */
export type NewPointKeyDraft = {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly domain: string;
  readonly openedDomain: string;
};

/**
 * What the fields hold when **New key** is picked: blank, but for the Domain,
 * pre-filled with the asset's (bulk: the shared one) — `null` leaves it blank.
 */
export function emptyNewPointKeyDraft(domain: string | null = null): NewPointKeyDraft {
  return { code: "", name: "", unit: "", domain: domain ?? "", openedDomain: domain ?? "" };
}

/**
 * The panel's refusal of a new code the asset already has a point under
 * (the picker excludes those keys; the free-text code must too), or `null`.
 * Checked before any write, so a clash writes neither the key nor the point.
 */
export function newKeyClashProblem(code: string, existingKeys: readonly string[]): string | null {
  const trimmed = code.trim();
  return trimmed !== "" && existingKeys.includes(trimmed)
    ? `This asset already has a point "${trimmed}"; give the new key another code.`
    : null;
}

/**
 * The asset's domain arriving after New key was picked (the asset summary
 * resolves late): an untouched Domain follows it; one the admin edited, and a
 * domain that has not changed, are left as they are.
 */
export function withLateDomain(draft: NewPointKeyDraft, domain: string | null): NewPointKeyDraft {
  const arrived = domain ?? "";
  if (draft.domain !== draft.openedDomain || draft.openedDomain === arrived) return draft;
  return { ...draft, domain: arrived, openedDomain: arrived };
}

/** The leave prompt's half for the fields: one holds text, or the Domain differs from its pre-fill. */
export function newPointKeyDraftChanged(draft: NewPointKeyDraft): boolean {
  return draft.code !== "" || draft.name !== "" || draft.unit !== "" || draft.domain !== draft.openedDomain;
}

/** The create body: trimmed, and a blank unit or domain is absent (the Point keys page sends none). */
export function newPointKeyBody(draft: NewPointKeyDraft): CreatePointKeyBody {
  const unit = draft.unit.trim();
  const body: CreatePointKeyBody = { code: draft.code.trim(), name: draft.name.trim() };
  const domain = draft.domain.trim();
  if (unit !== "") body.unit = unit;
  if (domain !== "") body.domain = domain;
  return body;
}

/** What `createPointKeyBodySchema` refuses in the draft, as `field: message`; empty when usable. */
export function newPointKeyProblems(draft: NewPointKeyDraft): string[] {
  const parsed = createPointKeyBodySchema.safeParse(newPointKeyBody(draft));
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

/**
 * A `409` from `POST /admin/point-keys`: the code is taken, so the key is in
 * the catalog already (the service's only `409`, "Point key "x" already exists").
 */
export function isPointKeyAlreadyExists(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 409;
}

/** A11–A13: the sentence when the key is in the catalog and the point write was refused. */
export function keyCreatedPointRefusedMessage(code: string, reason: string): string {
  return `The key "${code}" is in the catalog now; the point was not written: ${reason}`;
}

/**
 * A `503` (no worker for the backfill) or `409` (a backfill already running)
 * from the point write arrives with the point **saved**: the standalone `PUT`
 * and the batch commit the point before the backfill is asked for
 * (`calc-point-standalone.service.ts`, `calc-backfill-request.service.ts`).
 */
export function pointSavedDespiteRefusal(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.status === 503 || cause.status === 409);
}

/**
 * The sentence after the key exists: the plan's "not written" sentence for a
 * refusal that wrote nothing, and a neutral prefix before the server's own
 * sentence when the point may be saved ({@link pointSavedDespiteRefusal}).
 */
export function keyCreatedPointMessage(code: string, pointCause: unknown): string {
  const reason = apiErrorMessage(pointCause);
  return pointSavedDespiteRefusal(pointCause)
    ? `The key "${code}" is in the catalog now. ${reason}`
    : keyCreatedPointRefusedMessage(code, reason);
}

/** The point write's refusal after the key exists; `pointCause` is the server's own error. */
export class KeyCreatedPointRefusedError extends Error {
  readonly pointCause: unknown;

  constructor(code: string, pointCause: unknown) {
    super(keyCreatedPointMessage(code, pointCause));
    this.name = "KeyCreatedPointRefusedError";
    this.pointCause = pointCause;
  }
}

/**
 * The point write's own refusal: the cause a two-write failure carries, or
 * the cause itself — what a reader of the server's body (the batch's
 * `refused[]`) should parse.
 */
export function pointWriteCause(cause: unknown): unknown {
  return cause instanceof KeyCreatedPointRefusedError ? cause.pointCause : cause;
}

/**
 * A13's two writes, after the caller's clean check. With no new key, the
 * point write alone. A refused create other than "already exists" throws as
 * is: nothing was written. A refused point write after the key exists throws
 * {@link KeyCreatedPointRefusedError}.
 */
export async function createKeyThenWritePoint<T>(
  newKey: CreatePointKeyBody | null,
  createKey: (body: CreatePointKeyBody) => Promise<unknown>,
  writePoint: () => Promise<T>,
): Promise<T> {
  if (newKey === null) return writePoint();
  try {
    await createKey(newKey);
  } catch (cause) {
    if (!isPointKeyAlreadyExists(cause)) throw cause;
  }
  try {
    return await writePoint();
  } catch (cause) {
    throw new KeyCreatedPointRefusedError(newKey.code, cause);
  }
}

// ---- the batch wizard (A11) ------------------------------------------------

/**
 * The batch's check before any write: each eligible asset's rows, read as the
 * panel reads them (`fetchAdminAssetPoints("all", assetId)`), so the batch
 * applies decision 3's rules to every asset under the new code, as the panel
 * does for one. A refusal per asset, in the server's sentences.
 */
export function batchFormulaRefusals(
  assets: readonly Pick<AdminAssetDto, "id" | "code">[],
  rowsByAsset: ReadonlyMap<string, readonly Pick<AdminAssetPointDto, "pointKey" | "sourceKind">[]>,
  draft: CalcPointDraft,
): BatchRefusal[] {
  return assets.flatMap((asset) => {
    const problems = calcPointDraftProblems(draft, knownRefsFor(rowsByAsset.get(asset.id) ?? [], draft.pointKey));
    return problems.length === 0 ? [] : [{ assetId: asset.id, assetCode: asset.code, reason: problems.join(" ") }];
  });
}

/** The batch's sentence when that check refuses: nothing was written, the key included. */
export const BATCH_FORMULA_NOT_CHECKED_CLEAN =
  "Nothing was written, not even the new key: the formula does not pass on the asset(s) listed below.";
