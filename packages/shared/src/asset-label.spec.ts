import {
  ASSET_LABEL_SEPARATOR,
  assetLabel,
  assetLabelOf,
  assetLabelParts,
} from "./asset-label";

/**
 * `F4.316` / ADR 0111 — the asset label: `<code> · <RTU display name>`, or
 * `<code> · <location name>` for an asset with no RTU, or the bare code.
 *
 * Assertions live here; `asset-label.test.ts` is the vitest entry point (ADR 0014). One claim per
 * exported function, so a mutation reddens the `it` that owns it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The separator is exactly space, U+00B7, space. */
export function separatorIsMiddleDot(): void {
  assert(
    ASSET_LABEL_SEPARATOR === " \u00b7 ",
    `separator is ${JSON.stringify(ASSET_LABEL_SEPARATOR)}`,
  );
}

/** An RTU name follows the code. */
export function rtuNameIsAppended(): void {
  const label = assetLabel({
    code: "PHE-MFM-000000003",
    rtuName: "Lotapata I",
    locationName: null,
  });
  assert(label === "PHE-MFM-000000003 · Lotapata I", label);
}

/** With no RTU the location name follows the code. */
export function locationNameIsTheFallback(): void {
  const label = assetLabel({
    code: "WTR-WTP-01",
    rtuName: null,
    locationName: "Lotapata",
  });
  assert(label === "WTR-WTP-01 · Lotapata", label);
}

/** With neither, the label is the bare code and has no separator. */
export function bareCodeWhenNeitherIsKnown(): void {
  const label = assetLabel({
    code: "WTR-WTP-01",
    rtuName: null,
    locationName: null,
  });
  assert(label === "WTR-WTP-01", label);
}

/** When both are set the RTU wins. */
export function rtuWinsOverLocation(): void {
  const label = assetLabel({
    code: "A-1",
    rtuName: "RTU One",
    locationName: "Site One",
  });
  assert(label === "A-1 · RTU One", label);
}

/** `assetLabelOf` agrees with `assetLabel` on the same parts. */
export function labelOfReadsTheDtoShape(): void {
  const parts = { code: "A-1", rtuName: "RTU One", locationName: "Site One" };
  const row = {
    assetCode: "A-1",
    assetRtuName: "RTU One",
    assetLocationName: "Site One",
  };
  assert(assetLabelOf(row) === assetLabel(parts), assetLabelOf(row));
  const bare = {
    assetCode: "A-2",
    assetRtuName: null,
    assetLocationName: null,
  };
  assert(assetLabelOf(bare) === "A-2", assetLabelOf(bare));
}

/** `where` is the RTU name when there is one. */
export function partsWhereIsTheRtuName(): void {
  const parts = assetLabelParts({
    code: "A-1",
    rtuName: "RTU One",
    locationName: "Site One",
  });
  assert(
    parts.code === "A-1" && parts.where === "RTU One",
    JSON.stringify(parts),
  );
}

/** `where` is the location name when there is no RTU. */
export function partsWhereFallsBackToTheLocation(): void {
  const parts = assetLabelParts({
    code: "A-1",
    rtuName: null,
    locationName: "Site One",
  });
  assert(parts.where === "Site One", JSON.stringify(parts));
}

/** `where` is null when neither is known. */
export function partsWhereIsNullWhenNeitherIsKnown(): void {
  const parts = assetLabelParts({
    code: "A-1",
    rtuName: null,
    locationName: null,
  });
  assert(parts.code === "A-1" && parts.where === null, JSON.stringify(parts));
}
