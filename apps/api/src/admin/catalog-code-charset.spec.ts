import { CATALOG_CODE_MESSAGE } from "@bms/shared";
import type { z } from "zod";

import { instantiateAssetsBodySchema } from "./asset-templates/asset-templates.schema";
import { createAssetBodySchema, updateAssetBodySchema } from "./assets/assets.schema";
import { OnboardingValidateService } from "./onboarding/onboarding-validate.service";
import { draftAssetSchema, draftPointKeySchema } from "./onboarding/onboarding.schema";
import { createPointKeyBodySchema } from "./point-keys/point-keys.schema";

/**
 * `F2.23` / ADR 0065 decision 1 — the five Zod sites that admit a catalog code
 * apply `CATALOG_CODE_PATTERN` with `CATALOG_CODE_MESSAGE`, one function per
 * site so a site that loses its `.regex()` reddens on its own `it`.
 *
 * Each refusal pins four things: `success === false`; the issue sits at the
 * exact `path` the column reports; its `message` is the shared sentence; and
 * its `code` is `invalid_string` — the negative control, because `.min()` and
 * `.max()` share these fields and a `too_small`/`too_big` must not pass as a
 * class refusal. `é` is one character and two sites are `.min(2)`, so there
 * the length refusal fires beside the class one; the class issue is therefore
 * selected by predicate and counted, never read as `issues[0]`.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** ADR 0065 §3's illegal shapes: a dot, a space, the chat producer's old output, braces, non-ASCII. */
const REFUSED = ["feeder.a", "pump 1", "ST.-MARY'S-WORKS-ASSET-1", "{kw}", "é"] as const;

/** ADR 0065 decision 7's fixture shapes plus its own two examples. */
const ACCEPTED = ["TX_01", "kwh_total", "CALCWRITE_A", "FIXTURE-x-0f3a-01"] as const;

/** Any UUID the `.uuid()` check admits; nothing here reaches a database. */
const LOCATION_ID = "00000000-0000-4000-8000-000000000000";

type AnySchema = z.ZodTypeAny;

