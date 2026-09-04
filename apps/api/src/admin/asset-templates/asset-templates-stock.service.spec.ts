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
  // `required` and `sortOrder` both default in the schema (`true` / `0`);
  // spelled out here so GOOD_ENTRY's point is already exactly what the
  // parsed output produces, and assertion 3's deep-equal isn't tripped by a
  // Zod default the fixture never named.
  required: true,
  sortOrder: 0,
} as const;

// Lowercase on purpose: stockCodeParamSchema is /^[a-z0-9-]+$/ (admin.schema.ts:18-22).
const BAD_CODE = "f216-bad-formula";
const GOOD_CODE = "f216-good";

/**
 * The derived point `b` carries NO `meta` key at all — not `{}`, not `null`.
 * `meta` is `z.object({ tier }).strict().optional()`, so `meta: {}` fails
 * with "Required" (the `tier` key is missing) and `meta: null` fails with
 * "Expected object, received null" — both BEFORE Zod's `superRefine` ever
 * looks at `formula`, since Zod collects issues from every key of an object
 * schema independently of the others. Either would make this fixture assert
 * the wrong message, so `meta` is omitted entirely: `.optional()` accepts an
 * absent key with no issue, leaving the formula parse as the only failure.
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

const GOOD_ENTRY: StockAssetTemplateEntry = {
  code: GOOD_CODE,
  name: "F216 good",
  assetType: "test_rig",
  domain: "water",
  stockVersion: 3,
  content: { contentVersion: 1 },
  points: [{ pointKey: "a", ...MEASURED, meta: { tier: "core" } }],
} as unknown as StockAssetTemplateEntry;

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
 * **Assertion 3 — the positive path.** A valid entry's PARSED output — not
 * the raw catalog entry — reaches `create`, alongside the stock stamp, and
 * `stockVersion` never leaks onto the body: dropping the destructure would
 * make `.strict()` refuse the whole body with "Unrecognized key(s) in
 * object: 'stockVersion'", which this test would then fail to reach
 * `create` at all — so `Object.hasOwn` pins the destructure directly rather
 * than trusting that a leaked key happens to look the same.
 */
export async function assertAValidEntryReachesCreateWithTheParsedBodyAndTheStamp(): Promise<void> {
  const { templates, createCalls } = templatesStub();
  const stock = buildStockService(templates);

  const result = await stock.import(JWT, GOOD_CODE, ORG);
  assert(result === CREATED, "import() must return create()'s result by reference");
  assert(createCalls.length === 1, `expected exactly one create() call, got ${createCalls.length}`);

  const call = createCalls[0]!;
  expectDeepEqual(call.stamp, { stockCode: GOOD_CODE, stockVersion: 3 });

  const { stockVersion: _stockVersion, ...expectedBody } = GOOD_ENTRY as unknown as Record<string, unknown>;
  expectDeepEqual(call.body, { organizationId: ORG, ...expectedBody });
  assert(
    Object.hasOwn(call.body as object, "stockVersion") === false,
    "stockVersion must never reach create() as a body field — it is the stamp, not a body key",
  );
}

/** vitest's `expect(...).toEqual` precedent: `asset-templates.controller.spec.ts` already imports `expect`. */
function expectDeepEqual(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected);
}
