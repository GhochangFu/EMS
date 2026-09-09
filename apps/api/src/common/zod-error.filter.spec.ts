import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { FILTER_CATCH_EXCEPTIONS } from "@nestjs/common/constants";
import { expect } from "vitest";
import { ZodError, z } from "zod";

import { repoRoot } from "../testing/repo-root";
import { parseStoredContract } from "./parse-stored-contract";
import { ZodErrorFilter } from "./zod-error.filter";

/**
 * `F4.108` / ADR 0060 — assertions only (ADR 0014, §4.6).
 * `zod-error.filter.test.ts` is the Vitest entry point.
 *
 * The host is a hand-built double rather than a booted Nest application, which
 * is §4.6's rule here rather than a shortcut: `F4.20` records that esbuild emits
 * no `design:paramtypes` in this environment, so a module cannot be
 * instantiated to ask the framework anything. What a double *can* prove is
 * everything this filter decides — the status, the body, and what it declines
 * to handle.
 */

/**
 * `idParamSchema` as `admin.schema.ts` declares it, re-declared here rather than
 * imported.
 *
 * Importing it would make the assertion "the filter flattens whatever
 * `admin.schema.ts` currently says", which is not the claim. The claim is about
 * `z.string().uuid()` — a **bare string**, whose issue has an empty path — and
 * that is the property ADR 0060 turns on. The reader who widens
 * `idParamSchema` into an object wrapper should see this assertion fail and go
 * read `F4.115`, not have it silently follow them.
 */
const BARE_UUID = z.string().uuid();

function zodErrorFrom(schema: z.ZodTypeAny, value: unknown): ZodError {
  const result = schema.safeParse(value);
  expect(result.success, "the fixture must fail to parse or nothing below is measured").toBe(false);
  return (result as { error: ZodError }).error;
}

interface Captured {
  status: number | null;
  body: unknown;
}

