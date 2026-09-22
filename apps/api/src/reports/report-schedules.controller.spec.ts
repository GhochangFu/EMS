import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { JwtPayload, ReportScheduleDto } from "@bms/shared";

import { REQUEST_SCHEMAS } from "../openapi/openapi-registry";
import { repoRoot } from "../testing/repo-root";
import { decoratorAt, methodBody } from "../testing/source-scan";
import { ReportSchedulesController } from "./report-schedules.controller";
import type { ReportSchedulesService } from "./report-schedules.service";

/**
 * `F3.5b` (ADR 0071 decision 11; plan R-6, R-12) —
 * `report-schedules.controller.ts`, the `report-files.controller.spec.ts`
 * shape. Assertions live here; `report-schedules.controller.test.ts` is the
 * Vitest entry point (§4.6).
 *
 * **Behavioural**, over a hand-built controller (no Nest DI — `F4.20`): the
 * `.strict()` bodies refuse an unknown key before the service is reached, the
 * timezone refine answers a 400 whose flattened `fieldErrors.timezone` names
 * the field for `Not/AZone` and for the lowercase `asia/kolkata` (the amended
 * R-6), an empty PATCH is a 400, and a valid body reaches the service parsed.
 *
 * **Source scan**, for what behaviour cannot see: `create` and `update` parse
 * before they call the service, no handler argument is named `key`/`objectKey`
 * (ADR 0066 decision 4), the class carries the guard and the prefix. Every
 * anchor goes through `decoratorAt`/`methodBody`, never a bare `indexOf`,
 * because the class docblock quotes the decorators too.
 */
const CONTROLLER = join(repoRoot(), "apps/api/src/reports/report-schedules.controller.ts");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function source(): string {
  return readFileSync(CONTROLLER, "utf8");
}

/** `create` runs from its `async create(` to the by-id read's decorator. */
function createBody(text: string): string {
  return methodBody(text, "async create(", '@Get("schedules/:id")');
}

/** `update` runs from its `async update(` to the delete route's decorator. */
function updateBody(text: string): string {
  return methodBody(text, "async update(", '@Delete("schedules/:id")');
}

// ---------------------------------------------------------------------------
// Fixtures and fakes
// ---------------------------------------------------------------------------

const USER: JwtPayload = { sub: "u1", email: "admin@bms.local", name: "Admin", role: "admin" };
const SCHEDULE_ID = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "11111111-1111-4111-8111-111111111111";

const ROW: ReportScheduleDto = {
  id: SCHEDULE_ID,
  organizationId: ORG_ID,
  name: "Weekly energy",
  templateId: "energy_consumption",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "07:00",
  timezone: "Asia/Kolkata",
  locationIds: [],
  channelId: null,
  enabled: true,
  nextRunAt: "2026-09-28T01:30:00.000Z",
  lastRunAt: null,
  createdBy: null,
  createdAt: "2026-09-21T10:00:00.000Z",
  updatedAt: "2026-09-21T10:00:00.000Z",
};

export const VALID_CREATE_BODY = {
  name: "Weekly energy",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "07:00",
  timezone: "Asia/Kolkata",
  locationIds: [],
  organizationId: ORG_ID,
};

type Call = { method: string; args: unknown[] };

/** Records every call so a test can assert the service was NOT reached, not only that the handler threw. */
function serviceStub() {
  const calls: Call[] = [];
  const schedules = {
    create: async (...args: unknown[]) => {
      calls.push({ method: "create", args });
      return ROW;
    },
    list: async (...args: unknown[]) => {
      calls.push({ method: "list", args });
      return [ROW];
    },
    get: async (...args: unknown[]) => {
      calls.push({ method: "get", args });
      return ROW;
    },
    update: async (...args: unknown[]) => {
      calls.push({ method: "update", args });
      return ROW;
    },
    remove: async (...args: unknown[]) => {
      calls.push({ method: "remove", args });
    },
  } as unknown as ReportSchedulesService;
  return { schedules, calls };
}

async function rejects(run: () => Promise<unknown>): Promise<unknown> {
  let rejected = false;
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    rejected = true;
    caught = err;
  }
  assert(rejected, "expected the call to reject, and it resolved");
  return caught;
}

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null ? String((err as { name?: unknown }).name) : String(err);
}

function fieldErrorsOf(err: unknown): Record<string, string[] | undefined> {
  const response = (err as { getResponse(): unknown }).getResponse() as {
    fieldErrors?: Record<string, string[] | undefined>;
  };
  return response.fieldErrors ?? {};
}

// ---------------------------------------------------------------------------
// create: the parse is the gate
// ---------------------------------------------------------------------------

/** `.strict()`: an unknown key is a 400 and the service is never reached. */
export async function assertCreateRefusesAnUnknownKeyBeforeTheService(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const err = await rejects(() => controller.create(USER, { ...VALID_CREATE_BODY, nextRunAt: "2026-09-28T01:30:00Z" }));
  assert(errorName(err) === "BadRequestException", `an unknown key threw ${errorName(err)}`);
  assert(calls.length === 0, `an unknown key reached the service: ${JSON.stringify(calls)}`);
}

