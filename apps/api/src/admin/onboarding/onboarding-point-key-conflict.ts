/**
 * ADR 0051 Amendment 1 — the comparison that decides whether a draft point key
 * contradicts the fleet-wide catalog row of the same code.
 *
 * **Why this is a module rather than four lines inside the commit loop.**
 * `apps/api/vitest.config.ts` includes `src/**\/*.test.ts` only, and every
 * `*.integration.test.ts` in this directory self-skips without `DATABASE_URL`.
 * A rule proved only in the integration suite therefore gates nothing on a
 * developer machine with no stack up — which is exactly the machine on which a
 * future edit to this rule will be made. The comparison is pure, so it gets a
 * pure spec that runs every time, and the integration suite keeps one assertion
 * for the wiring.
 *
 * **What the rule protects.** `bms.point_keys` became global in `F3.39`, and
 * `OnboardingCommitService` writes it at `organization_admin`. A catalog unit
 * is authoritative for a reading whose asset/point pair has no mapping row yet
 * (`telemetry-write.service.ts`: `existingMapping ? existingMapping.unit :
 * catalog.unit`), so silently reusing a row while discarding what the draft
 * declared beside it lets one organization relabel another's first reading.
 * Amendment 1 decision 2 refuses that case instead of inheriting it.
 */

/** The fields of a draft point key this comparison reads. */
export type DeclaredPointKey = {
  domain?: string | null;
  unit?: string | null;
};

/** The fields of the `bms.point_keys` row this comparison reads. */
export type CatalogPointKey = {
  domain: string | null;
  unit: string | null;
};

/** Which field disagreed, and with what. `existing` is null when unset. */
export type PointKeyConflict = {
  field: "unit" | "domain";
  declared: string;
  existing: string | null;
};

/** Trims, and treats an empty or absent string as "declares nothing". */
function stated(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Returns the conflict between a declared point key and the catalog row that
 * already carries its code, or `null` when there is none.
 *
 * A draft that declares neither field asserts nothing, so it can contradict
 * nothing and reuses the row. A declared field that the catalog leaves unset is
 * a conflict, not a gap to fill: writing it would change the row every other
 * organization shares, which is the escalation Amendment 1 decision 2 closes.
 *
 * `unit` is compared exactly — a unit is a symbol and `kW` is not `kw`.
 * `domain` is compared case-folded, because `point_keys.domain` is a bare
 * unconstrained string (see the comment on `onboardingDraftPointKeySchema` in
 * `packages/shared/src/contracts/onboarding.ts`) and refusing a commit over
 * `Electrical` against `electrical` would be noise. `unit` is tested first: it
 * is the field that reaches the telemetry write, so it is the one a reader of
 * the error should see when both disagree.
 */
export function conflictingPointKeyDeclaration(
  declared: DeclaredPointKey,
  existing: CatalogPointKey,
): PointKeyConflict | null {
  const declaredUnit = stated(declared.unit);
  const existingUnit = stated(existing.unit);
  if (declaredUnit !== null && declaredUnit !== existingUnit) {
    return { field: "unit", declared: declaredUnit, existing: existingUnit };
  }

  const declaredDomain = stated(declared.domain);
  const existingDomain = stated(existing.domain);
  if (
    declaredDomain !== null &&
    declaredDomain.toLowerCase() !== (existingDomain === null ? null : existingDomain.toLowerCase())
  ) {
    return { field: "domain", declared: declaredDomain, existing: existingDomain };
  }

  return null;
}

/**
 * The `400` body for a refused declaration. `source` separates the two cases a
 * reader must tell apart: `catalog` is a row some other commit created, and
 * `draft` is the same code declared twice in this one draft with two different
 * answers — which would otherwise report a row created two statements earlier
 * as though it had always been there.
 */
export function pointKeyConflictMessage(
  code: string,
  conflict: PointKeyConflict,
  source: "catalog" | "draft",
): string {
  const held =
    conflict.existing === null ? `no ${conflict.field}` : `${conflict.field} '${conflict.existing}'`;
  if (source === "draft") {
    return (
      `This draft declares point key '${code}' twice, first with ${held} and then with ` +
      `${conflict.field} '${conflict.declared}'. Declare the code once, with one ${conflict.field}.`
    );
  }
  return (
    `Point key '${code}' already exists in the fleet-wide catalog with ${held}, and this draft ` +
    `declares ${conflict.field} '${conflict.declared}'. Every organization shares that row, so ` +
    `onboarding may add a code the platform does not have but may not change one it does. Ask a ` +
    `global administrator to reconcile the catalog entry, or drop the ${conflict.field} from the ` +
    `draft to accept the catalog's.`
  );
}