/** A minimal `ArgumentsHost` over an Express-shaped response. */
function httpHost(): { host: ArgumentsHost; captured: Captured } {
  const captured: Captured = { status: null, body: undefined };
  const response = {
    status(code: number) {
      captured.status = code;
      return response;
    },
    json(body: unknown) {
      captured.body = body;
      return response;
    },
  };
  const host = {
    getType: () => "http",
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

export function assertAMalformedParameterAnswers400(): void {
  const { host, captured } = httpHost();
  new ZodErrorFilter().catch(zodErrorFrom(BARE_UUID, "not-a-uuid"), host);

  expect(
    captured.status,
    "the whole row: an unguarded idParamSchema failure answered 500 before ADR 0060, so a " +
      "mistyped link was recorded as a server fault",
  ).toBe(HttpStatus.BAD_REQUEST);
}

/**
 * The body is `flatten()` and nothing else — ADR 0060 ruling 3.
 *
 * The absence half is the one that matters. `BadRequestException(err.flatten())`
 * answers the flattened object bare because `HttpException.createBody` returns
 * an object argument unchanged; an implementation that reached for
 * `BadRequestException` and let Nest wrap a *string* would answer
 * `{statusCode, message, error}`, which `apiErrorMessage` does not render.
 */
export function assertTheBodyIsTheFlattenedErrorAndNothingElse(): void {
  const { host, captured } = httpHost();
  const error = zodErrorFrom(z.object({ name: z.string() }), { name: 7 });
  new ZodErrorFilter().catch(error, host);

  expect(captured.body, "the body must be exactly what the 70 guarded sites already throw").toEqual(
    error.flatten(),
  );
  expect(
    Object.keys(captured.body as object).sort(),
    "no statusCode/message/error wrapper — apps/web's apiErrorMessage reads formErrors first " +
      "and then each fieldErrors key, and renders nothing for a Nest envelope",
  ).toEqual(["fieldErrors", "formErrors"]);
}

/**
 * A parameter refusal is unlabelled — the mirror image of `F4.115`.
 *
 * `z.string().uuid()` has no object wrapper, so the issue path is empty and
 * `flatten()` files the message under `formErrors`. `F4.115` is the other
 * direction: `patchDraftBodySchema` wrapped a path-less issue and it landed in
 * `fieldErrors.draft`.
 */
export function assertAMalformedIdLandsInFormErrorsNotFieldErrors(): void {
  const { host, captured } = httpHost();
  new ZodErrorFilter().catch(zodErrorFrom(BARE_UUID, "not-a-uuid"), host);
  const body = captured.body as { formErrors: string[]; fieldErrors: Record<string, string[]> };

  expect(body.formErrors, "the message has no field to name, so it must be unlabelled").toHaveLength(
    1,
  );
  expect(body.fieldErrors, "naming a field here would invent one").toEqual({});
}

/**
 * A global filter is consulted for every execution context, and this
 * application runs a Socket.IO adapter. `switchToHttp()` on a ws host yields a
 * client, so `.status(…)` would throw a `TypeError` that buries the original.
 */
export function assertANonHttpHostRethrowsTheOriginalError(): void {
  const error = zodErrorFrom(BARE_UUID, "not-a-uuid");
  const wsHost = {
    getType: () => "ws",
    switchToHttp: () => {
      throw new Error("switchToHttp must not be reached on a ws host");
    },
  } as unknown as ArgumentsHost;

  expect(() => new ZodErrorFilter().catch(error, wsHost)).toThrow(error);
}

/**
 * **Ruling 2's gate, and it belongs here rather than in commit 2.**
 *
 * The eight stored-data parses answer 500 before ADR 0060 and 500 after, so
 * nothing about them alone proves the ordering mattered. What proves it is
 * this: the filter's caught set holds `ZodError` and the server fault
 * `parseStoredContract` raises is not one. Widen the decorator to `@Catch()`
 * and a corrupt dashboard template becomes the caller's 400 — silently, with
 * every other test in this repo still green.
 */
export function assertTheFilterCatchesZodErrorAndNotTheStoredContractFault(): void {
  const caught = Reflect.getMetadata(FILTER_CATCH_EXCEPTIONS, ZodErrorFilter) as
    | Array<new (...args: never[]) => unknown>
    | undefined;

  expect(
    (caught ?? []).some((type) => zodErrorFrom(BARE_UUID, "nope") instanceof type),
    "the filter must catch ZodError — with an empty or narrower @Catch() it answers nothing " +
      "and the 44 unguarded controller sites keep their 500",
  ).toBe(true);

  let fault: unknown;
  try {
    parseStoredContract(BARE_UUID, 7, "dashboard_templates.map.dto");
  } catch (err) {
    fault = err;
  }
  expect(
    (caught ?? []).some((type) => fault instanceof type),
    "the filter must NOT catch what parseStoredContract raises. A @Catch() with no argument " +
      "catches everything, including that 500, and would report a corrupt stored row as the " +
      "caller's bad request — the exact reclassification ADR 0060 ruling 2 exists to prevent.",
  ).toBe(false);
}

/**
 * `zod` must be **one** class for the resolution `apps/api` runs under, and
 * both halves of ADR 0060 rest on that without anything else saying so.
 *
 * Every one of the eight sites ruling 2 converts parses a schema declared in
 * `packages/shared/src/contracts/`, while `parseStoredContract`'s
 * `err instanceof ZodError` and this filter's `@Catch(ZodError)` resolve `zod`
 * from `apps/api`. Two physical copies — a hoisting change, a version bump on
 * one package, a `pnpm.overrides` edit — and neither `instanceof` matches: the
 * helper re-throws the raw `ZodError`, the filter answers **400**, and a corrupt
 * stored row is reported as the caller's bad request with the whole suite green.
 * The same split silently breaks the 70 `catch (err) { if (err instanceof
 * ZodError) }` sites that predate this row.
 *
 * ---
 *
 * ## Why `createRequire`, and the measurement that forced it
 *
 * **A static `import { sectionTemplateContentSchema } from "@bms/shared"` in
 * this file measures the runner, not the application.** Written that way the
 * assertion FAILS, and the failure is an artefact:
 *
 * | resolution | `sharedError instanceof ZodError` |
 * |---|---|
 * | Vitest / Vite (this file's `import`) | **false** |
 * | CommonJS `require`, which is how `apps/api` runs | **true** |
 *
 * `packages/shared` publishes `dist/index.js` for both the `import` and the
 * `require` condition, so under Vite the shared package is CommonJS and picks
 * up `zod/index.cjs`, while this file's own `import "zod"` picks up the ESM
 * build — one physical package, two module instances, the classic dual-package
 * hazard. `apps/api` compiles to CommonJS and runs as `node dist/main.js`,
 * where both sides resolve `zod/index.cjs` and the identity holds. Measured
 * both ways rather than reasoned about.
 *
 * So the require is built from `apps/api/package.json`: it asks the question
 * production asks. This is the same lesson `tests/` already carries — reach a
 * `@bms` package through `createRequire`, not through a static import, when
 * the claim is about what ships.
 */
export function assertZodIsOneClassForTheResolutionTheApiRunsUnder(): void {
  const req = createRequire(join(repoRoot(), "apps/api/package.json"));
  const { ZodError: RuntimeZodError } = req("zod") as {
    ZodError: new (...args: never[]) => unknown;
  };
  const shared = req("@bms/shared") as {
    sectionTemplateContentSchema: {
      safeParse: (value: unknown) => { success: boolean; error?: unknown };
    };
  };

  const result = shared.sectionTemplateContentSchema.safeParse({ widgets: "not-an-array" });
  expect(result.success, "the fixture must fail to parse or nothing below is measured").toBe(false);

  expect(
    result.error instanceof RuntimeZodError,
    "a @bms/shared schema's ZodError is not an instance of the ZodError apps/api resolves. " +
      "There are two zod instances in this install, so parseStoredContract re-throws instead " +
      "of raising a 500, ZodErrorFilter then answers 400, and a corrupt stored row is " +
      "reported as the caller's bad request — ADR 0060 ruling 2 defeated at the package " +
      "boundary, with every unit test still green.",
  ).toBe(true);
}

/**
 * ADR 0060 §Verification: *"A mutation removing the filter registration reddens
 * an assertion that names the filter, not merely a suite."*
 *
 * A source scan because `main.ts` calls `NestFactory.create` at import time —
 * importing it here would boot the application. The call is asserted before the
 * import statement is, because deleting the call is the mutation that matters
 * and deleting the import would not compile.
 */
export function assertMainRegistersTheFilterGlobally(): void {
  const source = readFileSync(join(repoRoot(), "apps/api/src/main.ts"), "utf8");

  expect(
    /app\.useGlobalFilters\(\s*new ZodErrorFilter\(\)\s*\)/.test(source),
    "main.ts must call app.useGlobalFilters(new ZodErrorFilter()). Without it every one of " +
      "the 44 unguarded idParamSchema sites is back to a 500, and no other test in this repo " +
      "would notice — the filter's own unit assertions all call it directly.",
  ).toBe(true);
  expect(
    /import\s*\{\s*ZodErrorFilter\s*\}\s*from\s*"\.\/common\/zod-error\.filter"/.test(source),
    "main.ts must import ZodErrorFilter from ./common/zod-error.filter",
  ).toBe(true);
}