/**
 * R-6: the refine names the field. `Not/AZone` passes the segment-casing
 * regex and fails `Intl.DateTimeFormat`'s construction — the half of the
 * rule the mutation "drop the refine" removes; the key `timezone` in
 * `fieldErrors` is what this row reads, because `.strict()` alone answers a
 * 400 with no field for this input.
 */
export async function assertCreateRefusesAnUnknownZoneNamingTheField(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const err = await rejects(() => controller.create(USER, { ...VALID_CREATE_BODY, timezone: "Not/AZone" }));
  assert(errorName(err) === "BadRequestException", `Not/AZone threw ${errorName(err)}, not a 400`);
  const messages = fieldErrorsOf(err).timezone;
  assert(messages !== undefined, `the 400 must name timezone in fieldErrors; got ${JSON.stringify(fieldErrorsOf(err))}`);
  assert(
    messages[0] === "timezone is not a known IANA zone",
    `the refine's message must be the R-6 sentence; got ${JSON.stringify(messages)}`,
  );
  assert(calls.length === 0, `Not/AZone reached the service: ${JSON.stringify(calls)}`);
}

/** The amended R-6: `asia/kolkata` constructs under ICU but fails the segment-casing regex — refused. */
export async function assertCreateRefusesALowercaseZone(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const err = await rejects(() => controller.create(USER, { ...VALID_CREATE_BODY, timezone: "asia/kolkata" }));
  assert(errorName(err) === "BadRequestException", `asia/kolkata threw ${errorName(err)}, not a 400`);
  assert(fieldErrorsOf(err).timezone !== undefined, "the 400 for asia/kolkata must name timezone in fieldErrors");
  assert(calls.length === 0, `asia/kolkata reached the service: ${JSON.stringify(calls)}`);
}

/** The positive control for the two refusals above: the pilot's own zone passes the parse. */
export async function assertCreateAcceptsAsiaKolkata(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  await controller.create(USER, { ...VALID_CREATE_BODY, timezone: "Asia/Kolkata" });
  assert(calls.length === 1 && calls[0]?.method === "create", `Asia/Kolkata must reach the service once, got ${JSON.stringify(calls)}`);
}

/** A repeated format is a caller error, not de-duplicated. */
export async function assertCreateRefusesADuplicateFormat(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const err = await rejects(() => controller.create(USER, { ...VALID_CREATE_BODY, formats: ["pdf", "pdf"] }));
  assert(errorName(err) === "BadRequestException", `["pdf","pdf"] threw ${errorName(err)}, not a 400`);
  assert(fieldErrorsOf(err).formats !== undefined, "the 400 must name formats in fieldErrors");
  assert(calls.length === 0, `a duplicate format reached the service: ${JSON.stringify(calls)}`);
}

/** The positive control: a valid body reaches the service once, parsed, with the JWT. */
export async function assertCreateHandsTheParsedBodyAndTheJwtToTheService(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const dto = await controller.create(USER, VALID_CREATE_BODY);
  assert(calls.length === 1 && calls[0]?.method === "create", `expected one create call, got ${JSON.stringify(calls)}`);
  assert(calls[0]?.args[0] === USER, "create must receive the JWT as its first argument");
  assert(
    JSON.stringify(calls[0]?.args[1]) === JSON.stringify(VALID_CREATE_BODY),
    `create must receive the parsed body, got ${JSON.stringify(calls[0]?.args[1])}`,
  );
  assert(dto === ROW, "create must answer the service's DTO verbatim");
}

// ---------------------------------------------------------------------------
// update: the empty PATCH and the parsed id
// ---------------------------------------------------------------------------

/** The E4.1a lesson: `{}` is a 400, never a no-op 200. */
export async function assertUpdateRefusesAnEmptyBody(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const err = await rejects(() => controller.update(USER, { id: SCHEDULE_ID }, {}));
  assert(errorName(err) === "BadRequestException", `an empty PATCH threw ${errorName(err)}, not a 400`);
  assert(calls.length === 0, `an empty PATCH reached the service: ${JSON.stringify(calls)}`);
}

/** `organizationId` is a create-only field: on PATCH it is an unknown key. */
export async function assertUpdateRefusesOrganizationId(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const err = await rejects(() => controller.update(USER, { id: SCHEDULE_ID }, { organizationId: ORG_ID }));
  assert(errorName(err) === "BadRequestException", `organizationId on PATCH threw ${errorName(err)}, not a 400`);
  assert(calls.length === 0, `organizationId on PATCH reached the service: ${JSON.stringify(calls)}`);
}

