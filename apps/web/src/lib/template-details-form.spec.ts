/**
 * The Details tab's form rules (`F2.5`, ADR 0038 Unit 9a).
 *
 * Every fixture is built through `adminAssetTemplateDtoSchema.parse(...)` rather
 * than cast, so a DTO field that changes shape fails here instead of letting
 * these assertions run against an object the API can no longer produce.
 */
import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto } from "@bms/shared";

import {
  buildDetailsPatch,
  detailsFormErrors,
  detailsFormFrom,
  workOrderPrefixError,
} from "./template-details-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function template(overrides: Partial<AdminAssetTemplateDto> = {}): AdminAssetTemplateDto {
  return adminAssetTemplateDtoSchema.parse({
    id: "t1",
    organizationId: "o1",
    organizationCode: "ESKOM",
    organizationName: "Ion Exchange",
    code: "CHILLER",
    version: 1,
    name: "Chiller",
    assetType: "chiller",
    domain: "hvac",
    description: "A water-cooled chiller.",
    workOrderPrefix: null,
    status: "draft",
    content: {},
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    points: [],
    ...overrides,
  });
}

/** The form starts as what the server holds, with `null` reading as empty. */
export function runSeedTests(): void {
  const form = detailsFormFrom(template());
  assert(form.name === "Chiller", "the name seeds from the template");
  assert(form.assetType === "chiller", "the asset type seeds from the template");
  assert(form.domain === "hvac", "the domain seeds from the template");
  assert(form.description === "A water-cooled chiller.", "the description seeds from the template");

  // A textarea cannot hold `null`. Seeding it with the string "null" — which is
  // what a bare interpolation produces — would then be saved back as a
  // description reading "null".
  const blank = detailsFormFrom(template({ description: null }));
  assert(blank.description === "", "an absent description seeds as an empty string, not null");
}

/**
 * Blank is caught here, not by the server.
 *
 * `z.string().min(1)` accepts a single space, so trimming is what makes these
 * checks mean "has content" rather than "has characters".
 */
export function runBlankFieldTests(): void {
  const empty = detailsFormErrors({ name: "", assetType: "", domain: "", description: "", workOrderPrefix: "" });
  assert(empty.name !== undefined, "a blank name is refused");
  assert(empty.assetType !== undefined, "a blank asset type is refused");
  assert(empty.domain !== undefined, "an unchosen domain is refused");
  assert(empty.description === undefined, "a description is optional and may be empty");

  const spaces = detailsFormErrors({
    name: "   ",
    assetType: "  ",
    domain: " ",
    description: "",
    workOrderPrefix: "",
  });
  assert(
    spaces.name !== undefined && spaces.assetType !== undefined && spaces.domain !== undefined,
    "whitespace is not content — z.string().min(1) would accept it and store an invisible name",
  );

  const ok = detailsFormErrors({
    name: "Chiller",
    assetType: "chiller",
    domain: "hvac",
    description: "",
    workOrderPrefix: "",
  });
  assert(Object.keys(ok).length === 0, `a filled form has no errors — got ${Object.keys(ok)}`);
}

/** The length caps mirror `updateAssetTemplateBodySchema`. */
export function runLengthLimitTests(): void {
  const long = detailsFormErrors({
    name: "n".repeat(256),
    assetType: "a".repeat(65),
    domain: "hvac",
    description: "d".repeat(2001),
    workOrderPrefix: "",
  });
  assert(long.name !== undefined, "255 is the name cap");
  assert(long.assetType !== undefined, "64 is the asset type cap");
  assert(long.description !== undefined, "2000 is the description cap");

  const atCap = detailsFormErrors({
    name: "n".repeat(255),
    assetType: "a".repeat(64),
    domain: "hvac",
    description: "d".repeat(2000),
    workOrderPrefix: "",
  });
  assert(
    Object.keys(atCap).length === 0,
    `the cap is inclusive — a value of exactly the maximum is valid, got ${Object.keys(atCap)}`,
  );
}

/**
 * Only what changed is sent.
 *
 * `update()` writes `payload: { ...body }` to `bms.audit_log`. Resending every
 * field would leave every audit row claiming all four changed — the trail
 * saying something untrue about what an operator did.
 */
