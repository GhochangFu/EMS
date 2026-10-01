import { createAssetBodySchema, updateAssetBodySchema } from "./assets.schema";

/**
 * F3.74 (ADR 0088) — `rating` and `tripCause` are trimmed on the server, and a blank value is
 * `null`, so a direct API caller stores the same "none" the web form sends.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function runABlankRatingIsNull(): void {
  const parsed = updateAssetBodySchema.parse({ rating: "   " });
  assert(parsed.rating === null, `a blank rating must parse to null, got ${JSON.stringify(parsed.rating)}`);
}

export function runATripCauseIsTrimmed(): void {
  const parsed = updateAssetBodySchema.parse({ tripCause: "  high I^2t  " });
  assert(parsed.tripCause === "high I^2t", `tripCause must be trimmed, got ${JSON.stringify(parsed.tripCause)}`);
}

export function runAnOmittedRatingStaysUndefined(): void {
  const parsed = updateAssetBodySchema.parse({ tripCause: "manual" });
  assert(parsed.rating === undefined, "an omitted rating must stay undefined, so the update keeps it");
}

export function runANullTripCauseStaysNull(): void {
  const parsed = updateAssetBodySchema.parse({ tripCause: null });
  assert(parsed.tripCause === null, "an explicit null must stay null, so the update clears it");
}

export function runARatingOverItsBoundIsRefused(): void {
  const result = createAssetBodySchema.shape.rating.safeParse("x".repeat(33));
  assert(!result.success, "a 33-character rating must be refused");
}