/** The PATCH timezone carries the same refine as the create body. */
export async function assertUpdateRefusesAnUnknownZone(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const err = await rejects(() => controller.update(USER, { id: SCHEDULE_ID }, { timezone: "asia/kolkata" }));
  assert(errorName(err) === "BadRequestException", `asia/kolkata on PATCH threw ${errorName(err)}, not a 400`);
  assert(calls.length === 0, `asia/kolkata on PATCH reached the service: ${JSON.stringify(calls)}`);
}

/** The positive control: a one-field PATCH reaches the service with the parsed id and body. */
export async function assertUpdateHandsTheIdAndTheBodyToTheService(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const dto = await controller.update(USER, { id: SCHEDULE_ID }, { enabled: false });
  assert(calls.length === 1 && calls[0]?.method === "update", `expected one update call, got ${JSON.stringify(calls)}`);
  assert(calls[0]?.args[0] === USER && calls[0]?.args[1] === SCHEDULE_ID, "update must receive the JWT and the parsed id");
  assert(JSON.stringify(calls[0]?.args[2]) === JSON.stringify({ enabled: false }), "update must receive the parsed body");
  assert(dto === ROW, "update must answer the service's DTO verbatim");
}

/** A malformed id is a 400 from the param parse, before the service. */
export async function assertGetRefusesAMalformedId(): Promise<void> {
  const { schedules, calls } = serviceStub();
  const controller = new ReportSchedulesController(schedules);
  const err = await rejects(() => controller.get(USER, { id: "not-a-uuid" }));
  assert(errorName(err) === "BadRequestException", `a malformed id threw ${errorName(err)}, not a 400`);
  assert(calls.length === 0, `a malformed id reached the service: ${JSON.stringify(calls)}`);
}

// ---------------------------------------------------------------------------
// Status codes and the registry
// ---------------------------------------------------------------------------

export function assertCreateAnswers201(): void {
  assert(
    Reflect.getMetadata(HTTP_CODE_METADATA, ReportSchedulesController.prototype.create) === 201,
    "create must declare @HttpCode(201)",
  );
}

export function assertRemoveAnswers204(): void {
  assert(
    Reflect.getMetadata(HTTP_CODE_METADATA, ReportSchedulesController.prototype.remove) === 204,
    "remove must declare @HttpCode(204)",
  );
}

/** ADR 0029: the two bodies are registered under the handler names; list/get/remove take no body and no query. */
export function assertTheRegistryNamesTheTwoBodies(): void {
  assert("ReportSchedulesController_create" in REQUEST_SCHEMAS, "the registry must name ReportSchedulesController_create");
  assert("ReportSchedulesController_update" in REQUEST_SCHEMAS, "the registry must name ReportSchedulesController_update");
  for (const absent of ["ReportSchedulesController_list", "ReportSchedulesController_get", "ReportSchedulesController_remove"]) {
    assert(!(absent in REQUEST_SCHEMAS), `${absent} takes no body and no query and must stay out of the registry`);
  }
}

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

/** The scan: `create`'s text parses before it calls the service. */
export function assertCreateParsesBeforeTheService(): void {
  const body = createBody(source());
  const parseAt = body.indexOf(".parse(");
  const serviceAt = body.indexOf("this.schedules.create(");
  assert(parseAt > -1 && serviceAt > -1, "the scan must find both .parse( and this.schedules.create( in create");
  assert(parseAt < serviceAt, `create calls the service (at ${serviceAt}) before it parses (at ${parseAt})`);
}

/** The scan: `update`'s text parses before it calls the service. */
export function assertUpdateParsesBeforeTheService(): void {
  const body = updateBody(source());
  const parseAt = body.indexOf(".parse(");
  const serviceAt = body.indexOf("this.schedules.update(");
  assert(parseAt > -1 && serviceAt > -1, "the scan must find both .parse( and this.schedules.update( in update");
  assert(parseAt < serviceAt, `update calls the service (at ${serviceAt}) before it parses (at ${parseAt})`);
}

/** ADR 0066 decision 4: no handler argument is a key. */
export function assertNoHandlerArgumentIsAKey(): void {
  const text = source();
  const offenders = [...text.matchAll(/@(Body|Param|Query)\(\)\s+(key|objectKey)\b/g)].map((m) => m[0]);
  assert(offenders.length === 0, `no handler argument may be named key/objectKey: ${offenders.join(", ")}`);
}

export function assertTheClassCarriesTheGuardAndThePrefix(): void {
  const text = source();
  assert(decoratorAt(text, '@Controller("reports")') > -1, 'the class must declare @Controller("reports")');
  assert(decoratorAt(text, "@UseGuards(JwtAuthGuard)") > -1, "the class must declare @UseGuards(JwtAuthGuard)");
}

/**
 * No `@Res()` parameter: every handler returns its DTO and lets Nest write
 * it. The pattern is a decorator followed by a parameter name and a colon —
 * the class docblock spells `@Res()` in prose, and a text scan reads
 * docblock prose too.
 */
export function assertNoHandlerUsesRes(): void {
  assert(!/@Res\(\)\s+[A-Za-z_]+\s*:/.test(source()), "no schedule handler may take @Res()");
}