export function runOnlyChangedFieldsTests(): void {
  const row = template();

  assert(
    buildDetailsPatch(detailsFormFrom(row), row) === null,
    "an untouched form sends nothing at all — an empty PATCH still bumps updatedAt and audits",
  );

  const renamed = buildDetailsPatch({ ...detailsFormFrom(row), name: "Chiller 2" }, row);
  assert(renamed !== null, "a changed name produces a patch");
  assert(renamed?.name === "Chiller 2", "the new name is sent");
  assert(
    Object.keys(renamed ?? {}).join(",") === "name",
    `only the changed field is sent — got ${Object.keys(renamed ?? {}).join(",")}`,
  );

  const retyped = buildDetailsPatch({ ...detailsFormFrom(row), name: "Chiller  " }, row);
  assert(
    retyped === null,
    "a trailing space is not a change — it is trimmed before comparing, so it cannot be stored either",
  );

  const both = buildDetailsPatch(
    { ...detailsFormFrom(row), assetType: "pump", domain: "water" },
    row,
  );
  assert(
    Object.keys(both ?? {}).sort().join(",") === "assetType,domain",
    `two changes send two fields — got ${Object.keys(both ?? {}).join(",")}`,
  );
}

/**
 * The three states of `description`, which the service reads as three.
 *
 * `body.description !== undefined ? (body.description ?? null) : template.description`
 * — omit leaves it, `null` clears it, and a string sets it. `""` is a *string*
 * to that check, so an emptied box must send `null` or it stores an empty
 * value where the column means "none".
 */
export function runDescriptionThreeStateTests(): void {
  const row = template();

  const cleared = buildDetailsPatch({ ...detailsFormFrom(row), description: "" }, row);
  assert(cleared !== null, "clearing the description is a change");
  assert(
    cleared?.description === null,
    `an emptied description sends null, not "" — got ${JSON.stringify(cleared?.description)}`,
  );
  assert(
    "description" in (cleared ?? {}),
    "the key must be present — omitting it would leave the old description in place",
  );

  const set = buildDetailsPatch({ ...detailsFormFrom(row), description: "New text." }, row);
  assert(set?.description === "New text.", "a typed description is sent as a string");

  // The row already has no description, and the box is still empty. Sending
  // `null` here would be a write that changes nothing and audits as a change.
  const absent = template({ description: null });
  assert(
    buildDetailsPatch(detailsFormFrom(absent), absent) === null,
    "an absent description that is still absent sends nothing",
  );

  const filled = buildDetailsPatch({ ...detailsFormFrom(absent), description: "First." }, absent);
  assert(filled?.description === "First.", "adding a description to a row that had none is a change");

  // Whitespace-only is the same intent as empty. Storing `"   "` would render
  // as a description that exists and shows nothing.
  const blanked = buildDetailsPatch({ ...detailsFormFrom(row), description: "   " }, row);
  assert(
    blanked?.description === null,
    `a whitespace-only description clears it — got ${JSON.stringify(blanked?.description)}`,
  );
}

/**
 * `E3.1` / ADR 0122: the work-order prefix is a three-state field like
 * `description` — omitted leaves it, `null` clears it, a string sets it.
 */
export function runWorkOrderPrefixTests(): void {
  const stored = template({ workOrderPrefix: "STP" });
  assert(detailsFormFrom(stored).workOrderPrefix === "STP", "a stored prefix seeds the form");
  assert(
    detailsFormFrom(template({ workOrderPrefix: null })).workOrderPrefix === "",
    "an absent prefix seeds as an empty string",
  );

  assert(buildDetailsPatch(detailsFormFrom(stored), stored) === null, "an untouched prefix is not sent");
  const changed = buildDetailsPatch({ ...detailsFormFrom(stored), workOrderPrefix: "ETP" }, stored);
  assert(changed?.workOrderPrefix === "ETP", "a changed prefix is sent");
  assert(Object.keys(changed ?? {}).join(",") === "workOrderPrefix", "only the prefix is sent");

  const cleared = buildDetailsPatch({ ...detailsFormFrom(stored), workOrderPrefix: "" }, stored);
  assert(cleared !== null && cleared.workOrderPrefix === null, "an emptied prefix sends null, not \"\"");
  const lower = buildDetailsPatch({ ...detailsFormFrom(stored), workOrderPrefix: "etp" }, stored);
  assert(lower?.workOrderPrefix === "ETP", "the prefix is sent upper-case");

  const none = template({ workOrderPrefix: null });
  assert(buildDetailsPatch(detailsFormFrom(none), none) === null, "an absent prefix that stays empty sends nothing");

  assert(workOrderPrefixError("") === null, "empty is valid");
  assert(workOrderPrefixError("STP") === null, "STP is valid");
  assert(workOrderPrefixError("A") === "Two to eight capital letters or digits.", "one character is refused");
  assert(workOrderPrefixError("ABCDEFGHI") !== null, "nine characters are refused");
  assert(workOrderPrefixError("ST-P") !== null, "a hyphen is refused");
  const errs = detailsFormErrors({ ...detailsFormFrom(stored), workOrderPrefix: "S" });
  assert(errs.workOrderPrefix !== undefined, "an invalid prefix makes the form invalid");
}