function samePath(actual: readonly (string | number)[], expected: readonly (string | number)[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertRefusedAt(
  label: string,
  schema: AnySchema,
  build: (code: string) => unknown,
  path: readonly (string | number)[],
): void {
  for (const code of REFUSED) {
    const result = schema.safeParse(build(code));
    if (result.success) {
      throw new Error(`${label}: ${JSON.stringify(code)} must be refused`);
    }
    const atPath = result.error.issues.filter((issue) => samePath(issue.path, path));
    const classIssues = atPath.filter((issue) => issue.code === "invalid_string");
    assert(
      classIssues.length === 1,
      `${label}: ${JSON.stringify(code)} must raise exactly one class refusal at ${JSON.stringify(path)}, got ${JSON.stringify(atPath)}`,
    );
    assert(
      classIssues[0]?.message === CATALOG_CODE_MESSAGE,
      `${label}: ${JSON.stringify(code)} must carry the shared sentence, got ${JSON.stringify(classIssues[0]?.message)}`,
    );
    // Nothing but a length refusal may sit beside it, and only for the one
    // single-character input at a `.min(2)` site.
    const others = atPath.filter((issue) => issue.code !== "invalid_string");
    assert(
      others.every((issue) => issue.code === "too_small") && (others.length === 0 || code.length < 2),
      `${label}: ${JSON.stringify(code)} raised an issue this spec does not expect: ${JSON.stringify(others)}`,
    );
  }
}

function assertAccepted(label: string, schema: AnySchema, build: (code: string) => unknown): void {
  for (const code of ACCEPTED) {
    const result = schema.safeParse(build(code));
    assert(
      result.success,
      `${label}: ${JSON.stringify(code)} must be accepted, got ${JSON.stringify(result.success ? null : result.error.issues)}`,
    );
  }
}

/** Site 1 — `createAssetBodySchema.code`, and `updateAssetBodySchema` inherits through `.partial()`. */
export function assertAssetCreateAndUpdateCodeClass(): void {
  const create = (code: string): unknown => ({
    code,
    name: "Probe asset",
    siteName: "Probe site",
    locationId: LOCATION_ID,
    domain: "electrical",
  });
  assertRefusedAt("createAssetBodySchema", createAssetBodySchema, create, ["code"]);
  assertAccepted("createAssetBodySchema", createAssetBodySchema, create);

  const update = (code: string): unknown => ({ code });
  assertRefusedAt("updateAssetBodySchema", updateAssetBodySchema, update, ["code"]);
  assertAccepted("updateAssetBodySchema", updateAssetBodySchema, update);
}

/** Site 2 — `instantiateAssetBodySchema.code`, reached through the exported batch schema. */
export function assertInstantiateAssetCodeClass(): void {
  const build = (code: string): unknown => ({
    locationId: LOCATION_ID,
    assets: [{ code, name: "Probe asset" }],
  });
  assertRefusedAt("instantiateAssetsBodySchema", instantiateAssetsBodySchema, build, ["assets", 0, "code"]);
  assertAccepted("instantiateAssetsBodySchema", instantiateAssetsBodySchema, build);
}

/** Site 3 — `createPointKeyBodySchema.code` (`update` omits `code`, so there is no fourth site here). */
export function assertPointKeyCreateCodeClass(): void {
  const build = (code: string): unknown => ({ code, name: "Probe point key" });
  assertRefusedAt("createPointKeyBodySchema", createPointKeyBodySchema, build, ["code"]);
  assertAccepted("createPointKeyBodySchema", createPointKeyBodySchema, build);
}

/** Site 4 — `draftAssetSchema.code`. */
export function assertDraftAssetCodeClass(): void {
  const build = (code: string): unknown => ({
    rtuIndex: 0,
    code,
    name: "Probe asset",
    siteName: "Probe site",
    domain: "electrical",
  });
  assertRefusedAt("draftAssetSchema", draftAssetSchema, build, ["code"]);
  assertAccepted("draftAssetSchema", draftAssetSchema, build);
}

/** Site 5 — `draftPointKeySchema.code`. */
export function assertDraftPointKeyCodeClass(): void {
  const build = (code: string): unknown => ({ code, name: "Probe point key" });
  assertRefusedAt("draftPointKeySchema", draftPointKeySchema, build, ["code"]);
  assertAccepted("draftPointKeySchema", draftPointKeySchema, build);
}

/**
 * The commit path: `OnboardingValidateService.validate` runs
 * `onboardingDraftSchema.safeParse` first and reports each issue as
 * `path.join(".")`, so an illegal code stored in a draft surfaces as a
 * per-field error at `assets.<i>.code` / `pointKeys.<i>.code` — the surface
 * `F4.104` ruling 1 chose for every non-length refusal — and the draft is not
 * ready to commit.
 */
export function assertValidateNamesTheField(): void {
  const result = new OnboardingValidateService().validate({
    pointKeys: [{ code: "feeder.a", name: "Probe point key" }],
    assets: [
      { rtuIndex: 0, code: "ST.-MARY'S-WORKS-ASSET-1", name: "Probe asset", siteName: "Probe site", domain: "electrical" },
    ],
  });

  const names = (path: string): boolean =>
    result.errors.some((error) => error.path === path && error.message === CATALOG_CODE_MESSAGE);

  assert(
    names("assets.0.code"),
    `validate must name assets.0.code with the shared sentence, got ${JSON.stringify(result.errors)}`,
  );
  assert(
    names("pointKeys.0.code"),
    `validate must name pointKeys.0.code with the shared sentence, got ${JSON.stringify(result.errors)}`,
  );
  assert(result.readyToCommit === false, "a draft carrying an illegal code is not ready to commit");
  assert(result.valid === false, "and it is not valid");
}
