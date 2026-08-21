/**
 * Lifecycle capabilities (`F2.5`, ADR 0038 decision 3 — Unit 6).
 *
 * The status list comes from `assetTemplateStatusSchema`, **not** from the map
 * under test. That is the point: a fourth status added to the contract fails
 * here, loudly, instead of reaching `capabilities()` and returning
 * `undefined` — which reads at the call site as "no actions, and editable is
 * falsy", the safest-looking wrong answer there is.
 */
import { assetTemplateStatusSchema } from "@bms/shared/contracts";
import type { AssetTemplateStatus } from "@bms/shared";

import { capabilities, formulaFieldsAreReadOnly } from "./template-lifecycle";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ALL_STATUSES = assetTemplateStatusSchema.options as readonly AssetTemplateStatus[];

/** Every status in the contract is answered, and the answer is well formed. */
export function runEveryStatusIsCoveredTests(): void {
  assert(ALL_STATUSES.length === 3, `expected 3 statuses, got ${ALL_STATUSES.length}`);
  for (const status of ALL_STATUSES) {
    const result = capabilities(status);
    assert(result !== undefined, `no capabilities for status ${status}`);
    assert(typeof result.editable === "boolean", `${status}: editable must be a boolean`);
    assert(Array.isArray(result.actions), `${status}: actions must be an array`);
  }
}

/** The three tables, exactly — an extra action is as wrong as a missing one. */
export function runCapabilityTableTests(): void {
  const draft = capabilities("draft");
  assert(draft.editable, "a draft is editable");
  assert(
    draft.actions.join(",") === "publish,delete",
    `draft actions must be publish,delete — got ${draft.actions.join(",")}`,
  );

  const published = capabilities("published");
  assert(!published.editable, "a published version is never editable (ADR 0015)");
  assert(
    published.actions.join(",") === "createDraft,instantiate,archive",
    `published actions wrong — got ${published.actions.join(",")}`,
  );

  const archived = capabilities("archived");
  assert(!archived.editable, "an archived version is never editable");
  assert(
    archived.actions.join(",") === "createDraft",
    `ADR 0038 Amendment 3: an archived version offers revival only — got ${archived.actions.join(
      ",",
    )}`,
  );

  // The two questions the module keeps apart. Reviving an archived version
  // creates a **different** row at a higher version; this row stays read-only.
  // A reader who collapsed `actions.length > 0` into "editable" would put an
  // editable formula field on an archived template, which is the one thing
  // decision 3 forbids.
  assert(
    !archived.editable && archived.actions.length > 0,
    "an archived version has an action and is still not editable",
  );

  // Delete and Archive belong to exactly one status each. Offering Delete on an
  // archived version would hit `assertDraft` and 409; offering Archive would
  // hit the published-only guard.
  assert(!archived.actions.includes("delete"), "only a draft can be deleted");
  assert(!archived.actions.includes("archive"), "only a published version can be archived");
  assert(
    !archived.actions.includes("instantiate"),
    "instantiate is published-only — an archived version is out of the picker",
  );
}

/**
 * The invariant this module exists to hold, over the whole union.
 *
 * ADR 0038 decision 3 forbids an editable formula field on a published
 * template. Asserted as "not editable implies read-only" across every status
 * rather than as two hardcoded cases, so a future status cannot be added with
 * `editable: false` and a formula field that still accepts input.
 */
export function runFormulaReadOnlyInvariantTests(): void {
  for (const status of ALL_STATUSES) {
    const editable = capabilities(status).editable;
    assert(
      formulaFieldsAreReadOnly(status) === !editable,
      `${status}: formula read-only must be the inverse of editable`,
    );
    if (!editable) {
      assert(
        formulaFieldsAreReadOnly(status),
        `${status} is not editable, so its formula fields must be read-only`,
      );
    }
  }
  assert(!formulaFieldsAreReadOnly("draft"), "a draft's formula fields accept input");
  assert(formulaFieldsAreReadOnly("published"), "ADR 0038 decision 3");
  assert(formulaFieldsAreReadOnly("archived"), "an archived formula field is read-only");
}
