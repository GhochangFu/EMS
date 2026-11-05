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

export function separatorIsMiddleDot(): void {
  assert(
    ASSET_LABEL_SEPARATOR === " · ",
    `separator is ${JSON.stringify(ASSET_LABEL_SEPARATOR)}`,
  );
}

export function rtuNameIsAppended(): void {
  const label = assetLabel({
    code: "PHE-MFM-000000003",
    rtuName: "Lotapata I",
    locationName: "Lotapata",
  });
  assert(label === "PHE-MFM-000000003 · Lotapata I", label);
}

export function locationNameIsTheFallback(): void {
  const label = assetLabel({
    code: "WTR-WTP-01",
    rtuName: null,
    locationName: "Lotapata",
  });
  assert(label === "WTR-WTP-01 · Lotapata", label);
}

export function bareCodeWhenNeitherIsKnown(): void {
  const label = assetLabel({
    code: "WTR-WTP-01",
    rtuName: null,
    locationName: null,
  });
  assert(label === "WTR-WTP-01", label);
}

export function rtuWinsOverLocation(): void {
  const label = assetLabel({
    code: "A-1",
    rtuName: "RTU One",
    locationName: "Site One",
  });
  assert(label === "A-1 · RTU One", label);
}

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

export function partsSplitCodeFromWhere(): void {
  const withRtu = assetLabelParts({
    code: "A-1",
    rtuName: "RTU One",
    locationName: "Site One",
  });
  assert(
    withRtu.code === "A-1" && withRtu.where === "RTU One",
    JSON.stringify(withRtu),
  );
  const withSite = assetLabelParts({
    code: "A-1",
    rtuName: null,
    locationName: "Site One",
  });
  assert(withSite.where === "Site One", JSON.stringify(withSite));
  const bare = assetLabelParts({
    code: "A-1",
    rtuName: null,
    locationName: null,
  });
  assert(bare.code === "A-1" && bare.where === null, JSON.stringify(bare));
}
