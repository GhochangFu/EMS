import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";
import { ZodError } from "zod";

import type { AdminAssetTemplateDto, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { AssetTemplatesAdminController } from "./asset-templates.controller";
import type { AssetTemplatesAdminService } from "./asset-templates.service";
import { AssetTemplatesStockService } from "./asset-templates-stock.service";
import type { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import type { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import type { StockAssetTemplateEntry, StockImportStamp } from "./stock-catalog/types";

/**
 * `F2.16` — `AssetTemplatesStockService.import` handed the catalog entry to
 * `AssetTemplatesAdminService.create` without ever running
 * `createAssetTemplateBodySchema`, so the 256 KB content cap, the
 * prototype-key ban, the bms-calc-v1 parse and the `.strict()` key set only
 * guarded a stock entry at BUILD time, via `checkEntry` in
 * `stock-catalog.spec.ts`.
 *
 * This is a UNIT spec, not an integration case, because no request against
 * the running stack can exercise the refusal path: the catalog is code, and
 * every one of the 27 shipped entries already passes the schema (measured at
 * this change's HEAD — see the fix's commit message). The failing fixture
 * below is constructed by hand for that reason; it is not, and cannot be, a
 * shipped catalog entry.
 *
 * Hand-rolled `assert`/`rejects` helpers and `as unknown as` stubs, the
 * controller built by hand — the pattern `asset-health.controller.spec.ts`
 * uses. Assertions live here; `asset-templates-stock.service.test.ts` is the
 * Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG = "00000000-0000-4000-8000-00000000f216";
const JWT: JwtPayload = { sub: "u1", email: "admin@bms.local", name: "Admin", role: "admin" };
const MEASURED = {
  kind: "measured",
  sourceDataKeyPattern: null,
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
  // `required` and `sortOrder` both default in the schema (`true` / `0`),
  // spelled out here so a point built from MEASURED parses to itself. The
  // DEFAULTING case is carried by GOOD_ENTRY's second point instead, which
  // names none of the three defaulted keys on purpose — see assertion 3.
  required: true,
  sortOrder: 0,
} as const;

// Lowercase on purpose: stockCodeParamSchema is /^[a-z0-9-]+$/ (admin.schema.ts:18-22).
const BAD_CODE = "f216-bad-formula";
const GOOD_CODE = "f216-good";

/**
 * The derived point `b` carries NO `meta` key at all — not `{}`, not `null`.
 * `meta` is `z.object({ tier }).strict().optional()`, so `meta: {}` fails with
 * "Required" at `["points", 1, "meta", "tier"]` and `meta: null` fails with
 * "Expected object, received null" at `["points", 1, "meta"]` — and in BOTH
 * cases the formula issue this fixture exists to produce disappears entirely.
 *
 * The mechanism is NOT that Zod collects a per-key issue beside the formula
 * one — an earlier draft of this comment said that, and it is wrong. A failing
 * element makes `z.array` return INVALID rather than a dirty value, and
 * `templatePointsBodySchema` is a `ZodEffects`, which runs its `superRefine`
 * only when the inner parse succeeds; the sibling-scoped formula check
 * therefore never runs at all. Note what that costs: with `meta: {}` the
 * issue-count assertion below still passes, and only the path and message
 * assertions fail. So `meta` is omitted entirely — `.optional()` accepts an
 * absent key with no issue, leaving the formula parse as the one failure.
 */
const BAD_FORMULA_ENTRY: StockAssetTemplateEntry = {
  code: BAD_CODE,
  name: "F216 bad formula",
  assetType: "test_rig",
  domain: "water",
  stockVersion: 1,
  content: { contentVersion: 1 },
  points: [
    { pointKey: "a", ...MEASURED, meta: { tier: "core" } },
    {
      pointKey: "b",
      kind: "derived",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
      formula: "{a} +",
    },
  ],
} as unknown as StockAssetTemplateEntry;

/**
 * Two points, and the second one is the whole reason assertion 3 can tell a
 * parsed body from a raw entry:
 *
 * - `a` spells every defaulted key, so it parses to itself.
 * - `b` names NONE of `kind`, `required` and `sortOrder`, so its parsed output
 *   is NOT equal to its literal — Zod fills in `"measured"`, `true` and `0`.
 *   With only `a`, handing the raw entry to `create` would still pass.
 *
 * The `as unknown as` cast is what permits `b`: all three keys are
 * non-optional on `StockAssetTemplateEntry`, which is
 * `Omit<CreateAssetTemplateBody, "organizationId">` — `z.infer`'s OUTPUT type.
 * That is also why the decision this gates is inert for the shipped packs and
 * gated here anyway.
 */
const GOOD_ENTRY: StockAssetTemplateEntry = {
  code: GOOD_CODE,
  name: "F216 good",
  assetType: "test_rig",
  domain: "water",
  stockVersion: 3,
  content: { contentVersion: 1 },
  points: [{ pointKey: "a", ...MEASURED, meta: { tier: "core" } }, { pointKey: "b" }],
} as unknown as StockAssetTemplateEntry;

/**
 * What `create` must receive for `GOOD_ENTRY` — spelled by hand, and NEVER
 * derived from `GOOD_ENTRY`. A derived expectation drops the defaults from
 * both sides at once, so `toEqual` would hold whether `create` was handed the
 * parse's output or the raw entry, which is the false green this literal
 * exists to close.
 *
 * `stockVersion` is absent because it is the stamp, not a body key;
 * `organizationId` is the caller's, spread last by `import`.
 */
const EXPECTED_CREATE_BODY = {
  organizationId: ORG,
  code: GOOD_CODE,
  name: "F216 good",
  assetType: "test_rig",
  domain: "water",
  content: { contentVersion: 1 },
  points: [
    {
      pointKey: "a",
      kind: "measured",
      sourceDataKeyPattern: null,
      formula: null,
      formulaDialect: null,
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      required: true,
      sortOrder: 0,
      meta: { tier: "core" },
    },
    // The three keys point `b` never named. Only the parsed output carries
    // them — this line is what fails if `create` is handed the raw entry.
    { pointKey: "b", kind: "measured", required: true, sortOrder: 0 },
  ],
};

const EXPECTED_MESSAGE = "Invalid formula: unexpected end of formula at character 5";
const EXPECTED_PATH = ["points", 1, "formula"];
const EXPECTED_FLATTEN = { formErrors: [], fieldErrors: { points: [EXPECTED_MESSAGE] } };

const CREATED = { id: "created-sentinel" } as unknown as AdminAssetTemplateDto;

/** Records every call so a test can assert `create` was never reached, not only that import threw. */
function templatesStub() {
  const createCalls: { body: unknown; stamp: StockImportStamp | undefined }[] = [];
  const authorCalls: string[] = [];
  const templates = {
    assertCanAuthor: async (_jwt: JwtPayload, organizationId: string) => {
      authorCalls.push(organizationId);
    },
    create: async (_jwt: JwtPayload, body: unknown, stamp?: StockImportStamp) => {
      createCalls.push({ body, stamp });
      return CREATED;
    },
  } as unknown as AssetTemplatesAdminService;
  return { templates, createCalls, authorCalls };
}

function buildStockService(templates: AssetTemplatesAdminService) {
  const access = {} as unknown as AccessControlService; // import() never touches AccessControlService directly.
  return new AssetTemplatesStockService([BAD_FORMULA_ENTRY, GOOD_ENTRY], access, templates);
}

/**
 * **Assertion 1 — a schema-failing entry is refused before `create`, and
 * authorization has already run.**
 *
 * The `ZodError` propagates rather than being converted to a
 * `BadRequestException` here — that mapping belongs to the controller, which
 * already performs it for `POST /` (asset-templates.controller.ts:116-118).
 */
export async function assertASchemaFailingEntryIsRefusedBeforeCreate(): Promise<void> {
  const { templates, createCalls, authorCalls } = templatesStub();
  const stock = buildStockService(templates);

  let caught: unknown;
  try {
    await stock.import(JWT, BAD_CODE, ORG);
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof ZodError, `expected a ZodError, threw: ${String(caught)}`);
  const zodError = caught as ZodError;
  assert(
    zodError.issues.length === 1,
    `expected exactly one issue, got ${zodError.issues.length}: ${JSON.stringify(zodError.issues)}`,
  );
  assert(
    JSON.stringify(zodError.issues[0]?.path) === JSON.stringify(EXPECTED_PATH),
    `expected path ${JSON.stringify(EXPECTED_PATH)}, got ${JSON.stringify(zodError.issues[0]?.path)}`,
  );
  assert(
    zodError.issues[0]?.message === EXPECTED_MESSAGE,
    `expected message "${EXPECTED_MESSAGE}", got "${zodError.issues[0]?.message}"`,
  );
  assert(
    createCalls.length === 0,
    `create was reached ${createCalls.length} time(s) despite the schema failure; the parse must run ` +
      "before create, not after it",
  );
  assert(
    authorCalls.length === 1,
    // Authorization must still run before the schema is even consulted — an
    // actor outside the organization must not learn anything from a schema
    // error.
    `expected assertCanAuthor to have run once, got ${authorCalls.length}`,
  );
}

/**
 * **Assertion 2 — the controller answers 400 with the schema's own message,
 * not a generic "Bad Request Exception".**
 *
 * `importStock`'s existing `catch (err) { if (err instanceof ZodError) throw
 * new BadRequestException(err.flatten()); }` is what turns assertion 1's
 * `ZodError` into the byte-identical 400 body `POST /` returns.
 */
export async function assertTheControllerAnswers400WithTheSchemasOwnMessage(): Promise<void> {
  const { templates, createCalls } = templatesStub();
  const stock = buildStockService(templates);
  const controller = new AssetTemplatesAdminController(
    {} as unknown as AssetTemplatesAdminService,
    {} as unknown as AssetTemplateInstantiationService,
    {} as unknown as AssetTemplateMigrationService,
    stock,
  );

  let caught: unknown;
  try {
    await controller.importStock(BAD_CODE, { organizationId: ORG }, JWT);
  } catch (err) {
    caught = err;
  }
  assert(
    caught instanceof BadRequestException,
    `a schema-failing stock import must answer 400, not propagate the ZodError past the controller: ` +
      `threw ${String(caught)}`,
  );
  const badRequest = caught as BadRequestException;
  assert(badRequest.getStatus() === 400, `expected status 400, got ${badRequest.getStatus()}`);
  expectDeepEqual(badRequest.getResponse(), EXPECTED_FLATTEN);
  assert(createCalls.length === 0, `create was reached ${createCalls.length} time(s) despite the 400`);
}

/**
 * **Assertion 3 — the positive path.** A valid entry's PARSED output — not the
 * raw catalog entry — reaches `create`, alongside the stock stamp.
 *
 * The deep-equal is what separates the two objects, and it only can because
 * `GOOD_ENTRY`'s point `b` omits `kind`, `required` and `sortOrder` while
 * `EXPECTED_CREATE_BODY` spells all three. Hand `create` `{ ...body,
 * organizationId }` — keeping the parse for validation and discarding its
 * output — and this assertion fails on `points[1]`.
 *
 * The `Object.hasOwn(body, "stockVersion") === false` check below restates
 * that; it is NOT the gate on the destructure-before-parse ordering. Remove
 * the destructure and `.strict()` refuses the whole body with "Unrecognized
 * key(s) in object: 'stockVersion'", so `create` is never reached and the
 * `createCalls.length === 1` assertion fails first. It stays because it costs
 * nothing and states plainly what the body may not carry.
 */
export async function assertAValidEntryReachesCreateWithTheParsedBodyAndTheStamp(): Promise<void> {
  const { templates, createCalls } = templatesStub();
  const stock = buildStockService(templates);

  const result = await stock.import(JWT, GOOD_CODE, ORG);
  assert(result === CREATED, "import() must return create()'s result by reference");
  assert(createCalls.length === 1, `expected exactly one create() call, got ${createCalls.length}`);

  const call = createCalls[0]!;
  expectDeepEqual(call.stamp, { stockCode: GOOD_CODE, stockVersion: 3 });

  expectDeepEqual(call.body, EXPECTED_CREATE_BODY);
  assert(
    Object.hasOwn(call.body as object, "stockVersion") === false,
    "stockVersion must never reach create() as a body field — it is the stamp, not a body key",
  );
}

/**
 * `F2.16` — the caller's `organizationId` wins over anything the entry carries.
 *
 * The parse spreads `organizationId` LAST. Reverse it and an entry carrying its
 * own `organizationId` replaces the caller's, and the schema does not object:
 * the key is declared on the create body and only gets a `uuid()` format check.
 * `create` would then re-authorize and bind `withTenant` to the entry's
 * organization rather than the one the request named.
 *
 * The fixture casts past `StockAssetTemplateEntry`, which is
 * `Omit<CreateAssetTemplateBody, "organizationId">`, so TypeScript refuses this
 * key on a real catalog literal. That type-level guard is exactly what this
 * assertion declines to rely on — it is an accident of how the packs are
 * written, not a property of the import path.
 */
export async function assertTheCallersOrganizationWinsOverAnEntryThatCarriesOne(): Promise<void> {
  const OTHER_ORG = "00000000-0000-4000-8000-0000000f2160";
  const carriesAnOrganization = {
    ...GOOD_ENTRY,
    organizationId: OTHER_ORG,
  } as unknown as StockAssetTemplateEntry;
  const { templates, createCalls } = templatesStub();
  const access = {} as unknown as AccessControlService;
  const stock = new AssetTemplatesStockService([carriesAnOrganization], access, templates);

  await stock.import(JWT, GOOD_CODE, ORG);

  assert(createCalls.length === 1, `create must be reached once, got ${createCalls.length}`);
  const body = createCalls[0].body as Record<string, unknown>;
  assert(
    body.organizationId === ORG,
    `the caller's organization must win — create received ${String(body.organizationId)}`,
  );
}

/** vitest's `expect(...).toEqual` precedent: `asset-templates.controller.spec.ts` already imports `expect`. */
function expectDeepEqual(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected);
}
