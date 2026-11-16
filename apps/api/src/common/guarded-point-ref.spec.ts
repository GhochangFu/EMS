import { BadRequestException } from "@nestjs/common";
import { encodePointRef } from "@bms/shared";
import { expect } from "vitest";

import { POINT_KEY_MAX_CHARS, assertAssetIdParam, decodeBoundedPointRef, decodeGuardedPointRef } from "./guarded-point-ref";

/**
 * `E1.4a` / ADR 0135 Amendment 3 S2 (plan R6, T1.7) — the shared point-ref
 * guard. Assertions live here; `guarded-point-ref.test.ts` is the vitest entry
 * point (ADR 0014).
 */
const ASSET = "11111111-1111-4111-8111-111111111111";

/** The route param as Nest hands it over: `encodePointRef`'s output, URL-decoded once. */
const param = (assetId: string, pointKey: string): string => decodeURIComponent(encodePointRef(assetId, pointKey));

const refusal = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
};

export function aMalformedRefIsA400FromBoth(): void {
  for (const decode of [decodeGuardedPointRef, decodeBoundedPointRef]) {
    for (const bad of ["no-separator-here", "%E0%A4%A"]) {
      const err = refusal(() => decode(bad));
      expect(err, `${decode.name}(${bad})`).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe("Invalid point reference");
    }
  }
}

export function aNonUuidAssetIdIsA400FromBoth(): void {
  for (const decode of [decodeGuardedPointRef, decodeBoundedPointRef]) {
    const err = refusal(() => decode(param("not-a-uuid", "kw")));
    expect(err, decode.name).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe("Invalid point reference: the asset id is not a UUID");
  }
}

export function aGoodRefDecodesToItsPair(): void {
  for (const decode of [decodeGuardedPointRef, decodeBoundedPointRef]) {
    expect(decode(param(ASSET, "temp_c"))).toEqual({ assetId: ASSET, pointKey: "temp_c" });
  }
}

export function theBoundedOneAloneRefusesAnEmptyOrOverlongKey(): void {
  expect(POINT_KEY_MAX_CHARS).toBe(128);
  for (const key of ["", "k".repeat(129)]) {
    expect(decodeGuardedPointRef(param(ASSET, key)), "the telemetry guard keeps its behaviour").toEqual({
      assetId: ASSET,
      pointKey: key,
    });
    const err = refusal(() => decodeBoundedPointRef(param(ASSET, key)));
    expect(err, `length ${key.length}`).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toMatch(/point key must be 1 to 128 characters/);
  }
  expect(decodeBoundedPointRef(param(ASSET, "k".repeat(128))).pointKey).toHaveLength(128);
  expect(decodeBoundedPointRef(param(ASSET, "k")).pointKey).toBe("k");
}

export function theBoundCountsCodePointsAsPostgresDoes(): void {
  // 128 astral characters (U+20000, outside the BMP) are 128 characters to varchar(128) and
  // 256 UTF-16 units to `.length`.
  const astral = String.fromCodePoint(0x20000).repeat(128);
  expect(astral.length).toBe(256);
  expect(decodeBoundedPointRef(param(ASSET, astral)).pointKey).toBe(astral);
  expect(refusal(() => decodeBoundedPointRef(param(ASSET, `${astral}x`)))).toBeInstanceOf(BadRequestException);
}

/** `E1.2b`: the bare asset-id param guard — a UUID passes through unchanged, anything else is a 400. */
export function aBareAssetIdParamIsCheckedAsAUuid(): void {
  expect(assertAssetIdParam(ASSET)).toBe(ASSET);
  for (const bad of ["", "not-a-uuid", `${ASSET}x`, ` ${ASSET}`, "11111111111141118111111111111111", `${ASSET},${ASSET}`]) {
    const err = refusal(() => assertAssetIdParam(bad));
    expect(err, JSON.stringify(bad)).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe("Invalid asset id: not a UUID");
  }
}
