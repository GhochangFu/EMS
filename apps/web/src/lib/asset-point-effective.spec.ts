import type { AdminAssetPointDto, PointMetadataFields } from "@bms/shared";

import {
  effectivePointMetadata,
  inheritedFields,
  inheritedParts,
  qualityCell,
  rangeCell,
  scaleCell,
  RANGE_FIELDS,
  SCALE_FIELDS,
} from "./asset-point-effective";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const FIVE_NULL: PointMetadataFields = {
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

type Metadata = Pick<
  AdminAssetPointDto,
  "scaleMultiplier" | "scaleOffset" | "engMin" | "engMax" | "qualityPolicy" | "templateDefaults"
>;

function item(own: Partial<PointMetadataFields>, template: Partial<PointMetadataFields> | null): Metadata {
  return { ...FIVE_NULL, ...own, templateDefaults: template === null ? null : { ...FIVE_NULL, ...template } };
}

/**
 * ADR 0056 Amendment 3 part A (`F2.25`) — the effective value is the ingest
 * host's `coalesce(asset, template)` per field, and a field is inherited only
 * where the asset states nothing and the template states something.
 */
export function runEffectiveValueTests(): void {
  const own = effectivePointMetadata(item({ engMax: 50 }, { engMax: 100 }));
  assert(own.value.engMax === 50, `an own engMax wins over the template, got ${own.value.engMax}`);
  assert(own.inherited.engMax === false, "an own engMax is not inherited");

  const inherited = effectivePointMetadata(item({}, { engMax: 100 }));
  assert(inherited.value.engMax === 100, `a null own engMax takes the template's, got ${inherited.value.engMax}`);
  assert(inherited.inherited.engMax === true, "a value taken from the template is inherited");

  const neither = effectivePointMetadata(item({}, { engMin: 5 }));
  assert(neither.value.engMax === null, `nothing on either side reads null, got ${neither.value.engMax}`);
  assert(neither.inherited.engMax === false, "a null from the template is not an inherited value");

  // A zero the database can hold (a zero multiplier is refused by the body):
  // `??`, not `||`, or the template's 2 would replace the asset's own 0.
  const zero = effectivePointMetadata(item({ scaleOffset: 0, engMin: 0 }, { scaleOffset: 2, engMin: 7 }));
  assert(zero.value.scaleOffset === 0, `an own scaleOffset of 0 wins, got ${zero.value.scaleOffset}`);
  assert(zero.value.engMin === 0, `an own engMin of 0 wins, got ${zero.value.engMin}`);
  assert(zero.inherited.scaleOffset === false, "an own 0 is not inherited");

  const policy = effectivePointMetadata(item({}, { qualityPolicy: "accept_bad" }));
  assert(policy.value.qualityPolicy === "accept_bad", "the template's quality policy applies");
  assert(policy.inherited.qualityPolicy === true, "the template's quality policy is inherited");
}

/** `templateDefaults: null` — nothing to inherit: the own five, none inherited. */
export function runNoTemplateTests(): void {
  const result = effectivePointMetadata(item({ engMin: 1, qualityPolicy: "discard_bad" }, null));
  assert(
    JSON.stringify(result.value) === JSON.stringify({ ...FIVE_NULL, engMin: 1, qualityPolicy: "discard_bad" }),
    `with no template the value is the own five, got ${JSON.stringify(result.value)}`,
  );
  assert(
    Object.values(result.inherited).every((flag) => flag === false),
    `with no template nothing is inherited, got ${JSON.stringify(result.inherited)}`,
  );
}

/** The three cells render the effective value; the marker reads none / part / all. */
export function runCellTests(): void {
  const mixed = effectivePointMetadata(item({ scaleMultiplier: 0.1 }, { scaleOffset: 0 }));
  assert(scaleCell(mixed.value) === "×0.1 +0", `scale cell, got ${scaleCell(mixed.value)}`);
  assert(inheritedParts(mixed, SCALE_FIELDS) === "part", "own ×0.1 beside an inherited +0 is part");
  assert(
    JSON.stringify(inheritedFields(mixed, SCALE_FIELDS)) === JSON.stringify(["scaleOffset"]),
    `only the offset came from the template, got ${JSON.stringify(inheritedFields(mixed, SCALE_FIELDS))}`,
  );

  const all = effectivePointMetadata(item({}, { engMin: 0, engMax: 100 }));
  assert(rangeCell(all.value) === "0 – 100", `range cell, got ${rangeCell(all.value)}`);
  assert(inheritedParts(all, RANGE_FIELDS) === "all", "both bounds from the template is all");

  const none = effectivePointMetadata(item({ engMax: 9 }, { engMax: 100 }));
  assert(rangeCell(none.value) === "≤ 9", `range cell, got ${rangeCell(none.value)}`);
  assert(inheritedParts(none, RANGE_FIELDS) === "none", "an own bound is none");
  assert(inheritedParts(none, SCALE_FIELDS) === "none", "an empty cell is none");

  assert(rangeCell({ ...FIVE_NULL, engMin: -5 }) === "≥ -5", "one lower bound alone");
  assert(scaleCell({ ...FIVE_NULL, scaleOffset: -40 }) === "−40", "a negative offset");
  assert(scaleCell(FIVE_NULL) === "—", "an empty scale is a dash");
  assert(qualityCell({ ...FIVE_NULL, qualityPolicy: "accept_bad" }) === "accept_bad", "quality cell");
  assert(qualityCell(FIVE_NULL) === "—", "an empty quality is a dash");
}
